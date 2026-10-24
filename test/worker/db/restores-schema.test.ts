import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { restores } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { createTestEnv, resetDb } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const created = await createTestEnv();
  env = created.env;
  dispose = created.dispose;
});
afterAll(() => dispose());
beforeEach(async () => {
  await resetDb(env);
});

describe("restores table (Phase 7 migration)", () => {
  it("defaults last_seq to 0", async () => {
    const backup = await seedBackup(env, (await seedTarget(env)).id);
    const row = await seedRestore(env, {
      sourceBackupId: backup.id,
      destinationTargetId: (await seedTarget(env)).id,
    });
    expect(row.lastSeq).toBe(0);
  });

  it("allows only one queued or running restore per destination target", async () => {
    const backup = await seedBackup(env, (await seedTarget(env)).id);
    const destination = await seedTarget(env);
    const first = await seedRestore(env, { sourceBackupId: backup.id, destinationTargetId: destination.id });
    await expect(
      seedRestore(env, { sourceBackupId: backup.id, destinationTargetId: destination.id, status: "running" }),
    ).rejects.toThrow();
    await getDb(env).update(restores).set({ status: "failed" }).where(eq(restores.id, first.id));
    await expect(
      seedRestore(env, { sourceBackupId: backup.id, destinationTargetId: destination.id }),
    ).resolves.toBeTruthy();
  });
});
