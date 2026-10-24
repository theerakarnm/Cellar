import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client";
import { backups, restores } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { handleJobMessage, type QueueMessageLike } from "../../../src/worker/jobs/consumer";
import { MAX_START_ATTEMPTS, runRestoreJob } from "../../../src/worker/jobs/restore-job";
import { handleRestoreCallback } from "../../../src/worker/jobs/restore-callback";
import { sweepRestores } from "../../../src/worker/jobs/restore-sweeper";
import * as runner from "../../../src/worker/jobs/runner-client";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget, TEST_R2 } from "../../helpers/restore-fixtures";

vi.mock("../../../src/worker/jobs/runner-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/worker/jobs/runner-client")>()),
  startJob: vi.fn(),
  stopJob: vi.fn(),
}));

const startJob = vi.mocked(runner.startJob);
const NOW = new Date("2026-10-24T03:00:00.000Z");

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let env: Env;

beforeEach(async () => {
  startJob.mockReset();
  startJob.mockResolvedValue(undefined);
  vi.mocked(runner.stopJob).mockReset();
  ctx = await createTestEnv(TEST_R2);
  env = ctx.env;
});
afterEach(async () => {
  await ctx.dispose();
});

async function queuedRestore(targetOptions: Parameters<typeof seedTarget>[1] = {}) {
  const source = await seedTarget(env, { name: "source-db" });
  const destination = await seedTarget(env, { name: "scratch-db", ...targetOptions });
  const backup = await seedBackup(env, source.id);
  const restore = await seedRestore(env, { sourceBackupId: backup.id, destinationTargetId: destination.id });
  return { source, destination, backup, restore };
}

const rowOf = async (id: string) => (await getDb(env).select().from(restores).where(eq(restores.id, id)))[0];

describe("runRestoreJob", () => {
  it("skips a restore that does not exist", async () => {
    expect(await runRestoreJob(env, { jobId: "missing", attempts: 1 }, NOW)).toBe("skipped");
    expect(startJob).not.toHaveBeenCalled();
  });

  it("skips a restore that is no longer queued (duplicate delivery)", async () => {
    const { restore } = await queuedRestore();
    await getDb(env).update(restores).set({ status: "running" }).where(eq(restores.id, restore.id));
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("skipped");
    expect(startJob).not.toHaveBeenCalled();
  });

  it("starts the container with the decoded destination database, the source key, and the target deadline", async () => {
    const { backup, restore } = await queuedRestore({ jobDeadlineMinutes: 90 });
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("started");
    expect(startJob).toHaveBeenCalledTimes(1);
    const payload = startJob.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      jobId: restore.id,
      type: "restore",
      deadlineAt: "2026-10-24T04:30:00.000Z",
      db: { name: "scratch" },
      tunnel: { hostname: "db.example.com", tokenId: "tunnel-id-1", tokenSecret: "tunnel-secret-1" },
      r2: { bucket: "cellar-backups", key: backup.r2Key, accessKeyId: "AKIDTEST" },
      restore: { sourceKey: backup.r2Key, targetDbName: "scratch" },
    });
    expect(payload?.db.url).toContain("restore_user:restore-pass-1@127.0.0.1:");
    expect(payload?.db.url).not.toContain("backup-pass-1");
    expect(await rowOf(restore.id)).toMatchObject({ status: "running", startedAt: NOW.toISOString(), heartbeatAt: NOW.toISOString() });
  });

  it("starts the container once when the same message is delivered twice, and never stops it", async () => {
    const { restore } = await queuedRestore();
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("started");
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 2 }, NOW)).toBe("skipped");
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(runner.stopJob).not.toHaveBeenCalled();
    expect((await rowOf(restore.id))?.status).toBe("running");
  });

  it("returns a start failure to queued and starts again on the retry", async () => {
    const { restore } = await queuedRestore();
    startJob.mockRejectedValueOnce(new Error("no capacity"));
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("retry");
    expect(await rowOf(restore.id)).toMatchObject({ status: "queued", startedAt: null, heartbeatAt: null });
    expect(runner.stopJob).toHaveBeenCalledWith(expect.anything(), restore.id);

    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 2 }, NOW)).toBe("started");
    expect(startJob).toHaveBeenCalledTimes(2);
    expect((await rowOf(restore.id))?.status).toBe("running");
  });

  it("fails the restore when the container cannot start at the last attempt", async () => {
    const { restore } = await queuedRestore();
    startJob.mockRejectedValue(new Error("no capacity"));
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: MAX_START_ATTEMPTS }, NOW)).toBe("failed");
    expect(await rowOf(restore.id)).toMatchObject({ status: "failed", errorCode: "start_failed" });
    expect(runner.stopJob).toHaveBeenCalledTimes(1);
  });

  it("fails the restore when the source backup was deleted after it was queued", async () => {
    const { backup, restore } = await queuedRestore();
    await getDb(env).update(backups).set({ deletedAt: NOW.toISOString() }).where(eq(backups.id, backup.id));
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("failed");
    expect(await rowOf(restore.id)).toMatchObject({ status: "failed", errorCode: "backup_unavailable" });
    expect(startJob).not.toHaveBeenCalled();
  });

  it("fails the restore when the destination target was soft-deleted", async () => {
    const { restore } = await queuedRestore({ deletedAt: "2026-10-24T01:00:00.000Z" });
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("failed");
    expect(await rowOf(restore.id)).toMatchObject({ status: "failed", errorCode: "target_unavailable" });
  });

  it("asks the queue to retry when the container cannot start and attempts remain", async () => {
    const { restore } = await queuedRestore();
    startJob.mockRejectedValue(new Error("no capacity"));
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: MAX_START_ATTEMPTS - 1 }, NOW)).toBe("retry");
    expect((await rowOf(restore.id))?.status).toBe("queued");
  });

  it("fails the restore with a redacted message on the last attempt", async () => {
    const { restore } = await queuedRestore();
    startJob.mockRejectedValue(new Error("boom postgres://restore_user:restore-pass-1@db.example.com/scratch"));
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: MAX_START_ATTEMPTS }, NOW)).toBe("failed");
    const row = await rowOf(restore.id);
    expect(row).toMatchObject({ status: "failed", errorCode: "start_failed" });
    expect(row?.errorMessage).toContain("boom");
    expect(row?.errorMessage).not.toContain("restore-pass-1");
  });
});

describe("handleJobMessage - restore", () => {
  function message(body: unknown, attempts = 1) {
    return { body, attempts, ack: vi.fn<QueueMessageLike["ack"]>(), retry: vi.fn<QueueMessageLike["retry"]>() };
  }

  it("routes a restore message to the restore runner and acks it", async () => {
    const { restore } = await queuedRestore();
    const msg = message({ jobId: restore.id, type: "restore", targetId: restore.destinationTargetId });
    await handleJobMessage(env, msg, { now: () => NOW, startJob: vi.fn(), stopJob: vi.fn() });
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("retries the message when the container cannot start and attempts remain", async () => {
    const { restore } = await queuedRestore();
    startJob.mockRejectedValue(new Error("no capacity"));
    const msg = message({ jobId: restore.id, type: "restore", targetId: restore.destinationTargetId }, 1);
    await handleJobMessage(env, msg, { now: () => NOW, startJob: vi.fn(), stopJob: vi.fn() });
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(msg.ack).not.toHaveBeenCalled();
  });
});

describe("restore row after a lost started callback", () => {
  it("stays running past the queue timeout while progress keeps arriving, so the queue sweeper does not fail a live restore", async () => {
    const { restore } = await queuedRestore();
    expect(await runRestoreJob(env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("started");
    const later = new Date(NOW.getTime() + 61 * 60_000);
    await handleRestoreCallback(getDb(env), { jobId: restore.id, event: "progress", at: later.toISOString(), seq: 1 }, later);
    await sweepRestores(env, later);
    expect(await rowOf(restore.id)).toMatchObject({ status: "running", errorCode: null });
    expect(runner.stopJob).not.toHaveBeenCalled();
  });
});
