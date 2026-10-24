import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type Db, getDb } from "../db/client";
import { backups, settings } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { writeAudit } from "../lib/audit";
import { clampDownloadTtl } from "../lib/restore-rules";
import { presignGetObject } from "../lib/s3-presign";
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
