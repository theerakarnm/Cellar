import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { notifyBackupFinished } from "../alerts/notify";
import { getDb } from "../db/client";
import { backups, connectionTests, targets } from "../db/schema";
import type { Env } from "../env";
import { sweepRestores } from "./restore-sweeper";
import {
  CONNECTION_TEST_RETENTION_MS,
  HEARTBEAT_TIMEOUT_MS,
  QUEUE_TIMEOUT_MS,
  TEST_DEADLINE_MINUTES,
} from "./types";

export interface SweepResult {
  timedOut: string[];
  queueTimedOut: string[];
}

interface RunningRow {
  id: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  deadlineMinutes: number;
}

/** Why a running job must be timed out, or null when it is healthy. The deadline wins over a lost heartbeat. */
function timeoutReason(row: RunningRow, nowMs: number): "DEADLINE_EXCEEDED" | "HEARTBEAT_LOST" | null {
  const startedMs = row.startedAt ? Date.parse(row.startedAt) : nowMs;
  if (startedMs + row.deadlineMinutes * 60_000 <= nowMs) return "DEADLINE_EXCEEDED";
  const heartbeatMs = row.heartbeatAt ? Date.parse(row.heartbeatAt) : startedMs;
  if (nowMs - heartbeatMs >= HEARTBEAT_TIMEOUT_MS) return "HEARTBEAT_LOST";
  return null;
}

/**
 * Cron step 2. Running jobs without a heartbeat for 5 minutes or past their deadline become `timed_out`
 * (and their container is stopped). Jobs `queued` for more than 1 hour become `failed` with `queue_timeout`.
 * Finished connection tests older than 7 days are deleted. Applies to `backups`, `connection_tests`, and, via
 * `sweepRestores`, `restores`.
 */
export async function sweepStaleJobs(env: Env, now: Date, stop: (jobId: string) => Promise<void>): Promise<SweepResult> {
  const db = getDb(env);
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const result: SweepResult = { timedOut: [], queueTimedOut: [] };

  const runningBackups = await db
    .select({ id: backups.id, targetId: backups.targetId, startedAt: backups.startedAt, heartbeatAt: backups.heartbeatAt, deadlineMinutes: targets.jobDeadlineMinutes })
    .from(backups)
    .innerJoin(targets, eq(backups.targetId, targets.id))
    .where(eq(backups.status, "running"))
    .limit(200);
  for (const row of runningBackups) {
    const reason = timeoutReason(row, nowMs);
    if (!reason) continue;
    const changed = await db
      .update(backups)
      .set({ status: "timed_out", errorCode: reason, errorMessage: "The job stopped reporting progress or passed its deadline", finishedAt: nowIso })
      .where(and(eq(backups.id, row.id), eq(backups.status, "running")))
      .returning({ id: backups.id });
    if (changed.length === 0) continue;
    await db.update(targets).set({ lastStatus: "timed_out" }).where(eq(targets.id, row.targetId));
    await notifyBackupFinished(env, row.id);
    result.timedOut.push(row.id);
    await stop(row.id);
  }

  const runningTests = await db
    .select({ id: connectionTests.id, startedAt: connectionTests.startedAt, heartbeatAt: connectionTests.heartbeatAt })
    .from(connectionTests)
    .where(eq(connectionTests.status, "running"))
    .limit(200);
  for (const row of runningTests) {
    const reason = timeoutReason({ ...row, deadlineMinutes: TEST_DEADLINE_MINUTES }, nowMs);
    if (!reason) continue;
    const changed = await db
      .update(connectionTests)
      .set({ status: "timed_out", errorCode: reason, errorMessage: "The test stopped reporting progress or passed its deadline", finishedAt: nowIso })
      .where(and(eq(connectionTests.id, row.id), eq(connectionTests.status, "running")))
      .returning({ id: connectionTests.id });
    if (changed.length === 0) continue;
    result.timedOut.push(row.id);
    await stop(row.id);
  }

  const queueCutoff = new Date(nowMs - QUEUE_TIMEOUT_MS).toISOString();
  const queueFailure = { status: "failed" as const, errorCode: "queue_timeout", errorMessage: "The job waited more than 1 hour in the queue", finishedAt: nowIso };
  const staleBackups = await db
    .update(backups)
    .set(queueFailure)
    .where(and(eq(backups.status, "queued"), lte(backups.queuedAt, queueCutoff)))
    .returning({ id: backups.id, targetId: backups.targetId });
  for (const row of staleBackups) {
    await db.update(targets).set({ lastStatus: "failed" }).where(eq(targets.id, row.targetId));
    await notifyBackupFinished(env, row.id);
    result.queueTimedOut.push(row.id);
  }
  const staleTests = await db
    .update(connectionTests)
    .set(queueFailure)
    .where(and(eq(connectionTests.status, "queued"), lte(connectionTests.queuedAt, queueCutoff)))
    .returning({ id: connectionTests.id });
  result.queueTimedOut.push(...staleTests.map((row) => row.id));

  await db
    .delete(connectionTests)
    .where(
      and(
        inArray(connectionTests.status, ["success", "failed", "timed_out"]),
        lt(connectionTests.queuedAt, new Date(nowMs - CONNECTION_TEST_RETENTION_MS).toISOString()),
      ),
    );

  await sweepRestores(env, now);
  return result;
}
