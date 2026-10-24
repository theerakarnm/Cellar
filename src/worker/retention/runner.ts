import { getDb } from "../db/client";
import type { Env } from "../env";
import { redactError, redactSecrets } from "../lib/redact";
import { getRetentionDryRun } from "./config";
import { deleteBackup } from "./delete-backup";
import { loadActiveTarget, planRetention } from "./plan";

export const MAX_DELETIONS_PER_RUN = 50;

export interface RetentionResult {
  deleted: string[];
  failed: { id: string; error: string }[];
  dryRun: boolean;
  /** Planned deletions not attempted because of `maxDeletions`. Always 0 in a dry run. */
  remaining: number;
}

export async function runRetention(
  env: Env,
  targetId: string,
  opts: { now?: Date; maxDeletions?: number } = {},
): Promise<RetentionResult> {
  const db = getDb(env);
  const dryRun = await getRetentionDryRun(env);
  const result: RetentionResult = { deleted: [], failed: [], dryRun, remaining: 0 };

  const target = await loadActiveTarget(db, targetId);
  if (!target) return result;

  const plan = await planRetention(db, target, opts.now ?? new Date());

  if (dryRun) {
    console.info(
      redactSecrets(
        JSON.stringify({
          event: "retention.dry_run",
          targetId,
          keep: plan.keep.length,
          delete: plan.delete.map((d) => d.id),
        }),
      ),
    );
    return result;
  }

  const batch = plan.delete.slice(0, opts.maxDeletions ?? MAX_DELETIONS_PER_RUN);
  result.remaining = plan.delete.length - batch.length;

  for (const backup of batch) {
    try {
      const outcome = await deleteBackup(env, { id: backup.id, targetId, r2Key: backup.r2Key }, { reason: "retention", actor: "system" });
      if (outcome.status === "deleted") result.deleted.push(backup.id);
      else if (outcome.status === "refused_latest_success") result.failed.push({ id: backup.id, error: "refused_latest_success" });
      else if (outcome.status === "r2_failed") result.failed.push({ id: backup.id, error: outcome.error });
    } catch (error) {
      result.failed.push({ id: backup.id, error: redactError(error) });
    }
  }
  return result;
}
