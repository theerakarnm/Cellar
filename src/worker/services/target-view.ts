import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { backups, targetAlertChannels, targets } from "../db/schema";
import type { Env } from "../env";
import { parsePgUrl } from "../../shared/pg-url";
import { decrypt } from "../lib/crypto";

export type TargetRow = typeof targets.$inferSelect;
export type TargetStats = { backupCount: number; totalBackupBytes: number };

export type TargetView = {
  id: string;
  name: string;
  projectTag: string | null;
  dbName: string;
  connection: { host: string; port: number; dbName: string; user: string };
  hasRestoreUrl: boolean;
  hasTunnelToken: boolean;
  tunnelHostname: string;
  scheduleCron: string;
  timezone: string;
  enabled: boolean;
  retention: { keepLast: number | null; daily: number | null; weekly: number | null; monthly: number | null; maxAgeDays: number | null };
  jobDeadlineMinutes: number;
  staleAfterHours: number | null;
  alertFailureThreshold: number;
  nextRunAt: string | null;
  lastBackupAt: string | null;
  lastStatus: string | null;
  alertChannelIds: string[];
  stats: TargetStats;
  createdAt: string;
  updatedAt: string;
};

export const EMPTY_STATS: TargetStats = { backupCount: 0, totalBackupBytes: 0 };

/** Builds the API shape. Reads only masked parts of the stored URL. No `*_enc` value leaves this function. */
export async function toTargetView(env: Env, row: TargetRow, alertChannelIds: string[], stats: TargetStats): Promise<TargetView> {
  const connection = parsePgUrl(await decrypt(row.connectionUrlEnc, env.ENCRYPTION_KEY));
  if (!connection) throw new Error(`Stored connection URL for target ${row.id} is not a valid PostgreSQL URL`);
  return {
    id: row.id,
    name: row.name,
    projectTag: row.projectTag,
    dbName: row.dbName,
    connection,
    hasRestoreUrl: row.restoreUrlEnc !== null,
    hasTunnelToken: row.tunnelTokenIdEnc !== null && row.tunnelTokenSecretEnc !== null,
    tunnelHostname: row.tunnelHostname,
    scheduleCron: row.scheduleCron,
    timezone: row.timezone,
    enabled: row.enabled,
    retention: { keepLast: row.keepLast, daily: row.keepDaily, weekly: row.keepWeekly, monthly: row.keepMonthly, maxAgeDays: row.maxAgeDays },
    jobDeadlineMinutes: row.jobDeadlineMinutes,
    staleAfterHours: row.staleAfterHours,
    alertFailureThreshold: row.alertFailureThreshold,
    nextRunAt: row.nextRunAt,
    lastBackupAt: row.lastBackupAt,
    lastStatus: row.lastStatus,
    alertChannelIds,
    stats,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Successful, not-deleted backups per target. Unfiltered on purpose when no id is given: avoids D1's 100-parameter limit. */
export async function loadStats(db: Db, targetId?: string): Promise<Map<string, TargetStats>> {
  const rows = await db
    .select({ targetId: backups.targetId, backupCount: count(), totalBackupBytes: sql<number>`coalesce(sum(${backups.sizeBytes}), 0)` })
    .from(backups)
    .where(and(eq(backups.status, "success"), isNull(backups.deletedAt), targetId ? eq(backups.targetId, targetId) : undefined))
    .groupBy(backups.targetId);
  return new Map(rows.map((row) => [row.targetId, { backupCount: row.backupCount, totalBackupBytes: row.totalBackupBytes }]));
}

export async function loadAlertChannelIds(db: Db, targetId?: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select()
    .from(targetAlertChannels)
    .where(targetId ? eq(targetAlertChannels.targetId, targetId) : undefined)
    .orderBy(targetAlertChannels.channelId);
  const byTarget = new Map<string, string[]>();
  for (const row of rows) byTarget.set(row.targetId, [...(byTarget.get(row.targetId) ?? []), row.channelId]);
  return byTarget;
}
