import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { backups, connectionTests, targets } from "../db/schema";
import type { Env } from "../env";
import type { JobType } from "./types";

export interface ClaimOptions {
  jobId: string;
  type: JobType;
  nowIso: string;
  /** Backups only: the R2 key chosen for this run. */
  r2Key?: string;
  /** Limit on running backups. Ignored for test jobs. */
  maxConcurrent: number;
}

/**
 * Atomically moves one `queued` job to `running`. Returns false when the row is not `queued`, when the
 * number of running backups is at the limit (tests and restores are not counted), or when the other job
 * type is running for the same target. One SQL statement, so two consumers cannot both pass the checks.
 */
export async function claimJob(env: Env, options: ClaimOptions): Promise<boolean> {
  const { jobId, type, nowIso, r2Key, maxConcurrent } = options;
  const runningBackups = "(SELECT count(*) FROM backups WHERE status = 'running')";
  const statement =
    type === "backup"
      ? env.DB.prepare(
          `UPDATE backups SET status = 'running', started_at = ?, heartbeat_at = ?, attempt = attempt + 1, r2_key = ?
           WHERE id = ? AND status = 'queued'
           AND NOT EXISTS (SELECT 1 FROM connection_tests t WHERE t.target_id = backups.target_id AND t.status = 'running')
           AND ${runningBackups} < ?`,
        ).bind(nowIso, nowIso, r2Key ?? null, jobId, maxConcurrent)
      : env.DB.prepare(
          `UPDATE connection_tests SET status = 'running', started_at = ?, heartbeat_at = ?
           WHERE id = ? AND status = 'queued'
           AND NOT EXISTS (SELECT 1 FROM backups b WHERE b.target_id = connection_tests.target_id AND b.status = 'running')`,
        ).bind(nowIso, nowIso, jobId);
  const result = await statement.run();
  return result.meta.changes > 0;
}

/** Current status of a job row, or null when it does not exist. */
export async function readJobStatus(env: Env, type: JobType, jobId: string): Promise<string | null> {
  const db = getDb(env);
  const [row] =
    type === "backup"
      ? await db.select({ status: backups.status }).from(backups).where(eq(backups.id, jobId)).limit(1)
      : await db.select({ status: connectionTests.status }).from(connectionTests).where(eq(connectionTests.id, jobId)).limit(1);
  return row?.status ?? null;
}

/** The statuses a job row can be failed from. Terminal rows never change. */
export type FailableStatus = "queued" | "running";

/** Moves a job to `failed`. Only rows still in one of `statuses` (default: `queued` and `running`) change. */
export async function failJob(
  env: Env,
  type: JobType,
  jobId: string,
  error: { code: string; message: string },
  nowIso: string,
  statuses: FailableStatus[] = ["queued", "running"],
): Promise<boolean> {
  const db = getDb(env);
  const changes = { status: "failed" as const, errorCode: error.code, errorMessage: error.message, finishedAt: nowIso };
  if (type === "test") {
    const rows = await db
      .update(connectionTests)
      .set(changes)
      .where(and(eq(connectionTests.id, jobId), inArray(connectionTests.status, statuses)))
      .returning({ id: connectionTests.id });
    return rows.length > 0;
  }
  const rows = await db
    .update(backups)
    .set(changes)
    .where(and(eq(backups.id, jobId), inArray(backups.status, statuses)))
    .returning({ targetId: backups.targetId });
  const [row] = rows;
  if (!row) return false;
  await db.update(targets).set({ lastStatus: "failed" }).where(eq(targets.id, row.targetId));
  return true;
}
