import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../../src/worker/app";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedRestore } from "../../helpers/restore-fixtures";
import { auditRows, backupRow, daysAgo, failingR2, hasObject, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

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

const del = (id: string, body: unknown = { confirm: true }, env = t.env) =>
  app.request(
    `http://localhost/api/backups/${id}`,
    { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
  );

async function seedTwo() {
  const targetId = await seedTarget(t.env);
  const old = await seedBackup(t.env, targetId, daysAgo(3));
  const latest = await seedBackup(t.env, targetId, daysAgo(0));
  return { targetId, old, latest };
}

describe("DELETE /api/backups/:id", () => {
  it("deletes the object and soft-deletes the row even while retention is in dry run", async () => {
    const { old } = await seedTwo();

    const res = await del(old.id);

    expect(res.status).toBe(204);
    expect(await hasObject(t.env, old.r2Key)).toBe(false);
    const row = await backupRow(t.env, old.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedReason).toBe("manual");
    const audit = await auditRows(t.env);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "backup.delete", entityId: old.id });
    expect(audit[0]?.actor).not.toBe("system");
  });

  it("requires { confirm: true }", async () => {
    const { old } = await seedTwo();
    for (const body of [{}, { confirm: false }, { confirm: "true" }]) {
      const res = await del(old.id, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_error");
    }
    expect(await hasObject(t.env, old.r2Key)).toBe(true);
  });

  it("refuses the latest success with 409 and changes nothing", async () => {
    const { latest } = await seedTwo();

    const res = await del(latest.id);

    expect(res.status).toBe(409);
    expect(await hasObject(t.env, latest.r2Key)).toBe(true);
    expect((await backupRow(t.env, latest.id))?.deletedAt).toBeNull();
  });

  it("returns 409 backup_in_use while a restore is queued from the backup, and changes nothing", async () => {
    const { targetId, old } = await seedTwo();
    await seedRestore(t.env, { sourceBackupId: old.id, destinationTargetId: targetId, status: "queued" });

    const res = await del(old.id);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("backup_in_use");
    expect(await hasObject(t.env, old.r2Key)).toBe(true);
    expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
    expect(await auditRows(t.env)).toEqual([]);
  });

  it("refuses a backup that is not a success", async () => {
    const targetId = await seedTarget(t.env);
    const failed = await seedBackup(t.env, targetId, daysAgo(1), "failed");
    expect((await del(failed.id)).status).toBe(409);
  });

  it("returns 404 for an unknown id and for a backup that is already deleted", async () => {
    const { old } = await seedTwo();
    expect((await del("00000000-0000-7000-8000-000000000000")).status).toBe(404);
    expect((await del(old.id)).status).toBe(204);
    expect((await del(old.id)).status).toBe(404);
  });

  it("returns 502 and leaves D1 unchanged when R2 fails", async () => {
    const { old } = await seedTwo();

    const res = await del(old.id, { confirm: true }, failingR2(t.env, new Set([old.r2Key])));

    expect(res.status).toBe(502);
    expect(await hasObject(t.env, old.r2Key)).toBe(true);
    expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
  });
});
