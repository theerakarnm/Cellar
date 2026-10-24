import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { backups, targets } from "../db/schema";
import type { Env } from "../env";
import { redactError } from "../lib/redact";
import { deliverAlert } from "./dispatch";
import { type AlertTarget, buildAlertMessage } from "./message";

/**
 * Call once per backup, right after its row reaches a terminal status (success, failed, timed_out).
 * Updates the failure episode state on the target and sends alerts. Never throws.
 */
export async function notifyBackupFinished(env: Env, backupId: string): Promise<void> {
  try {
    await handleBackupFinished(env, backupId);
  } catch (error) {
    console.warn(JSON.stringify({ msg: "alert processing failed", backupId, error: redactError(error) }));
  }
}

/**
 * Runs `task` after the response when an execution context exists. Hono throws on `c.executionCtx`
 * when the app was called without one (as route tests do), so the task is returned to be awaited then.
 */
export function afterResponse(c: { readonly executionCtx: Pick<ExecutionContext, "waitUntil"> }, task: Promise<void>): Promise<void> {
  try {
    c.executionCtx.waitUntil(task);
    return Promise.resolve();
  } catch {
    return task;
  }
}

async function handleBackupFinished(env: Env, backupId: string): Promise<void> {
  const db = getDb(env);
  const row = await db
    .select({
      status: backups.status,
      errorCode: backups.errorCode,
      errorMessage: backups.errorMessage,
      finishedAt: backups.finishedAt,
      deletedAt: targets.deletedAt,
      targetId: targets.id,
      name: targets.name,
      projectTag: targets.projectTag,
      timezone: targets.timezone,
    })
    .from(backups)
    .innerJoin(targets, eq(backups.targetId, targets.id))
    .where(eq(backups.id, backupId))
    .get();
  if (!row || row.deletedAt) return;

  if (row.status === "success") {
    await db
      .update(targets)
      .set({ consecutiveFailures: 0, failureAlertedAt: null, staleAlertedAt: null })
      .where(eq(targets.id, row.targetId));
    return;
  }
  if (row.status !== "failed" && row.status !== "timed_out") return;

  const target: AlertTarget = { id: row.targetId, name: row.name, projectTag: row.projectTag, timezone: row.timezone };
  const at = row.finishedAt ? new Date(row.finishedAt) : new Date();
  const [counter] = await db
    .update(targets)
    .set({ consecutiveFailures: sql`${targets.consecutiveFailures} + 1` })
    .where(eq(targets.id, row.targetId))
    .returning({ count: targets.consecutiveFailures, threshold: targets.alertFailureThreshold });
  if (!counter) return;

  const error = { errorCode: row.errorCode, errorMessage: row.errorMessage };
  await deliverAlert(
    env,
    target.id,
    "backup_failed",
    buildAlertMessage(target, { event: "backup_failed", status: row.status, ...error }, at, env.APP_BASE_URL),
  );

  if (counter.count < counter.threshold) return;
  const claimed = await db
    .update(targets)
    .set({ failureAlertedAt: at.toISOString() })
    .where(and(eq(targets.id, target.id), isNull(targets.failureAlertedAt)))
    .returning({ id: targets.id });
  if (claimed.length === 0) return;
  await deliverAlert(
    env,
    target.id,
    "backup_consecutive_failures",
    buildAlertMessage(target, { event: "backup_consecutive_failures", count: counter.count, ...error }, at, env.APP_BASE_URL),
  );
}
