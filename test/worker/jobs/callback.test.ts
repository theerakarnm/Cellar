import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import { handleCallback, verifyCallbackSignature } from "../../../src/worker/jobs/callback";
import { app } from "../../../src/worker/app";
import { SIGNATURE_VECTOR } from "../../../container/contract";
import { createTestEnv } from "../../helpers/env";
import { insertBackup, insertTarget, insertTest, NOW, signedHeaders } from "./fixtures";

let env: Env;
let dispose: () => Promise<void>;

beforeEach(async () => {
  const created = await createTestEnv();
  env = created.env;
  dispose = created.dispose;
  await insertTarget(env, "t1");
  await insertBackup(env, "b1", "t1", { status: "running", startedAt: NOW.toISOString(), heartbeatAt: NOW.toISOString() });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

const SHA = "a".repeat(64);
const event = (jobId: string, name: string, seq: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ jobId, event: name, at: NOW.toISOString(), seq, ...extra });
const backupRow = async (id = "b1") => (await getDb(env).select().from(backups).where(eq(backups.id, id)))[0];
const targetRow = async () => (await getDb(env).select().from(targets).where(eq(targets.id, "t1")))[0];

async function post(rawBody: string, headers?: { timestamp?: string; signature?: string }, now = NOW) {
  const signed = await signedHeaders(env, JSON.parse(rawBody).jobId, rawBody, now.getTime() / 1000);
  return handleCallback(env, rawBody, { ...signed, ...headers }, now);
}
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number }) => error.status);

describe("handleCallback - authentication", () => {
  it("rejects a bad signature with 401 and changes nothing", async () => {
    const body = event("b1", "succeeded", 1, { result: { sizeBytes: 5, sha256: SHA } });
    expect(await status(post(body, { signature: "0".repeat(64) }))).toBe(401);
    expect((await backupRow())?.status).toBe("running");
  });

  it("rejects a signature made for another job id", async () => {
    await insertBackup(env, "b2", "t1", { status: "success" });
    const body = event("b1", "progress", 1);
    const other = await signedHeaders(env, "b2", body);
    expect(await status(handleCallback(env, body, other, NOW))).toBe(401);
  });

  it("rejects a body that was changed after signing", async () => {
    const body = event("b1", "progress", 1);
    const signed = await signedHeaders(env, "b1", body);
    expect(await status(handleCallback(env, event("b1", "failed", 1, { error: { code: "UNKNOWN", message: "x" } }), signed, NOW))).toBe(401);
  });

  it("rejects missing headers, a non-numeric timestamp, and a non-JSON body", async () => {
    const body = event("b1", "progress", 1);
    expect(await status(handleCallback(env, body, { timestamp: undefined, signature: undefined }, NOW))).toBe(401);
    expect(await status(post(body, { timestamp: "abc" }))).toBe(401);
    expect(await status(handleCallback(env, "not json", { timestamp: "1", signature: "x" }, NOW))).toBe(401);
  });

  it("rejects a validly signed callback older than 5 minutes (replay) and one from the far future", async () => {
    const body = event("b1", "progress", 1);
    const old = await signedHeaders(env, "b1", body, NOW.getTime() / 1000 - 301);
    expect(await status(handleCallback(env, body, old, NOW))).toBe(401);
    const future = await signedHeaders(env, "b1", body, NOW.getTime() / 1000 + 301);
    expect(await status(handleCallback(env, body, future, NOW))).toBe(401);
    const edge = await signedHeaders(env, "b1", body, NOW.getTime() / 1000 - 299);
    expect(await status(handleCallback(env, body, edge, NOW))).toBe(200);
  });

  it("rejects an oversized body with 413", async () => {
    const body = event("b1", "progress", 1, { pad: "x".repeat(70_000) });
    expect(await status(post(body))).toBe(413);
  });

  it("returns 404 for a validly signed callback about an unknown job", async () => {
    expect(await status(post(event("ghost", "progress", 1)))).toBe(404);
  });

  it("returns 400 for a signed body that does not match the schema", async () => {
    expect(await status(post(event("b1", "bogus", 1)))).toBe(400);
    expect(await status(post(event("b1", "failed", 1)))).toBe(400);
    expect(await status(post(event("b1", "succeeded", 1)))).toBe(400);
    expect(await status(post(event("b1", "progress", 0)))).toBe(400);
  });
});

describe("handleCallback - backup state changes", () => {
  it("applies a valid success: row, target last_backup_at and last_status", async () => {
    const outcome = await post(
      event("b1", "succeeded", 3, {
        result: { sizeBytes: 123456, sha256: SHA, pgServerVersion: "16.3", durationMs: 4200, partCount: 1 },
      }),
    );
    expect(outcome).toEqual({ applied: true, type: "backup", event: "succeeded", targetId: "t1" });
    expect(await backupRow()).toMatchObject({
      status: "success",
      sizeBytes: 123456,
      sha256: SHA,
      pgVersionServer: "16.3",
      durationMs: 4200,
      finishedAt: NOW.toISOString(),
      lastSeq: 3,
    });
    expect(await targetRow()).toMatchObject({ lastBackupAt: NOW.toISOString(), lastStatus: "success" });
  });

  it("applies a failure with a redacted, capped message", async () => {
    await post(
      event("b1", "failed", 2, { error: { code: "DUMP_FAILED", message: "connection to postgres://app:hunter2@db:5432/shop failed " + "y".repeat(2000) } }),
    );
    const row = await backupRow();
    expect(row).toMatchObject({ status: "failed", errorCode: "DUMP_FAILED" });
    expect(row?.errorMessage).toContain("postgres://app:***@db:5432/shop");
    expect(row?.errorMessage).not.toContain("hunter2");
    expect(row?.errorMessage?.length).toBeLessThanOrEqual(1000);
    expect((await targetRow())?.lastStatus).toBe("failed");
  });

  it("refreshes the heartbeat on started and progress without changing the status", async () => {
    const later = new Date(NOW.getTime() + 60_000);
    await post(event("b1", "progress", 1), undefined, later);
    expect(await backupRow()).toMatchObject({ status: "running", heartbeatAt: later.toISOString(), lastSeq: 1 });
    await post(event("b1", "started", 2), undefined, later);
    expect((await backupRow())?.lastSeq).toBe(2);
  });

  it("ignores a repeated or lower seq (replay protection)", async () => {
    await post(event("b1", "progress", 5));
    const stale = await post(event("b1", "progress", 5));
    const lower = await post(event("b1", "failed", 4, { error: { code: "UNKNOWN", message: "late" } }));
    expect(stale.applied).toBe(false);
    expect(lower.applied).toBe(false);
    expect(await backupRow()).toMatchObject({ status: "running", lastSeq: 5 });
  });

  it("applies a terminal event once and ignores later events", async () => {
    await post(event("b1", "succeeded", 2, { result: { sizeBytes: 1, sha256: SHA } }));
    const again = await post(event("b1", "succeeded", 3, { result: { sizeBytes: 999, sha256: SHA } }));
    const failedLate = await post(event("b1", "failed", 4, { error: { code: "UNKNOWN", message: "late" } }));
    expect([again.applied, failedLate.applied]).toEqual([false, false]);
    expect(await backupRow()).toMatchObject({ status: "success", sizeBytes: 1 });
    expect((await targetRow())?.lastStatus).toBe("success");
  });

  it("does not revive a timed_out job", async () => {
    await getDb(env).update(backups).set({ status: "timed_out" }).where(eq(backups.id, "b1"));
    const outcome = await post(event("b1", "succeeded", 1, { result: { sizeBytes: 1, sha256: SHA } }));
    expect(outcome.applied).toBe(false);
    expect((await backupRow())?.status).toBe("timed_out");
  });
});

describe("handleCallback - connection tests", () => {
  beforeEach(async () => {
    await insertTest(env, "c1", "t1", { status: "running" });
  });
  const testRow = async () => (await getDb(env).select().from(connectionTests).where(eq(connectionTests.id, "c1")))[0];

  it("stores the result of a successful test", async () => {
    const outcome = await post(event("c1", "succeeded", 1, { result: { pgServerVersion: "16.3", dbSizeBytes: 8192, hasReadAllData: true } }));
    expect(outcome).toMatchObject({ applied: true, type: "test", targetId: "t1" });
    expect(await testRow()).toMatchObject({ status: "success" });
    expect(JSON.parse((await testRow())?.resultJson ?? "{}")).toEqual({ pgServerVersion: "16.3", dbSizeBytes: 8192, hasReadAllData: true });
  });

  it("accepts the PG13 success result, where hasReadAllData is null because the role does not exist", async () => {
    const pg13Result = { pgServerVersion: "13.16", dbSizeBytes: 1000, hasReadAllData: null, durationMs: 50 };
    const outcome = await post(event("c1", "succeeded", 1, { result: pg13Result }));
    expect(outcome).toMatchObject({ applied: true, type: "test", targetId: "t1" });
    expect(await testRow()).toMatchObject({ status: "success" });
    expect(JSON.parse((await testRow())?.resultJson ?? "{}")).toEqual(pg13Result);
  });

  it("accepts a success result without hasReadAllData", async () => {
    const outcome = await post(event("c1", "succeeded", 1, { result: { pgServerVersion: "13.16", dbSizeBytes: 1000, durationMs: 50 } }));
    expect(outcome).toMatchObject({ applied: true, type: "test" });
    expect(await testRow()).toMatchObject({ status: "success" });
  });

  it("stores a redacted failure and leaves the target status alone", async () => {
    await post(event("c1", "failed", 1, { error: { code: "AUTH_FAILED", message: "password=hunter2 rejected" } }));
    const row = await testRow();
    expect(row).toMatchObject({ status: "failed", errorCode: "AUTH_FAILED" });
    expect(row?.errorMessage).not.toContain("hunter2");
    expect((await targetRow())?.lastStatus).toBeNull();
  });
});

describe("POST /internal/jobs/callback", () => {
  it("is reachable without an Access token and returns the applied flag", async () => {
    const prod = { ...env, DEV_BYPASS: "" } as Env;
    const body = event("b1", "progress", 1);
    const signed = await signedHeaders(env, "b1", body, Date.now() / 1000);
    const response = await app.request(
      "http://localhost/internal/jobs/callback",
      { method: "POST", body, headers: { "X-Cellar-Timestamp": signed.timestamp, "X-Cellar-Signature": signed.signature } },
      prod,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, applied: true });
  });

  it("answers 401 with the generic error body for a bad signature", async () => {
    const response = await app.request("http://localhost/internal/jobs/callback", { method: "POST", body: event("b1", "progress", 1), headers: { "X-Cellar-Timestamp": "1", "X-Cellar-Signature": "00" } }, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Unauthorized" } });
  });

  it("keeps /api routes behind Access while /internal is open", async () => {
    const prod = { ...env, DEV_BYPASS: "" } as Env;
    expect((await app.request("http://localhost/api/targets/t1/backups", {}, prod)).status).toBe(401);
  });
});

describe("Phase 4 contract", () => {
  it("verifies SIGNATURE_VECTOR with the Worker-side verifier and rejects a changed body", async () => {
    const { jobKeyBase64, timestamp, jobId, rawBody, signatureHex } = SIGNATURE_VECTOR;
    expect(await verifyCallbackSignature(jobKeyBase64, timestamp, jobId, rawBody, signatureHex)).toBe(true);
    expect(await verifyCallbackSignature(jobKeyBase64, timestamp, jobId, `${rawBody} `, signatureHex)).toBe(false);
  });
});

