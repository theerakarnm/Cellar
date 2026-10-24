/// <reference types="vite/client" />
import { getPlatformProxy } from "wrangler";
import type { Env } from "../../src/worker/env";

const migrationFiles = import.meta.glob("../../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const TEST_ENCRYPTION_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

const TABLES_CHILD_FIRST = [
  "target_alert_channels",
  "restores",
  "backups",
  "targets",
  "alert_channels",
  "audit_logs",
  "settings",
];

async function migrate(db: D1Database): Promise<void> {
  for (const path of Object.keys(migrationFiles).sort()) {
    for (const statement of (migrationFiles[path] ?? "").split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await db.prepare(statement).run();
    }
  }
}

/** Deletes every row. Call in `beforeEach` so tests share one migrated in-memory database per file. */
export async function resetDb(env: Env): Promise<void> {
  await env.DB.batch(TABLES_CHILD_FIRST.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}

/**
 * Local D1, R2, and Queue bindings from wrangler.jsonc (in memory, nothing persisted), migrated from /migrations.
 * Secrets are fixed fake values so tests never depend on a local .dev.vars file.
 */
export async function createTestEnv(overrides: Partial<Env> = {}): Promise<{ env: Env; dispose(): Promise<void> }> {
  const proxy = await getPlatformProxy<Env>({ configPath: "wrangler.jsonc", persist: false });
  await migrate(proxy.env.DB);
  const env: Env = {
    ...proxy.env,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    ACCESS_AUD: "test-aud",
    DEV_BYPASS: "true",
    ...overrides,
  };
  return { env, dispose: () => proxy.dispose() };
}
