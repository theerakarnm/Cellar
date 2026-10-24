import { getDb } from "../../src/worker/db/client";
import { backups, restores, targets } from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { encrypt } from "../../src/worker/lib/crypto";
import { uuidv7 } from "../../src/worker/lib/uuidv7";

export const NOW_ISO = "2026-10-24T00:00:00.000Z";

export const TEST_R2 = {
  R2_ENDPOINT: "https://acct123.r2.cloudflarestorage.com",
  R2_BUCKET: "cellar-backups",
  R2_ACCESS_KEY_ID: "AKIDTEST",
  R2_SECRET_ACCESS_KEY: "r2-secret-test",
} satisfies Partial<Env>;

export const BACKUP_URL = "postgres://backup_user:backup-pass-1@db.example.com:5432/appdb";
export const RESTORE_URL = "postgres://restore_user:restore-pass-1@db.example.com:5432/scratch";

export function fakeQueue(options: { failSend?: boolean } = {}): { queue: Queue; sent: unknown[] } {
  const sent: unknown[] = [];
  const queue = {
    send: async (message: unknown) => {
      if (options.failSend) throw new Error("queue down at postgres://q:queue-secret@h/db");
      sent.push(message);
    },
    sendBatch: async () => {},
  } as unknown as Queue;
  return { queue, sent };
}

export async function seedTarget(
  env: Env,
  o: {
    id?: string;
    name?: string;
    restoreUrl?: string | null;
    deletedAt?: string | null;
    jobDeadlineMinutes?: number;
  } = {},
): Promise<typeof targets.$inferSelect> {
  const id = o.id ?? uuidv7();
  const restoreUrl = o.restoreUrl === undefined ? RESTORE_URL : o.restoreUrl;
  const [row] = await getDb(env)
    .insert(targets)
    .values({
      id,
      name: o.name ?? `name-${id}`,
      dbName: "appdb",
      connectionUrlEnc: await encrypt(BACKUP_URL, env.ENCRYPTION_KEY),
      restoreUrlEnc: restoreUrl === null ? null : await encrypt(restoreUrl, env.ENCRYPTION_KEY),
      tunnelHostname: "db.example.com",
      tunnelTokenIdEnc: await encrypt("tunnel-id-1", env.ENCRYPTION_KEY),
      tunnelTokenSecretEnc: await encrypt("tunnel-secret-1", env.ENCRYPTION_KEY),
      jobDeadlineMinutes: o.jobDeadlineMinutes ?? 120,
      deletedAt: o.deletedAt ?? null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    })
    .returning();
  if (!row) throw new Error("seedTarget: insert returned no row");
  return row;
}

export async function seedBackup(
  env: Env,
  targetId: string,
  o: {
    id?: string;
    status?: "queued" | "running" | "success" | "failed" | "timed_out";
    deletedAt?: string | null;
  } = {},
): Promise<typeof backups.$inferSelect> {
  const id = o.id ?? uuidv7();
  const [row] = await getDb(env)
    .insert(backups)
    .values({
      id,
      targetId,
      status: o.status ?? "success",
      trigger: "manual",
      r2Key: `backups/${targetId}/2026/10/24/2026-10-24T02:00:00.000Z_${id}.dump`,
      sizeBytes: 1234,
      sha256: "ab".repeat(32),
      queuedAt: NOW_ISO,
      deletedAt: o.deletedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("seedBackup: insert returned no row");
  return row;
}

export async function seedRestore(
  env: Env,
  o: {
    id?: string;
    sourceBackupId: string;
    destinationTargetId: string;
    status?: "queued" | "running" | "success" | "failed" | "timed_out";
    destinationDbName?: string;
    isSourceOverwrite?: boolean;
    queuedAt?: string;
    startedAt?: string | null;
    heartbeatAt?: string | null;
    lastSeq?: number;
  },
): Promise<typeof restores.$inferSelect> {
  const [row] = await getDb(env)
    .insert(restores)
    .values({
      id: o.id ?? uuidv7(),
      sourceBackupId: o.sourceBackupId,
      destinationTargetId: o.destinationTargetId,
      destinationDbName: o.destinationDbName ?? "scratch",
      status: o.status ?? "queued",
      actor: "dev@localhost",
      isSourceOverwrite: o.isSourceOverwrite ?? false,
      queuedAt: o.queuedAt ?? NOW_ISO,
      startedAt: o.startedAt ?? null,
      heartbeatAt: o.heartbeatAt ?? null,
      lastSeq: o.lastSeq ?? 0,
    })
    .returning();
  if (!row) throw new Error("seedRestore: insert returned no row");
  return row;
}
