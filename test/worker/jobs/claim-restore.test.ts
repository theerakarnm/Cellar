import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { backups, connectionTests, restores } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import { handleJobMessage, type QueueMessageLike } from "../../../src/worker/jobs/consumer";
import type { JobPayload } from "../../../src/worker/jobs/payload";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedRestore } from "../../helpers/restore-fixtures";
import { insertBackup, insertTarget, insertTest, NOW } from "./fixtures";

let env: Env;
let dispose: () => Promise<void>;
let started: JobPayload[];

beforeAll(async () => {
  const created = await createTestEnv();
  env = created.env;
  dispose = created.dispose;
});
afterAll(async () => {
  await dispose();
});
beforeEach(async () => {
  started = [];
  await resetDb(env);
});
afterEach(async () => {
  vi.restoreAllMocks();
});

function message(body: unknown) {
  return { body, ack: vi.fn<QueueMessageLike["ack"]>(), retry: vi.fn<QueueMessageLike["retry"]>() };
}
const deps = () => ({
  now: () => NOW,
  startJob: async (payload: JobPayload) => {
    started.push(payload);
  },
  stopJob: async (_jobId: string) => {},
});
const backupRow = async (id: string) => (await getDb(env).select().from(backups).where(eq(backups.id, id)))[0];
const testRow = async (id: string) => (await getDb(env).select().from(connectionTests).where(eq(connectionTests.id, id)))[0];

/** Target t1 is the destination of a restore whose source backup lives on t2. */
async function seedRestoreInto(status: "queued" | "running" | "success" | "failed" | "timed_out") {
  await insertTarget(env, "t1");
  await insertTarget(env, "t2");
  await insertBackup(env, "src", "t2", { status: "success" });
  await seedRestore(env, { sourceBackupId: "src", destinationTargetId: "t1", status });
}

describe("backup claim vs restores into the same target", () => {
  it.each(["queued", "running"] as const)("blocks the backup and retries it while a restore is %s", async (status) => {
    await seedRestoreInto(status);
    await insertBackup(env, "b1", "t1");
    const msg = message({ jobId: "b1", type: "backup", targetId: "t1" });
    await handleJobMessage(env, msg, deps());
    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(started).toHaveLength(0);
    expect(await backupRow("b1")).toMatchObject({ status: "queued" });
  });

  it.each(["success", "failed", "timed_out"] as const)("allows the backup once the restore is %s", async (status) => {
    await seedRestoreInto(status);
    await insertBackup(env, "b1", "t1");
    const msg = message({ jobId: "b1", type: "backup", targetId: "t1" });
    await handleJobMessage(env, msg, deps());
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(started).toHaveLength(1);
    expect(await backupRow("b1")).toMatchObject({ status: "running" });
  });

  it("does not block a backup when the restore targets a different target", async () => {
    await insertTarget(env, "t1");
    await insertTarget(env, "t2");
    await insertTarget(env, "t3");
    await insertBackup(env, "src", "t3", { status: "success" });
    await seedRestore(env, { sourceBackupId: "src", destinationTargetId: "t2", status: "running" });
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(env, message({ jobId: "b1", type: "backup", targetId: "t1" }), deps());
    expect(await backupRow("b1")).toMatchObject({ status: "running" });
  });

  it("does not apply the restore guard to connection tests on the same target", async () => {
    await seedRestoreInto("running");
    await insertTest(env, "c1", "t1");
    const msg = message({ jobId: "c1", type: "test", targetId: "t1" });
    await handleJobMessage(env, msg, deps());
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(await testRow("c1")).toMatchObject({ status: "running" });
    expect(started).toHaveLength(1);
  });
});
