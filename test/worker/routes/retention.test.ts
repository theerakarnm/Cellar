import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../../src/worker/app";
import { writeSetting } from "../../../src/worker/retention/config";
import { runRetention } from "../../../src/worker/retention/runner";
import { createTestEnv, resetDb } from "../../helpers/env";
import { NOW, auditRows, backupRow, daysAgo, hasObject, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

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

const preview = (targetId: string, env = t.env) =>
  app.request(`http://localhost/api/targets/${targetId}/retention-preview`, {}, env);

// keep_last is the only rule used here, so the answer does not depend on the real clock the route reads.
async function seedThree() {
  const targetId = await seedTarget(t.env, { keepLast: 1 });
  const b2 = await seedBackup(t.env, targetId, daysAgo(2));
  const b1 = await seedBackup(t.env, targetId, daysAgo(1));
  const b0 = await seedBackup(t.env, targetId, daysAgo(0));
  return { targetId, b2, b1, b0 };
}

describe("GET /api/targets/:id/retention-preview", () => {
  it("lists what would be deleted, with reasons for what is kept, and changes nothing", async () => {
    const { targetId, b2, b1, b0 } = await seedThree();

    const res = await preview(targetId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dryRun: boolean;
      keep: string[];
      delete: { id: string; reason: string }[];
      reasons: Record<string, string[]>;
    };
    expect(body.dryRun).toBe(true);
    expect(body.keep).toEqual([b0.id]);
    expect(body.delete.map((d) => d.id)).toEqual([b2.id, b1.id]);
    expect(body.reasons[b0.id]).toContain("keep_last");
    for (const b of [b2, b1, b0]) {
      expect(await hasObject(t.env, b.r2Key)).toBe(true);
      expect((await backupRow(t.env, b.id))?.deletedAt).toBeNull();
    }
    expect(await auditRows(t.env)).toEqual([]);
  });

  it("matches exactly what the runner then deletes", async () => {
    const { targetId } = await seedThree();
    const body = (await (await preview(targetId)).json()) as { delete: { id: string }[] };

    await writeSetting(t.env, "retention_dry_run", false);
    const result = await runRetention(t.env, targetId, { now: NOW });

    expect(result.deleted).toEqual(body.delete.map((d) => d.id));
  });

  it("returns 404 for an unknown or soft-deleted target", async () => {
    const deleted = await seedTarget(t.env, { deletedAt: NOW.toISOString() });
    expect((await preview(deleted)).status).toBe(404);
    expect((await preview("00000000-0000-7000-8000-000000000000")).status).toBe(404);
  });

  it("sits behind Access", async () => {
    const locked = await createTestEnv({ DEV_BYPASS: "false" });
    try {
      expect((await preview("any-id", locked.env)).status).toBe(401);
    } finally {
      await locked.dispose();
    }
  });
});
