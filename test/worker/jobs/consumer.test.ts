import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import { handleJobMessage, type QueueMessageLike } from "../../../src/worker/jobs/consumer";
import { enqueueDueBackups, queueManualBackup } from "../../../src/worker/jobs/dispatch";
import { rewriteForTunnel, type JobPayload } from "../../../src/worker/jobs/payload";
import { jobShape, SAMPLE_JOBS } from "../../../container/contract";
import { updateSettings } from "../../../src/worker/lib/settings";
import { createTestEnv } from "../../helpers/env";
import { captureLogs, fakeQueue, insertBackup, insertTarget, insertTest, NOW, SECRETS } from "./fixtures";
import { seedChannel } from "../../helpers/alerts-seed";

let env: Env;
let sent: ReturnType<typeof fakeQueue>["sent"];
let dispose: () => Promise<void>;
let started: JobPayload[];

beforeEach(async () => {
  const fake = fakeQueue();
  sent = fake.sent;
  const created = await createTestEnv({ JOBS: fake.queue });
  env = created.env;
  dispose = created.dispose;
  started = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

function message(body: unknown) {
  return { body, ack: vi.fn<QueueMessageLike["ack"]>(), retry: vi.fn<QueueMessageLike["retry"]>() };
}
const deps = (failWith?: Error, stopWith?: Error) => ({
  now: () => NOW,
  startJob: async (payload: JobPayload) => {
    if (failWith) throw failWith;
    started.push(payload);
  },
  stopJob: vi.fn(async (_jobId: string) => {
    if (stopWith) throw stopWith;
  }),
});
const backupRow = async (id: string) => (await getDb(env).select().from(backups).where(eq(backups.id, id)))[0];
const testRow = async (id: string) => (await getDb(env).select().from(connectionTests).where(eq(connectionTests.id, id)))[0];
const backupMessage = (jobId: string, targetId = "t1") => message({ jobId, type: "backup", targetId });

describe("handleJobMessage - backup", () => {
  it("claims the row, marks it running with an R2 key, starts the container, and acks", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    const msg = backupMessage("b1");
    await handleJobMessage(env, msg, deps());
    expect(await backupRow("b1")).toMatchObject({
      status: "running",
      startedAt: NOW.toISOString(),
      heartbeatAt: NOW.toISOString(),
      attempt: 1,
      r2Key: "backups/t1/2026/10/24/2026-10-24T02:00:30.000Z_shop.dump",
    });
    expect(started).toHaveLength(1);
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("builds the tunnel payload: rewritten URL, decrypted tunnel token, R2 block, deadline, callback URL", async () => {
    await insertTarget(env, "t1", { jobDeadlineMinutes: 90 });
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(env, backupMessage("b1"), deps());
    const payload = started[0];
    expect(payload).toMatchObject({
      jobId: "b1",
      type: "backup",
      callbackUrl: "http://cellar-callback.internal/internal/jobs/callback",
      deadlineAt: "2026-10-24T03:30:30.000Z",
      db: { url: `postgres://app:${SECRETS.password}@127.0.0.1:15432/shop?sslmode=require`, name: "shop" },
      tunnel: { hostname: "db.example.com", tokenId: SECRETS.tokenId, tokenSecret: SECRETS.tokenSecret, localPort: 15432 },
      r2: {
        endpoint: "http://rustfs.test:9000",
        bucket: "cellar-test",
        key: "backups/t1/2026/10/24/2026-10-24T02:00:30.000Z_shop.dump",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
        partSizeBytes: 33554432,
      },
    });
    expect(Buffer.from(payload?.jobKey ?? "", "base64")).toHaveLength(32);
  });

  it("uses CALLBACK_BASE_URL when it is set", async () => {
    const withBase = { ...env, CALLBACK_BASE_URL: "https://cellar.example.com/" } as Env;
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(withBase, backupMessage("b1"), deps());
    expect(started[0]?.callbackUrl).toBe("https://cellar.example.com/internal/jobs/callback");
  });

  it("acks and ignores a message whose row is not queued (idempotent redelivery)", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1", { status: "running" });
    const msg = backupMessage("b1");
    await handleJobMessage(env, msg, deps());
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(started).toHaveLength(0);
    const unknown = backupMessage("missing");
    await handleJobMessage(env, unknown, deps());
    expect(unknown.ack).toHaveBeenCalledOnce();
  });

  it("starts a redelivered message only once", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(env, backupMessage("b1"), deps());
    await handleJobMessage(env, backupMessage("b1"), deps());
    expect(started).toHaveLength(1);
  });

  it("acks malformed messages without touching anything", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const msg = message({ jobId: "x", type: "restore", targetId: "t1", extra: true });
    await handleJobMessage(env, msg, deps());
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(started).toHaveLength(0);
  });

  it("fails the job when the target was deleted", async () => {
    await insertTarget(env, "t1", { deletedAt: NOW.toISOString() });
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(env, backupMessage("b1"), deps());
    expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "target_unavailable" });
  });

  it("marks the job failed START_FAILED when the container cannot start, and acks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    const msg = backupMessage("b1");
    await handleJobMessage(env, msg, deps(new Error("no capacity")));
    expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "START_FAILED" });
    expect((await getDb(env).select().from(targets).where(eq(targets.id, "t1")))[0]?.lastStatus).toBe("failed");
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("sends one Backup failed alert when START_FAILED is recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
    await insertTarget(env, "t1");
    await seedChannel(env, "c1", "t1");
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(env, backupMessage("b1"), deps(new Error("no capacity")));
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)).toContain("Backup failed");
  });

  it("stops the container before marking START_FAILED when start fails after the runner may have started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    const d = deps(new Error("outbound failed"));
    const msg = backupMessage("b1");
    await handleJobMessage(env, msg, d);
    expect(d.stopJob).toHaveBeenCalledWith("b1");
    expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "START_FAILED" });
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("still marks START_FAILED and acks when stopping the container also fails, logging only the redacted error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    const msg = backupMessage("b1");
    await handleJobMessage(env, msg, deps(new Error("no capacity"), new Error(`stop failed at postgres://app:${SECRETS.password}@db`)));
    expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "START_FAILED" });
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(warn.mock.calls.flat().join(" ")).toContain("could not stop backup b1");
    expect(warn.mock.calls.flat().join(" ")).not.toContain(SECRETS.password);
  });

  it("marks the job failed when a tunnel secret cannot be decrypted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await insertTarget(env, "t1", { tunnelTokenSecretEnc: "not-a-valid-payload" });
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(env, backupMessage("b1"), deps());
    expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "START_FAILED" });
    expect(started).toHaveLength(0);
  });
});

describe("handleJobMessage - concurrency", () => {
  it("retries with a delay when the global limit is reached, then starts once a slot frees up", async () => {
    await updateSettings(getDb(env), { max_concurrent_jobs: 1 }, NOW);
    await insertTarget(env, "t1");
    await insertTarget(env, "t2");
    await insertBackup(env, "b1", "t1", { status: "running" });
    await insertBackup(env, "b2", "t2");
    const first = backupMessage("b2", "t2");
    await handleJobMessage(env, first, deps());
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(first.ack).not.toHaveBeenCalled();
    expect((await backupRow("b2"))?.status).toBe("queued");
    expect(started).toHaveLength(0);

    await getDb(env).update(backups).set({ status: "success" }).where(eq(backups.id, "b1"));
    const second = backupMessage("b2", "t2");
    await handleJobMessage(env, second, deps());
    expect(second.ack).toHaveBeenCalledOnce();
    expect((await backupRow("b2"))?.status).toBe("running");
  });

  it("does not count a running connection test against the backup limit", async () => {
    await updateSettings(getDb(env), { max_concurrent_jobs: 1 }, NOW);
    await insertTarget(env, "t1");
    await insertTarget(env, "t2");
    await insertTest(env, "c1", "t1", { status: "running" });
    await insertBackup(env, "b2", "t2");
    const msg = backupMessage("b2", "t2");
    await handleJobMessage(env, msg, deps());
    expect(msg.ack).toHaveBeenCalledOnce();
    expect((await backupRow("b2"))?.status).toBe("running");
  });

  it("starts a connection test even when the backup limit is reached", async () => {
    await updateSettings(getDb(env), { max_concurrent_jobs: 1 }, NOW);
    await insertTarget(env, "t1");
    await insertTarget(env, "t2");
    await insertBackup(env, "b1", "t1", { status: "running" });
    await insertTest(env, "c2", "t2");
    const msg = message({ jobId: "c2", type: "test", targetId: "t2" });
    await handleJobMessage(env, msg, deps());
    expect(msg.ack).toHaveBeenCalledOnce();
    expect((await testRow("c2"))?.status).toBe("running");
  });

  it("uses the default limit of 1 when no setting is stored", async () => {
    for (const id of ["t1", "t2"]) {
      await insertTarget(env, id);
      await insertBackup(env, `b-${id}`, id);
    }
    const messages = ["t1", "t2"].map((id) => backupMessage(`b-${id}`, id));
    for (const msg of messages) await handleJobMessage(env, msg, deps());
    expect(started).toHaveLength(1);
    expect(messages[1]?.retry).toHaveBeenCalledOnce();
  });

  it("never starts more than the limit when messages are handled concurrently", async () => {
    await updateSettings(getDb(env), { max_concurrent_jobs: 2 }, NOW);
    for (const id of ["t1", "t2", "t3", "t4"]) {
      await insertTarget(env, id);
      await insertBackup(env, `b-${id}`, id);
    }
    await Promise.all(["t1", "t2", "t3", "t4"].map((id) => handleJobMessage(env, backupMessage(`b-${id}`, id), deps())));
    expect(started).toHaveLength(2);
  });

  it("does not run a test and a backup for the same target at the same time", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1", { status: "running" });
    await insertTest(env, "c1", "t1");
    const msg = message({ jobId: "c1", type: "test", targetId: "t1" });
    await handleJobMessage(env, msg, deps());
    expect(msg.retry).toHaveBeenCalledOnce();
    expect((await testRow("c1"))?.status).toBe("queued");
  });
});

describe("handleJobMessage - test job", () => {
  it("starts a tunnel test with a 5 minute deadline and no R2 block", async () => {
    await insertTarget(env, "t1");
    await insertTest(env, "c1", "t1");
    await handleJobMessage(env, message({ jobId: "c1", type: "test", targetId: "t1" }), deps());
    expect((await testRow("c1"))?.status).toBe("running");
    expect(started[0]).toMatchObject({ jobId: "c1", type: "test", deadlineAt: "2026-10-24T02:05:30.000Z" });
    expect(started[0]?.r2).toBeUndefined();
  });
});

describe("secrets stay out of queue messages and logs", () => {
  it("never writes decrypted secrets to the queue or to console output across the whole flow", async () => {
    const logs = captureLogs();
    await insertTarget(env, "t1");
    await insertTarget(env, "t2", { nextRunAt: null });
    await enqueueDueBackups(env, NOW);
    await queueManualBackup(env, "t2", NOW);
    for (const body of sent) await handleJobMessage(env, message(body), deps(new Error(`start failed for ${SECRETS.password}`)));
    expect(sent).toHaveLength(2);
    const everything = JSON.stringify(sent) + logs.text();
    for (const secret of [SECRETS.password, SECRETS.tokenId, SECRETS.tokenSecret, env.ENCRYPTION_KEY, env.R2_SECRET_ACCESS_KEY]) {
      expect(everything).not.toContain(secret);
    }
    expect(sent.every((body) => Object.keys(body).sort().join() === "jobId,targetId,type")).toBe(true);
    expect(logs.text()).toContain("could not start backup");
  });

  it("positive control: the container payload does carry the decrypted secrets", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    await handleJobMessage(env, backupMessage("b1"), deps());
    expect(JSON.stringify(started[0])).toContain(SECRETS.password);
    expect(JSON.stringify(started[0])).toContain(SECRETS.tokenSecret);
  });

  it("builds payloads with the same shape as the Phase 4 SAMPLE_JOBS", async () => {
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1");
    await insertTarget(env, "t2");
    await insertTest(env, "c1", "t2");
    await handleJobMessage(env, backupMessage("b1"), deps());
    await handleJobMessage(env, message({ jobId: "c1", type: "test", targetId: "t2" }), deps());
    expect(jobShape(started[0])).toEqual(jobShape(SAMPLE_JOBS.backup));
    expect(jobShape(started[1])).toEqual(jobShape(SAMPLE_JOBS.test));
  });
});

describe("rewriteForTunnel", () => {
  it.each([
    ["postgres://app:p%40ss@db.example.com:5432/shop?sslmode=require", "postgres://app:p%40ss@127.0.0.1:15432/shop?sslmode=require"],
    ["postgres://app:p@ss:w0rd@db.example.com/shop", "postgres://app:p%40ss%3Aw0rd@127.0.0.1:15432/shop"],
    ["postgresql://u:pw@host.docker.internal:5433/db", "postgresql://u:pw@127.0.0.1:15432/db"],
  ])("%s", (input, expected) => {
    expect(rewriteForTunnel(input, 15432)).toBe(expected);
  });
});
