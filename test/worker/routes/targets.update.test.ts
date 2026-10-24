import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { alertChannels, auditLogs, targetAlertChannels, targets } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { decrypt } from "../../../src/worker/lib/crypto";
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

async function create(overrides: Record<string, unknown> = {}) {
  const res = await api(env).post("/api/targets", tunnelBody(overrides));
  expect(res.status).toBe(201);
  return res.json as { id: string; nextRunAt: string | null };
}

async function rowOf(id: string) {
  const [row] = await getDb(env).select().from(targets).where(eq(targets.id, id));
  if (!row) throw new Error("row missing");
  return row;
}

describe("PATCH /api/targets/:id", () => {
  it("keeps every stored secret byte for byte when the secret fields are omitted", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    const res = await api(env).patch(`/api/targets/${id}`, { name: "Renamed", scheduleCron: "0 3 * * *", retention: { daily: 14 } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: "Renamed", scheduleCron: "0 3 * * *", retention: { keepLast: 3, daily: 14, weekly: 4, monthly: 6, maxAgeDays: null } });
    const after = await rowOf(id);
    for (const column of ["connectionUrlEnc", "restoreUrlEnc", "tunnelTokenIdEnc", "tunnelTokenSecretEnc", "tunnelHostname", "dbName"] as const) {
      expect(after[column], column).toBe(before[column]);
    }
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
  });

  it("re-encrypts a new connection URL and updates db_name and the masked connection", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    const res = await api(env).patch(`/api/targets/${id}`, { connectionUrl: "postgres://other:new-pw@db2.example.com:6000/orders" });
    expect(res.json).toMatchObject({ dbName: "orders", connection: { host: "db2.example.com", port: 6000, dbName: "orders", user: "other" } });
    expect(res.text).not.toContain("new-pw");
    const after = await rowOf(id);
    expect(after.connectionUrlEnc).not.toBe(before.connectionUrlEnc);
    expect(await decrypt(after.connectionUrlEnc, env.ENCRYPTION_KEY)).toBe("postgres://other:new-pw@db2.example.com:6000/orders");
    expect(after.tunnelTokenSecretEnc).toBe(before.tunnelTokenSecretEnc);
  });

  it("replaces only the tunnel token secret when only that is sent", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    await api(env).patch(`/api/targets/${id}`, { tunnel: { tokenSecret: "rotated-secret" } });
    const after = await rowOf(id);
    expect(await decrypt(after.tunnelTokenSecretEnc ?? "", env.ENCRYPTION_KEY)).toBe("rotated-secret");
    expect(after.tunnelTokenIdEnc).toBe(before.tunnelTokenIdEnc);
    expect(after.tunnelHostname).toBe(before.tunnelHostname);
  });

  it("sets or clears the restore URL and the project tag", async () => {
    const { id } = await create();
    const cleared = await api(env).patch(`/api/targets/${id}`, { restoreUrl: null, projectTag: null });
    expect(cleared.json).toMatchObject({ hasRestoreUrl: false, projectTag: null });
    const set = await api(env).patch(`/api/targets/${id}`, { restoreUrl: "postgres://r:r2@db.example.com/shop" });
    expect(set.json.hasRestoreUrl).toBe(true);
  });

  it("recomputes next_run_at when cron or timezone changes (Asia/Bangkok and UTC)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const { id, nextRunAt } = await create();
    expect(nextRunAt).toBe("2026-10-24T19:00:00.000Z");
    const utc = await api(env).patch(`/api/targets/${id}`, { timezone: "UTC" });
    expect(utc.json.nextRunAt).toBe("2026-10-24T02:00:00.000Z");
    const cron = await api(env).patch(`/api/targets/${id}`, { scheduleCron: "30 6 * * *" });
    expect(cron.json.nextRunAt).toBe("2026-10-24T06:30:00.000Z");
  });

  it("sets next_run_at to null when disabled and recomputes it when enabled again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const { id } = await create();
    const off = await api(env).patch(`/api/targets/${id}`, { enabled: false });
    expect(off.json).toMatchObject({ enabled: false, nextRunAt: null });
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    const on = await api(env).patch(`/api/targets/${id}`, { enabled: true });
    expect(on.json).toMatchObject({ enabled: true, nextRunAt: "2026-10-26T19:00:00.000Z" });
  });

  it("leaves next_run_at alone when schedule, timezone, and enabled do not change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const { id } = await create();
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    const res = await api(env).patch(`/api/targets/${id}`, { name: "Renamed", scheduleCron: "0 2 * * *", enabled: true });
    expect(res.json.nextRunAt).toBe("2026-10-24T19:00:00.000Z");
  });

  it("merges retention field by field and lets null switch a rule off", async () => {
    const { id } = await create();
    const res = await api(env).patch(`/api/targets/${id}`, { retention: { keepLast: null, maxAgeDays: 90 } });
    expect(res.json.retention).toEqual({ keepLast: null, daily: 7, weekly: 4, monthly: 6, maxAgeDays: 90 });
  });

  it("replaces only the supplied tunnel part and keeps the other tunnel columns", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    const res = await api(env).patch(`/api/targets/${id}`, { tunnel: { hostname: "db2.example.com" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tunnelHostname: "db2.example.com", hasTunnelToken: true });
    const after = await rowOf(id);
    expect([after.tunnelTokenIdEnc, after.tunnelTokenSecretEnc]).toEqual([before.tunnelTokenIdEnc, before.tunnelTokenSecretEnc]);
  });

  it("updates the alert failure threshold and rejects one out of bounds", async () => {
    const { id } = await create();
    const res = await api(env).patch(`/api/targets/${id}`, { alertFailureThreshold: 7 });
    expect(res.json).toMatchObject({ alertFailureThreshold: 7 });
    expect((await rowOf(id)).alertFailureThreshold).toBe(7);
    expect((await api(env).patch(`/api/targets/${id}`, { alertFailureThreshold: 101 })).status).toBe(400);
  });

  it("rejects connectionMode as an unknown field", async () => {
    const { id } = await create();
    const res = await api(env).patch(`/api/targets/${id}`, { connectionMode: "tunnel" });
    expect(res.status).toBe(400);
  });

  it("replaces, keeps, and clears alert channel links", async () => {
    for (const id of ["c1", "c2"]) {
      await getDb(env).insert(alertChannels).values({ id, type: "discord", name: id, credentialEnc: "v1:x:y", events: "[]", createdAt: "t", updatedAt: "t" });
    }
    const { id } = await create({ alertChannelIds: ["c1"] });
    expect((await api(env).patch(`/api/targets/${id}`, { alertChannelIds: ["c2"] })).json.alertChannelIds).toEqual(["c2"]);
    expect((await api(env).patch(`/api/targets/${id}`, { name: "Renamed" })).json.alertChannelIds).toEqual(["c2"]);
    expect((await api(env).patch(`/api/targets/${id}`, { alertChannelIds: [] })).json.alertChannelIds).toEqual([]);
    expect(await getDb(env).select().from(targetAlertChannels)).toHaveLength(0);
    const bad = await api(env).patch(`/api/targets/${id}`, { alertChannelIds: ["ghost"] });
    expect(bad.status).toBe(400);
  });

  it("returns 400 for an empty body or invalid values, 404 for unknown or deleted targets, 409 for a taken name", async () => {
    const { id } = await create();
    await create({ name: "Second" });
    expect((await api(env).patch(`/api/targets/${id}`, {})).status).toBe(400);
    expect((await api(env).patch(`/api/targets/${id}`, { scheduleCron: "nope" })).status).toBe(400);
    expect((await api(env).patch(`/api/targets/${id}`, { timezone: "Mars/Base" })).status).toBe(400);
    expect((await api(env).patch("/api/targets/missing", { name: "x" })).status).toBe(404);
    expect((await api(env).patch(`/api/targets/${id}`, { name: "Second" })).status).toBe(409);
    expect((await api(env).patch(`/api/targets/${id}`, { name: "Shop DB" })).status).toBe(200);
  });

  it("writes a target.update audit row that lists changed secrets by name only", async () => {
    const { id } = await create();
    await api(env).patch(`/api/targets/${id}`, { name: "Renamed", connectionUrl: "postgres://u:audit-leak-pw@h.example.com/db", tunnel: { tokenSecret: "audit-leak-secret" } });
    const rows = await getDb(env).select().from(auditLogs).where(eq(auditLogs.action, "target.update"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "dev@localhost", entityType: "target", entityId: id });
    const details = JSON.parse(rows[0]?.details ?? "{}");
    expect(details).toMatchObject({ name: "Renamed", secretsChanged: ["connectionUrl", "tunnel.tokenSecret"] });
    expect(rows[0]?.details).not.toContain("audit-leak");
  });
});
