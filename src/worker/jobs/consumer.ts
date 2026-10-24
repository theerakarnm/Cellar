import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { targets } from "../db/schema";
import type { Env } from "../env";
import { getSettings } from "../lib/settings";
import { buildJobPayload, type JobPayload } from "./payload";
import { buildBackupKey } from "../lib/r2-key";
import { claimJob, failJob, readJobStatus } from "./state";
import { jobMessageSchema, QUEUE_RETRY_DELAY_SECONDS } from "./types";

export interface ConsumerDeps {
  startJob(payload: JobPayload): Promise<void>;
  now(): Date;
}

export interface QueueMessageLike {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

/**
 * Handles one queue message (`max_batch_size` is 1). Idempotent: a message whose row is not `queued` is acked
 * and ignored. Never logs the payload.
 */
export async function handleJobMessage(env: Env, message: QueueMessageLike, deps: ConsumerDeps): Promise<void> {
  const parsed = jobMessageSchema.safeParse(message.body);
  if (!parsed.success) {
    console.warn("jobs: dropped a malformed queue message");
    message.ack();
    return;
  }
  const { jobId, type, targetId } = parsed.data;
  const now = deps.now();
  const nowIso = now.toISOString();
  const db = getDb(env);

  const status = await readJobStatus(env, type, jobId);
  if (status !== "queued") {
    message.ack();
    return;
  }

  const [target] = await db
    .select()
    .from(targets)
    .where(and(eq(targets.id, targetId), isNull(targets.deletedAt)))
    .limit(1);
  if (!target) {
    await failJob(env, type, jobId, { code: "target_unavailable", message: "The target no longer exists" }, nowIso);
    message.ack();
    return;
  }

  const r2Key = type === "backup" ? buildBackupKey(target.id, target.dbName, now) : undefined;
  const { max_concurrent_jobs: maxConcurrent } = await getSettings(db);
  const claimed = await claimJob(env, { jobId, type, nowIso, r2Key, maxConcurrent });
  if (!claimed) {
    if ((await readJobStatus(env, type, jobId)) === "queued") message.retry({ delaySeconds: QUEUE_RETRY_DELAY_SECONDS });
    else message.ack();
    return;
  }

  try {
    const payload = await buildJobPayload(env, target, { id: jobId, type, r2Key }, now);
    await deps.startJob(payload);
  } catch (error) {
    console.error(`jobs: could not start ${type} ${jobId}`, error instanceof Error ? error.name : "unknown");
    await failJob(env, type, jobId, { code: "START_FAILED", message: "The container could not be started" }, deps.now().toISOString());
  }
  message.ack();
}
