import type { targets } from "../db/schema";
import type { Env } from "../env";
import { decrypt } from "../lib/crypto";
import { deriveJobKey } from "../lib/job-key";
import {
  CALLBACK_HOST,
  CALLBACK_PATH,
  PART_SIZE_BYTES,
  TEST_DEADLINE_MINUTES,
  TUNNEL_LOCAL_PORT,
  type JobType,
} from "./types";

export type TargetRow = typeof targets.$inferSelect;

/** Worker-to-container job input (docs/PLAN.md section 5). Contains secrets: never log or queue it. */
export interface JobPayload {
  jobId: string;
  type: JobType;
  callbackUrl: string;
  jobKey: string;
  deadlineAt: string;
  db: { url: string; name: string };
  tunnel: { hostname: string; tokenId: string; tokenSecret: string; localPort: number };
  r2?: {
    endpoint: string;
    bucket: string;
    key: string;
    accessKeyId: string;
    secretAccessKey: string;
    partSizeBytes: number;
  };
}

/** Points the connection URL at the local end of the tunnel, keeping user, password, database, and query. */
export function rewriteForTunnel(connectionUrl: string, localPort: number): string {
  const url = new URL(connectionUrl);
  url.hostname = "127.0.0.1";
  url.port = String(localPort);
  return url.toString();
}

export function jobDeadline(type: JobType, target: TargetRow, startedAt: Date): Date {
  const minutes = type === "backup" ? target.jobDeadlineMinutes : TEST_DEADLINE_MINUTES;
  return new Date(startedAt.getTime() + minutes * 60_000);
}

export async function buildJobPayload(
  env: Env,
  target: TargetRow,
  job: { id: string; type: JobType; r2Key?: string },
  startedAt: Date,
): Promise<JobPayload> {
  const key = env.ENCRYPTION_KEY;
  const connectionUrl = await decrypt(target.connectionUrlEnc, key);
  const callbackBase = env.CALLBACK_BASE_URL ? env.CALLBACK_BASE_URL.replace(/\/+$/, "") : `http://${CALLBACK_HOST}`;

  const payload: JobPayload = {
    jobId: job.id,
    type: job.type,
    callbackUrl: `${callbackBase}${CALLBACK_PATH}`,
    jobKey: await deriveJobKey(key, job.id),
    deadlineAt: jobDeadline(job.type, target, startedAt).toISOString(),
    db: { url: rewriteForTunnel(connectionUrl, TUNNEL_LOCAL_PORT), name: target.dbName },
    tunnel: {
      hostname: target.tunnelHostname,
      tokenId: await decrypt(target.tunnelTokenIdEnc, key),
      tokenSecret: await decrypt(target.tunnelTokenSecretEnc, key),
      localPort: TUNNEL_LOCAL_PORT,
    },
  };

  if (job.type === "backup") {
    if (!job.r2Key) throw new Error("A backup job needs an R2 key");
    payload.r2 = {
      endpoint: env.R2_ENDPOINT,
      bucket: env.R2_BUCKET,
      key: job.r2Key,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      partSizeBytes: PART_SIZE_BYTES,
    };
  }
  return payload;
}
