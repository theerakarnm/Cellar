import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { app } from "../../../src/worker/app";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { alertChannels, auditLogs, targetAlertChannels, targets } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { decrypt } from "../../../src/worker/lib/crypto";
import type { AppEnv } from "../../../src/worker/middleware/access";
import { errorHandler } from "../../../src/worker/middleware/error";
import { targetRoutes } from "../../../src/worker/routes/targets";
import { api, SECRETS, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));
afterEach(() => vi.useRealTimers());

async function seedChannel(id: string) {
  await getDb(env).insert(alertChannels).values({ id, type: "discord", name: id, credentialEnc: "v1:x:y", events: "[]", createdAt: "t", updatedAt: "t" });
}

describe("POST /api/targets", () => {
  it("creates a tunnel target with the owner defaults and masked connection info", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const res = await api(env).post("/api/targets", tunnelBody());
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      name: "Shop DB",
      projectTag: "shop",
      dbName: "shop",
      connection: { host: "db.example.com", port: 5432, dbName: "shop", user: "backup" },
      hasRestoreUrl: true,
      hasTunnelToken: true,
      tunnelHostname: "db.example.com",
      scheduleCron: "0 2 * * *",
      timezone: "Asia/Bangkok",
      enabled: true,
      retention: { keepLast: 3, daily: 7, weekly: 4, monthly: 6, maxAgeDays: null },
      jobDeadlineMinutes: 120,
      staleAfterHours: null,
      alertFailureThreshold: 3,
      nextRunAt: "2026-10-24T19:00:00.000Z",
      lastBackupAt: null,
      lastStatus: null,
      alertChannelIds: [],
      stats: { backupCount: 0, totalBackupBytes: 0 },
    });
    expect(res.json.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("computes next_run_at for a UTC schedule", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T07:00:00Z"));
    const res = await api(env).post("/api/targets", tunnelBody({ timezone: "UTC", scheduleCron: "30 6 * * *" }));
    expect(res.json.nextRunAt).toBe("2026-10-25T06:30:00.000Z");
  });

  it("stores next_run_at as null for a disabled target", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ enabled: false }));
    expect(res.json).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it("never returns a secret, in the response or in the audit row, and stores them encrypted", async () => {
    const res = await api(env).post("/api/targets", tunnelBody());
    const db = getDb(env);
    const [row] = await db.select().from(targets);
    const [audit] = await db.select().from(auditLogs);
    for (const secret of SECRETS) {
      expect(res.text, secret).not.toContain(secret);
      expect(audit?.details, secret).not.toContain(secret);
      expect(JSON.stringify(row), secret).not.toContain(secret);
    }
    expect(res.text).not.toContain("_enc");
    expect(res.text).not.toContain("postgres://");
    expect(row?.connectionUrlEnc).toMatch(/^v1:/);
    expect(await decrypt(row?.connectionUrlEnc ?? "", env.ENCRYPTION_KEY)).toBe(tunnelBody().connectionUrl);
    expect(await decrypt(row?.tunnelTokenSecretEnc ?? "", env.ENCRYPTION_KEY)).toBe("token-secret-456");
  });

  it("derives db_name from the URL path and sanitizes it", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ connectionUrl: "postgres://u:p@h.example.com/my%20db.v2" }));
    expect(res.json).toMatchObject({ dbName: "my_db_v2", connection: { dbName: "my db.v2" } });
  });

  it("stores a custom alert failure threshold and rejects one out of bounds", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ alertFailureThreshold: 5 }));
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ alertFailureThreshold: 5 });
    const bad = await api(env).post("/api/targets", tunnelBody({ name: "Other", alertFailureThreshold: 0 }));
    expect(bad.status).toBe(400);
  });

  it("rejects a body without tunnel fields", async () => {
    const { tunnel: _tunnel, ...rest } = tunnelBody();
    const res = await api(env).post("/api/targets", rest);
    expect(res.status).toBe(400);
  });

  it("links existing alert channels and rejects unknown ones", async () => {
    await seedChannel("c1");
    await seedChannel("c2");
    const ok = await api(env).post("/api/targets", tunnelBody({ alertChannelIds: ["c2", "c1"] }));
    expect(ok.json.alertChannelIds).toEqual(["c1", "c2"]);
    const bad = await api(env).post("/api/targets", tunnelBody({ name: "Other", alertChannelIds: ["c1", "ghost"] }));
    expect(bad.status).toBe(400);
    expect(bad.json.error.details).toEqual([{ path: "alertChannelIds", message: "Unknown alert channel ids: ghost" }]);
    expect(await getDb(env).select().from(targets).where(eq(targets.name, "Other"))).toHaveLength(0);
  });

  it("rejects invalid input with 400 validation_error and creates nothing", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ scheduleCron: "61 * * * *" }, "scheduleCron"],
      [{ timezone: "Mars/Base" }, "timezone"],
      [{ connectionUrl: "mysql://u:p@h/db" }, "connectionUrl"],
      [{ tunnel: undefined }, "tunnel"],
      [{ tunnel: { hostname: "db.example.com", tokenId: "id" } }, "tunnel.tokenSecret"],
      [{ dbName: "shop" }, ""],
    ];
    for (const [override, path] of cases) {
      const res = await api(env).post("/api/targets", tunnelBody(override));
      expect(res.status, JSON.stringify(override)).toBe(400);
      expect(res.json.error.code).toBe("validation_error");
      expect(res.json.error.details.map((d: { path: string }) => d.path)).toContain(path);
    }
    expect(await getDb(env).select().from(targets)).toHaveLength(0);
  });

  it("does not echo a rejected URL's password", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ connectionUrl: "http://backup:leaky-pw@db.example.com/shop" }));
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("leaky-pw");
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await app.request("http://localhost/api/targets", { method: "POST", body: "{nope" }, env);
    expect(res.status).toBe(400);
  });

  it("returns 409 for a duplicate name", async () => {
    await api(env).post("/api/targets", tunnelBody());
    const res = await api(env).post("/api/targets", tunnelBody());
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("conflict");
  });

  it("writes a target.create audit row for the authenticated actor", async () => {
    const asAlice = new Hono<AppEnv>();
    asAlice.onError(errorHandler);
    asAlice.use("*", async (c, next) => {
      c.set("actorEmail", "alice@example.com");
      await next();
    });
    asAlice.route("/api/targets", targetRoutes);
    const res = await api(env, asAlice).post("/api/targets", tunnelBody());
    const rows = await getDb(env).select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "alice@example.com", action: "target.create", entityType: "target", entityId: res.json.id });
    expect(JSON.parse(rows[0]?.details ?? "{}")).toMatchObject({ name: "Shop DB", connection: { host: "db.example.com", user: "backup" } });
  });

  it("returns 401 without a valid Access token when DEV_BYPASS is off", async () => {
    const res = await api({ ...env, DEV_BYPASS: "" }).post("/api/targets", tunnelBody());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/targets/:id", () => {
  it("returns the target, and the response never contains a secret", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    const res = await api(env).get(`/api/targets/${created.json.id}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual(created.json);
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
  });

  it("returns 404 not_found for an unknown id", async () => {
    const res = await api(env).get("/api/targets/nope");
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("not_found");
  });
});
