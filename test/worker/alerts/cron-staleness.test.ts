import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

// The default export pulls in the container entrypoints, which only exist in the Workers runtime.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
  WorkerEntrypoint: class {},
}));

import worker from "../../../src/worker/index";
import type { Env } from "../../../src/worker/env";
import { createTestEnv, resetDb } from "../../helpers/env";
import { createExecutionContext } from "../../helpers/exec-ctx";
import { seedChannel, seedTarget, targetRow } from "../../helpers/alerts-seed";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(async () => {
  await dispose();
});
beforeEach(async () => {
  await resetDb(env);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
});
afterEach(async () => {
  vi.restoreAllMocks();
});

async function tick(at: Date) {
  const ctx = createExecutionContext();
  const controller = { scheduledTime: at.getTime(), cron: "* * * * *", noRetry() {} } as ScheduledController;
  await worker.scheduled?.(controller, env, ctx);
  await ctx.settled();
}

describe("scheduled handler", () => {
  it("sends one stale alert across repeated ticks", async () => {
    await seedTarget(env, "t1", { last_backup_at: hoursAgo(30), created_at: hoursAgo(500) });
    await seedChannel(env, "c1", "t1");
    await tick(NOW);
    await tick(new Date(NOW.getTime() + 60_000));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await targetRow(env, "t1"))?.stale_alerted_at).not.toBeNull();
  });

  it("sends nothing for a target with a recent success", async () => {
    await seedTarget(env, "t1", { last_backup_at: hoursAgo(1), created_at: hoursAgo(500) });
    await seedChannel(env, "c1", "t1");
    await tick(NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
