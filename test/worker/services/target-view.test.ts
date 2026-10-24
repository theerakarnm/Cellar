import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/worker/env";
import { encrypt } from "../../../src/worker/lib/crypto";
import { EMPTY_STATS, toTargetView, type TargetRow } from "../../../src/worker/services/target-view";
import { TEST_ENCRYPTION_KEY } from "../../helpers/env";

const env = { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY } as Env;

async function row(overrides: Partial<TargetRow> = {}): Promise<TargetRow> {
  return {
    id: "t1",
    name: "Shop",
    dbName: "shop",
    pgVersion: null,
    connectionUrlEnc: await encrypt("postgres://backup:s3cret@db.example.com:6543/shop", TEST_ENCRYPTION_KEY),
    restoreUrlEnc: await encrypt("postgres://restore:r3store@db.example.com:6543/shop", TEST_ENCRYPTION_KEY),
    projectTag: "shop",
    tunnelHostname: "db.example.com",
    tunnelTokenIdEnc: await encrypt("token-id-1", TEST_ENCRYPTION_KEY),
    tunnelTokenSecretEnc: await encrypt("token-secret-1", TEST_ENCRYPTION_KEY),
    scheduleCron: "0 2 * * *",
    timezone: "Asia/Bangkok",
    enabled: true,
    keepLast: 3,
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 6,
    maxAgeDays: null,
    jobDeadlineMinutes: 120,
    staleAfterHours: null,
    alertFailureThreshold: 3,
    consecutiveFailures: 0,
    failureAlertedAt: null,
    staleAlertedAt: null,
    nextRunAt: "2026-10-24T19:00:00.000Z",
    lastBackupAt: null,
    lastStatus: null,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("toTargetView", () => {
  it("exposes masked connection parts and booleans only", async () => {
    const view = await toTargetView(env, await row(), ["c1"], { backupCount: 2, totalBackupBytes: 300 });
    expect(view.connection).toEqual({ host: "db.example.com", port: 6543, dbName: "shop", user: "backup" });
    expect(view).toMatchObject({ hasRestoreUrl: true, hasTunnelToken: true, alertChannelIds: ["c1"], stats: { backupCount: 2, totalBackupBytes: 300 } });
    const json = JSON.stringify(view);
    for (const secret of ["s3cret", "r3store", "token-id-1", "token-secret-1", "postgres://", "_enc", "v1:"]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("reports hasRestoreUrl false without a restore URL and maps the alert failure threshold", async () => {
    const view = await toTargetView(env, await row({ restoreUrlEnc: null, alertFailureThreshold: 5 }), [], EMPTY_STATS);
    expect(view).toMatchObject({ hasRestoreUrl: false, hasTunnelToken: true, tunnelHostname: "db.example.com", alertFailureThreshold: 5 });
  });

  it("maps the retention columns to the API names", async () => {
    const view = await toTargetView(env, await row({ keepLast: null, maxAgeDays: 90 }), [], EMPTY_STATS);
    expect(view.retention).toEqual({ keepLast: null, daily: 7, weekly: 4, monthly: 6, maxAgeDays: 90 });
  });
});
