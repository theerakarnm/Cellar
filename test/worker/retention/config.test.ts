import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getLastRun,
  getRetentionDryRun,
  getRetentionTimezone,
  setLastRun,
  writeSetting,
} from "../../../src/worker/retention/config";
import { createTestEnv, resetDb } from "../../helpers/env";

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

describe("retention config", () => {
  it("defaults dry run to true when the row is absent", async () => {
    expect(await getRetentionDryRun(t.env)).toBe(true);
  });

  it("turns dry run off only for a stored boolean false", async () => {
    await writeSetting(t.env, "retention_dry_run", false);
    expect(await getRetentionDryRun(t.env)).toBe(false);
    await writeSetting(t.env, "retention_dry_run", "false");
    expect(await getRetentionDryRun(t.env)).toBe(true);
  });

  it("uses default_timezone when valid and Asia/Bangkok otherwise", async () => {
    expect(await getRetentionTimezone(t.env)).toBe("Asia/Bangkok");
    await writeSetting(t.env, "default_timezone", "Europe/Berlin");
    expect(await getRetentionTimezone(t.env)).toBe("Europe/Berlin");
    await writeSetting(t.env, "default_timezone", "Not/AZone");
    expect(await getRetentionTimezone(t.env)).toBe("Asia/Bangkok");
  });

  it("round-trips the last run and treats a malformed value as no run", async () => {
    expect(await getLastRun(t.env)).toBeNull();
    await setLastRun(t.env, { date: "2026-06-15", dryRun: true });
    expect(await getLastRun(t.env)).toEqual({ date: "2026-06-15", dryRun: true });
    await writeSetting(t.env, "retention_last_run", { date: 20260615 });
    expect(await getLastRun(t.env)).toBeNull();
  });
});
