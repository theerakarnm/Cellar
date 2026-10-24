import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSetting } from "../../../src/worker/retention/config";
import { runRetention } from "../../../src/worker/retention/runner";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedRestore } from "../../helpers/restore-fixtures";
import {
  NOW,
  auditRows,
  backupRow,
  daysAgo,
  failingR2,
  hasObject,
  seedBackup,
  seedTarget,
} from "../../helpers/retention-fixtures";

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

describe("runRetention", () => {
  it("removes the right objects, soft-deletes the rows, and audits each deletion", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 2 });
    const b4 = await seedBackup(t.env, targetId, daysAgo(4));
    const b3 = await seedBackup(t.env, targetId, daysAgo(3));
    const b2 = await seedBackup(t.env, targetId, daysAgo(2));
    const b1 = await seedBackup(t.env, targetId, daysAgo(1));
    const b0 = await seedBackup(t.env, targetId, daysAgo(0));

    const result = await runRetention(t.env, targetId, { now: NOW });

    expect(result).toEqual({ deleted: [b4.id, b3.id, b2.id], failed: [], skipped: [], dryRun: false, remaining: 0 });
    for (const gone of [b4, b3, b2]) {
      expect(await hasObject(t.env, gone.r2Key)).toBe(false);
      const row = await backupRow(t.env, gone.id);
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.deletedReason).toBe("retention");
    }
    for (const kept of [b1, b0]) {
      expect(await hasObject(t.env, kept.r2Key)).toBe(true);
      expect((await backupRow(t.env, kept.id))?.deletedAt).toBeNull();
    }
    const audit = await auditRows(t.env);
    expect(audit).toHaveLength(3);
    expect(audit.every((a) => a.action === "retention.delete" && a.actor === "system")).toBe(true);
  });

  it("never touches failed backups", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const failed = await seedBackup(t.env, targetId, daysAgo(9), "failed");
    await seedBackup(t.env, targetId, daysAgo(2));
    await seedBackup(t.env, targetId, daysAgo(0));

    await runRetention(t.env, targetId, { now: NOW });

    expect((await backupRow(t.env, failed.id))?.deletedAt).toBeNull();
  });

  it("keeps D1 consistent when an R2 delete fails, continues, and heals on the next run", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const b2 = await seedBackup(t.env, targetId, daysAgo(2));
    const b1 = await seedBackup(t.env, targetId, daysAgo(1));
    await seedBackup(t.env, targetId, daysAgo(0));
    const env = failingR2(t.env, new Set([b1.r2Key]));

    const first = await runRetention(env, targetId, { now: NOW });

    expect(first.deleted).toEqual([b2.id]);
    expect(first.failed).toEqual([{ id: b1.id, error: expect.stringContaining("R2 unavailable") }]);
    expect(await hasObject(t.env, b1.r2Key)).toBe(true);
    expect((await backupRow(t.env, b1.id))?.deletedAt).toBeNull();
    expect((await auditRows(t.env)).map((a) => a.action).sort()).toEqual(["retention.delete", "retention.delete_failed"]);

    const second = await runRetention(t.env, targetId, { now: NOW });
    expect(second.deleted).toEqual([b1.id]);
    expect(await hasObject(t.env, b1.r2Key)).toBe(false);
  });

  it("deletes nothing in dry run, which is the default, and logs the decision", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(0));

    const result = await runRetention(t.env, targetId, { now: NOW });

    expect(result).toEqual({ deleted: [], failed: [], skipped: [], dryRun: true, remaining: 0 });
    expect(await hasObject(t.env, old.r2Key)).toBe(true);
    expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
    expect(await auditRows(t.env)).toEqual([]);
    expect(info).toHaveBeenCalledWith(expect.stringContaining(old.id));
  });

  it("keeps the latest success even when every rule is off", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 0 });
    const b2 = await seedBackup(t.env, targetId, daysAgo(2));
    const b1 = await seedBackup(t.env, targetId, daysAgo(1));
    const b0 = await seedBackup(t.env, targetId, daysAgo(0));

    const result = await runRetention(t.env, targetId, { now: NOW });

    expect(result.deleted).toEqual([b2.id, b1.id]);
    expect(await hasObject(t.env, b0.r2Key)).toBe(true);
  });

  it("skips a soft-deleted target and leaves its backups alone", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1, deletedAt: NOW.toISOString() });
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(0));

    const result = await runRetention(t.env, targetId, { now: NOW });

    expect(result.deleted).toEqual([]);
    expect(await hasObject(t.env, old.r2Key)).toBe(true);
  });

  it("stops at maxDeletions, oldest first, and reports what is left", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const b3 = await seedBackup(t.env, targetId, daysAgo(3));
    const b2 = await seedBackup(t.env, targetId, daysAgo(2));
    await seedBackup(t.env, targetId, daysAgo(1));
    await seedBackup(t.env, targetId, daysAgo(0));

    const result = await runRetention(t.env, targetId, { now: NOW, maxDeletions: 2 });

    expect(result.deleted).toEqual([b3.id, b2.id]);
    expect(result.remaining).toBe(1);
  });

  it("reports a backup held by a running restore as skipped, not failed, and leaves it untouched", async () => {
    await goLive();
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const held = await seedBackup(t.env, targetId, daysAgo(1));
    await seedBackup(t.env, targetId, daysAgo(0));
    await seedRestore(t.env, { sourceBackupId: held.id, destinationTargetId: targetId, status: "running" });

    const result = await runRetention(t.env, targetId, { now: NOW });

    expect(result).toEqual({ deleted: [], failed: [], skipped: [{ id: held.id, reason: "active_restore" }], dryRun: false, remaining: 0 });
    expect(await hasObject(t.env, held.r2Key)).toBe(true);
    expect((await backupRow(t.env, held.id))?.deletedAt).toBeNull();
    expect(await auditRows(t.env)).toEqual([]);
  });
});
