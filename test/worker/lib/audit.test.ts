import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { writeAudit } from "../../../src/worker/lib/audit";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));

describe("writeAudit", () => {
  it("stores actor, action, entity, and a UUIDv7 id with a UTC ISO time", async () => {
    await writeAudit(getDb(env), { actor: "alice@example.com", action: "target.create", entityType: "target", entityId: "t1", ip: "203.0.113.9" });
    const [row] = await getDb(env).select().from(auditLogs);
    expect(row).toMatchObject({ actor: "alice@example.com", action: "target.create", entityType: "target", entityId: "t1", ip: "203.0.113.9", details: null });
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(row?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("stores details as redacted JSON", async () => {
    await writeAudit(getDb(env), {
      actor: "system",
      action: "target.update",
      entityType: "target",
      details: { note: "failed for postgres://admin:hunter2@db.example.com/app", password: "hunter2" },
    });
    const [row] = await getDb(env).select().from(auditLogs);
    expect(row?.details).not.toContain("hunter2");
    expect(JSON.parse(row?.details ?? "null")).toHaveProperty("note");
    expect(row?.entityId).toBeNull();
  });
});
