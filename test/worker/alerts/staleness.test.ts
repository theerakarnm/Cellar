import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { checkStaleness, staleAfterMs } from "../../../src/worker/alerts/staleness";
import { notifyBackupFinished } from "../../../src/worker/alerts/notify";
import type { Env } from "../../../src/worker/env";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedChannel, seedTarget, targetRow } from "../../helpers/alerts-seed";

const HOUR = 3_600_000;
const NOW = new Date("2026-10-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

const texts = () => fetchSpy.mock.calls.map((c: Parameters<typeof fetch>) => JSON.parse((c[1] as RequestInit).body as string).content as string);

describe("staleAfterMs", () => {
  const base = { staleAfterHours: null, scheduleCron: "0 2 * * *", timezone: "Asia/Bangkok" };
  it("uses the explicit hours when set", () => {
    expect(staleAfterMs({ ...base, staleAfterHours: 5 }, NOW)).toBe(5 * HOUR);
  });
  it("derives interval plus 2 h from the schedule (daily = 26 h)", () => {
    expect(staleAfterMs(base, NOW)).toBe(26 * HOUR);
  });
});

describe("checkStaleness", () => {
  beforeEach(async () => {
    await seedTarget(env, "t1", { name: "shop-prod", last_backup_at: hoursAgo(30), created_at: hoursAgo(500) });
    await seedChannel(env, "c1", "t1");
  });

  it("alerts once per stale episode across many ticks", async () => {
    for (let i = 0; i < 5; i++) await checkStaleness(env, new Date(NOW.getTime() + i * 60_000));
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain("No successful backup in 26 h");
    expect((await targetRow(env, "t1"))?.stale_alerted_at).toBe(NOW.toISOString());
  });

  it("alerts again only after a success clears the episode", async () => {
    await checkStaleness(env, NOW);
    await seedBackup(env, "ok1", "t1", "success");
    await notifyBackupFinished(env, "ok1");
    await env.DB.prepare("UPDATE targets SET last_backup_at = ? WHERE id = 't1'").bind(hoursAgo(1)).run();
    await checkStaleness(env, NOW);
    expect(texts()).toHaveLength(1);
    const later = new Date(NOW.getTime() + 30 * HOUR);
    await checkStaleness(env, later);
    expect(texts()).toHaveLength(2);
  });

  it("does not alert inside the window, at the exact limit, or for disabled and deleted targets", async () => {
    await seedTarget(env, "fresh", { last_backup_at: hoursAgo(25) });
    await seedTarget(env, "edge", { last_backup_at: hoursAgo(26) });
    await seedTarget(env, "off", { last_backup_at: hoursAgo(99), enabled: 0 });
    await seedTarget(env, "gone", { last_backup_at: hoursAgo(99), deleted_at: hoursAgo(1) });
    for (const id of ["fresh", "edge", "off", "gone"]) await seedChannel(env, `c-${id}`, id);
    await checkStaleness(env, NOW);
    expect(texts()).toHaveLength(1);
  });

  it("measures a never-succeeded target from its creation time", async () => {
    await seedTarget(env, "new", { created_at: hoursAgo(27) });
    await seedChannel(env, "c-new", "new");
    await seedTarget(env, "newer", { created_at: hoursAgo(2) });
    await seedChannel(env, "c-newer", "newer");
    await checkStaleness(env, NOW);
    const sent = texts().filter((t: string) => t.includes("target-new"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Last success: never");
  });

  it("honours a per-target stale_after_hours", async () => {
    await seedTarget(env, "short", { last_backup_at: hoursAgo(3), stale_after_hours: 2 });
    await seedChannel(env, "c-short", "short");
    await checkStaleness(env, NOW);
    expect(texts().some((t: string) => t.includes("target-short") && t.includes("No successful backup in 2 h"))).toBe(true);
  });

  it("marks the episode even when the target has no linked channel", async () => {
    await seedTarget(env, "lonely", { last_backup_at: hoursAgo(99) });
    await checkStaleness(env, NOW);
    expect((await targetRow(env, "lonely"))?.stale_alerted_at).toBe(NOW.toISOString());
  });

  it("never throws when the database is broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(checkStaleness({ ...env, DB: {} as D1Database }, NOW)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
