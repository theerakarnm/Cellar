import { getDb } from "../../../src/worker/db/client";
import { backups } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { app } from "../../../src/worker/app";
import { uuidv7 } from "../../../src/worker/lib/uuidv7";
import { signedHeaders } from "../../worker/jobs/fixtures";

/** Inserts a `running` backup with an r2_key and a fresh heartbeat, as the dispatch step would. */
export async function seedRunningBackup(env: Env, targetId: string, startedAt: string): Promise<{ id: string }> {
  const id = uuidv7();
  await getDb(env).insert(backups).values({
    id,
    targetId,
    status: "running",
    trigger: "schedule",
    r2Key: `backups/${targetId}/${id}.dump`,
    queuedAt: startedAt,
    startedAt,
    heartbeatAt: startedAt,
  });
  return { id };
}

/** Posts a correctly signed `succeeded` callback for the backup through the real app route. */
export async function postSucceededCallback(env: Env, ctx: ExecutionContext, backupId: string): Promise<Response> {
  const body = JSON.stringify({
    jobId: backupId,
    event: "succeeded",
    at: new Date().toISOString(),
    seq: 1,
    result: { sizeBytes: 1, sha256: "a".repeat(64) },
  });
  const signed = await signedHeaders(env, backupId, body, Date.now() / 1000);
  return app.request(
    "http://localhost/internal/jobs/callback",
    {
      method: "POST",
      body,
      headers: { "X-Cellar-Timestamp": signed.timestamp, "X-Cellar-Signature": signed.signature },
    },
    env,
    ctx,
  );
}
