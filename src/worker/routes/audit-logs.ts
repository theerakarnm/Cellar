import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { auditLogs } from "../db/schema";
import { decodeCursor, paginationQuery, toPage } from "../lib/pagination";
import { parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";

const auditQuery = paginationQuery.extend({ entityType: z.string().min(1).optional(), entityId: z.string().min(1).optional() });

export const auditLogRoutes = new Hono<AppEnv>();

auditLogRoutes.get("/", async (c) => {
  const query = parseQuery(c, auditQuery);
  const [at, id] = query.cursor ? decodeCursor(query.cursor, 2) : [];
  const rows = await getDb(c.env)
    .select()
    .from(auditLogs)
    .where(
      and(
        query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined,
        query.entityId ? eq(auditLogs.entityId, query.entityId) : undefined,
        at === undefined || id === undefined ? undefined : or(lt(auditLogs.at, at), and(eq(auditLogs.at, at), lt(auditLogs.id, id))),
      ),
    )
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(query.limit + 1);
  const items = rows.map((row) => ({ ...row, details: row.details === null ? null : parseDetails(row.details) }));
  return c.json(toPage(items, query.limit, (row) => [row.at, row.id]));
});

function parseDetails(details: string): unknown {
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}
