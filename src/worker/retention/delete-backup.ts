import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { backups } from "../db/schema";
import type { Env } from "../env";
import { writeAudit } from "../lib/audit";
import { redactError } from "../lib/redact";
import { backupTime, compareBackupTime } from "./plan";

export type Db = ReturnType<typeof getDb>;

/** Latest live success under the same shared ordering the planner uses, so the guard can never disagree with the plan. */
export async function findLatestSuccessId(db: Db, targetId: string): Promise<string | null> {
  const rows = await db
    .select({ id: backups.id, startedAt: backupTime })
    .from(backups)
    .where(and(eq(backups.targetId, targetId), eq(backups.status, "success"), isNull(backups.deletedAt)));
  let latest: { id: string; startedAt: string } | null = null;
  for (const row of rows) {
    if (!latest || compareBackupTime(latest, row) < 0) latest = row;
  }
  return latest?.id ?? null;
}

export type DeleteReason = "retention" | "manual";

export type DeleteOutcome =
  | { status: "deleted" }
  | { status: "already_deleted" }
  | { status: "refused_latest_success" }
  | { status: "r2_failed"; error: string };

export interface DeletableBackup {
  id: string;
  targetId: string;
  r2Key: string | null;
}

const AUDIT_ACTIONS: Record<DeleteReason, { ok: string; failed: string | null }> = {
  retention: { ok: "retention.delete", failed: "retention.delete_failed" },
  manual: { ok: "backup.delete", failed: null },
};

/**
 * The single delete routine, shared by the retention runner and DELETE /api/backups/:id.
 * Order is fixed: R2 object first, then the D1 soft delete, then the audit row.
 * A D1 error after the R2 delete is thrown to the caller; the next run repeats the (idempotent) R2 delete and heals it.
 */
export async function deleteBackup(
  env: Env,
  backup: DeletableBackup,
  opts: { reason: DeleteReason; actor: string; ip?: string | null },
): Promise<DeleteOutcome> {
  const db = getDb(env);
  const actions = AUDIT_ACTIONS[opts.reason];
  const details = { targetId: backup.targetId, r2Key: backup.r2Key, reason: opts.reason };

  if ((await findLatestSuccessId(db, backup.targetId)) === backup.id) {
    return { status: "refused_latest_success" };
  }

  try {
    if (!backup.r2Key) throw new Error("backup has no r2_key");
    await env.BACKUPS.delete(backup.r2Key);
  } catch (error) {
    const message = redactError(error);
    if (actions.failed) {
      await writeAudit(db, {
        actor: opts.actor,
        action: actions.failed,
        entityType: "backup",
        entityId: backup.id,
        details: { ...details, error: message },
        ip: opts.ip ?? null,
      });
    }
    return { status: "r2_failed", error: message };
  }

  const updated = await db
    .update(backups)
    .set({ deletedAt: new Date().toISOString(), deletedReason: opts.reason })
    .where(and(eq(backups.id, backup.id), isNull(backups.deletedAt)))
    .returning({ id: backups.id });
  if (updated.length === 0) return { status: "already_deleted" };

  try {
    await writeAudit(db, {
      actor: opts.actor,
      action: actions.ok,
      entityType: "backup",
      entityId: backup.id,
      details,
      ip: opts.ip ?? null,
    });
  } catch (error) {
    console.error(`audit write failed after delete of ${backup.id}: ${redactError(error)}`);
  }
  return { status: "deleted" };
}
