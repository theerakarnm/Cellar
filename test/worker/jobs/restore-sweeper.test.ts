import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client";
import { restores } from "../../../src/worker/db/schema";
import * as runner from "../../../src/worker/jobs/runner-client";
import { sweepRestores } from "../../../src/worker/jobs/restore-sweeper";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

vi.mock("../../../src/worker/jobs/runner-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/worker/jobs/runner-client")>()),
  startJob: vi.fn(),
  stopJob: vi.fn(),
}));

const stopJob = vi.mocked(runner.stopJob);
const NOW = new Date("2026-10-24T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let sourceId: string;
let backupId: string;

beforeEach(async () => {
  stopJob.mockReset();
  stopJob.mockResolvedValue(undefined);
  ctx = await createTestEnv();
  sourceId = (await seedTarget(ctx.env)).id;
  backupId = (await seedBackup(ctx.env, sourceId)).id;
});
afterEach(async () => {
  await ctx.dispose();
});

/** Each restore gets its own destination target: only one queued or running restore may exist per destination. */
async function restoreRow(o: Omit<Parameters<typeof seedRestore>[1], "sourceBackupId" | "destinationTargetId"> & { deadlineMinutes?: number }) {
  const destination = await seedTarget(ctx.env, { jobDeadlineMinutes: o.deadlineMinutes ?? 120 });
  return seedRestore(ctx.env, { ...o, sourceBackupId: backupId, destinationTargetId: destination.id });
}
const rowOf = async (id: string) => (await getDb(ctx.env).select().from(restores).where(eq(restores.id, id)))[0];

describe("sweepRestores", () => {
  it("leaves a running restore with a fresh heartbeat alone", async () => {
    const fresh = await restoreRow({ status: "running", startedAt: ago(30), heartbeatAt: ago(1) });
    expect(await sweepRestores(ctx.env, NOW)).toEqual({ timedOut: [], queueTimedOut: [] });
    expect((await rowOf(fresh.id))?.status).toBe("running");
    expect(stopJob).not.toHaveBeenCalled();
  });

  it("times out a running restore with no heartbeat for more than 5 minutes and stops its container", async () => {
    const stale = await restoreRow({ status: "running", startedAt: ago(30), heartbeatAt: ago(6) });
    const result = await sweepRestores(ctx.env, NOW);
    expect(result.timedOut).toEqual([stale.id]);
    expect(await rowOf(stale.id)).toMatchObject({ status: "timed_out", errorCode: "TIMEOUT", finishedAt: NOW.toISOString() });
    expect(stopJob).toHaveBeenCalledWith(ctx.env, stale.id);
  });

  it("uses started_at when no heartbeat has arrived yet", async () => {
    const stale = await restoreRow({ status: "running", startedAt: ago(10), heartbeatAt: null });
    expect((await sweepRestores(ctx.env, NOW)).timedOut).toEqual([stale.id]);
  });

  it("times out a running restore past the destination target's deadline even with a fresh heartbeat", async () => {
    const late = await restoreRow({ status: "running", startedAt: ago(61), heartbeatAt: ago(1), deadlineMinutes: 60 });
    const ontime = await restoreRow({ status: "running", startedAt: ago(59), heartbeatAt: ago(1), deadlineMinutes: 60 });
    const result = await sweepRestores(ctx.env, NOW);
    expect(result.timedOut).toEqual([late.id]);
    expect((await rowOf(ontime.id))?.status).toBe("running");
  });

  it("fails a restore that waited in the queue for more than 1 hour with queue_timeout", async () => {
    const old = await restoreRow({ status: "queued", queuedAt: ago(61) });
    const recent = await restoreRow({ status: "queued", queuedAt: ago(59) });
    const result = await sweepRestores(ctx.env, NOW);
    expect(result.queueTimedOut).toEqual([old.id]);
    expect(await rowOf(old.id)).toMatchObject({ status: "failed", errorCode: "queue_timeout" });
    expect((await rowOf(recent.id))?.status).toBe("queued");
    expect(stopJob).not.toHaveBeenCalled();
  });

  it("does not touch finished restores", async () => {
    const done = await restoreRow({ status: "success", startedAt: ago(500), heartbeatAt: ago(400), queuedAt: ago(600) });
    const failed = await restoreRow({ status: "failed", queuedAt: ago(600) });
    expect(await sweepRestores(ctx.env, NOW)).toEqual({ timedOut: [], queueTimedOut: [] });
    expect((await rowOf(done.id))?.status).toBe("success");
    expect((await rowOf(failed.id))?.status).toBe("failed");
  });

  it("still marks the row when stopping the container fails", async () => {
    stopJob.mockRejectedValue(new Error("container already gone"));
    const stale = await restoreRow({ status: "running", startedAt: ago(30), heartbeatAt: ago(9) });
    expect((await sweepRestores(ctx.env, NOW)).timedOut).toEqual([stale.id]);
    expect((await rowOf(stale.id))?.status).toBe("timed_out");
  });
});
