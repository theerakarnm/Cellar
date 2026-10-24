import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb, type Db } from "../db/client";
import { backups, connectionTests, targets } from "../db/schema";
import { queueConnectionTest, queueManualBackup } from "../jobs/dispatch";
import { writeAudit } from "../lib/audit";
import { ApiError } from "../lib/api-error";
import { decodeCursor, encodeCursor, paginationQuery } from "../lib/pagination";
import { parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";

/** Mounted at `/api/targets` next to the Phase 2 CRUD routes. */
export const targetJobs = new Hono<AppEnv>();

async function requireTarget(db: Db, id: string): Promise<void> {
  const [target] = await db
    .select({ id: targets.id })
    .from(targets)
    .where(and(eq(targets.id, id), isNull(targets.deletedAt)))
    .limit(1);
  if (!target) throw new ApiError(404, "not_found", "Target not found");
}

targetJobs.post("/:id/backup", async (c) => {
  const targetId = c.req.param("id");
  await requireTarget(getDb(c.env), targetId);
  const backupId = await queueManualBackup(c.env, targetId, new Date());
  await writeAudit(getDb(c.env), {
    actor: c.get("actorEmail"),
    action: "backup.trigger",
    entityType: "backup",
    entityId: backupId,
    details: { targetId, trigger: "manual" },
  });
  return c.json({ backupId }, 202);
});

targetJobs.post("/:id/test", async (c) => {
  const targetId = c.req.param("id");
  await requireTarget(getDb(c.env), targetId);
  const testId = await queueConnectionTest(c.env, targetId, new Date());
  return c.json({ testId }, 202);
});

targetJobs.get("/:id/test/:testId", async (c) => {
  const db = getDb(c.env);
  const [row] = await db
    .select()
    .from(connectionTests)
    .where(and(eq(connectionTests.id, c.req.param("testId")), eq(connectionTests.targetId, c.req.param("id"))))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", "Connection test not found");
  return c.json({
    status: row.status,
    ...(row.resultJson ? { result: JSON.parse(row.resultJson) as unknown } : {}),
    ...(row.errorCode ? { error: { code: row.errorCode, message: row.errorMessage } } : {}),
  });
});

const backupListQuery = paginationQuery.extend({
  status: z.enum(["queued", "running", "success", "failed", "timed_out"]).optional(),
});

const sortKey = sql<string>`coalesce(${backups.startedAt}, ${backups.queuedAt})`;

targetJobs.get("/:id/backups", async (c) => {
  const db = getDb(c.env);
  const targetId = c.req.param("id");
  await requireTarget(db, targetId);
  const query = parseQuery(c, backupListQuery);

  let after;
  if (query.cursor) {
    const [key = "", id = ""] = decodeCursor(query.cursor, 2);
    after = or(lt(sortKey, key), and(eq(sortKey, key), lt(backups.id, id)));
  }

  const rows = await db
    .select({
      id: backups.id,
      targetId: backups.targetId,
      status: backups.status,
      trigger: backups.trigger,
      r2Key: backups.r2Key,
      sizeBytes: backups.sizeBytes,
      sha256: backups.sha256,
      pgVersionServer: backups.pgVersionServer,
      durationMs: backups.durationMs,
      errorCode: backups.errorCode,
      errorMessage: backups.errorMessage,
      queuedAt: backups.queuedAt,
      startedAt: backups.startedAt,
      finishedAt: backups.finishedAt,
      sortKey,
    })
    .from(backups)
    .where(
      and(
        eq(backups.targetId, targetId),
        isNull(backups.deletedAt),
        query.status ? eq(backups.status, query.status) : undefined,
        after,
      ),
    )
    .orderBy(desc(sortKey), desc(backups.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last ? encodeCursor([last.sortKey, last.id]) : null;
  return c.json({ items: page.map(({ sortKey: _sortKey, ...item }) => item), nextCursor });
});
