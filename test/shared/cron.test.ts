import { describe, expect, it } from "vitest";
import { approxIntervalMs, nextRun, validateCron } from "../../src/shared/cron";

const iso = (expr: string, tz: string, after: string) => nextRun(expr, tz, new Date(after)).toISOString();

describe("validateCron", () => {
  it("accepts common expressions", () => {
    for (const expr of ["0 2 * * *", "*/15 * * * *", "0 9 * * 1-5", "30 1,13 * * *", "0 0 1 */2 *", "5-30/5 * * * *", "0 0 * * 7"]) {
      expect(validateCron(expr), expr).toBeNull();
    }
  });

  it("rejects bad expressions with a message", () => {
    for (const expr of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8",
      "*/0 * * * *", "5-1 * * * *", "@daily", "a b c d e", "1,,2 * * * *", "*/5/2 * * * *"]) {
      expect(validateCron(expr), expr).toEqual(expect.any(String));
    }
  });

  it("rejects an expression that never matches a real date", () => {
    expect(validateCron("0 0 31 2 *")).toBe("cron never matches a real date");
  });
});

describe("nextRun", () => {
  it("Asia/Bangkok: daily 02:00 local is 19:00 UTC the day before", () => {
    expect(iso("0 2 * * *", "Asia/Bangkok", "2026-10-24T00:00:00Z")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("UTC: daily 02:00", () => {
    expect(iso("0 2 * * *", "UTC", "2026-10-24T01:30:00Z")).toBe("2026-10-24T02:00:00.000Z");
  });

  it("is strictly after: a run exactly at `after` moves to the next day", () => {
    expect(iso("0 2 * * *", "UTC", "2026-10-24T02:00:00Z")).toBe("2026-10-25T02:00:00.000Z");
    expect(iso("0 2 * * *", "UTC", "2026-10-24T02:00:00.001Z")).toBe("2026-10-25T02:00:00.000Z");
  });

  it("handles steps and ranges", () => {
    expect(iso("*/15 * * * *", "UTC", "2026-10-24T10:07:30Z")).toBe("2026-10-24T10:15:00.000Z");
    expect(iso("0 9 * * 1-5", "Asia/Bangkok", "2026-10-24T00:00:00Z")).toBe("2026-10-26T02:00:00.000Z");
  });

  it("treats day-of-week 0 and 7 as Sunday", () => {
    expect(iso("0 0 * * 0", "UTC", "2026-10-24T00:00:00Z")).toBe("2026-10-25T00:00:00.000Z");
    expect(iso("0 0 * * 7", "UTC", "2026-10-24T00:00:00Z")).toBe("2026-10-25T00:00:00.000Z");
  });

  it("matches day-of-month OR day-of-week when both are restricted", () => {
    expect(iso("0 0 28 * 1", "UTC", "2026-10-24T00:00:00Z")).toBe("2026-10-26T00:00:00.000Z");
    expect(iso("0 0 28 * 1", "UTC", "2026-10-26T00:00:00Z")).toBe("2026-10-28T00:00:00.000Z");
  });

  it("rolls over month and year, and finds Feb 29", () => {
    expect(iso("0 0 1 1 *", "UTC", "2026-10-24T00:00:00Z")).toBe("2027-01-01T00:00:00.000Z");
    expect(iso("0 0 29 2 *", "UTC", "2026-10-24T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  it("DST gap: 02:30 America/New_York on 2026-03-08 runs at 03:30 local", () => {
    expect(iso("30 2 * * *", "America/New_York", "2026-03-07T12:00:00Z")).toBe("2026-03-08T07:30:00.000Z");
    expect(iso("30 2 * * *", "America/New_York", "2026-03-08T07:30:00Z")).toBe("2026-03-09T06:30:00.000Z");
  });

  it("DST overlap: 01:30 America/New_York on 2026-11-01 runs once, at the first occurrence", () => {
    expect(iso("30 1 * * *", "America/New_York", "2026-10-31T12:00:00Z")).toBe("2026-11-01T05:30:00.000Z");
    expect(iso("30 1 * * *", "America/New_York", "2026-11-01T05:30:00Z")).toBe("2026-11-02T06:30:00.000Z");
    expect(iso("30 1 * * *", "America/New_York", "2026-11-01T05:45:00Z")).toBe("2026-11-02T06:30:00.000Z");
  });

  it("DST overlap: a frequent job runs each wall time once, so the repeated hour is not run twice", () => {
    expect(iso("*/30 * * * *", "America/New_York", "2026-11-01T05:45:00Z")).toBe("2026-11-01T07:00:00.000Z");
    expect(iso("*/30 * * * *", "America/New_York", "2026-11-01T06:15:00Z")).toBe("2026-11-01T07:00:00.000Z");
  });

  it("throws on an invalid expression", () => {
    expect(() => nextRun("bad", "UTC", new Date())).toThrow();
  });
});

describe("approxIntervalMs", () => {
  it("is 24 hours for a daily job and 1 hour for an hourly job", () => {
    expect(approxIntervalMs("0 2 * * *", "Asia/Bangkok", new Date("2026-10-24T00:00:00Z"))).toBe(24 * 3600_000);
    expect(approxIntervalMs("0 * * * *", "UTC", new Date("2026-10-24T00:00:00Z"))).toBe(3600_000);
  });
});
