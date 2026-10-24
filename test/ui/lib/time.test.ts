import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE, formatInTimeZone, formatRelative, timeZoneForAudit } from "../../../ui/src/lib/time";

describe("formatInTimeZone", () => {
  it("shows the same instant in the target's zone", () => {
    expect(formatInTimeZone("2026-10-23T19:00:00.000Z", "Asia/Bangkok")).toBe("2026-10-24 02:00 GMT+7");
    expect(formatInTimeZone("2026-10-23T19:00:00.000Z", "UTC")).toBe("2026-10-23 19:00 GMT");
  });

  it("follows daylight saving in the zone", () => {
    expect(formatInTimeZone("2026-07-01T12:00:00.000Z", "Europe/London")).toBe("2026-07-01 13:00 GMT+1");
    expect(formatInTimeZone("2026-01-01T12:00:00.000Z", "Europe/London")).toBe("2026-01-01 12:00 GMT");
  });

  it("rolls the date over at midnight local time", () => {
    expect(formatInTimeZone("2026-12-31T17:30:00.000Z", "Asia/Bangkok")).toBe("2027-01-01 00:30 GMT+7");
  });

  it("returns a dash for missing or invalid input", () => {
    expect(formatInTimeZone(null, "UTC")).toBe("-");
    expect(formatInTimeZone("not a date", "UTC")).toBe("-");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");
  it.each([
    ["2026-10-24T11:59:30.000Z", "just now"],
    ["2026-10-24T11:55:00.000Z", "5 min ago"],
    ["2026-10-24T09:00:00.000Z", "3 h ago"],
    ["2026-10-22T12:00:00.000Z", "2 d ago"],
    ["2026-10-24T14:00:00.000Z", "in 2 h"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });
});

describe("timeZoneForAudit", () => {
  const targets = [{ id: "t1", timezone: "UTC" }];
  it("uses the target's zone for target entries", () => {
    expect(timeZoneForAudit("target", "t1", targets)).toBe("UTC");
  });
  it("falls back to the default zone", () => {
    expect(timeZoneForAudit("target", "gone", targets)).toBe(DEFAULT_TIMEZONE);
    expect(timeZoneForAudit("settings", null, targets)).toBe(DEFAULT_TIMEZONE);
  });
});
