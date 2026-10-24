import { describe, expect, it } from "vitest";
import { classifyTarget, isActiveStatus, isRedHealth, staleThresholdMs } from "../../../ui/src/lib/status";

const now = new Date("2026-10-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const base = { enabled: true, lastStatus: "success" as const, lastBackupAt: hoursAgo(2), createdAt: hoursAgo(500), staleAfterHours: null, scheduleCron: "0 2 * * *", timezone: "Asia/Bangkok" };

describe("staleThresholdMs", () => {
  it("is the schedule interval plus 2 hours when not overridden (daily = 26 h)", () => {
    expect(staleThresholdMs(base, now)).toBe(26 * 3_600_000);
  });
  it("uses stale_after_hours when set", () => {
    expect(staleThresholdMs({ ...base, staleAfterHours: 5 }, now)).toBe(5 * 3_600_000);
  });
});

describe("classifyTarget", () => {
  it("is ok for a recent success", () => {
    expect(classifyTarget(base, now)).toBe("ok");
  });
  it("is failing when the last job failed or timed out", () => {
    expect(classifyTarget({ ...base, lastStatus: "failed" }, now)).toBe("failing");
    expect(classifyTarget({ ...base, lastStatus: "timed_out" }, now)).toBe("failing");
  });
  it("is not failing while a job is queued or running", () => {
    expect(classifyTarget({ ...base, lastStatus: "running" }, now)).toBe("ok");
  });
  it("turns stale just past the threshold, not before", () => {
    expect(classifyTarget({ ...base, lastBackupAt: hoursAgo(25.9) }, now)).toBe("ok");
    expect(classifyTarget({ ...base, lastBackupAt: hoursAgo(26.1) }, now)).toBe("stale");
  });
  it("uses stale_after_hours for the threshold", () => {
    expect(classifyTarget({ ...base, staleAfterHours: 1, lastBackupAt: hoursAgo(2) }, now)).toBe("stale");
  });
  it("gives a new target with no backup a grace period, then calls it stale", () => {
    const fresh = { ...base, lastStatus: null, lastBackupAt: null };
    expect(classifyTarget({ ...fresh, createdAt: hoursAgo(1) }, now)).toBe("never");
    expect(classifyTarget({ ...fresh, createdAt: hoursAgo(30) }, now)).toBe("stale");
  });
  it("never highlights a disabled target", () => {
    expect(classifyTarget({ ...base, enabled: false, lastStatus: "failed" }, now)).toBe("disabled");
  });
});

describe("helpers", () => {
  it("marks only failing and stale as red", () => {
    expect(["failing", "stale", "ok", "never", "disabled"].map((h) => isRedHealth(h as never))).toEqual([true, true, false, false, false]);
  });
  it("treats queued and running as active", () => {
    expect(["queued", "running", "success", "failed", "timed_out"].map((s) => isActiveStatus(s as never))).toEqual([true, true, false, false, false]);
  });
});
