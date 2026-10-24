import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeSetting } from "../../../src/worker/retention/config";
import { createTestEnv, resetDb } from "../../helpers/env";
import { createExecutionContext } from "../../helpers/exec-ctx";
import { backupRow, daysAgo, hasObject, seedBackup, seedTarget } from "../../helpers/retention-fixtures";
import { postSucceededCallback, seedRunningBackup } from "./callback-helpers";

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

describe("succeeded backup callback", () => {
  it("runs retention for that target after responding, and still answers 200", async () => {
    await writeSetting(t.env, "retention_dry_run", false);
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    const running = await seedRunningBackup(t.env, targetId, daysAgo(0));
    const ctx = createExecutionContext();

    const res = await postSucceededCallback(t.env, ctx, running.id);
    expect(res.status).toBe(200);
    await ctx.settled();

    expect((await backupRow(t.env, old.id))?.deletedAt).not.toBeNull();
    expect(await hasObject(t.env, old.r2Key)).toBe(false);
    expect((await backupRow(t.env, running.id))?.status).toBe("success");
  });

  it("does not run retention again for a replayed succeeded event", async () => {
    await writeSetting(t.env, "retention_dry_run", false);
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const running = await seedRunningBackup(t.env, targetId, daysAgo(0));
    const first = createExecutionContext();
    await postSucceededCallback(t.env, first, running.id);
    await first.settled();

    const late = await seedBackup(t.env, targetId, daysAgo(5));
    const replay = createExecutionContext();
    const res = await postSucceededCallback(t.env, replay, running.id);
    expect(res.status).toBe(200);
    await replay.settled();

    expect(await hasObject(t.env, late.r2Key)).toBe(true);
    expect((await backupRow(t.env, late.id))?.deletedAt).toBeNull();
  });
});
