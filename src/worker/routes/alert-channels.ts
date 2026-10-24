import { asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import {
  createChannelSchema,
  discordCredentialSchema,
  lineCredentialSchema,
  updateChannelSchema,
} from "../../shared/alerts";
import { sendToChannel } from "../alerts/dispatch";
import { buildTestMessage } from "../alerts/message";
import { getDb } from "../db/client";
import { alertChannels, targetAlertChannels } from "../db/schema";
import { writeAudit } from "../lib/audit";
import { ApiError, notFound } from "../lib/api-error";
import { encrypt } from "../lib/crypto";
import { decodeCursor, encodeCursor, paginationQuery, toPage } from "../lib/pagination";
import { parseBody, parseQuery } from "../lib/validate";
import { uuidv7 } from "../lib/uuidv7";
import type { AppEnv } from "../middleware/access";

type ChannelRow = typeof alertChannels.$inferSelect;

function toResponse(row: ChannelRow) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    events: JSON.parse(row.events) as string[],
    enabled: row.enabled,
    hasCredential: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const clientIp = (c: { req: { header(name: string): string | undefined } }) => c.req.header("cf-connecting-ip") ?? null;

export const alertChannelRoutes = new Hono<AppEnv>();

alertChannelRoutes.get("/", async (c) => {
  const { limit, cursor } = parseQuery(c, paginationQuery);
  const [lastId] = cursor ? decodeCursor(cursor, 1) : [];
  const rows = await getDb(c.env)
    .select()
    .from(alertChannels)
    .where(lastId === undefined ? undefined : gt(alertChannels.id, lastId))
    .orderBy(asc(alertChannels.id))
    .limit(limit + 1);
  return c.json(toPage(rows.map(toResponse), limit, (row) => [row.id]));
});

alertChannelRoutes.post("/", async (c) => {
  const body = await parseBody(c, createChannelSchema);
  const now = new Date().toISOString();
  const db = getDb(c.env);
  const [row] = await db
    .insert(alertChannels)
    .values({
      id: uuidv7(),
      type: body.type,
      name: body.name,
      credentialEnc: await encrypt(JSON.stringify(body.credential), c.env.ENCRYPTION_KEY),
      events: JSON.stringify(body.events),
      enabled: body.enabled,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new ApiError(500, "internal_error", "Insert returned no row");
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "alert_channel.create",
    entityType: "alert_channel",
    entityId: row.id,
    details: { type: row.type, name: row.name, events: body.events, enabled: row.enabled },
    ip: clientIp(c),
  });
  return c.json(toResponse(row), 201);
});

alertChannelRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c, updateChannelSchema);
  const db = getDb(c.env);
  const existing = await db.select().from(alertChannels).where(eq(alertChannels.id, id)).get();
  if (!existing) throw notFound("Alert channel");

  let credentialEnc: string | undefined;
  if (body.credential !== undefined) {
    const schema = existing.type === "line" ? lineCredentialSchema : discordCredentialSchema;
    const parsed = schema.safeParse(body.credential);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "validation_error",
        `credential does not match a ${existing.type} channel`,
        parsed.error.issues.map((issue) => ({ path: ["credential", ...issue.path].join("."), message: issue.message })),
      );
    }
    credentialEnc = await encrypt(JSON.stringify(parsed.data), c.env.ENCRYPTION_KEY);
  }

  const [row] = await db
    .update(alertChannels)
    .set({
      updatedAt: new Date().toISOString(),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.events !== undefined && { events: JSON.stringify(body.events) }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(credentialEnc !== undefined && { credentialEnc }),
    })
    .where(eq(alertChannels.id, id))
    .returning();
  if (!row) throw notFound("Alert channel");
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "alert_channel.update",
    entityType: "alert_channel",
    entityId: id,
    details: { name: row.name, events: body.events, enabled: row.enabled, credentialChanged: credentialEnc !== undefined },
    ip: clientIp(c),
  });
  return c.json(toResponse(row));
});

alertChannelRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const existing = await db.select().from(alertChannels).where(eq(alertChannels.id, id)).get();
  if (!existing) throw notFound("Alert channel");
  await db.batch([
    db.delete(targetAlertChannels).where(eq(targetAlertChannels.channelId, id)),
    db.delete(alertChannels).where(eq(alertChannels.id, id)),
  ]);
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "alert_channel.delete",
    entityType: "alert_channel",
    entityId: id,
    details: { type: existing.type, name: existing.name },
    ip: clientIp(c),
  });
  return c.body(null, 204);
});

alertChannelRoutes.post("/:id/test", async (c) => {
  const row = await getDb(c.env).select().from(alertChannels).where(eq(alertChannels.id, c.req.param("id"))).get();
  if (!row) throw notFound("Alert channel");
  const result = await sendToChannel(c.env, row, buildTestMessage(row.name, new Date()));
  return c.json(result);
});
