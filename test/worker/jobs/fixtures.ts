import { vi } from "vitest";
import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
import { getDb } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";
import type { JobMessage } from "../../../src/worker/jobs/types";
import { signCallback } from "../../../container/hmac";
import { encrypt } from "../../../src/worker/lib/crypto";
import { deriveJobKey } from "../../../src/worker/lib/job-key";

export const SECRETS = { password: "s3cr3tpw", tokenId: "tok-id-123", tokenSecret: "tok-secret-456" };
export const NOW = new Date("2026-10-24T02:00:30.000Z");
/** 02:00 Asia/Bangkok on 2026-10-24, the slot that is due at NOW. */
export const DUE_SLOT = "2026-10-23T19:00:00.000Z";

export function fakeQueue(options: { failSend?: boolean } = {}): { queue: Queue<JobMessage>; sent: JobMessage[] } {
  const sent: JobMessage[] = [];
  const queue = {
    send: async (message: JobMessage) => {
      if (options.failSend) throw new Error("queue down");
      sent.push(message);
    },
  } as unknown as Queue<JobMessage>;
  return { queue, sent };
}

type TargetOverrides = Partial<typeof targets.$inferInsert>;

export async function insertTarget(env: Env, id: string, overrides: TargetOverrides = {}): Promise<void> {
  const key = env.ENCRYPTION_KEY;
  await getDb(env)
    .insert(targets)
    .values({
      id,
      name: `target-${id}`,
      dbName: "shop",
      connectionUrlEnc: await encrypt(`postgres://app:${SECRETS.password}@db.internal:5432/shop?sslmode=require`, key),
      tunnelHostname: "db.example.com",
      tunnelTokenIdEnc: await encrypt(SECRETS.tokenId, key),
      tunnelTokenSecretEnc: await encrypt(SECRETS.tokenSecret, key),
      nextRunAt: DUE_SLOT,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      ...overrides,
    });
}

export async function insertBackup(env: Env, id: string, targetId: string, overrides: Partial<typeof backups.$inferInsert> = {}) {
  await getDb(env)
    .insert(backups)
    .values({ id, targetId, status: "queued", trigger: "manual", queuedAt: NOW.toISOString(), ...overrides });
}

export async function insertTest(env: Env, id: string, targetId: string, overrides: Partial<typeof connectionTests.$inferInsert> = {}) {
  await getDb(env)
    .insert(connectionTests)
    .values({ id, targetId, status: "queued", queuedAt: NOW.toISOString(), ...overrides });
}

export async function signedHeaders(env: Env, jobId: string, rawBody: string, timestamp: number = NOW.getTime() / 1000) {
  const ts = String(Math.floor(timestamp));
  const signature = await signCallback(await deriveJobKey(env.ENCRYPTION_KEY, jobId), ts, jobId, rawBody);
  return { timestamp: ts, signature };
}

export function captureLogs(): { text(): string } {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
  }
  return { text: () => lines.join("\n") };
}
