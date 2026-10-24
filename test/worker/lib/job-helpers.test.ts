import { describe, expect, it } from "vitest";
import { deriveJobKey } from "../../../src/worker/lib/job-key";
import { buildBackupKey } from "../../../src/worker/lib/r2-key";

const master = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));

describe("deriveJobKey", () => {
  it("is deterministic per job, differs between jobs and keys, and is 32 bytes of base64", async () => {
    const a = await deriveJobKey(master, "job-1");
    expect(await deriveJobKey(master, "job-1")).toBe(a);
    expect(await deriveJobKey(master, "job-2")).not.toBe(a);
    expect(await deriveJobKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(2))), "job-1")).not.toBe(a);
    expect(atob(a)).toHaveLength(32);
  });
});

describe("buildBackupKey", () => {
  it("follows backups/{targetId}/{YYYY}/{MM}/{DD}/{ISO-timestamp}_{dbname}.dump in UTC", () => {
    expect(buildBackupKey("t1", "shop", new Date("2026-10-24T02:00:00.123Z"))).toBe("backups/t1/2026/10/24/2026-10-24T02:00:00.123Z_shop.dump");
    expect(buildBackupKey("t1", "shop", new Date("2026-12-31T23:59:59.000Z"))).toBe("backups/t1/2026/12/31/2026-12-31T23:59:59.000Z_shop.dump");
  });
});
