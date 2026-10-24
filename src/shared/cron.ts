import { getZonedParts, zonedTimeToUtc } from "./tz";

type Field = { name: string; min: number; max: number };

const FIELDS: Field[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

type ParsedCron = {
  minutes: number[];
  hours: number[];
  daysOfMonth: Set<number>;
  months: Set<number>;
  /** 0 = Sunday ... 6 = Saturday (7 is folded into 0). */
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
};

const SEARCH_DAYS = 366 * 9;

function parseField(text: string, field: Field): number[] | string {
  const values = new Set<number>();
  for (const item of text.split(",")) {
    const [rangePart = "", stepPart, extra] = item.split("/");
    if (rangePart === "" || extra !== undefined) return `invalid ${field.name} field "${text}"`;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) return `invalid step in ${field.name} field "${text}"`;
      step = Number(stepPart);
    }
    let from: number;
    let to: number;
    if (rangePart === "*") {
      from = field.min;
      to = field.name === "day-of-week" ? 6 : field.max;
    } else {
      const match = /^(\d+)(?:-(\d+))?$/.exec(rangePart);
      if (!match) return `invalid ${field.name} field "${text}"`;
      from = Number(match[1]);
      to = match[2] === undefined ? (stepPart === undefined ? from : field.max) : Number(match[2]);
    }
    if (from < field.min || to > field.max || from > to) {
      return `${field.name} must be between ${field.min} and ${field.max} (got "${item}")`;
    }
    for (let value = from; value <= to; value += step) values.add(field.name === "day-of-week" && value === 7 ? 0 : value);
  }
  return [...values].sort((a, b) => a - b);
}

function parse(expr: string): ParsedCron | string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "cron must have 5 fields: minute hour day-of-month month day-of-week";
  const parsed: number[][] = [];
  for (const [index, field] of FIELDS.entries()) {
    const result = parseField(parts[index] ?? "", field);
    if (typeof result === "string") return result;
    parsed.push(result);
  }
  return {
    minutes: parsed[0] ?? [],
    hours: parsed[1] ?? [],
    daysOfMonth: new Set(parsed[2]),
    months: new Set(parsed[3]),
    daysOfWeek: new Set(parsed[4]),
    domRestricted: !(parts[2] ?? "").startsWith("*"),
    dowRestricted: !(parts[4] ?? "").startsWith("*"),
  };
}

function dayMatches(cron: ParsedCron, date: Date): boolean {
  if (!cron.months.has(date.getUTCMonth() + 1)) return false;
  const domOk = cron.daysOfMonth.has(date.getUTCDate());
  const dowOk = cron.daysOfWeek.has(date.getUTCDay());
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

type Naive = { year: number; month: number; day: number; hour: number; minute: number };

/** First wall time at or after `start` (calendar arithmetic only, no time zone) that matches. */
function nextNaive(cron: ParsedCron, start: Naive): Naive | null {
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    if (!dayMatches(cron, date)) continue;
    for (const hour of cron.hours) {
      if (offset === 0 && hour < start.hour) continue;
      for (const minute of cron.minutes) {
        if (offset === 0 && hour === start.hour && minute < start.minute) continue;
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute };
      }
    }
  }
  return null;
}

/**
 * Returns an error message, or null when `expr` is a usable 5-field cron expression.
 * Supported: `*`, lists `1,2`, ranges `1-5`, steps `*\/15` and `1-30/5`, numeric values only.
 * Day-of-week 0 and 7 are Sunday. When both day-of-month and day-of-week are restricted, either may match.
 */
export function validateCron(expr: string): string | null {
  const cron = parse(expr);
  if (typeof cron === "string") return cron;
  const start = new Date(Date.UTC(2026, 0, 1));
  const first = nextNaive(cron, {
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    day: start.getUTCDate(),
    hour: 0,
    minute: 0,
  });
  return first ? null : "cron never matches a real date";
}

/**
 * The first run strictly after `after`, evaluating the expression in the wall clock of `tz`.
 * DST: a wall time that does not exist runs just after the gap (02:30 becomes 03:30).
 * A wall time that happens twice runs once, at its first occurrence.
 * Throws if `expr` is invalid (call `validateCron` first).
 */
export function nextRun(expr: string, tz: string, after: Date): Date {
  const cron = parse(expr);
  if (typeof cron === "string") throw new Error(cron);
  const p = getZonedParts(after, tz);
  let cursor = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) + 60_000);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const naive = nextNaive(cron, {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
      hour: cursor.getUTCHours(),
      minute: cursor.getUTCMinutes(),
    });
    if (!naive) throw new Error("cron never matches a real date");
    const instant = zonedTimeToUtc({ ...naive, second: 0 }, tz);
    if (instant.getTime() > after.getTime()) return instant;
    cursor = new Date(Date.UTC(naive.year, naive.month - 1, naive.day, naive.hour, naive.minute) + 60_000);
  }
  throw new Error("could not find the next run");
}

/** Milliseconds between the next two runs after `after`. */
export function approxIntervalMs(expr: string, tz: string, after: Date): number {
  const first = nextRun(expr, tz, after);
  return nextRun(expr, tz, first).getTime() - first.getTime();
}
