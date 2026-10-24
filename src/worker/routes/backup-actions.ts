import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type Db, getDb } from "../db/client";
import { backups, restores, settings, targets } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { writeAudit } from "../lib/audit";
import { decrypt } from "../lib/crypto";
import { redactError } from "../lib/redact";
import { clampDownloadTtl, destinationDbNameFromUrl } from "../lib/restore-rules";
import { presignGetObject } from "../lib/s3-presign";
import { uuidv7 } from "../lib/uuidv7";
import { parseBody } from "../lib/validate";
import type { AppEnv } from "../middleware/access";

export const backupActions = new Hono<AppEnv>();

async function findAvailableBackup(db: Db, id: string) {
  const [backup] = await db.select().from(backups).where(eq(backups.id, id)).limit(1);
  if (!backup) throw new ApiError(404, "not_found", "Backup not found");
  if (backup.status !== "success" || backup.deletedAt !== null || backup.r2Key === null) {
    throw new ApiError(409, "conflict", "Backup is not available (only successful, undeleted backups can be downloaded or restored)");
  }
  return { ...backup, r2Key: backup.r2Key };
}

async function readDownloadTtlSeconds(db: Db): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "download_url_ttl_seconds")).limit(1);
  if (!row) return clampDownloadTtl(undefined);
  try {
    return clampDownloadTtl(JSON.parse(row.value));
  } catch {
    return clampDownloadTtl(undefined);
  }
}

const restoreBody = z.strictObject({
  destinationTargetId: z.string().min(1),
  confirmName: z.string(),
  acknowledgeOverwrite: z.boolean().optional(),
});

async function destinationBusy(db: Db, targetId: string): Promise<boolean> {
  const [activeRestore] = await db
    .select({ id: restores.id })
    .from(restores)
    .where(and(eq(restores.destinationTargetId, targetId), inArray(restores.status, ["queued", "running"])))
    .limit(1);
  if (activeRestore) return true;
  const [activeBackup] = await db
    .select({ id: backups.id })
    .from(backups)
    .where(and(eq(backups.targetId, targetId), inArray(backups.status, ["queued", "running"])))
    .limit(1);
  return activeBackup !== undefined;
}

function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return text.includes("UNIQUE constraint failed");
}

backupActions.post("/:id/download-url", async (c) => {
  const db = getDb(c.env);
  const backup = await findAvailableBackup(db, c.req.param("id"));
  const ttl = await readDownloadTtlSeconds(db);
  const now = new Date();
  const url = await presignGetObject({
    endpoint: c.env.R2_ENDPOINT,
    bucket: c.env.R2_BUCKET,
    key: backup.r2Key,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    region: c.env.R2_REGION || "auto",
    expiresInSeconds: ttl,
    now,
  });
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "backup.download",
    entityType: "backup",
    entityId: backup.id,
    details: { targetId: backup.targetId, expiresAt },
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  return c.json({ url, expiresAt }, 200, { "Cache-Control": "no-store" });
});

backupActions.post("/:id/restore", async (c) => {
  const db = getDb(c.env);
  const body = await parseBody(c, restoreBody);
  const backup = await findAvailableBackup(db, c.req.param("id"));

  const [destination] = await db.select().from(targets).where(eq(targets.id, body.destinationTargetId)).limit(1);
  if (!destination || destination.deletedAt !== null) throw new ApiError(404, "not_found", "Destination target not found");
  if (body.confirmName !== destination.name) {
    throw new ApiError(400, "validation_error", "Invalid request", [
      { path: "confirmName", message: "confirmName must exactly equal the destination target name" },
    ]);
  }
  const sameDatabase = destination.id === backup.targetId;
  if (sameDatabase && body.acknowledgeOverwrite !== true) {
    throw new ApiError(400, "validation_error", "Invalid request", [
      { path: "acknowledgeOverwrite", message: "Restoring into the source database needs acknowledgeOverwrite: true" },
    ]);
  }
  if (destination.restoreUrlEnc === null) {
    throw new ApiError(400, "restore_url_missing", "The destination target has no restore connection URL. Add one to the target before restoring.");
  }
  const restoreUrl = await decrypt(destination.restoreUrlEnc, c.env.ENCRYPTION_KEY);
  const destinationDbName = destinationDbNameFromUrl(restoreUrl);
  if (destinationDbName === null) {
    throw new ApiError(400, "restore_url_invalid", "The destination restore connection URL must be a postgres URL that names a database");
  }
  if (await destinationBusy(db, destination.id)) {
    throw new ApiError(409, "conflict", "Another backup or restore is queued or running on the destination target");
  }

  const restoreId = uuidv7();
  try {
    await db.insert(restores).values({
      id: restoreId,
      sourceBackupId: backup.id,
      destinationTargetId: destination.id,
      destinationDbName,
      status: "queued",
      actor: c.get("actorEmail"),
      isSourceOverwrite: sameDatabase,
      queuedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "conflict", "Another backup or restore is queued or running on the destination target");
    }
    throw error;
  }
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "restore.start",
    entityType: "restore",
    entityId: restoreId,
    details: { backupId: backup.id, destinationTargetId: destination.id, destinationDbName, sameDatabase },
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  try {
    await c.env.JOBS.send({ jobId: restoreId, type: "restore", targetId: destination.id });
  } catch (error) {
    await db
      .update(restores)
      .set({ status: "failed", errorCode: "enqueue_failed", errorMessage: redactError(error), finishedAt: new Date().toISOString() })
      .where(eq(restores.id, restoreId));
    throw new ApiError(503, "enqueue_failed", "Could not queue the restore job. Try again.");
  }
  return c.json({ restoreId, sameDatabase }, 202);
});
