import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { eq } from "drizzle-orm";
import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import { runCronTick } from "../../../src/worker/jobs/cron";
import { sweepStaleJobs } from "../../../src/worker/jobs/sweeper";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedChannel } from "../../helpers/alerts-seed";
import { fakeQueue, insertBackup, insertTarget, insertTest, NOW } from "./fixtures";

let env: Env;
let dispose: () => Promise<void>;
let stopped: string[];
const stop = async (id: string) => {
  stopped.push(id);
};
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const backupStatus = async (id: string) => (await getDb(env).select().from(backups).where(eq(backups.id, id)))[0];
const testStatus = async (id: string) => (await getDb(env).select().from(connectionTests).where(eq(connectionTests.id, id)))[0];

beforeAll(async () => {
  const created = await createTestEnv({ JOBS: fakeQueue().queue });
  env = created.env;
  dispose = created.dispose;
});
afterAll(() => dispose());
beforeEach(async () => {
  await resetDb(env);
  stopped = [];
  await insertTarget(env, "t1", { jobDeadlineMinutes: 120, nextRunAt: null });
  await insertTarget(env, "t2", { nextRunAt: null });
  await insertTarget(env, "t3", { nextRunAt: null });
});
afterEach(async () => {
  vi.restoreAllMocks();
});

describe("sweepStaleJobs", () => {
  it("times out running backups with no heartbeat for 5 minutes and leaves healthy ones", async () => {
    await insertBackup(env, "lost", "t1", { status: "running", startedAt: minutesAgo(30), heartbeatAt: minutesAgo(6) });
    await insertBackup(env, "healthy", "t2", { status: "running", startedAt: minutesAgo(30), heartbeatAt: minutesAgo(4) });
    const result = await sweepStaleJobs(env, NOW, stop);
    expect(result.timedOut).toEqual(["lost"]);
    expect(await backupStatus("lost")).toMatchObject({ status: "timed_out", errorCode: "HEARTBEAT_LOST", finishedAt: NOW.toISOString() });
    expect((await backupStatus("healthy"))?.status).toBe("running");
    expect(stopped).toEqual(["lost"]);
    expect((await getDb(env).select().from(targets).where(eq(targets.id, "t1")))[0]?.lastStatus).toBe("timed_out");
  });

  it("times out a backup past its deadline even when heartbeats are fresh", async () => {
    await insertBackup(env, "slow", "t1", { status: "running", startedAt: minutesAgo(121), heartbeatAt: minutesAgo(1) });
    await insertBackup(env, "ok", "t2", { status: "running", startedAt: minutesAgo(119), heartbeatAt: minutesAgo(1) });
    await sweepStaleJobs(env, NOW, stop);
    expect(await backupStatus("slow")).toMatchObject({ status: "timed_out", errorCode: "DEADLINE_EXCEEDED" });
    expect((await backupStatus("ok"))?.status).toBe("running");
  });

  it("fails backups queued for more than 1 hour with queue_timeout and leaves newer ones", async () => {
    await insertBackup(env, "old", "t1", { queuedAt: minutesAgo(61) });
    await insertBackup(env, "new", "t2", { queuedAt: minutesAgo(59) });
    const result = await sweepStaleJobs(env, NOW, stop);
    expect(result.queueTimedOut).toEqual(["old"]);
    expect(await backupStatus("old")).toMatchObject({ status: "failed", errorCode: "queue_timeout" });
    expect((await backupStatus("new"))?.status).toBe("queued");
    expect(stopped).toEqual([]);
  });

  it("never touches finished rows", async () => {
    await insertBackup(env, "done", "t1", { status: "success", startedAt: minutesAgo(500), heartbeatAt: minutesAgo(500), queuedAt: minutesAgo(500) });
    await insertBackup(env, "bad", "t2", { status: "failed", startedAt: minutesAgo(500), heartbeatAt: minutesAgo(500), queuedAt: minutesAgo(500) });
    const result = await sweepStaleJobs(env, NOW, stop);
    expect(result).toEqual({ timedOut: [], queueTimedOut: [] });
    expect((await backupStatus("done"))?.status).toBe("success");
    expect((await backupStatus("bad"))?.status).toBe("failed");
  });

  it("applies the same rules to connection tests with a 5 minute deadline", async () => {
    await insertTest(env, "slow", "t1", { status: "running", startedAt: minutesAgo(6), heartbeatAt: minutesAgo(0) });
    await insertTest(env, "fresh", "t2", { status: "running", startedAt: minutesAgo(2), heartbeatAt: minutesAgo(1) });
    await insertTest(env, "stuck", "t3", { queuedAt: minutesAgo(90) });
    await sweepStaleJobs(env, NOW, stop);
    expect(await testStatus("slow")).toMatchObject({ status: "timed_out", errorCode: "DEADLINE_EXCEEDED" });
    expect((await testStatus("fresh"))?.status).toBe("running");
    expect(await testStatus("stuck")).toMatchObject({ status: "failed", errorCode: "queue_timeout" });
  });

  it("deletes finished connection tests older than 7 days only", async () => {
    await insertTest(env, "ancient", "t1", { status: "success", queuedAt: minutesAgo(8 * 24 * 60) });
    await insertTest(env, "recent", "t2", { status: "success", queuedAt: minutesAgo(6 * 24 * 60) });
    await sweepStaleJobs(env, NOW, stop);
    expect(await testStatus("ancient")).toBeUndefined();
    expect((await testStatus("recent"))?.status).toBe("success");
  });
});

describe("sweepStaleJobs backup alerts", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const discordBodies = () => fetchSpy.mock.calls.map((call) => String((call[1] as RequestInit).body));

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
    await seedChannel(env, "c1", "t1");
  });

  it("sends one Backup timed out alert when a running backup times out", async () => {
    await insertBackup(env, "lost", "t1", { status: "running", startedAt: minutesAgo(30), heartbeatAt: minutesAgo(6) });
    await sweepStaleJobs(env, NOW, stop);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(discordBodies()[0]).toContain("Backup timed out");
  });

  it("sends one Backup failed alert when a queued backup passes the queue timeout", async () => {
    await insertBackup(env, "old", "t1", { queuedAt: minutesAgo(61) });
    await sweepStaleJobs(env, NOW, stop);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(discordBodies()[0]).toContain("Backup failed");
  });

  it("stops the container before waiting on a hung alert webhook", async () => {
    const order: string[] = [];
    const recordStop = async (id: string) => {
      order.push(`stop:${id}`);
    };
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          order.push("fetch");
          (init as RequestInit).signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await insertBackup(env, "lost", "t1", { status: "running", startedAt: minutesAgo(30), heartbeatAt: minutesAgo(6) });
    await sweepStaleJobs(env, NOW, recordStop);
    expect(order[0]).toBe("stop:lost");
    expect(order).toContain("fetch");
    expect(order.indexOf("stop:lost")).toBeLessThan(order.indexOf("fetch"));
  }, 20_000);

  it("sends no alert for a finished backup or for a connection test", async () => {
    await insertBackup(env, "done", "t1", { status: "success", startedAt: minutesAgo(500), heartbeatAt: minutesAgo(500), queuedAt: minutesAgo(500) });
    await insertTest(env, "slow", "t1", { status: "running", startedAt: minutesAgo(6), heartbeatAt: minutesAgo(0) });
    await sweepStaleJobs(env, NOW, stop);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("runCronTick", () => {
  it("runs the sweeper even when the enqueue step fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...env, DB: undefined } as unknown as Env;
    await runCronTick(broken, NOW);
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([expect.stringContaining("cron: enqueue failed"), expect.stringContaining("cron: sweep failed")]),
    );
  });

  it("enqueues a due target and sweeps in one tick", async () => {
    const fake = fakeQueue();
    const tickEnv = { ...env, JOBS: fake.queue } as Env;
    await getDb(env).update(targets).set({ nextRunAt: "2026-10-23T19:00:00.000Z" }).where(eq(targets.id, "t1"));
    await insertBackup(env, "old", "t2", { queuedAt: minutesAgo(90) });
    await runCronTick(tickEnv, NOW);
    expect(fake.sent).toHaveLength(1);
    expect((await backupStatus("old"))?.errorCode).toBe("queue_timeout");
  });
});
