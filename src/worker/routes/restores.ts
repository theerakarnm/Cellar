import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { restores } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { decodeCursor, paginationQuery, toPage } from "../lib/pagination";
import { parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";

const listQuery = paginationQuery.extend({ targetId: z.string().min(1).optional() });

export const restoresRoutes = new Hono<AppEnv>();

/** Public view of a restore row: no heartbeatAt, no lastSeq. */
function toView(row: typeof restores.$inferSelect) {
  return {
    id: row.id,
    sourceBackupId: row.sourceBackupId,
    destinationTargetId: row.destinationTargetId,
    destinationDbName: row.destinationDbName,
    status: row.status,
    actor: row.actor,
    sameDatabase: row.isSourceOverwrite,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

restoresRoutes.get("/", async (c) => {
  const query = parseQuery(c, listQuery);
  const [afterQueuedAt, afterId] = query.cursor ? decodeCursor(query.cursor, 2) : [];
  const rows = await getDb(c.env)
    .select()
    .from(restores)
    .where(
      and(
        query.targetId ? eq(restores.destinationTargetId, query.targetId) : undefined,
        afterQueuedAt === undefined || afterId === undefined
          ? undefined
          : or(
              lt(restores.queuedAt, afterQueuedAt),
              and(eq(restores.queuedAt, afterQueuedAt), lt(restores.id, afterId)),
            ),
      ),
    )
    .orderBy(desc(restores.queuedAt), desc(restores.id))
    .limit(query.limit + 1);
  return c.json(toPage(rows.map(toView), query.limit, (row) => [row.queuedAt ?? "", row.id]));
});

restoresRoutes.get("/:id", async (c) => {
  const [row] = await getDb(c.env).select().from(restores).where(eq(restores.id, c.req.param("id"))).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Restore not found");
  return c.json(toView(row));
});
