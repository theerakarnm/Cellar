import { asc, isNull } from "drizzle-orm";
import { getZonedParts } from "../../shared/tz";
import { getDb } from "../db/client";
import { targets } from "../db/schema";
import type { Env } from "../env";
import { redactError } from "../lib/redact";
import { getLastRun, getRetentionDryRun, getRetentionTimezone, setLastRun } from "./config";
import { MAX_DELETIONS_PER_RUN, runRetention } from "./runner";

export interface DailyRetentionResult {
  ran: boolean;
  /** False when the per-tick budget ran out; the next cron tick continues and the day is not yet recorded. */
  complete: boolean;
  deleted: number;
  failed: number;
}

function localDate(now: Date, tz: string): string {
  const p = getZonedParts(now, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Runs retention for every active target at most once per local day (default timezone).
 * A dry-run day does not block a later live run on the same day.
 */
export async function runDailyRetention(
  env: Env,
  now: Date = new Date(),
  budget: number = MAX_DELETIONS_PER_RUN,
): Promise<DailyRetentionResult> {
  const [tz, dryRun, lastRun] = await Promise.all([getRetentionTimezone(env), getRetentionDryRun(env), getLastRun(env)]);
  const today = localDate(now, tz);
  if (lastRun?.date === today && (lastRun.dryRun === false || dryRun === true)) {
    return { ran: false, complete: true, deleted: 0, failed: 0 };
  }

  const ids = await getDb(env).select({ id: targets.id }).from(targets).where(isNull(targets.deletedAt)).orderBy(asc(targets.id));
  let remainingBudget = budget;
  let complete = true;
  let deleted = 0;
  let failed = 0;

  for (const { id } of ids) {
    if (remainingBudget <= 0) {
      complete = false;
      break;
    }
    try {
      const result = await runRetention(env, id, { now, maxDeletions: remainingBudget });
      remainingBudget -= result.deleted.length + result.failed.length;
      deleted += result.deleted.length;
      failed += result.failed.length;
      if (result.remaining > 0) complete = false;
    } catch (error) {
      console.error(`retention failed for target ${id}: ${redactError(error)}`);
    }
  }

  if (complete) await setLastRun(env, { date: today, dryRun });
  return { ran: true, complete, deleted, failed };
}

/** Never throws: for ctx.waitUntil after a successful backup callback. */
export async function triggerRetentionAfterBackup(env: Env, targetId: string): Promise<void> {
  try {
    await runRetention(env, targetId);
  } catch (error) {
    console.error(`retention after backup failed for target ${targetId}: ${redactError(error)}`);
  }
}

/** Never throws: for ctx.waitUntil from the cron handler. */
export async function triggerDailyRetention(env: Env, now: Date): Promise<void> {
  try {
    await runDailyRetention(env, now);
  } catch (error) {
    console.error(`daily retention failed: ${redactError(error)}`);
  }
}
