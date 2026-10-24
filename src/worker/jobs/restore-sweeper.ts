import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { restores, targets } from "../db/schema";
import type { Env } from "../env";
import { stopJob } from "./runner-client";
import { HEARTBEAT_TIMEOUT_MS, QUEUE_TIMEOUT_MS } from "./types";

export interface RestoreSweepResult {
  timedOut: string[];
  queueTimedOut: string[];
}

/**
 * PLAN.md section 6 rules, applied to `restores`:
 * - `running` with no heartbeat for 5 minutes, or past `started_at + destination job_deadline_minutes`, becomes `timed_out`.
 * - `queued` for more than 1 hour becomes `failed` with `error_code = queue_timeout`.
 * Updates are guarded by the current status, so a callback that wins the race is never overwritten.
 */
export async function sweepRestores(env: Env, now = new Date()): Promise<RestoreSweepResult> {
  const db = getDb(env);
  const nowMs = now.getTime();
  const at = now.toISOString();
  const result: RestoreSweepResult = { timedOut: [], queueTimedOut: [] };

  const running = await db
    .select({ id: restores.id, startedAt: restores.startedAt, heartbeatAt: restores.heartbeatAt, deadlineMinutes: targets.jobDeadlineMinutes })
    .from(restores)
    .innerJoin(targets, eq(targets.id, restores.destinationTargetId))
    .where(eq(restores.status, "running"));

  for (const row of running) {
    const lastBeatMs = Date.parse(row.heartbeatAt ?? row.startedAt ?? at);
    const deadlineMs = Date.parse(row.startedAt ?? at) + row.deadlineMinutes * 60_000;
    if (nowMs - lastBeatMs <= HEARTBEAT_TIMEOUT_MS && nowMs <= deadlineMs) continue;
    const changed = await db
      .update(restores)
      .set({ status: "timed_out", errorCode: "TIMEOUT", errorMessage: "No heartbeat from the container, or the job deadline passed", finishedAt: at })
      .where(and(eq(restores.id, row.id), eq(restores.status, "running")))
      .returning({ id: restores.id });
    if (changed.length === 0) continue;
    result.timedOut.push(row.id);
    try {
      await stopJob(env, row.id);
    } catch {
      console.warn(`restore sweeper: could not stop container for ${row.id}`);
    }
  }

  const queued = await db
    .update(restores)
    .set({ status: "failed", errorCode: "queue_timeout", errorMessage: "The restore waited in the queue for more than 1 hour", finishedAt: at })
    .where(and(eq(restores.status, "queued"), lt(restores.queuedAt, new Date(nowMs - QUEUE_TIMEOUT_MS).toISOString())))
    .returning({ id: restores.id });
  result.queueTimedOut.push(...queued.map((r) => r.id));
  return result;
}
