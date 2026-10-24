import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { backups, restores, targets } from "../db/schema";
import type { Env } from "../env";
import { decrypt } from "../lib/crypto";
import { deriveJobKey } from "../lib/job-key";
import { redactError } from "../lib/redact";
import { destinationDbNameFromUrl } from "../lib/restore-rules";
import { rewriteForTunnel, type JobPayload } from "./payload";
import { startJob, stopJob } from "./runner-client";
import { CALLBACK_HOST, CALLBACK_PATH, PART_SIZE_BYTES, TUNNEL_LOCAL_PORT, type Db } from "./types";

export type RestoreJobOutcome = "skipped" | "started" | "retry" | "failed";

/** The queue gives up retrying after this many deliveries; the restore row then becomes `failed`. */
export const MAX_START_ATTEMPTS = 3;

type RestoreJobPayload = JobPayload & {
  type: "restore";
  r2: NonNullable<JobPayload["r2"]>;
  restore: { sourceKey: string; targetDbName: string };
};

async function failRestore(db: Db, id: string, code: string, message: string, now: Date): Promise<"failed"> {
  await db
    .update(restores)
    .set({ status: "failed", errorCode: code, errorMessage: message, finishedAt: now.toISOString() })
    .where(and(eq(restores.id, id), inArray(restores.status, ["queued", "running"])));
  return "failed";
}

/**
 * Queue consumer branch for restore messages. Idempotent: only a `queued` row is started.
 * The row stays `queued` until the container sends its `started` callback. Never logs the payload: it holds
 * the restore URL password, the tunnel secret, the job key, and the R2 secret.
 */
export async function runRestoreJob(env: Env, message: { jobId: string; attempts: number }, now = new Date()): Promise<RestoreJobOutcome> {
  const db = getDb(env);
  const [restore] = await db.select().from(restores).where(eq(restores.id, message.jobId)).limit(1);
  if (!restore || restore.status !== "queued") return "skipped";

  const [backup] = await db.select().from(backups).where(eq(backups.id, restore.sourceBackupId)).limit(1);
  if (!backup || backup.status !== "success" || backup.deletedAt !== null || backup.r2Key === null) {
    return failRestore(db, restore.id, "backup_unavailable", "The source backup is no longer available", now);
  }
  const [destination] = await db.select().from(targets).where(eq(targets.id, restore.destinationTargetId)).limit(1);
  if (!destination || destination.deletedAt !== null || destination.restoreUrlEnc === null) {
    return failRestore(db, restore.id, "target_unavailable", "The destination target was deleted or has no restore connection URL", now);
  }

  const restoreUrl = await decrypt(destination.restoreUrlEnc, env.ENCRYPTION_KEY);
  const targetDbName = destinationDbNameFromUrl(restoreUrl);
  if (targetDbName === null) {
    return failRestore(db, restore.id, "target_unavailable", "The destination restore connection URL does not name a database", now);
  }

  const callbackBase = env.CALLBACK_BASE_URL ? env.CALLBACK_BASE_URL.replace(/\/+$/, "") : `http://${CALLBACK_HOST}`;
  const payload: RestoreJobPayload = {
    jobId: restore.id,
    type: "restore",
    callbackUrl: `${callbackBase}${CALLBACK_PATH}`,
    jobKey: await deriveJobKey(env.ENCRYPTION_KEY, restore.id),
    deadlineAt: new Date(now.getTime() + destination.jobDeadlineMinutes * 60_000).toISOString(),
    db: { url: rewriteForTunnel(restoreUrl, TUNNEL_LOCAL_PORT), name: targetDbName },
    tunnel: {
      hostname: destination.tunnelHostname,
      tokenId: await decrypt(destination.tunnelTokenIdEnc, env.ENCRYPTION_KEY),
      tokenSecret: await decrypt(destination.tunnelTokenSecretEnc, env.ENCRYPTION_KEY),
      localPort: TUNNEL_LOCAL_PORT,
    },
    r2: {
      endpoint: env.R2_ENDPOINT,
      bucket: env.R2_BUCKET,
      key: backup.r2Key,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      partSizeBytes: PART_SIZE_BYTES,
    },
    restore: { sourceKey: backup.r2Key, targetDbName },
  };

  try {
    await startJob(env, payload);
    return "started";
  } catch (error) {
    await stopJob(env, restore.id);
    if (message.attempts < MAX_START_ATTEMPTS) return "retry";
    return failRestore(db, restore.id, "start_failed", redactError(error), now);
  }
}
