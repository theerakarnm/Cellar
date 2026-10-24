import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../../src/worker/app";
import { getDb } from "../../../src/worker/db/client";
import { settings } from "../../../src/worker/db/schema";
import { createTestEnv, resetDb } from "../../helpers/env";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
beforeAll(async () => {
  ctx = await createTestEnv();
});
afterAll(async () => {
  await ctx.dispose();
});
beforeEach(async () => {
  await resetDb(ctx.env);
});

const put = (body: unknown) =>
  app.request("http://localhost/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, ctx.env);
const stored = async () => (await getDb(ctx.env).select().from(settings).where(eq(settings.key, "download_url_ttl_seconds")))[0];

describe("PUT /api/settings download_url_ttl_seconds", () => {
  it("accepts whole seconds from 1 to 900 and stores them as JSON", async () => {
    expect((await put({ download_url_ttl_seconds: 600 })).status).toBe(200);
    expect(JSON.parse((await stored())?.value ?? "null")).toBe(600);
    expect((await put({ download_url_ttl_seconds: 900 })).status).toBe(200);
    expect((await put({ download_url_ttl_seconds: 1 })).status).toBe(200);
  });

  it("rejects values above 15 minutes, below 1 second, fractions, and strings", async () => {
    for (const bad of [901, 0, -1, 1.5, "600"]) {
      expect((await put({ download_url_ttl_seconds: bad })).status).toBe(400);
    }
    expect(await stored()).toBeUndefined();
  });
});
