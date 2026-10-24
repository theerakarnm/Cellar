import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs, backups, targets } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { api, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));

describe("DELETE /api/targets/:id", () => {
  it("soft deletes: 204, hidden from get and list, schedule stopped, backups kept", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    const id = created.json.id as string;
    await getDb(env).insert(backups).values({ id: "b1", targetId: id, status: "success", trigger: "manual", queuedAt: "2026-10-24T00:00:00.000Z", sizeBytes: 10 });

    const res = await api(env).delete(`/api/targets/${id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    expect((await api(env).get(`/api/targets/${id}`)).status).toBe(404);
    expect((await api(env).get("/api/targets")).json.items).toEqual([]);

    const [row] = await getDb(env).select().from(targets).where(eq(targets.id, id));
    expect(row?.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row).toMatchObject({ enabled: false, nextRunAt: null });
    const kept = await getDb(env).select().from(backups).where(eq(backups.targetId, id));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.deletedAt).toBeNull();
  });

  it("returns 404 for an unknown id and for a second delete", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    expect((await api(env).delete("/api/targets/missing")).status).toBe(404);
    expect((await api(env).delete(`/api/targets/${created.json.id}`)).status).toBe(204);
    expect((await api(env).delete(`/api/targets/${created.json.id}`)).status).toBe(404);
  });

  it("cannot patch a deleted target, and its name can be reused by a new target", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    await api(env).delete(`/api/targets/${created.json.id}`);
    expect((await api(env).patch(`/api/targets/${created.json.id}`, { enabled: true })).status).toBe(404);
    const reused = await api(env).post("/api/targets", tunnelBody());
    expect(reused.status).toBe(201);
    expect(reused.json.id).not.toBe(created.json.id);
    expect((await api(env).post("/api/targets", tunnelBody())).status).toBe(409);
  });

  it("writes a target.delete audit row for the actor", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    await api(env).delete(`/api/targets/${created.json.id}`);
    const [row] = await getDb(env).select().from(auditLogs).where(eq(auditLogs.action, "target.delete"));
    expect(row).toMatchObject({ actor: "dev@localhost", entityType: "target", entityId: created.json.id });
    expect(JSON.parse(row?.details ?? "{}")).toEqual({ name: "Shop DB" });
  });
});
