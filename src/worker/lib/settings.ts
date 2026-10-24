import { z } from "zod";
import { settings } from "../db/schema";
import type { Db } from "../jobs/types";

export const MAX_CONCURRENT_JOBS_LIMIT = 10;

/** Known settings keys and their validators. Later phases add keys here. */
export const settingValidators = {
  max_concurrent_jobs: z.number().int().min(1).max(MAX_CONCURRENT_JOBS_LIMIT),
  download_url_ttl_seconds: z.number().int().min(1).max(900),
  retention_dry_run: z.boolean(),
} as const;

export const SETTING_DEFAULTS = { max_concurrent_jobs: 1, retention_dry_run: true } as const;

export type Settings = { max_concurrent_jobs: number; retention_dry_run: boolean };

export const settingsInputSchema = z
  .object(settingValidators)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one setting is required" });
export type SettingsInput = z.infer<typeof settingsInputSchema>;

/** Stored value if present and valid, otherwise the code default. */
export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settings);
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const maxConcurrent = parseStored(stored.get("max_concurrent_jobs"), settingValidators.max_concurrent_jobs);
  const retentionDryRun = parseStored(stored.get("retention_dry_run"), settingValidators.retention_dry_run);
  return {
    max_concurrent_jobs: maxConcurrent ?? SETTING_DEFAULTS.max_concurrent_jobs,
    retention_dry_run: retentionDryRun ?? SETTING_DEFAULTS.retention_dry_run,
  };
}

function parseStored<T>(raw: string | undefined, validator: z.ZodType<T>): T | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = validator.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function updateSettings(db: Db, patch: SettingsInput, now: Date): Promise<Settings> {
  for (const [key, value] of Object.entries(patch)) {
    const row = { key, value: JSON.stringify(value), updatedAt: now.toISOString() };
    await db.insert(settings).values(row).onConflictDoUpdate({ target: settings.key, set: { value: row.value, updatedAt: row.updatedAt } });
  }
  return getSettings(db);
}
