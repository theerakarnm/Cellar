import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The default export pulls in the container entrypoints, which only exist in the Workers runtime.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
  WorkerEntrypoint: class {},
}));

import worker from "../../../src/worker/index";
import { writeSetting } from "../../../src/worker/retention/config";
import { createTestEnv } from "../../helpers/env";
import { createExecutionContext } from "../../helpers/exec-ctx";
import { NOW, backupRow, daysAgo, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

let t: Awaited<ReturnType<typeof createTestEnv>>;
beforeEach(async () => {
  t = await createTestEnv();
});
afterEach(async () => {
  await t.dispose();
});

describe("scheduled handler", () => {
  it("runs the daily retention for every active target", async () => {
    await writeSetting(t.env, "retention_dry_run", false);
    const targetId = await seedTarget(t.env, { keepLast: 1 });
    const old = await seedBackup(t.env, targetId, daysAgo(3));
    await seedBackup(t.env, targetId, daysAgo(0));
    const ctx = createExecutionContext();

    await worker.scheduled?.({ scheduledTime: NOW.getTime(), cron: "* * * * *", noRetry() {} } as ScheduledController, t.env, ctx);
    await ctx.settled();

    expect((await backupRow(t.env, old.id))?.deletedAt).not.toBeNull();
  });
});
