import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import { enqueueDueBackups, queueConnectionTest, queueManualBackup, scheduleSlot } from "../../../src/worker/jobs/dispatch";
import type { JobMessage } from "../../../src/worker/jobs/types";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedChannel } from "../../helpers/alerts-seed";
import { DUE_SLOT, fakeQueue, insertBackup, insertTarget, NOW } from "./fixtures";

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
});
afterEach(async () => {
  vi.restoreAllMocks();
});

const allBackups = () => getDb(env).select().from(backups);
const nextRunOf = async (id: string) => (await getDb(env).select().from(targets).where(eq(targets.id, id)))[0]?.nextRunAt;

describe("scheduleSlot", () => {
  it("truncates to the UTC minute", () => {
    expect(scheduleSlot(new Date("2026-10-24T02:00:37.123Z"))).toBe("2026-10-24T02:00:00.000Z");
  });
});

describe("enqueueDueBackups", () => {
  it("queues one backup for a due target, sends one message, and advances next_run_at to tomorrow", async () => {
    await insertTarget(env, "t1");
    const result = await enqueueDueBackups(env, NOW);
    expect(result.enqueued).toHaveLength(1);
    const rows = await allBackups();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetId: "t1", status: "queued", trigger: "schedule", scheduleSlot: DUE_SLOT });
    expect(sent).toEqual([{ jobId: rows[0]?.id, type: "backup", targetId: "t1" }]);
    expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("does not enqueue twice when the cron fires twice", async () => {
    await insertTarget(env, "t1");
    await enqueueDueBackups(env, NOW);
    await enqueueDueBackups(env, new Date(NOW.getTime() + 1000));
    expect(await allBackups()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("does not create a second job when two ticks run at the same time", async () => {
    await insertTarget(env, "t1");
    await Promise.all([enqueueDueBackups(env, NOW), enqueueDueBackups(env, NOW)]);
    const rows = await allBackups();
    expect(rows).toHaveLength(1);
    expect(new Set(sent.map((message) => message.jobId))).toEqual(new Set([rows[0]?.id]));
  });

  it("does not enqueue twice when a first tick died before advancing next_run_at", async () => {
    await insertTarget(env, "t1");
    await enqueueDueBackups(env, NOW);
    await getDb(env).update(targets).set({ nextRunAt: DUE_SLOT }).where(eq(targets.id, "t1"));
    await getDb(env).update(backups).set({ status: "success" });
    const result = await enqueueDueBackups(env, NOW);
    expect(result.enqueued).toHaveLength(0);
    expect(await allBackups()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("re-sends the message when a previous tick died between the insert and the send", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "crashed", "t1", { status: "queued", trigger: "schedule", scheduleSlot: DUE_SLOT });
    const result = await enqueueDueBackups(env, NOW);
    expect(result.enqueued).toEqual(["crashed"]);
    expect(await allBackups()).toHaveLength(1);
    expect(sent).toEqual([{ jobId: "crashed", type: "backup", targetId: "t1" }]);
    expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("does not re-send when the same-slot row is running or finished", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "slot", "t1", { status: "running", trigger: "schedule", scheduleSlot: DUE_SLOT });
    expect((await enqueueDueBackups(env, NOW)).enqueued).toEqual([]);
    expect(sent).toEqual([]);
    await getDb(env).update(backups).set({ status: "success" });
    await getDb(env).update(targets).set({ nextRunAt: DUE_SLOT }).where(eq(targets.id, "t1"));
    expect((await enqueueDueBackups(env, NOW)).enqueued).toEqual([]);
    expect(sent).toEqual([]);
    expect(await allBackups()).toHaveLength(1);
  });

  it("marks the still-queued slot row failed and still advances when the re-send fails", async () => {
    const failing = fakeQueue({ failSend: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failingEnv = { ...env, JOBS: failing.queue } as Env;
    await insertTarget(env, "t1");
    await insertBackup(env, "crashed", "t1", { status: "queued", trigger: "schedule", scheduleSlot: DUE_SLOT });
    await enqueueDueBackups(failingEnv, NOW);
    expect(await allBackups()).toHaveLength(1);
    expect((await allBackups())[0]).toMatchObject({ id: "crashed", status: "failed", errorCode: "enqueue_failed" });
    expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("sends one Backup failed alert when the re-send fails and marks the row failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
    const failingEnv = { ...env, JOBS: fakeQueue({ failSend: true }).queue } as Env;
    await insertTarget(env, "t1");
    await seedChannel(env, "c1", "t1");
    await insertBackup(env, "crashed", "t1", { status: "queued", trigger: "schedule", scheduleSlot: DUE_SLOT });
    await enqueueDueBackups(failingEnv, NOW);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)).toContain("Backup failed");
  });

  it("keeps the slot row running when the consumer claims it before the failing re-send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The queue claims the row (the consumer's guarded UPDATE wins the race) and then the send fails.
    const racingQueue = {
      send: async (message: JobMessage) => {
        await getDb(env)
          .update(backups)
          .set({ status: "running", startedAt: NOW.toISOString(), heartbeatAt: NOW.toISOString(), attempt: 1 })
          .where(eq(backups.id, message.jobId));
        throw new Error("queue down");
      },
    } as unknown as Queue<JobMessage>;
    await insertTarget(env, "t1");
    await insertBackup(env, "crashed", "t1", { status: "queued", trigger: "schedule", scheduleSlot: DUE_SLOT });
    await enqueueDueBackups({ ...env, JOBS: racingQueue } as Env, NOW);
    expect(await allBackups()).toHaveLength(1);
    expect((await allBackups())[0]).toMatchObject({
      id: "crashed",
      status: "running",
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
    });
    expect((await getDb(env).select().from(targets).where(eq(targets.id, "t1")))[0]?.lastStatus).toBeNull();
    expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("ignores targets that are not due, disabled, deleted, or have no next_run_at", async () => {
    await insertTarget(env, "future", { nextRunAt: "2026-10-24T19:00:00.000Z" });
    await insertTarget(env, "disabled", { enabled: false });
    await insertTarget(env, "deleted", { deletedAt: NOW.toISOString() });
    await insertTarget(env, "none", { nextRunAt: null });
    expect((await enqueueDueBackups(env, NOW)).enqueued).toHaveLength(0);
    expect(await allBackups()).toHaveLength(0);
  });

  it("skips a target that already has an active backup and retries on the next tick", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "manual-1", "t1", { status: "running" });
    const result = await enqueueDueBackups(env, NOW);
    expect(result).toEqual({ enqueued: [], blocked: ["t1"] });
    expect(await nextRunOf("t1")).toBe(DUE_SLOT);
    await getDb(env).update(backups).set({ status: "success" });
    expect((await enqueueDueBackups(env, new Date(NOW.getTime() + 60_000))).enqueued).toHaveLength(1);
  });

  it("jumps next_run_at past now after a long outage instead of queueing every missed slot", async () => {
    await insertTarget(env, "t1", { nextRunAt: "2026-10-19T19:00:00.000Z" });
    await enqueueDueBackups(env, NOW);
    expect(await allBackups()).toHaveLength(1);
    expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("marks the row failed and still advances when the queue send fails", async () => {
    const failing = fakeQueue({ failSend: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failingEnv = { ...env, JOBS: failing.queue } as Env;
    await insertTarget(env, "t1");
    await enqueueDueBackups(failingEnv, NOW);
    const [row] = await allBackups();
    expect(row).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
    expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("keeps going when one target fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await insertTarget(env, "a", { nextRunAt: `${DUE_SLOT}garbage` });
    await insertTarget(env, "b");
    const result = await enqueueDueBackups(env, NOW);
    expect(result.enqueued).toHaveLength(1);
    expect((await allBackups())[0]?.targetId).toBe("b");
  });
});

describe("queueManualBackup", () => {
  it("creates a queued manual backup and sends one message", async () => {
    await insertTarget(env, "t1");
    const id = await queueManualBackup(env, "t1", NOW);
    expect(sent).toEqual([{ jobId: id, type: "backup", targetId: "t1" }]);
    expect((await allBackups())[0]).toMatchObject({ id, trigger: "manual", status: "queued", scheduleSlot: null });
  });

  it("rejects a second backup while one is queued or running with 409", async () => {
    await insertTarget(env, "t1");
    await queueManualBackup(env, "t1", NOW);
    await expect(queueManualBackup(env, "t1", NOW)).rejects.toMatchObject({ status: 409 });
    expect(sent).toHaveLength(1);
  });

  it("allows a new backup once the previous one is finished", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "old", "t1", { status: "success" });
    await expect(queueManualBackup(env, "t1", NOW)).resolves.toBeTruthy();
  });
});

describe("queueConnectionTest", () => {
  it("creates a queued test and sends a test message", async () => {
    await insertTarget(env, "t1");
    const id = await queueConnectionTest(env, "t1", NOW);
    expect(sent).toEqual([{ jobId: id, type: "test", targetId: "t1" }]);
    expect((await getDb(env).select().from(connectionTests))[0]).toMatchObject({ id, status: "queued" });
  });

  it("rejects with 409 while a test or a backup is active for the target", async () => {
    await insertTarget(env, "t1");
    await queueConnectionTest(env, "t1", NOW);
    await expect(queueConnectionTest(env, "t1", NOW)).rejects.toMatchObject({ status: 409 });
    await insertTarget(env, "t2");
    await insertBackup(env, "b", "t2", { status: "running" });
    await expect(queueConnectionTest(env, "t2", NOW)).rejects.toMatchObject({ status: 409 });
  });
});
