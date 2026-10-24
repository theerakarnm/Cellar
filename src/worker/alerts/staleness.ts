import { and, eq, isNull } from "drizzle-orm";
import { approxIntervalMs } from "../../shared/cron";
import { getDb } from "../db/client";
import { targets } from "../db/schema";
import type { Env } from "../env";
import { redactError } from "../lib/redact";
import { deliverAlert } from "./dispatch";
import { buildAlertMessage } from "./message";

const HOUR_MS = 3_600_000;
const DERIVED_GRACE_MS = 2 * HOUR_MS;

/** Explicit `stale_after_hours`, else the schedule's expected interval plus 2 h (daily = 26 h). */
export function staleAfterMs(
  target: { staleAfterHours: number | null; scheduleCron: string; timezone: string },
  now: Date,
): number {
  if (target.staleAfterHours !== null) return target.staleAfterHours * HOUR_MS;
  return approxIntervalMs(target.scheduleCron, target.timezone, now) + DERIVED_GRACE_MS;
}

/**
 * Alerts once per stale episode: the claim on `stale_alerted_at` is atomic, and a later success
 * (see notifyBackupFinished) clears it. Runs in the per-minute cron; one SELECT when nothing is stale. Never throws.
 */
export async function checkStaleness(env: Env, now: Date = new Date()): Promise<void> {
  try {
    const db = getDb(env);
    const candidates = await db
      .select({
        id: targets.id,
        name: targets.name,
        projectTag: targets.projectTag,
        timezone: targets.timezone,
        scheduleCron: targets.scheduleCron,
        staleAfterHours: targets.staleAfterHours,
        lastBackupAt: targets.lastBackupAt,
        createdAt: targets.createdAt,
      })
      .from(targets)
      .where(and(eq(targets.enabled, true), isNull(targets.deletedAt), isNull(targets.staleAlertedAt)));

    for (const target of candidates) {
      try {
        const reference = new Date(target.lastBackupAt ?? target.createdAt);
        const limitMs = staleAfterMs(target, now);
        if (now.getTime() - reference.getTime() <= limitMs) continue;
        const claimed = await db
          .update(targets)
          .set({ staleAlertedAt: now.toISOString() })
          .where(and(eq(targets.id, target.id), isNull(targets.staleAlertedAt)))
          .returning({ id: targets.id });
        if (claimed.length === 0) continue;
        const text = buildAlertMessage(
          target,
          {
            event: "backup_stale",
            staleAfterHours: Math.round(limitMs / HOUR_MS),
            lastSuccessAt: target.lastBackupAt ? reference : null,
          },
          now,
          env.APP_BASE_URL,
        );
        await deliverAlert(env, target.id, "backup_stale", text);
      } catch (error) {
        console.warn(JSON.stringify({ msg: "staleness check failed for target", targetId: target.id, error: redactError(error) }));
      }
    }
  } catch (error) {
    console.warn(JSON.stringify({ msg: "staleness check failed", error: redactError(error) }));
  }
}
