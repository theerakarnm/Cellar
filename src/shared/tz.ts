export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday. */
  weekday: number;
};

export type WallTime = Omit<ZonedParts, "weekday">;

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

/** True for IANA names such as "Asia/Bangkok" and "UTC". Offsets such as "+07:00" are rejected. */
export function isValidTimeZone(tz: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `date` in `tz`. */
export function getZonedParts(date: Date, tz: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(tz).formatToParts(date)) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday ?? ""] ?? 0,
  };
}

function offsetMs(instantMs: number, tz: string): number {
  const p = getZonedParts(new Date(instantMs), tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Converts a local wall time in `tz` to an instant.
 * - Normal time: the single matching instant.
 * - Overlap (clocks go back, the wall time happens twice): the EARLIER instant.
 * - Gap (clocks go forward, the wall time does not exist): the wall time is read with the offset in force
 *   before the gap, so the result lands after the gap (02:30 becomes 03:30 when 02:00 jumps to 03:00).
 */
export function zonedTimeToUtc(wall: WallTime, tz: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const before = offsetMs(guess - DAY_MS, tz);
  const after = offsetMs(guess + DAY_MS, tz);
  const matches = (instant: number): boolean => {
    const p = getZonedParts(new Date(instant), tz);
    return (
      p.year === wall.year &&
      p.month === wall.month &&
      p.day === wall.day &&
      p.hour === wall.hour &&
      p.minute === wall.minute &&
      p.second === wall.second
    );
  };
  const valid = [guess - before, guess - after].filter(matches);
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(guess - before);
}
