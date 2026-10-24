import { and, eq, isNull, sql } from "drizzle-orm";
import { backups, targets } from "../db/schema";
import type { Db } from "./delete-backup";
import { selectBackupsToDelete } from "./gfs";
import type { RetentionBackup, RetentionPolicy } from "./types";

export type TargetRow = typeof targets.$inferSelect;

export interface PlannedDeletion {
  id: string;
  r2Key: string | null;
  startedAt: string;
  sizeBytes: number | null;
}

export interface RetentionPlan {
  keep: string[];
  /** Oldest first, so a per-run cap always removes the oldest backups first. */
  delete: PlannedDeletion[];
  reasons: Record<string, string[]>;
}

/** D1 datetimes without a zone (for example "2026-06-15 12:00:00") are UTC; parsing them as local time would shift the day. */
export function toIsoUtc(value: string): string {
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  return new Date(withZone).toISOString();
}

/** A backup's time for ordering and retention: `started_at`, or `queued_at` when it never started. */
export const backupTime = sql<string>`coalesce(${backups.startedAt}, ${backups.queuedAt})`;

/**
 * The one backup ordering, oldest first: time compared after `toIsoUtc`, then id as the tie-break.
 * The retention plan and the latest-success guard must order rows identically, so both sort with this.
 */
export function compareBackupTime(a: { id: string; startedAt: string }, b: { id: string; startedAt: string }): number {
  return toIsoUtc(a.startedAt).localeCompare(toIsoUtc(b.startedAt)) || a.id.localeCompare(b.id);
}

export async function loadActiveTarget(db: Db, targetId: string): Promise<TargetRow | undefined> {
  return db
    .select()
    .from(targets)
    .where(and(eq(targets.id, targetId), isNull(targets.deletedAt)))
    .get();
}

export async function planRetention(db: Db, target: TargetRow, now: Date): Promise<RetentionPlan> {
  const rows = (
    await db
      .select({ id: backups.id, r2Key: backups.r2Key, sizeBytes: backups.sizeBytes, startedAt: backupTime })
      .from(backups)
      .where(and(eq(backups.targetId, target.id), eq(backups.status, "success"), isNull(backups.deletedAt)))
  )
    .sort(compareBackupTime)
    .map((r) => ({ id: r.id, r2Key: r.r2Key, sizeBytes: r.sizeBytes, startedAt: toIsoUtc(r.startedAt) }));

  const input: RetentionBackup[] = rows.map((r) => ({ id: r.id, status: "success", created_at: r.startedAt }));
  const policy: RetentionPolicy = {
    keep_last: target.keepLast,
    daily: target.keepDaily,
    weekly: target.keepWeekly,
    monthly: target.keepMonthly,
    max_age_days: target.maxAgeDays,
  };
  const selection = selectBackupsToDelete(input, policy, now, target.timezone);

  const doomed = new Set(selection.delete.map((b) => b.id));
  return {
    keep: selection.keep.map((b) => b.id),
    delete: rows.filter((r) => doomed.has(r.id)),
    reasons: selection.reasons,
  };
}
