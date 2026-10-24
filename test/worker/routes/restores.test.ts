import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../../src/worker/app";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let backupId: string;
let destinationA: string;
let destinationB: string;

beforeAll(async () => {
  ctx = await createTestEnv();
});
afterAll(async () => {
  await ctx.dispose();
});
beforeEach(async () => {
  await resetDb(ctx.env);
  backupId = (await seedBackup(ctx.env, (await seedTarget(ctx.env)).id)).id;
  destinationA = (await seedTarget(ctx.env)).id;
  destinationB = (await seedTarget(ctx.env)).id;
});

const get = (path: string) => app.request(`http://localhost${path}`, {}, ctx.env);
type Page = { items: { id: string; status: string }[]; nextCursor: string | null };

async function seedHistory() {
  const base = { sourceBackupId: backupId, status: "success" as const };
  await seedRestore(ctx.env, { ...base, id: "r-1", destinationTargetId: destinationA, queuedAt: "2026-10-24T01:00:00.000Z" });
  await seedRestore(ctx.env, { ...base, id: "r-2", destinationTargetId: destinationB, queuedAt: "2026-10-24T02:00:00.000Z" });
  await seedRestore(ctx.env, { ...base, id: "r-3", destinationTargetId: destinationA, queuedAt: "2026-10-24T03:00:00.000Z" });
}

describe("GET /api/restores", () => {
  it("lists newest first", async () => {
    await seedHistory();
    const page = (await (await get("/api/restores")).json()) as Page;
    expect(page.items.map((i) => i.id)).toEqual(["r-3", "r-2", "r-1"]);
    expect(page.nextCursor).toBeNull();
  });

  it("filters by destination targetId", async () => {
    await seedHistory();
    const page = (await (await get(`/api/restores?targetId=${destinationA}`)).json()) as Page;
    expect(page.items.map((i) => i.id)).toEqual(["r-3", "r-1"]);
  });

  it("pages with an opaque cursor and visits every row once", async () => {
    await seedHistory();
    const first = (await (await get("/api/restores?limit=2")).json()) as Page;
    expect(first.items.map((i) => i.id)).toEqual(["r-3", "r-2"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (await get(`/api/restores?limit=2&cursor=${first.nextCursor}`)).json()) as Page;
    expect(second.items.map((i) => i.id)).toEqual(["r-1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor and an out-of-range limit with 400", async () => {
    expect((await get("/api/restores?cursor=!!!")).status).toBe(400);
    expect((await get("/api/restores?limit=201")).status).toBe(400);
    expect((await get("/api/restores?limit=0")).status).toBe(400);
  });
});

describe("GET /api/restores/:id", () => {
  it("returns the public fields only", async () => {
    await seedRestore(ctx.env, { id: "r-9", sourceBackupId: backupId, destinationTargetId: destinationA, status: "running", isSourceOverwrite: true, lastSeq: 4, heartbeatAt: "2026-10-24T01:00:00.000Z" });
    const res = await get("/api/restores/r-9");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "r-9",
      sourceBackupId: backupId,
      destinationTargetId: destinationA,
      destinationDbName: "scratch",
      status: "running",
      actor: "dev@localhost",
      sameDatabase: true,
      errorCode: null,
      errorMessage: null,
      queuedAt: "2026-10-24T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    });
  });

  it("returns 404 for an unknown id", async () => {
    expect((await get("/api/restores/nope")).status).toBe(404);
  });
});
