import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../../src/worker/env";
import { createTestEnv, resetDb } from "./env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());

describe("createTestEnv", () => {
  it("applies every migration to the in-memory D1", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('targets','backups','restores','alert_channels','target_alert_channels','audit_logs','settings') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(["alert_channels", "audit_logs", "backups", "restores", "settings", "target_alert_channels", "targets"]);
  });

  it("provides working R2 and Queue bindings", async () => {
    await env.BACKUPS.put("probe", "hello");
    expect(await (await env.BACKUPS.get("probe"))?.text()).toBe("hello");
    await env.JOBS.send({ jobId: "probe-job", type: "test", targetId: "probe-target" });
  });

  it("resetDb empties tables", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('k', '1', 'now')").run();
    await resetDb(env);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM settings").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
