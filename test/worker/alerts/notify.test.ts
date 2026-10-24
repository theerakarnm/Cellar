import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { afterResponse, notifyBackupFinished } from "../../../src/worker/alerts/notify";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedChannel, seedTarget, targetRow } from "../../helpers/alerts-seed";
import type { Env } from "../../../src/worker/env";

const SECRET_URL = "postgres://app:Sup3rS3cretPw@db.internal:5432/shop";
let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;
let n = 0;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
  await seedTarget(env, "t1", { name: "shop-prod", project_tag: "shop" });
  await seedChannel(env, "c1", "t1");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

async function finish(status: string, over: Record<string, unknown> = {}) {
  const id = `b${++n}`;
  await seedBackup(env, id, "t1", status, over);
  await notifyBackupFinished(env, id);
}

function sentTexts(): string[] {
  return fetchSpy.mock.calls.map((call: Parameters<typeof fetch>) => JSON.parse((call[1] as RequestInit).body as string).content as string);
}

describe("notifyBackupFinished", () => {
  it("sends backup_failed on every failure and the consecutive alert exactly once per episode", async () => {
    for (let i = 0; i < 5; i++) await finish("failed", { error_code: "DUMP_FAILED", error_message: "boom" });
    const texts = sentTexts();
    expect(texts.filter((t) => t.includes("Backup failed"))).toHaveLength(5);
    expect(texts.filter((t) => t.includes("consecutive backup failures"))).toHaveLength(1);
    expect(texts.find((t) => t.includes("consecutive"))).toContain("3 consecutive backup failures");
    expect((await targetRow(env, "t1"))?.consecutive_failures).toBe(5);
  });

  it("counts timed_out as a failure and titles it", async () => {
    await finish("timed_out");
    expect(sentTexts()[0]).toContain("Backup timed out");
  });

  it("resets on success and fires a new episode afterwards", async () => {
    for (let i = 0; i < 3; i++) await finish("failed");
    await finish("success");
    expect(await targetRow(env, "t1")).toEqual({ consecutive_failures: 0, failure_alerted_at: null, stale_alerted_at: null });
    fetchSpy.mockClear();
    for (let i = 0; i < 3; i++) await finish("failed");
    expect(sentTexts().filter((t) => t.includes("consecutive backup failures"))).toHaveLength(1);
  });

  it("honours a per-target threshold", async () => {
    await env.DB.prepare("UPDATE targets SET alert_failure_threshold = 1 WHERE id = 't1'").run();
    await finish("failed");
    expect(sentTexts().filter((t) => t.includes("1 consecutive backup failures"))).toHaveLength(1);
  });

  it("success also clears a stale episode", async () => {
    await env.DB.prepare("UPDATE targets SET stale_alerted_at = '2026-10-23T00:00:00.000Z' WHERE id = 't1'").run();
    await finish("success");
    expect((await targetRow(env, "t1"))?.stale_alerted_at).toBeNull();
  });

  it("does nothing for non-terminal rows and unknown ids", async () => {
    await finish("running");
    await notifyBackupFinished(env, "missing");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await targetRow(env, "t1"))?.consecutive_failures).toBe(0);
  });

  it("sends nothing when the target has no linked channel", async () => {
    await seedTarget(env, "t2");
    await seedBackup(env, "bx", "t2", "failed");
    await notifyBackupFinished(env, "bx");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await targetRow(env, "t2"))?.consecutive_failures).toBe(1);
  });

  it("sends nothing for a backup of a soft-deleted target", async () => {
    await env.DB.prepare("UPDATE targets SET deleted_at = ? WHERE id = 't1'").bind("2026-10-24T01:00:00.000Z").run();
    await finish("failed");
    await finish("timed_out");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never puts connection URLs or passwords in the delivered message", async () => {
    await finish("failed", { error_code: "DUMP_FAILED", error_message: `could not connect ${SECRET_URL} password=hunter2-hunter2` });
    const text = sentTexts()[0] ?? "";
    expect(text).toContain("postgres://app:***@db.internal");
    expect(text).not.toContain("Sup3rS3cretPw");
    expect(text).not.toContain("hunter2");
  });

  it("never throws when delivery fails, and still updates state", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error(`down ${"https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL"}`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(finish("failed")).resolves.toBeUndefined();
    expect((await targetRow(env, "t1"))?.consecutive_failures).toBe(1);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("abcDEF");
  });

  it("never throws when the database is broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { ...env, DB: {} as D1Database };
    await expect(notifyBackupFinished(broken, "b1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("afterResponse", () => {
  it("hands the task to waitUntil when a context exists", async () => {
    const waitUntil = vi.fn();
    const task = Promise.resolve();
    await afterResponse({ executionCtx: { waitUntil } }, task);
    expect(waitUntil).toHaveBeenCalledWith(task);
  });

  it("returns the task itself when Hono has no context", async () => {
    const { Hono } = await import("hono");
    const app = new Hono<{ Bindings: Env }>();
    let ran = false;
    app.get("/", async (c) => {
      await afterResponse(c, (async () => { ran = true; })());
      return c.text("ok");
    });
    const res = await app.request("http://localhost/", {}, env);
    expect(res.status).toBe(200);
    expect(ran).toBe(true);
  });
});
