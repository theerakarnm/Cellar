import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { backups, targets } from "../../../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { loadActiveTarget, planRetention, toIsoUtc } from "../../../src/worker/retention/plan";
import { createTestEnv, resetDb } from "../../helpers/env";
import { NOW, daysAgo, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

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

async function plan(targetId: string) {
  const db = getDb(t.env);
  const target = await loadActiveTarget(db, targetId);
  if (!target) throw new Error("target not found");
  return planRetention(db, target, NOW);
}

describe("planRetention", () => {
  it("maps keep_last and lists deletions oldest first with their R2 keys", async () => {
    const targetId = await seedTarget(t.env, { keepLast: 2 });
    const b3 = await seedBackup(t.env, targetId, daysAgo(3));
    const b2 = await seedBackup(t.env, targetId, daysAgo(2));
    const b1 = await seedBackup(t.env, targetId, daysAgo(1));
    const b0 = await seedBackup(t.env, targetId, daysAgo(0));

    const result = await plan(targetId);

    expect(result.delete.map((d) => d.id)).toEqual([b3.id, b2.id]);
    expect(result.delete.map((d) => d.r2Key)).toEqual([b3.r2Key, b2.r2Key]);
    expect(result.keep.sort()).toEqual([b1.id, b0.id].sort());
    expect(result.reasons[b0.id]).toContain("keep_last");
  });

  it("ignores failed and already soft-deleted backups", async () => {
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const failed = await seedBackup(t.env, targetId, daysAgo(5), "failed");
    const gone = await seedBackup(t.env, targetId, daysAgo(4));
    await getDb(t.env).update(backups).set({ deletedAt: NOW.toISOString(), deletedReason: "manual" }).where(eq(backups.id, gone.id));
    const old = await seedBackup(t.env, targetId, daysAgo(2));
    await seedBackup(t.env, targetId, daysAgo(0));

    const result = await plan(targetId);

    expect(result.delete.map((d) => d.id)).toEqual([old.id]);
    expect(result.delete.map((d) => d.id)).not.toContain(failed.id);
  });

  it("maps keep_daily to the daily rule using the target's local days", async () => {
    const targetId = await seedTarget(t.env, { keepLast: null, keepDaily: 2 });
    const b2 = await seedBackup(t.env, targetId, daysAgo(2));
    await seedBackup(t.env, targetId, daysAgo(1));
    const sameDayEarly = await seedBackup(t.env, targetId, new Date(NOW.getTime() - 3_600_000).toISOString());
    await seedBackup(t.env, targetId, daysAgo(0));

    const result = await plan(targetId);

    expect(result.delete.map((d) => d.id)).toEqual([b2.id, sameDayEarly.id]);
  });

  it("uses the target's timezone for the day boundary", async () => {
    const earlyUtc = "2026-06-14T17:30:00.000Z";
    const lateUtc = "2026-06-15T10:00:00.000Z";
    const bangkok = await seedTarget(t.env, { keepLast: null, keepDaily: 2, timezone: "Asia/Bangkok" });
    const bangkokEarly = await seedBackup(t.env, bangkok, earlyUtc);
    await seedBackup(t.env, bangkok, lateUtc);
    const utc = await seedTarget(t.env, { keepLast: null, keepDaily: 2, timezone: "UTC" });
    await seedBackup(t.env, utc, earlyUtc);
    await seedBackup(t.env, utc, lateUtc);

    expect((await plan(bangkok)).delete.map((d) => d.id)).toEqual([bangkokEarly.id]);
    expect((await plan(utc)).delete).toEqual([]);
  });

  it("reports startedAt as ISO-8601 UTC even when D1 stores a zone-less datetime", async () => {
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const older = await seedBackup(t.env, targetId, "2026-06-13 08:00:00");
    const newer = await seedBackup(t.env, targetId, "2026-06-14 08:00:00");

    const result = await plan(targetId);

    expect(result.delete).toEqual([
      { id: older.id, r2Key: older.r2Key, startedAt: "2026-06-13T08:00:00.000Z", sizeBytes: 1 },
    ]);
    expect(result.keep).toEqual([newer.id]);
  });

  it("falls back to queued_at when started_at is null", async () => {
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const older = await seedBackup(t.env, targetId, daysAgo(3));
    const neverStarted = await seedBackup(t.env, targetId, daysAgo(1));
    await getDb(t.env).update(backups).set({ startedAt: null }).where(eq(backups.id, neverStarted.id));

    const result = await plan(targetId);

    expect(result.delete.map((d) => d.id)).toEqual([older.id]);
    expect(result.keep).toEqual([neverStarted.id]);
  });

  it("returns no target for a soft-deleted target", async () => {
    const targetId = await seedTarget(t.env, { deletedAt: NOW.toISOString() });
    expect(await loadActiveTarget(getDb(t.env), targetId)).toBeUndefined();
    expect(await getDb(t.env).select().from(targets).where(eq(targets.id, targetId)).get()).toBeDefined();
  });
});

describe("toIsoUtc", () => {
  it("keeps zoned strings and appends Z to zone-less ones", () => {
    expect(toIsoUtc("2026-06-15T10:00:00.000Z")).toBe("2026-06-15T10:00:00.000Z");
    expect(toIsoUtc("2026-06-15T10:00:00+07:00")).toBe("2026-06-15T03:00:00.000Z");
    expect(toIsoUtc("2026-06-15 10:00:00")).toBe("2026-06-15T10:00:00.000Z");
  });
});
