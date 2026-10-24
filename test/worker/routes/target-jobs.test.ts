import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, connectionTests } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import { app } from "../../../src/worker/app";
import { createTestEnv, resetDb } from "../../helpers/env";
import { fakeQueue, insertBackup, insertTarget, insertTest, NOW } from "../jobs/fixtures";

let env: Env;
let sent: ReturnType<typeof fakeQueue>["sent"];
let dispose: () => Promise<void>;

beforeAll(async () => {
  const fake = fakeQueue();
  sent = fake.sent;
  const created = await createTestEnv({ JOBS: fake.queue });
  env = created.env;
  dispose = created.dispose;
});
afterAll(async () => {
  await dispose();
});
beforeEach(async () => {
  sent.length = 0;
  await resetDb(env);
  await insertTarget(env, "t1", { nextRunAt: null });
});

const call = (path: string, init?: RequestInit) => app.request(`http://localhost/api/targets/${path}`, init, env);
const json = async (response: Response) => (await response.json()) as Record<string, any>;
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

describe("POST /api/targets/:id/backup", () => {
  it("returns 202 with the backup id, queues one message, and writes an audit row", async () => {
    const response = await call("t1/backup", { method: "POST" });
    expect(response.status).toBe(202);
    const { backupId } = await json(response);
    expect(sent).toEqual([{ jobId: backupId, type: "backup", targetId: "t1" }]);
    const audit = await getDb(env).select().from(auditLogs).where(eq(auditLogs.entityId, backupId));
    expect(audit[0]).toMatchObject({ action: "backup.trigger", actor: "dev@localhost", entityType: "backup" });
  });

  it("returns 409 when a backup is already queued or running, and 404 for unknown or deleted targets", async () => {
    await call("t1/backup", { method: "POST" });
    const second = await call("t1/backup", { method: "POST" });
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("conflict");
    expect((await call("nope/backup", { method: "POST" })).status).toBe(404);
    await insertTarget(env, "gone", { deletedAt: NOW.toISOString(), nextRunAt: null });
    expect((await call("gone/backup", { method: "POST" })).status).toBe(404);
  });
});

describe("test connection routes", () => {
  it("returns 202 with a test id, then reports queued, success with result, and failure with error", async () => {
    const created = await call("t1/test", { method: "POST" });
    expect(created.status).toBe(202);
    const { testId } = await json(created);
    expect(await json(await call(`t1/test/${testId}`))).toEqual({ status: "queued" });

    await getDb(env)
      .update(connectionTests)
      .set({ status: "success", resultJson: JSON.stringify({ pgServerVersion: "16.3", hasReadAllData: true }) });
    expect(await json(await call(`t1/test/${testId}`))).toEqual({
      status: "success",
      result: { pgServerVersion: "16.3", hasReadAllData: true },
    });

    await getDb(env)
      .update(connectionTests)
      .set({ status: "failed", resultJson: null, errorCode: "AUTH_FAILED", errorMessage: "denied" });
    expect(await json(await call(`t1/test/${testId}`))).toEqual({
      status: "failed",
      error: { code: "AUTH_FAILED", message: "denied" },
    });
  });

  it("returns 409 while a backup runs and 404 for a test of another target", async () => {
    await insertBackup(env, "b1", "t1", { status: "running" });
    expect((await call("t1/test", { method: "POST" })).status).toBe(409);
    await insertTarget(env, "t2", { nextRunAt: null });
    await insertTest(env, "c9", "t2", { status: "success" });
    expect((await call("t1/test/c9")).status).toBe(404);
  });
});

describe("GET /api/targets/:id/backups", () => {
  beforeEach(async () => {
    await insertBackup(env, "b-old", "t1", { status: "success", queuedAt: minutes(-30), startedAt: minutes(-29) });
    await insertBackup(env, "b-mid", "t1", { status: "failed", queuedAt: minutes(-20), startedAt: minutes(-19) });
    await insertBackup(env, "b-new", "t1", { status: "success", queuedAt: minutes(-10), startedAt: minutes(-9) });
    await insertBackup(env, "b-queued", "t1", { status: "queued", queuedAt: minutes(-1) });
    await insertBackup(env, "b-deleted", "t1", {
      status: "success",
      queuedAt: minutes(-5),
      startedAt: minutes(-4),
      deletedAt: minutes(0),
    });
    await insertTarget(env, "t2", { nextRunAt: null });
    await insertBackup(env, "other-target", "t2", { status: "success" });
  });
  const ids = (body: Record<string, any>) => (body.items as { id: string }[]).map((item) => item.id);

  it("lists newest first, falling back to queued_at, without deleted rows or other targets", async () => {
    const body = await json(await call("t1/backups"));
    expect(ids(body)).toEqual(["b-queued", "b-new", "b-mid", "b-old"]);
    expect(body.nextCursor).toBeNull();
  });

  it("pages with an opaque cursor without gaps or repeats", async () => {
    const first = await json(await call("t1/backups?limit=3"));
    expect(ids(first)).toEqual(["b-queued", "b-new", "b-mid"]);
    expect(typeof first.nextCursor).toBe("string");
    const second = await json(await call(`t1/backups?limit=3&cursor=${first.nextCursor}`));
    expect(ids(second)).toEqual(["b-old"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by status and exposes no internal columns", async () => {
    const body = await json(await call("t1/backups?status=success"));
    expect(ids(body)).toEqual(["b-new", "b-old"]);
    expect(Object.keys(body.items[0]).sort()).toEqual(
      [
        "durationMs",
        "errorCode",
        "errorMessage",
        "finishedAt",
        "id",
        "pgVersionServer",
        "queuedAt",
        "r2Key",
        "sha256",
        "sizeBytes",
        "startedAt",
        "status",
        "targetId",
        "trigger",
      ].sort(),
    );
  });

  it("rejects a bad status, limit, or cursor with 400 and an unknown target with 404", async () => {
    expect((await call("t1/backups?status=bogus")).status).toBe(400);
    expect((await call("t1/backups?limit=500")).status).toBe(400);
    expect((await call("t1/backups?cursor=!!!")).status).toBe(400);
    expect((await call("nope/backups")).status).toBe(404);
  });
});
