import { eq } from "drizzle-orm";
import { isValidTimeZone } from "../../shared/tz";
import { getDb } from "../db/client";
import { settings } from "../db/schema";
import type { Env } from "../env";

export const RETENTION_DRY_RUN_KEY = "retention_dry_run";
export const RETENTION_LAST_RUN_KEY = "retention_last_run";
const DEFAULT_TIMEZONE_KEY = "default_timezone";
const FALLBACK_TIMEZONE = "Asia/Bangkok";

export interface RetentionLastRun {
  date: string;
  dryRun: boolean;
}

export async function readSetting(env: Env, key: string): Promise<unknown> {
  const row = await getDb(env)
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return undefined;
  }
}

export async function writeSetting(env: Env, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  const updatedAt = new Date().toISOString();
  await getDb(env)
    .insert(settings)
    .values({ key, value: json, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt } });
}

/** Only a stored boolean `false` turns dry run off. Anything else, including a missing row, means dry run. */
export async function getRetentionDryRun(env: Env): Promise<boolean> {
  return (await readSetting(env, RETENTION_DRY_RUN_KEY)) !== false;
}

export async function getRetentionTimezone(env: Env): Promise<string> {
  const value = await readSetting(env, DEFAULT_TIMEZONE_KEY);
  return typeof value === "string" && isValidTimeZone(value) ? value : FALLBACK_TIMEZONE;
}

export async function getLastRun(env: Env): Promise<RetentionLastRun | null> {
  const value = await readSetting(env, RETENTION_LAST_RUN_KEY);
  if (typeof value !== "object" || value === null) return null;
  const { date, dryRun } = value as Record<string, unknown>;
  return typeof date === "string" && typeof dryRun === "boolean" ? { date, dryRun } : null;
}

export async function setLastRun(env: Env, lastRun: RetentionLastRun): Promise<void> {
  await writeSetting(env, RETENTION_LAST_RUN_KEY, lastRun);
}
