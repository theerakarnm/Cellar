import { getZonedParts } from "../../shared/tz";
import type { RetentionBackup, RetentionDecision, RetentionPolicy } from "./types";

const DAY_MS = 86_400_000;

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

function limit(n: number | null | undefined): number {
  return n != null && n > 0 ? Math.floor(n) : 0;
}

/** Local calendar day, for example "2026-03-05". */
export function dayKey(at: Date, tz: string): string {
  const p = getZonedParts(at, tz);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/** Local calendar month, for example "2026-03". */
export function monthKey(at: Date, tz: string): string {
  const p = getZonedParts(at, tz);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}`;
}

/** Local ISO week (Monday start, ISO week-year), for example "2026-W10". */
export function isoWeekKey(at: Date, tz: string): string {
  const p = getZonedParts(at, tz);
  const day = Date.UTC(p.year, p.month - 1, p.day);
  const mondayIndex = (new Date(day).getUTCDay() + 6) % 7;
  const thursday = day + (3 - mondayIndex) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
  return `${pad(isoYear, 4)}-W${pad(week, 2)}`;
}

interface Candidate {
  backup: RetentionBackup;
  at: Date;
}

/** Newest backup of each of the `count` most recent distinct keys. */
function newestPerBucket(newestFirst: Candidate[], count: number, keyOf: (at: Date) => string): RetentionBackup[] {
  if (count === 0) return [];
  const winners = new Map<string, RetentionBackup>();
  for (const c of newestFirst) {
    const key = keyOf(c.at);
    if (winners.has(key)) continue;
    if (winners.size === count) break;
    winners.set(key, c.backup);
  }
  return [...winners.values()];
}

export function selectBackupsToDelete(
  backups: RetentionBackup[],
  policy: RetentionPolicy,
  now: Date,
  tz: string,
): RetentionDecision {
  const newestFirst: Candidate[] = backups
    .filter((b) => b.status === "success")
    .map((backup) => {
      const at = new Date(backup.created_at);
      if (Number.isNaN(at.getTime())) throw new RangeError(`Invalid created_at for backup ${backup.id}`);
      return { backup, at };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.backup.id < b.backup.id ? 1 : -1));

  const maxAgeDays = limit(policy.max_age_days);
  const oldestAllowed = maxAgeDays > 0 ? now.getTime() - maxAgeDays * DAY_MS : -Infinity;
  const ageEligible = newestFirst.filter((c) => c.at.getTime() >= oldestAllowed);

  const reasons: Record<string, string[]> = {};
  const addReason = (id: string, reason: string): void => {
    (reasons[id] ??= []).push(reason);
  };

  for (const b of ageEligible.slice(0, limit(policy.keep_last))) addReason(b.backup.id, "keep_last");
  for (const b of newestPerBucket(ageEligible, limit(policy.daily), (d) => dayKey(d, tz))) addReason(b.id, "daily");
  for (const b of newestPerBucket(ageEligible, limit(policy.weekly), (d) => isoWeekKey(d, tz))) addReason(b.id, "weekly");
  for (const b of newestPerBucket(ageEligible, limit(policy.monthly), (d) => monthKey(d, tz))) addReason(b.id, "monthly");

  const latest = newestFirst[0];
  if (latest) addReason(latest.backup.id, "latest_success");

  const keep: RetentionBackup[] = [];
  const del: RetentionBackup[] = [];
  for (const c of newestFirst) (reasons[c.backup.id] ? keep : del).push(c.backup);
  return { keep, delete: del, reasons };
}
