import { describe, expect, it } from "vitest";
import { getZonedParts, isValidTimeZone, zonedTimeToUtc } from "../../src/shared/tz";

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    for (const tz of ["Asia/Bangkok", "UTC", "America/New_York", "America/Argentina/Buenos_Aires"]) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  it("rejects unknown names, offsets, and padding", () => {
    for (const tz of ["", "Mars/Base", "+07:00", "Asia/Bangkok ", "GMT+7x", "../etc"]) {
      expect(isValidTimeZone(tz), tz).toBe(false);
    }
  });
});

describe("getZonedParts", () => {
  it("reads Bangkok wall time (UTC+7) and weekday", () => {
    expect(getZonedParts(new Date("2026-10-24T19:30:15Z"), "Asia/Bangkok")).toEqual({
      year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 15, weekday: 7,
    });
  });

  it("returns hour 0 (not 24) at local midnight", () => {
    expect(getZonedParts(new Date("2026-10-24T17:00:00Z"), "Asia/Bangkok").hour).toBe(0);
  });

  it("maps Monday to 1 and Sunday to 7", () => {
    expect(getZonedParts(new Date("2026-10-26T12:00:00Z"), "UTC").weekday).toBe(1);
    expect(getZonedParts(new Date("2026-10-25T12:00:00Z"), "UTC").weekday).toBe(7);
  });
});

describe("zonedTimeToUtc", () => {
  const wall = (year: number, month: number, day: number, hour: number, minute: number) => ({
    year, month, day, hour, minute, second: 0,
  });

  it("converts a normal wall time", () => {
    expect(zonedTimeToUtc(wall(2026, 10, 25, 2, 0), "Asia/Bangkok").toISOString()).toBe("2026-10-24T19:00:00.000Z");
    expect(zonedTimeToUtc(wall(2026, 7, 1, 12, 0), "America/New_York").toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });

  it("moves a wall time inside a DST gap to just after the gap", () => {
    expect(zonedTimeToUtc(wall(2026, 3, 8, 2, 30), "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("picks the first occurrence of a wall time that happens twice", () => {
    expect(zonedTimeToUtc(wall(2026, 11, 1, 1, 30), "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("roundtrips through getZonedParts", () => {
    const instant = new Date("2026-02-14T03:04:05Z");
    const p = getZonedParts(instant, "Europe/London");
    expect(zonedTimeToUtc(p, "Europe/London").toISOString()).toBe(instant.toISOString());
  });
});
