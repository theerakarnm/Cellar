import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { api, SECRETS, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));

function row(id: string, at: string, overrides: Partial<typeof auditLogs.$inferInsert> = {}): typeof auditLogs.$inferInsert {
  return { id, at, actor: "alice@example.com", action: "target.update", entityType: "target", entityId: "t1", details: null, ip: null, ...overrides };
}

describe("GET /api/audit-logs", () => {
  it("returns an empty page", async () => {
    expect((await api(env).get("/api/audit-logs")).json).toEqual({ items: [], nextCursor: null });
  });

  it("lists newest first, with parsed details, after create, update, and delete", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    const id = created.json.id as string;
    await api(env).patch(`/api/targets/${id}`, { name: "Renamed" });
    await api(env).delete(`/api/targets/${id}`);
    const res = await api(env).get("/api/audit-logs");
    expect(res.status).toBe(200);
    expect(res.json.items.map((item: { action: string }) => item.action)).toEqual(["target.delete", "target.update", "target.create"]);
    expect(res.json.items[0]).toMatchObject({ actor: "dev@localhost", entityType: "target", entityId: id, details: { name: "Renamed" } });
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
  });

  it("filters by entityType and entityId", async () => {
    await getDb(env).insert(auditLogs).values([
      row("a", "2026-10-24T01:00:00.000Z"),
      row("b", "2026-10-24T02:00:00.000Z", { entityId: "t2" }),
      row("c", "2026-10-24T03:00:00.000Z", { entityType: "backup", entityId: "b1", action: "backup.delete" }),
    ]);
    const ids = async (query: string) => (await api(env).get(`/api/audit-logs?${query}`)).json.items.map((i: { id: string }) => i.id);
    expect(await ids("entityType=target")).toEqual(["b", "a"]);
    expect(await ids("entityType=target&entityId=t1")).toEqual(["a"]);
    expect(await ids("entityId=b1")).toEqual(["c"]);
    expect(await ids("entityType=nothing")).toEqual([]);
  });

  it("pages newest first without repeats or gaps, including rows with the same timestamp", async () => {
    const same = "2026-10-24T05:00:00.000Z";
    await getDb(env).insert(auditLogs).values([
      row("r1", "2026-10-24T01:00:00.000Z"),
      row("r2", same),
      row("r3", same),
      row("r4", same),
      row("r5", "2026-10-24T09:00:00.000Z"),
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await api(env).get(`/api/audit-logs?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.json.items.map((i: { id: string }) => i.id));
      cursor = res.json.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["r5", "r4", "r3", "r2", "r1"]);
  });

  it("returns details that is not valid JSON as plain text, and rejects bad limits and cursors", async () => {
    await getDb(env).insert(auditLogs).values(row("x", "2026-10-24T01:00:00.000Z", { details: "plain text" }));
    expect((await api(env).get("/api/audit-logs")).json.items[0].details).toBe("plain text");
    for (const query of ["limit=0", "limit=201", "cursor=%21%21%21"]) {
      expect((await api(env).get(`/api/audit-logs?${query}`)).status, query).toBe(400);
    }
  });
});
