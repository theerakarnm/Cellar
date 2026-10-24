import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { nextRun } from "../../shared/cron";
import { parsePgUrl, sanitizeDbName } from "../../shared/pg-url";
import { TARGET_DEFAULTS, type CreateTargetInput, type UpdateTargetInput } from "../../shared/target-schema";
import { getDb, type Db } from "../db/client";
import { alertChannels, targetAlertChannels, targets } from "../db/schema";
import type { Env } from "../env";
import { conflict, notFound, validationError } from "../lib/api-error";
import { auditInsert } from "../lib/audit";
import { encrypt } from "../lib/crypto";
import { decodeCursor, toPage, type Page } from "../lib/pagination";
import { uuidv7 } from "../lib/uuidv7";
import { EMPTY_STATS, loadAlertChannelIds, loadStats, toTargetView, type TargetRow, type TargetView } from "./target-view";

export type Actor = { email: string; ip: string | null };

type Statements = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

async function assertNameFree(db: Db, name: string, exceptId?: string): Promise<void> {
  const taken = await db
    .select({ id: targets.id })
    .from(targets)
    .where(and(eq(targets.name, name), isNull(targets.deletedAt), exceptId ? ne(targets.id, exceptId) : undefined))
    .limit(1);
  if (taken.length > 0) throw conflict("A target with this name already exists");
}

async function assertChannelsExist(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await db.select({ id: alertChannels.id }).from(alertChannels).where(inArray(alertChannels.id, ids));
  const missing = ids.filter((id) => !found.some((row) => row.id === id));
  if (missing.length > 0) throw validationError("alertChannelIds", `Unknown alert channel ids: ${missing.join(", ")}`);
}

function channelLinks(targetId: string, ids: string[]) {
  return ids.map((channelId) => ({ targetId, channelId }));
}

async function requireTarget(db: Db, id: string): Promise<TargetRow> {
  const [row] = await db.select().from(targets).where(and(eq(targets.id, id), isNull(targets.deletedAt))).limit(1);
  if (!row) throw notFound("Target");
  return row;
}

async function viewOf(env: Env, db: Db, row: TargetRow): Promise<TargetView> {
  const [channels, stats] = await Promise.all([loadAlertChannelIds(db, row.id), loadStats(db, row.id)]);
  return toTargetView(env, row, channels.get(row.id) ?? [], stats.get(row.id) ?? EMPTY_STATS);
}

function dbNameOf(url: string): string {
  const info = parsePgUrl(url);
  if (!info) throw validationError("connectionUrl", "Must be a postgres:// or postgresql:// URL with a user, a host, and a database name");
  return sanitizeDbName(info.dbName);
}

function scheduleFor(cron: string, timezone: string, enabled: boolean, now: Date): string | null {
  return enabled ? nextRun(cron, timezone, now).toISOString() : null;
}

export async function getTarget(env: Env, id: string): Promise<TargetView> {
  const db = getDb(env);
  return viewOf(env, db, await requireTarget(db, id));
}

export async function createTarget(env: Env, input: CreateTargetInput, actor: Actor): Promise<TargetView> {
  const db = getDb(env);
  await assertNameFree(db, input.name);
  await assertChannelsExist(db, input.alertChannelIds);

  const now = new Date();
  const stamp = now.toISOString();
  const id = uuidv7(now.getTime());
  const key = env.ENCRYPTION_KEY;
  const retention = input.retention ?? {};
  const row: typeof targets.$inferInsert = {
    id,
    name: input.name,
    dbName: dbNameOf(input.connectionUrl),
    connectionUrlEnc: await encrypt(input.connectionUrl, key),
    restoreUrlEnc: input.restoreUrl ? await encrypt(input.restoreUrl, key) : null,
    projectTag: input.projectTag ?? null,
    tunnelHostname: input.tunnel.hostname,
    tunnelTokenIdEnc: await encrypt(input.tunnel.tokenId, key),
    tunnelTokenSecretEnc: await encrypt(input.tunnel.tokenSecret, key),
    scheduleCron: input.scheduleCron,
    timezone: input.timezone,
    enabled: input.enabled,
    keepLast: retention.keepLast === undefined ? TARGET_DEFAULTS.keepLast : retention.keepLast,
    keepDaily: retention.daily === undefined ? TARGET_DEFAULTS.keepDaily : retention.daily,
    keepWeekly: retention.weekly === undefined ? TARGET_DEFAULTS.keepWeekly : retention.weekly,
    keepMonthly: retention.monthly === undefined ? TARGET_DEFAULTS.keepMonthly : retention.monthly,
    maxAgeDays: retention.maxAgeDays === undefined ? TARGET_DEFAULTS.maxAgeDays : retention.maxAgeDays,
    jobDeadlineMinutes: input.jobDeadlineMinutes,
    staleAfterHours: input.staleAfterHours ?? null,
    alertFailureThreshold: input.alertFailureThreshold,
    nextRunAt: scheduleFor(input.scheduleCron, input.timezone, input.enabled, now),
    createdAt: stamp,
    updatedAt: stamp,
  };

  const statements: Statements = [
    db.insert(targets).values(row),
    auditInsert(db, {
      actor: actor.email,
      ip: actor.ip,
      action: "target.create",
      entityType: "target",
      entityId: id,
      details: {
        name: row.name,
        projectTag: row.projectTag,
        connection: parsePgUrl(input.connectionUrl),
        hasRestoreUrl: row.restoreUrlEnc !== null,
        tunnelHostname: row.tunnelHostname,
        scheduleCron: row.scheduleCron,
        timezone: row.timezone,
        enabled: row.enabled,
        retention: { keepLast: row.keepLast, daily: row.keepDaily, weekly: row.keepWeekly, monthly: row.keepMonthly, maxAgeDays: row.maxAgeDays },
        jobDeadlineMinutes: row.jobDeadlineMinutes,
        staleAfterHours: row.staleAfterHours,
        alertFailureThreshold: row.alertFailureThreshold,
        alertChannelIds: input.alertChannelIds,
      },
    }),
  ];
  if (input.alertChannelIds.length > 0) statements.push(db.insert(targetAlertChannels).values(channelLinks(id, input.alertChannelIds)));

  await db.batch(statements);
  return getTarget(env, id);
}

export async function listTargets(env: Env, query: { limit: number; cursor?: string | undefined }): Promise<Page<TargetView>> {
  const db = getDb(env);
  const after = query.cursor ? decodeCursor(query.cursor, 1)[0] : undefined;
  const rows = await db
    .select()
    .from(targets)
    .where(and(isNull(targets.deletedAt), after === undefined ? undefined : gt(targets.name, after)))
    .orderBy(asc(targets.name))
    .limit(query.limit + 1);
  const [channels, stats] = await Promise.all([loadAlertChannelIds(db), loadStats(db)]);
  const views = await Promise.all(rows.map((row) => toTargetView(env, row, channels.get(row.id) ?? [], stats.get(row.id) ?? EMPTY_STATS)));
  return toPage(views, query.limit, (view) => [view.name]);
}
