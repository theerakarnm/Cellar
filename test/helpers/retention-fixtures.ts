import { eq } from "drizzle-orm";
import { getDb } from "../../src/worker/db/client";
import { auditLogs, backups, targets } from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { uuidv7 } from "../../src/worker/lib/uuidv7";

export const NOW = new Date("2026-06-15T12:00:00.000Z");

export const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** Defaults to keep_last 2 with every other rule off, so tests state only what they exercise. */
export async function seedTarget(
  env: Env,
  overrides: Partial<Omit<typeof targets.$inferInsert, "id">> = {},
): Promise<string> {
  const id = uuidv7();
  const at = NOW.toISOString();
  await getDb(env).insert(targets).values({
    id,
    name: `target-${id}`,
    dbName: "app",
    connectionUrlEnc: "v1:aa:bb",
    tunnelHostname: "db.example.com",
    tunnelTokenIdEnc: "v1:aa:bb",
    tunnelTokenSecretEnc: "v1:aa:bb",
    createdAt: at,
    updatedAt: at,
    keepLast: 2,
    keepDaily: null,
    keepWeekly: null,
    keepMonthly: null,
    maxAgeDays: null,
    ...overrides,
  });
  return id;
}

export interface SeededBackup {
  id: string;
  r2Key: string;
}

export async function seedBackup(
  env: Env,
  targetId: string,
  startedAt: string,
  status: "success" | "failed" = "success",
): Promise<SeededBackup> {
  const id = uuidv7();
  const r2Key = `backups/${targetId}/${id}.dump`;
  await getDb(env).insert(backups).values({
    id,
    targetId,
    status,
    trigger: "schedule",
    r2Key,
    sizeBytes: 1,
    queuedAt: startedAt,
    startedAt,
    finishedAt: startedAt,
  });
  if (status === "success") await env.BACKUPS.put(r2Key, "dump");
  return { id, r2Key };
}

export async function backupRow(env: Env, id: string) {
  return getDb(env).select().from(backups).where(eq(backups.id, id)).get();
}

export async function hasObject(env: Env, key: string): Promise<boolean> {
  return (await env.BACKUPS.head(key)) !== null;
}

export async function auditRows(env: Env) {
  return getDb(env)
    .select({ action: auditLogs.action, actor: auditLogs.actor, entityId: auditLogs.entityId })
    .from(auditLogs)
    .all();
}

/** Same bindings as `env`, but R2 `delete` throws for the given keys. */
export function failingR2(env: Env, failKeys: ReadonlySet<string>): Env {
  const bucket = new Proxy(env.BACKUPS, {
    get(target, prop) {
      if (prop === "delete") {
        return async (key: string | string[]) => {
          if (typeof key === "string" && failKeys.has(key)) throw new Error("R2 unavailable");
          return target.delete(key);
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...env, BACKUPS: bucket };
}
