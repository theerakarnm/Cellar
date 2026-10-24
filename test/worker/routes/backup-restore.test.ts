import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../../src/worker/app";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs, restores } from "../../../src/worker/db/schema";
import { createTestEnv } from "../../helpers/env";
import { TEST_R2, fakeQueue, seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let sent: unknown[];

async function boot(options: { failSend?: boolean } = {}): Promise<void> {
  const queue = fakeQueue(options);
  sent = queue.sent;
  ctx = await createTestEnv({ ...TEST_R2, JOBS: queue.queue });
}

beforeEach(async () => {
  await boot();
});
afterEach(async () => {
  await ctx.dispose();
});

const restore = (backupId: string, body: unknown) =>
  app.request(
    `http://localhost/api/backups/${backupId}/restore`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    ctx.env,
  );

async function setup() {
  const source = await seedTarget(ctx.env, { name: "source-db" });
  const destination = await seedTarget(ctx.env, { name: "scratch-db" });
  const backup = await seedBackup(ctx.env, source.id);
  return { source, destination, backup };
}

const allRestores = () => getDb(ctx.env).select().from(restores);
const auditRows = (action: string) => getDb(ctx.env).select().from(auditLogs).where(eq(auditLogs.action, action));
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("POST /api/backups/:id/restore", () => {
  it("rejects a wrong confirmName with 400 and starts nothing", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "not-the-name" });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("validation_error");
    expect(await allRestores()).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(await auditRows("restore.start")).toHaveLength(0);
  });

  it("requires an exact match: case and surrounding spaces are rejected", async () => {
    const { destination, backup } = await setup();
    for (const confirmName of ["Scratch-DB", "scratch-db ", " scratch-db", ""]) {
      expect((await restore(backup.id, { destinationTargetId: destination.id, confirmName })).status).toBe(400);
    }
    expect(await allRestores()).toHaveLength(0);
  });

  it("rejects a destination without a restore connection URL, with a clear message", async () => {
    const source = await seedTarget(ctx.env, { name: "source-db" });
    const destination = await seedTarget(ctx.env, { name: "no-restore-url", restoreUrl: null });
    const backup = await seedBackup(ctx.env, source.id);
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "no-restore-url" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("restore_url_missing");
    expect(body.error.message).toContain("restore connection URL");
    expect(await allRestores()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("rejects a restore URL that names no database", async () => {
    const source = await seedTarget(ctx.env, { name: "source-db" });
    const destination = await seedTarget(ctx.env, { name: "no-db", restoreUrl: "postgres://restore_user:pw@db.example.com:5432" });
    const backup = await seedBackup(ctx.env, source.id);
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "no-db" });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("restore_url_invalid");
    expect(await allRestores()).toHaveLength(0);
  });

  it("queues the restore into another target: 202, sameDatabase false, queue message carries ids only", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { restoreId: string; sameDatabase: boolean };
    expect(body.sameDatabase).toBe(false);
    const rows = await allRestores();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.restoreId,
      sourceBackupId: backup.id,
      destinationTargetId: destination.id,
      destinationDbName: "scratch",
      status: "queued",
      actor: "dev@localhost",
      isSourceOverwrite: false,
    });
    expect(sent).toEqual([{ jobId: body.restoreId, type: "restore", targetId: destination.id }]);
  });

  it("flags sameDatabase when the destination is the backup's own target", async () => {
    const { source, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: source.id, confirmName: "source-db", acknowledgeOverwrite: true });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { sameDatabase: boolean }).sameDatabase).toBe(true);
    expect((await allRestores())[0]?.isSourceOverwrite).toBe(true);
  });

  it("requires acknowledgeOverwrite: true when the destination is the backup's own target", async () => {
    const { source, backup } = await setup();
    for (const extra of [{}, { acknowledgeOverwrite: false }]) {
      const res = await restore(backup.id, { destinationTargetId: source.id, confirmName: "source-db", ...extra });
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("validation_error");
    }
    expect(await allRestores()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("does not need acknowledgeOverwrite for another target, and accepts it there", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db", acknowledgeOverwrite: true });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { sameDatabase: boolean }).sameDatabase).toBe(false);
  });

  it("accepts acknowledgeOverwrite: false for another target, and rejects non-boolean values", async () => {
    const { destination, backup } = await setup();
    for (const bad of [{ acknowledgeOverwrite: "true" }, { acknowledgeOverwrite: 1 }, { acknowledgeOverwrite: null }]) {
      const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db", ...bad });
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("validation_error");
    }
    expect(await allRestores()).toHaveLength(0);
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db", acknowledgeOverwrite: false });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { sameDatabase: boolean }).sameDatabase).toBe(false);
  });

  it("writes a restore.start audit row that holds no connection secrets", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    const { restoreId } = (await res.json()) as { restoreId: string };
    const rows = await auditRows("restore.start");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "dev@localhost", entityType: "restore", entityId: restoreId });
    const details = JSON.parse(rows[0]?.details ?? "{}") as Record<string, unknown>;
    expect(details).toMatchObject({ backupId: backup.id, destinationTargetId: destination.id, destinationDbName: "scratch", sameDatabase: false });
    expect(rows[0]?.details).not.toContain("restore-pass-1");
    expect(rows[0]?.details).not.toContain("postgres://");
  });

  it("rejects unknown body fields, including the old confirmDbName", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db", confirmDbName: "scratch" });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("validation_error");
    expect((await restore(backup.id, { confirmName: "scratch-db" })).status).toBe(400);
  });

  it("returns 404 for an unknown backup", async () => {
    const { destination } = await setup();
    expect((await restore("nope", { destinationTargetId: destination.id, confirmName: "scratch-db" })).status).toBe(404);
  });

  it("returns 404 for an unknown or soft-deleted destination", async () => {
    const { backup } = await setup();
    const deleted = await seedTarget(ctx.env, { name: "gone", deletedAt: "2026-10-24T01:00:00.000Z" });
    expect((await restore(backup.id, { destinationTargetId: "nope", confirmName: "x" })).status).toBe(404);
    expect((await restore(backup.id, { destinationTargetId: deleted.id, confirmName: "gone" })).status).toBe(404);
  });

  it("returns 409 when the backup is not successful or was deleted", async () => {
    const { source, destination } = await setup();
    const failed = await seedBackup(ctx.env, source.id, { status: "failed" });
    const deleted = await seedBackup(ctx.env, source.id, { deletedAt: "2026-10-24T01:00:00.000Z" });
    for (const backup of [failed, deleted]) {
      expect((await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" })).status).toBe(409);
    }
    expect(await allRestores()).toHaveLength(0);
  });

  it("returns 409 while another restore is queued or running on the destination", async () => {
    const { destination, backup } = await setup();
    await seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id, status: "running" });
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    expect(res.status).toBe(409);
    expect(await allRestores()).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("returns 409 while a backup is queued or running on the destination", async () => {
    const { source, backup } = await setup();
    await seedBackup(ctx.env, source.id, { status: "running" });
    const res = await restore(backup.id, { destinationTargetId: source.id, confirmName: "source-db", acknowledgeOverwrite: true });
    expect(res.status).toBe(409);
    expect(await allRestores()).toHaveLength(0);
  });

  it("marks the restore failed and answers 503 when the queue send fails, without leaking the error text", async () => {
    await ctx.dispose();
    await boot({ failSend: true });
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("queue-secret");
    const rows = await allRestores();
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
    expect(rows[0]?.errorMessage).not.toContain("queue-secret");
  });
});
