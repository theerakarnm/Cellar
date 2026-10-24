import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { alertChannels, backups } from "../../../src/worker/db/schema";
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

const NAMES = ["delta", "alpha", "echo", "charlie", "สำรอง", "bravo"];
const SORTED = ["alpha", "bravo", "charlie", "delta", "echo", "สำรอง"];

async function createAll(names: string[]) {
  const ids: Record<string, string> = {};
  for (const name of names) {
    const res = await api(env).post("/api/targets", tunnelBody({ name }));
    ids[name] = res.json.id;
  }
  return ids;
}

function backupRow(targetId: string, id: string, overrides: Partial<typeof backups.$inferInsert> = {}): typeof backups.$inferInsert {
  return { id, targetId, status: "success", trigger: "manual", queuedAt: "2026-10-24T00:00:00.000Z", ...overrides };
}

describe("GET /api/targets", () => {
  it("returns an empty page", async () => {
    const res = await api(env).get("/api/targets");
    expect(res.json).toEqual({ items: [], nextCursor: null });
  });

  it("lists targets by name with the default limit and no cursor", async () => {
    await createAll(NAMES);
    const res = await api(env).get("/api/targets");
    expect(res.status).toBe(200);
    expect(res.json.items.map((t: { name: string }) => t.name)).toEqual(SORTED);
    expect(res.json.nextCursor).toBeNull();
  });

  it("pages through all targets with limit and cursor, with no repeats or gaps", async () => {
    await createAll(NAMES);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await api(env).get(`/api/targets?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.json.items.map((t: { name: string }) => t.name));
      cursor = res.json.nextCursor;
      pages++;
    } while (cursor);
    expect(seen).toEqual(SORTED);
    expect(pages).toBe(3);
  });

  it("returns exactly nextCursor null when the last page is full", async () => {
    await createAll(["a", "b"]);
    const res = await api(env).get("/api/targets?limit=2");
    expect(res.json.items).toHaveLength(2);
    expect(res.json.nextCursor).toBeNull();
  });

  it("rejects a bad limit or cursor with 400", async () => {
    for (const query of ["limit=0", "limit=201", "limit=abc", "cursor=%21%21%21"]) {
      const res = await api(env).get(`/api/targets?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.json.error.code).toBe("validation_error");
    }
  });

  it("includes alert channel ids and backup stats, counting only successful, not-deleted backups", async () => {
    const db = getDb(env);
    await db.insert(alertChannels).values({ id: "c1", type: "line", name: "ops", credentialEnc: "v1:x:y", events: "[]", createdAt: "t", updatedAt: "t" });
    const ids = await createAll(["bravo"]);
    const created = await api(env).post("/api/targets", tunnelBody({ name: "alpha", alertChannelIds: ["c1"] }));
    ids.alpha = created.json.id;
    await db.insert(backups).values([
      backupRow(ids.alpha ?? "", "b1", { sizeBytes: 100 }),
      backupRow(ids.alpha ?? "", "b2", { sizeBytes: 200 }),
      backupRow(ids.alpha ?? "", "b3", { status: "failed", sizeBytes: 999 }),
      backupRow(ids.alpha ?? "", "b4", { sizeBytes: 5000, deletedAt: "2026-10-24T01:00:00.000Z" }),
    ]);
    const res = await api(env).get("/api/targets");
    const [alpha, bravo] = res.json.items;
    expect(alpha).toMatchObject({ name: "alpha", alertChannelIds: ["c1"], stats: { backupCount: 2, totalBackupBytes: 300 } });
    expect(bravo).toMatchObject({ name: "bravo", alertChannelIds: [], stats: { backupCount: 0, totalBackupBytes: 0 } });
  });

  it("never contains a secret", async () => {
    await createAll(["alpha"]);
    const res = await api(env).get("/api/targets");
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
    expect(res.text).not.toContain("_enc");
  });
});
