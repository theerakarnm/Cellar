import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { signCallback } from "../../../container/hmac";
import { getDb } from "../db/client";
import { backups, connectionTests, restores, targets } from "../db/schema";
import type { Env } from "../env";
import { deriveJobKey } from "../lib/job-key";
import { redactSecrets } from "../lib/redact";
import { ApiError } from "../lib/api-error";
import { handleRestoreCallback } from "./restore-callback";
import { CALLBACK_WINDOW_SECONDS, MAX_CALLBACK_BODY_BYTES, type Db, type JobType } from "./types";

const callbackSchema = z.object({
  jobId: z.string().min(1).max(64),
  event: z.enum(["started", "progress", "succeeded", "failed"]),
  at: z.string(),
  seq: z.number().int().min(1),
  result: z
    .object({
      sizeBytes: z.number().int().min(0).optional(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      pgServerVersion: z.string().max(64).optional(),
      durationMs: z.number().int().min(0).optional(),
      partCount: z.number().int().min(0).optional(),
      dbSizeBytes: z.number().int().min(0).optional(),
      hasReadAllData: z.boolean().nullable().optional(),
    })
    .optional(),
  error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/), message: z.string().max(4000) }).optional(),
});
export type CallbackPayload = z.infer<typeof callbackSchema>;

export interface CallbackHeaders {
  timestamp: string | undefined;
  signature: string | undefined;
}

export interface CallbackOutcome {
  applied: boolean;
  type: JobType;
  event: CallbackPayload["event"];
  jobId: string;
  targetId: string;
}

const unauthorized = () => new ApiError(401, "unauthorized", "Unauthorized");

function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function verifySignature(env: Env, rawBody: string, headers: CallbackHeaders, now: Date): Promise<string> {
  const idOnly = z.object({ jobId: z.string().min(1).max(64) }).safeParse(safeJson(rawBody));
  const timestamp = headers.timestamp;
  if (!idOnly.success || !timestamp || !headers.signature || !/^\d{1,12}$/.test(timestamp)) throw unauthorized();
  const jobId = idOnly.data.jobId;

  const jobKey = await deriveJobKey(env.ENCRYPTION_KEY, jobId);
  if (!(await verifyCallbackSignature(jobKey, timestamp, jobId, rawBody, headers.signature))) throw unauthorized();
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > CALLBACK_WINDOW_SECONDS) throw unauthorized();
  return jobId;
}

export async function verifyCallbackSignature(jobKeyBase64: string, timestamp: string, jobId: string, rawBody: string, signatureHex: string): Promise<boolean> {
  return safeEqual(await signCallback(jobKeyBase64, timestamp, jobId, rawBody), signatureHex.toLowerCase());
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Verifies and applies one container callback. Order: size, signature (HMAC over `timestamp.jobId.rawBody`,
 * constant-time compare), 5 minute timestamp window, body shape, then the state change. `seq` must be higher
 * than the last applied one and terminal jobs never change, so replays and duplicates are acknowledged but ignored.
 */
export async function handleCallback(env: Env, rawBody: string, headers: CallbackHeaders, now: Date): Promise<CallbackOutcome> {
  if (rawBody.length > MAX_CALLBACK_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Callback body is too large");
  await verifySignature(env, rawBody, headers, now);

  const parsed = callbackSchema.safeParse(safeJson(rawBody));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid callback body");
  const payload = parsed.data;
  if (payload.event === "failed" && !payload.error) throw new ApiError(400, "validation_error", "A failed event needs an error");
  if (payload.event === "succeeded" && !payload.result) throw new ApiError(400, "validation_error", "A succeeded event needs a result");

  const db = getDb(env);
  const nowIso = now.toISOString();
  const [backup] = await db.select({ targetId: backups.targetId }).from(backups).where(eq(backups.id, payload.jobId)).limit(1);
  if (backup) {
    const applied = await applyBackupEvent(db, payload, nowIso);
    return { applied, type: "backup", event: payload.event, jobId: payload.jobId, targetId: backup.targetId };
  }
  const [test] = await db
    .select({ targetId: connectionTests.targetId })
    .from(connectionTests)
    .where(eq(connectionTests.id, payload.jobId))
    .limit(1);
  if (test) {
    const applied = await applyTestEvent(db, payload, nowIso);
    return { applied, type: "test", event: payload.event, jobId: payload.jobId, targetId: test.targetId };
  }
  const [restore] = await db
    .select({ targetId: restores.destinationTargetId })
    .from(restores)
    .where(eq(restores.id, payload.jobId))
    .limit(1);
  if (restore) {
    const applied = (await handleRestoreCallback(db, payload, now)) === "applied";
    return { applied, type: "restore", event: payload.event, jobId: payload.jobId, targetId: restore.targetId };
  }
  throw new ApiError(404, "not_found", "Unknown job");
}

function errorFields(payload: CallbackPayload): { errorCode: string | null; errorMessage: string | null } {
  if (!payload.error) return { errorCode: null, errorMessage: null };
  return { errorCode: payload.error.code, errorMessage: redactSecrets(payload.error.message).slice(0, 1000) };
}

async function applyBackupEvent(db: Db, payload: CallbackPayload, nowIso: string): Promise<boolean> {
  const open = and(
    eq(backups.id, payload.jobId),
    inArray(backups.status, ["queued", "running"]),
    lt(backups.lastSeq, payload.seq),
  );
  const common = { lastSeq: payload.seq, heartbeatAt: nowIso };
  const result = payload.result;

  let rows: { targetId: string }[];
  if (payload.event === "succeeded") {
    rows = await db
      .update(backups)
      .set({
        ...common,
        status: "success",
        finishedAt: nowIso,
        sizeBytes: result?.sizeBytes ?? null,
        sha256: result?.sha256 ?? null,
        pgVersionServer: result?.pgServerVersion ?? null,
        durationMs: result?.durationMs ?? null,
      })
      .where(open)
      .returning({ targetId: backups.targetId });
  } else if (payload.event === "failed") {
    rows = await db
      .update(backups)
      .set({ ...common, status: "failed", finishedAt: nowIso, durationMs: result?.durationMs ?? null, ...errorFields(payload) })
      .where(open)
      .returning({ targetId: backups.targetId });
  } else {
    rows = await db.update(backups).set(common).where(open).returning({ targetId: backups.targetId });
  }

  const [row] = rows;
  if (!row) return false;
  if (payload.event === "succeeded") {
    await db.update(targets).set({ lastBackupAt: nowIso, lastStatus: "success" }).where(eq(targets.id, row.targetId));
  } else if (payload.event === "failed") {
    await db.update(targets).set({ lastStatus: "failed" }).where(eq(targets.id, row.targetId));
  }
  return true;
}

async function applyTestEvent(db: Db, payload: CallbackPayload, nowIso: string): Promise<boolean> {
  const open = and(
    eq(connectionTests.id, payload.jobId),
    inArray(connectionTests.status, ["queued", "running"]),
    lt(connectionTests.lastSeq, payload.seq),
  );
  const common = { lastSeq: payload.seq, heartbeatAt: nowIso };

  let rows: { id: string }[];
  if (payload.event === "succeeded") {
    rows = await db
      .update(connectionTests)
      .set({ ...common, status: "success", finishedAt: nowIso, resultJson: redactSecrets(JSON.stringify(payload.result ?? {})) })
      .where(open)
      .returning({ id: connectionTests.id });
  } else if (payload.event === "failed") {
    rows = await db
      .update(connectionTests)
      .set({ ...common, status: "failed", finishedAt: nowIso, ...errorFields(payload) })
      .where(open)
      .returning({ id: connectionTests.id });
  } else {
    rows = await db.update(connectionTests).set(common).where(open).returning({ id: connectionTests.id });
  }
  return rows.length > 0;
}

