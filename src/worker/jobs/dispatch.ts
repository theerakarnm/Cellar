import { and, asc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { nextRun } from "../../shared/cron";
import { getDb } from "../db/client";
import { backups, connectionTests, targets } from "../db/schema";
import type { Env } from "../env";
import { ApiError } from "../lib/api-error";
import { uuidv7 } from "../lib/uuidv7";
import { failJob } from "./state";
import { DUE_BATCH_LIMIT, type JobMessage } from "./types";

/** UTC ISO minute of an instant, for example 2026-10-24T02:00:00.000Z. */
export function scheduleSlot(at: Date): string {
  return `${at.toISOString().slice(0, 16)}:00.000Z`;
}

function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}

/** Sends the queue message. If the send fails, the row is marked failed so it never sits `queued` for an hour. */
async function enqueue(env: Env, message: JobMessage, now: Date): Promise<boolean> {
  try {
    await env.JOBS.send(message);
    return true;
  } catch {
    console.error(`jobs: enqueue failed for ${message.type} ${message.jobId}`);
    await failJob(env, message.type, message.jobId, { code: "enqueue_failed", message: "The job could not be queued" }, now.toISOString());
    return false;
  }
}

export interface EnqueueResult {
  /** Backup ids whose queue message was sent this tick, including re-sends for still-`queued` slot rows. */
  enqueued: string[];
  /** Targets whose slot was due but which already have a queued or running backup. They are retried next tick. */
  blocked: string[];
}

/**
 * Cron step 1. For each due target: insert the `queued` row for the slot (the unique indexes make this
 * idempotent), send the queue message, then advance `next_run_at`. When the slot row already exists and is
 * still `queued`, a previous tick may have died between the insert and the send, so the message is sent
 * again; the consumer claim is idempotent. A running or finished slot row is never re-sent.
 */
export async function enqueueDueBackups(env: Env, now: Date): Promise<EnqueueResult> {
  const db = getDb(env);
  const nowIso = now.toISOString();
  const due = await db
    .select({ id: targets.id, scheduleCron: targets.scheduleCron, timezone: targets.timezone, nextRunAt: targets.nextRunAt })
    .from(targets)
    .where(and(eq(targets.enabled, true), isNull(targets.deletedAt), isNotNull(targets.nextRunAt), lte(targets.nextRunAt, nowIso)))
    .orderBy(asc(targets.nextRunAt))
    .limit(DUE_BATCH_LIMIT);

  const result: EnqueueResult = { enqueued: [], blocked: [] };
  for (const target of due) {
    if (!target.nextRunAt) continue;
    try {
      const slotTime = new Date(target.nextRunAt);
      const slot = scheduleSlot(slotTime);
      const jobId = uuidv7(now.getTime());
      const inserted = await db
        .insert(backups)
        .values({ id: jobId, targetId: target.id, status: "queued", trigger: "schedule", scheduleSlot: slot, queuedAt: nowIso })
        .onConflictDoNothing()
        .returning({ id: backups.id });

      if (inserted.length === 0) {
        const [sameSlot] = await db
          .select({ id: backups.id, status: backups.status })
          .from(backups)
          .where(and(eq(backups.targetId, target.id), eq(backups.scheduleSlot, slot)))
          .limit(1);
        if (!sameSlot) {
          result.blocked.push(target.id);
          continue;
        }
        const reSent =
          sameSlot.status === "queued" &&
          (await enqueue(env, { jobId: sameSlot.id, type: "backup", targetId: target.id }, now));
        if (reSent) result.enqueued.push(sameSlot.id);
      } else if (await enqueue(env, { jobId, type: "backup", targetId: target.id }, now)) {
        result.enqueued.push(jobId);
      }

      let next = nextRun(target.scheduleCron, target.timezone, slotTime);
      if (next.getTime() <= now.getTime()) next = nextRun(target.scheduleCron, target.timezone, now);
      await db
        .update(targets)
        .set({ nextRunAt: next.toISOString(), updatedAt: nowIso })
        .where(and(eq(targets.id, target.id), eq(targets.nextRunAt, target.nextRunAt)));
    } catch (error) {
      console.error(`jobs: scheduling target ${target.id} failed`, error instanceof Error ? error.name : "unknown");
    }
  }
  return result;
}

/** Backup now. Throws 409 when the target already has a queued or running backup. Returns the backup id. */
export async function queueManualBackup(env: Env, targetId: string, now: Date): Promise<string> {
  const db = getDb(env);
  const jobId = uuidv7(now.getTime());
  try {
    await db.insert(backups).values({ id: jobId, targetId, status: "queued", trigger: "manual", queuedAt: now.toISOString() });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, "conflict", "A backup is already queued or running for this target");
    throw error;
  }
  if (!(await enqueue(env, { jobId, type: "backup", targetId }, now))) {
    throw new ApiError(503, "enqueue_failed", "The backup could not be queued");
  }
  return jobId;
}

/** Test connection. Throws 409 when the target has a queued or running test or backup. Returns the test id. */
export async function queueConnectionTest(env: Env, targetId: string, now: Date): Promise<string> {
  const db = getDb(env);
  const [activeBackup] = await db
    .select({ id: backups.id })
    .from(backups)
    .where(and(eq(backups.targetId, targetId), inArray(backups.status, ["queued", "running"])))
    .limit(1);
  if (activeBackup) throw new ApiError(409, "conflict", "A backup is queued or running for this target");

  const jobId = uuidv7(now.getTime());
  try {
    await db.insert(connectionTests).values({ id: jobId, targetId, status: "queued", queuedAt: now.toISOString() });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, "conflict", "A connection test is already queued or running for this target");
    throw error;
  }
  if (!(await enqueue(env, { jobId, type: "test", targetId }, now))) {
    throw new ApiError(503, "enqueue_failed", "The connection test could not be queued");
  }
  return jobId;
}
