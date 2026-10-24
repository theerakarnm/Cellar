import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { backups } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { parseBody } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { deleteBackup } from "../retention/delete-backup";

const deleteBody = z.object({ confirm: z.literal(true) });

export const backupDeleteRoutes = new Hono<AppEnv>();

backupDeleteRoutes.delete("/backups/:id", async (c) => {
  await parseBody(c, deleteBody);

  const backup = await getDb(c.env)
    .select({ id: backups.id, targetId: backups.targetId, status: backups.status, r2Key: backups.r2Key })
    .from(backups)
    .where(and(eq(backups.id, c.req.param("id")), isNull(backups.deletedAt)))
    .get();
  if (!backup) throw new ApiError(404, "not_found", "Backup not found");
  if (backup.status !== "success") {
    throw new ApiError(409, "conflict", "Only successful backups can be deleted", { reason: "not_success" });
  }

  const outcome = await deleteBackup(c.env, backup, {
    reason: "manual",
    actor: c.get("actorEmail"),
    ip: c.req.header("cf-connecting-ip") ?? null,
  });

  if (outcome.status === "refused_latest_success") {
    throw new ApiError(409, "conflict", "The most recent successful backup cannot be deleted", { reason: "latest_success" });
  }
  if (outcome.status === "r2_failed") {
    return c.json(
      {
        error: {
          code: "r2_delete_failed",
          message: "The backup file could not be deleted from R2; nothing was changed",
        },
      },
      502,
    );
  }
  if (outcome.status === "already_deleted") throw new ApiError(404, "not_found", "Backup not found");
  return c.body(null, 204);
});
