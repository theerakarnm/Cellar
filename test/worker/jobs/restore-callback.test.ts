import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client";
import { restores } from "../../../src/worker/db/schema";
import { handleCallback } from "../../../src/worker/jobs/callback";
import { handleRestoreCallback, type CallbackBody } from "../../../src/worker/jobs/restore-callback";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";
import { signedHeaders } from "./fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let restoreId: string;

beforeEach(async () => {
  ctx = await createTestEnv();
  const source = await seedTarget(ctx.env);
  const destination = await seedTarget(ctx.env);
  const backup = await seedBackup(ctx.env, source.id);
  restoreId = (await seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id })).id;
});
afterEach(async () => {
  await ctx.dispose();
});

const T1 = new Date("2026-10-24T03:00:00.000Z");
const T2 = new Date("2026-10-24T03:00:30.000Z");
const T3 = new Date("2026-10-24T03:05:00.000Z");

const event = (seq: number, name: CallbackBody["event"], error?: CallbackBody["error"]): CallbackBody => ({
  jobId: restoreId,
  event: name,
  at: "2026-10-24T03:00:00.000Z",
  seq,
  ...(error ? { error } : {}),
});
const apply = (body: CallbackBody, now: Date) => handleRestoreCallback(getDb(ctx.env), body, now);
const row = async () => (await getDb(ctx.env).select().from(restores).where(eq(restores.id, restoreId)))[0];

describe("handleRestoreCallback", () => {
  it("reports ids that are not restores so the caller can try other job types", async () => {
    expect(await apply({ ...event(1, "started"), jobId: "someone-else" }, T1)).toBe("not_a_restore");
  });

  it("refreshes start and heartbeat from the Worker clock on started for a running restore", async () => {
    await getDb(ctx.env).update(restores).set({ status: "running" }).where(eq(restores.id, restoreId));
    expect(await apply(event(1, "started"), T1)).toBe("applied");
    expect(await row()).toMatchObject({ status: "running", startedAt: T1.toISOString(), heartbeatAt: T1.toISOString(), lastSeq: 1 });
  });

  it("ignores started for a restore that is still queued, leaving it queued", async () => {
    expect(await apply(event(1, "started"), T1)).toBe("ignored");
    expect(await row()).toMatchObject({ status: "queued", startedAt: null, lastSeq: 0 });
  });

  it("stores a failure with its error code and a redacted message", async () => {
    await apply(event(1, "started"), T1);
    const message = "pg_restore: connection to postgres://restore_user:restore-pass-1@127.0.0.1:15432/scratch failed";
    expect(await apply(event(2, "failed", { code: "RESTORE_FAILED", message }), T2)).toBe("applied");
    const stored = await row();
    expect(stored).toMatchObject({ status: "failed", errorCode: "RESTORE_FAILED", finishedAt: T2.toISOString() });
    expect(stored?.errorMessage).toContain("pg_restore");
    expect(stored?.errorMessage).not.toContain("restore-pass-1");
  });

  it("preserves error codes that contain digits, like the callback schema allows", async () => {
    await apply(event(1, "started"), T1);
    expect(await apply(event(2, "failed", { code: "PG17_X", message: "boom" }), T2)).toBe("applied");
    expect((await row())?.errorCode).toBe("PG17_X");
  });

  it("still replaces a code that starts with a digit with UNKNOWN", async () => {
    await apply(event(1, "started"), T1);
    await apply(event(2, "failed", { code: "17_PG", message: "boom" }), T2);
    expect((await row())?.errorCode).toBe("UNKNOWN");
  });

  it("replaces an unusable error code with UNKNOWN and caps the message length", async () => {
    await apply(event(1, "started"), T1);
    await apply(event(2, "failed", { code: "drop table; --", message: "x".repeat(5000) }), T2);
    const stored = await row();
    expect(stored?.errorCode).toBe("UNKNOWN");
    expect(stored?.errorMessage?.length).toBe(1000);
  });

  it("is reached through handleCallback with a signed body and reports the destination target", async () => {
    const destination = (await getDb(ctx.env).select().from(restores).where(eq(restores.id, restoreId)))[0];
    await getDb(ctx.env).update(restores).set({ status: "running" }).where(eq(restores.id, restoreId));
    const rawBody = JSON.stringify(event(1, "started"));
    const outcome = await handleCallback(ctx.env, rawBody, await signedHeaders(ctx.env, restoreId, rawBody, T1.getTime() / 1000), T1);
    expect(outcome).toMatchObject({ applied: true, type: "restore", event: "started", targetId: destination?.destinationTargetId });
    expect((await row())?.status).toBe("running");
  });
});
