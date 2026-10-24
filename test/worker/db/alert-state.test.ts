import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../../src/worker/env";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedTarget } from "../../helpers/alerts-seed";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(async () => {
  await dispose();
});
beforeEach(async () => {
  await resetDb(env);
});

describe("alert state columns on targets", () => {
  it("default to threshold 3 (from Phase 1), zero failures, and no episode markers", async () => {
    await seedTarget(env, "t1");
    const row = await env.DB.prepare(
      "SELECT alert_failure_threshold AS threshold, consecutive_failures AS failures, failure_alerted_at AS fa, stale_alerted_at AS sa FROM targets WHERE id = 't1'",
    ).first();
    expect(row).toEqual({ threshold: 3, failures: 0, fa: null, sa: null });
  });
});
