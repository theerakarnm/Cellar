import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteBackup } from "../../../src/worker/retention/delete-backup";
import { createTestEnv } from "../../helpers/env";
import {
  auditRows,
  backupRow,
  daysAgo,
  failingR2,
  hasObject,
  seedBackup,
  seedTarget,
} from "../../helpers/retention-fixtures";

let t: Awaited<ReturnType<typeof createTestEnv>>;
beforeEach(async () => {
  t = await createTestEnv();
});
afterEach(async () => {
  await t.dispose();
});

const asDeletable = (targetId: string, b: { id: string; r2Key: string }) => ({ id: b.id, targetId, r2Key: b.r2Key });

describe("deleteBackup", () => {
  it("removes the object, soft-deletes the row, and writes one audit row", async () => {
    const targetId = await seedTarget(t.env);
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(0));

    const outcome = await deleteBackup(t.env, asDeletable(targetId, old), { reason: "retention", actor: "system" });

    expect(outcome).toEqual({ status: "deleted" });
    expect(await hasObject(t.env, old.r2Key)).toBe(false);
    const row = await backupRow(t.env, old.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedReason).toBe("retention");
    expect(row?.status).toBe("success");
    expect(await auditRows(t.env)).toEqual([{ action: "retention.delete", actor: "system", entityId: old.id }]);
  });

  it("refuses the latest success and changes nothing", async () => {
    const targetId = await seedTarget(t.env);
    await seedBackup(t.env, targetId, daysAgo(3));
    const latest = await seedBackup(t.env, targetId, daysAgo(0));

    const outcome = await deleteBackup(t.env, asDeletable(targetId, latest), { reason: "manual", actor: "a@example.com" });

    expect(outcome).toEqual({ status: "refused_latest_success" });
    expect(await hasObject(t.env, latest.r2Key)).toBe(true);
    expect((await backupRow(t.env, latest.id))?.deletedAt).toBeNull();
    expect(await auditRows(t.env)).toEqual([]);
  });

  it("keeps the row when the R2 delete fails, and audits only retention failures", async () => {
    const targetId = await seedTarget(t.env);
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(0));
    const env = failingR2(t.env, new Set([old.r2Key]));

    const retention = await deleteBackup(env, asDeletable(targetId, old), { reason: "retention", actor: "system" });
    expect(retention).toMatchObject({ status: "r2_failed", error: expect.stringContaining("R2 unavailable") });
    const manual = await deleteBackup(env, asDeletable(targetId, old), { reason: "manual", actor: "a@example.com" });
    expect(manual.status).toBe("r2_failed");

    expect(await hasObject(t.env, old.r2Key)).toBe(true);
    expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
    expect(await auditRows(t.env)).toEqual([{ action: "retention.delete_failed", actor: "system", entityId: old.id }]);
  });

  it("reports already_deleted on a repeat call and writes no second audit row", async () => {
    const targetId = await seedTarget(t.env);
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(0));
    const opts = { reason: "retention", actor: "system" } as const;

    await deleteBackup(t.env, asDeletable(targetId, old), opts);
    const second = await deleteBackup(t.env, asDeletable(targetId, old), opts);

    expect(second).toEqual({ status: "already_deleted" });
    expect(await auditRows(t.env)).toHaveLength(1);
  });

  it("fails without touching D1 when the row has no r2_key", async () => {
    const targetId = await seedTarget(t.env);
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(0));

    const outcome = await deleteBackup(t.env, { id: old.id, targetId, r2Key: null }, { reason: "manual", actor: "a@example.com" });

    expect(outcome).toMatchObject({ status: "r2_failed" });
    expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
  });
});
