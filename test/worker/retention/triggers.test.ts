import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastRun, writeSetting } from "../../../src/worker/retention/config";
import { runDailyRetention, triggerDailyRetention, triggerRetentionAfterBackup } from "../../../src/worker/retention/triggers";
import { createTestEnv, resetDb } from "../../helpers/env";
import { NOW, backupRow, daysAgo, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

// 19:00 on 15 June in Asia/Bangkok. The next Bangkok day starts at 17:00Z, still the same UTC day.
const NEXT_BANGKOK_DAY = new Date("2026-06-15T17:01:00.000Z");

let t: Awaited<ReturnType<typeof createTestEnv>>;
beforeAll(async () => {
  t = await createTestEnv();
});
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await resetDb(t.env);
});
afterEach(async () => {
  vi.restoreAllMocks();
});

const goLive = () => writeSetting(t.env, "retention_dry_run", false);

describe("runDailyRetention", () => {
  it("runs once per local day", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    await seedBackup(t.env, targetId, daysAgo(2));
    await seedBackup(t.env, targetId, daysAgo(0));

    expect(await runDailyRetention(t.env, NOW)).toEqual({ ran: true, complete: true, deleted: 1, failed: 0 });

    const extra = await seedBackup(t.env, targetId, daysAgo(1));
    expect((await runDailyRetention(t.env, NOW)).ran).toBe(false);
    expect((await backupRow(t.env, extra.id))?.deletedAt).toBeNull();
  });

  it("runs again when the Bangkok day changes, even within the same UTC day", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    await seedBackup(t.env, targetId, daysAgo(0));
    await runDailyRetention(t.env, NOW);

    const extra = await seedBackup(t.env, targetId, daysAgo(1));
    const next = await runDailyRetention(t.env, NEXT_BANGKOK_DAY);

    expect(next).toMatchObject({ ran: true, deleted: 1 });
    expect((await backupRow(t.env, extra.id))?.deletedAt).not.toBeNull();
  });

  it("stops at the budget, does not record the day, and finishes on the next tick", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(2));
    await seedBackup(t.env, targetId, daysAgo(1));
    await seedBackup(t.env, targetId, daysAgo(0));

    const first = await runDailyRetention(t.env, NOW, 2);
    expect(first).toMatchObject({ ran: true, complete: false, deleted: 2 });
    expect(await getLastRun(t.env)).toBeNull();

    const second = await runDailyRetention(t.env, NOW, 2);
    expect(second).toMatchObject({ ran: true, complete: true, deleted: 1 });
    expect(await getLastRun(t.env)).toEqual({ date: "2026-06-15", dryRun: false });
  });

  it("lets a live run happen on a day that only had a dry run", async () => {
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const old = await seedBackup(t.env, targetId, daysAgo(2));
    await seedBackup(t.env, targetId, daysAgo(0));
    vi.spyOn(console, "info").mockImplementation(() => {});

    expect(await runDailyRetention(t.env, NOW)).toMatchObject({ ran: true, deleted: 0 });
    expect((await runDailyRetention(t.env, NOW)).ran).toBe(false);

    await goLive();
    expect(await runDailyRetention(t.env, NOW)).toMatchObject({ ran: true, deleted: 1 });
    expect((await backupRow(t.env, old.id))?.deletedAt).not.toBeNull();
  });
});

describe("retention triggers", () => {
  it("never throw and log a redacted line", async () => {
    const broken = {
      ...t.env,
      DB: {
        prepare() {
          throw new Error("connect postgres://app:hunter2@db.example.com/x failed");
        },
      } as unknown as D1Database,
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(triggerRetentionAfterBackup(broken, "t1")).resolves.toBeUndefined();
    await expect(triggerDailyRetention(broken, NOW)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain("hunter2");
  });
});
