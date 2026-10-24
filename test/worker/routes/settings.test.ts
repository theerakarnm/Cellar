import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import { app } from "../../../src/worker/app";
import { createTestEnv } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;
beforeEach(async () => {
  const created = await createTestEnv();
  env = created.env;
  dispose = created.dispose;
});
afterEach(async () => {
  await dispose();
});

const put = (body: unknown) =>
  app.request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, env);
const get = () => app.request("http://localhost/api/settings", {}, env);

describe("settings routes", () => {
  it("returns code defaults when nothing is stored", async () => {
    expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 1, retention_dry_run: true });
  });

  it("stores a valid value, returns it from GET, and writes an audit row", async () => {
    const response = await put({ max_concurrent_jobs: 4 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ max_concurrent_jobs: 4, retention_dry_run: true });
    expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 4, retention_dry_run: true });
    const audit = await getDb(env).select().from(auditLogs);
    expect(audit[0]).toMatchObject({ action: "settings.update", actor: "dev@localhost", entityType: "settings", details: '{"max_concurrent_jobs":4}' });
  });

  it.each([[{ max_concurrent_jobs: 0 }], [{ max_concurrent_jobs: 11 }], [{ max_concurrent_jobs: 1.5 }], [{ max_concurrent_jobs: "3" }], [{ unknown_key: 1 }], [{}]])(
    "rejects %j with 400 and stores nothing",
    async (body) => {
      expect((await put(body)).status).toBe(400);
      expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 1, retention_dry_run: true });
      expect(await getDb(env).select().from(auditLogs)).toHaveLength(0);
    },
  );

  it("accepts a boolean retention_dry_run and rejects other values", async () => {
    const ok = await put({ retention_dry_run: false });
    expect(ok.status).toBe(200);
    expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 1, retention_dry_run: false });

    const bad = await put({ retention_dry_run: "no" });
    expect(bad.status).toBe(400);
    const audit = await getDb(env).select().from(auditLogs);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "settings.update", details: '{"retention_dry_run":false}' });
  });

  it("does not let a client write the internal retention_last_run key", async () => {
    const res = await put({ retention_last_run: { date: "2099-01-01", dryRun: false } });
    expect(res.status).toBe(400);
    expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 1, retention_dry_run: true });
  });

  it("is protected by Access", async () => {
    const prod = { ...env, DEV_BYPASS: "" } as Env;
    expect((await app.request("http://localhost/api/settings", {}, prod)).status).toBe(401);
  });
});
