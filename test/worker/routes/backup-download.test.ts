import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../../src/worker/app";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs, settings } from "../../../src/worker/db/schema";
import { createTestEnv } from "../../helpers/env";
import { TEST_R2, seedBackup, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;

beforeEach(async () => {
  ctx = await createTestEnv(TEST_R2);
});
afterEach(async () => {
  await ctx.dispose();
});

const post = (id: string) => app.request(`http://localhost/api/backups/${id}/download-url`, { method: "POST" }, ctx.env);

async function setTtl(value: string): Promise<void> {
  await getDb(ctx.env).insert(settings).values({ key: "download_url_ttl_seconds", value, updatedAt: "2026-10-24T00:00:00.000Z" });
}

function signedLifetimeSeconds(url: string): number {
  return Number(new URL(url).searchParams.get("X-Amz-Expires"));
}

describe("POST /api/backups/:id/download-url", () => {
  it("returns a presigned R2 URL that expires in 15 minutes by default", async () => {
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const res = await post(backup.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { url: string; expiresAt: string };
    const url = new URL(body.url);
    expect(url.origin).toBe(TEST_R2.R2_ENDPOINT);
    expect(url.pathname.startsWith("/cellar-backups/backups/")).toBe(true);
    expect(url.searchParams.get("X-Amz-Credential")?.startsWith("AKIDTEST/")).toBe(true);
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(signedLifetimeSeconds(body.url)).toBe(900);
    const msUntilExpiry = Date.parse(body.expiresAt) - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(0);
    expect(msUntilExpiry).toBeLessThanOrEqual(900_000);
  });

  it("never signs more than 15 minutes, even when the setting is larger", async () => {
    await setTtl("3600");
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string; expiresAt: string };
    expect(signedLifetimeSeconds(body.url)).toBe(900);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(900_000);
  });

  it("honours a smaller download_url_ttl_seconds setting", async () => {
    await setTtl("300");
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string };
    expect(signedLifetimeSeconds(body.url)).toBe(300);
  });

  it("falls back to 15 minutes when the setting is not a usable number", async () => {
    await setTtl('"soon"');
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string };
    expect(signedLifetimeSeconds(body.url)).toBe(900);
  });

  it("uses R2_REGION when it is set", async () => {
    await ctx.dispose();
    ctx = await createTestEnv({ ...TEST_R2, R2_REGION: "us-east-1" });
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string };
    expect(new URL(body.url).searchParams.get("X-Amz-Credential")).toContain("/us-east-1/s3/aws4_request");
  });

  it("writes a backup.download audit row without the URL or any signature", async () => {
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string };
    const rows = await getDb(ctx.env).select().from(auditLogs).where(eq(auditLogs.action, "backup.download"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "dev@localhost", entityType: "backup", entityId: backup.id });
    expect(rows[0]?.details).toContain(target.id);
    expect(rows[0]?.details).not.toContain("X-Amz");
    expect(rows[0]?.details).not.toContain("r2-secret-test");
    expect(rows[0]?.details).not.toContain(body.url);
  });

  it("returns 404 for an unknown backup and writes no audit row", async () => {
    const res = await post("does-not-exist");
    expect(res.status).toBe(404);
    expect(await getDb(ctx.env).select().from(auditLogs)).toHaveLength(0);
  });

  it("returns 409 for backups that are not successful or were deleted", async () => {
    const target = await seedTarget(ctx.env);
    const failed = await seedBackup(ctx.env, target.id, { status: "failed" });
    const deleted = await seedBackup(ctx.env, target.id, { deletedAt: "2026-10-24T01:00:00.000Z" });
    for (const backup of [failed, deleted]) {
      const res = await post(backup.id);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("conflict");
    }
    expect(await getDb(ctx.env).select().from(auditLogs)).toHaveLength(0);
  });

  it("still serves backups whose target was soft-deleted (history and R2 data are kept)", async () => {
    const target = await seedTarget(ctx.env, { deletedAt: "2026-10-24T01:00:00.000Z" });
    const backup = await seedBackup(ctx.env, target.id);
    expect((await post(backup.id)).status).toBe(200);
  });
});
