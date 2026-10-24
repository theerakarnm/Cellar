import { describe, expect, it } from "vitest";
import { dayKey, isoWeekKey, monthKey, selectBackupsToDelete } from "../../../src/worker/retention/gfs";
import { OFF, ids, mk } from "./helpers";

const NOW = new Date("2026-10-24T03:00:00+07:00");
const DAY_MS = 86_400_000;

describe("bucket keys", () => {
  it("uses the local calendar in the given zone", () => {
    const at = new Date("2026-03-05T18:30:00Z");
    expect(dayKey(at, "UTC")).toBe("2026-03-05");
    expect(dayKey(at, "Asia/Bangkok")).toBe("2026-03-06");
  });

  it("handles a daylight saving change day", () => {
    // New York clocks moved forward on 2026-03-08. 04:30Z is Mar 7 23:30 EST, 06:30Z is Mar 8 01:30 EST.
    expect(dayKey(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
    expect(dayKey(new Date("2026-03-08T06:30:00Z"), "America/New_York")).toBe("2026-03-08");
  });

  it("starts ISO weeks on Monday", () => {
    expect(isoWeekKey(new Date("2026-03-01T12:00:00Z"), "UTC")).toBe("2026-W09"); // Sunday
    expect(isoWeekKey(new Date("2026-03-02T12:00:00Z"), "UTC")).toBe("2026-W10"); // Monday
  });

  it("uses the ISO week-year across the new year", () => {
    expect(isoWeekKey(new Date("2026-12-28T12:00:00Z"), "UTC")).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-03T12:00:00Z"), "UTC")).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-04T12:00:00Z"), "UTC")).toBe("2027-W01");
    expect(isoWeekKey(new Date("2024-12-30T12:00:00Z"), "UTC")).toBe("2025-W01");
    expect(isoWeekKey(new Date("2021-01-03T12:00:00Z"), "UTC")).toBe("2020-W53");
    expect(isoWeekKey(new Date("2026-01-01T12:00:00Z"), "UTC")).toBe("2026-W01");
  });

  it("rolls the month at local midnight", () => {
    const at = new Date("2026-12-31T17:30:00Z");
    expect(monthKey(at, "UTC")).toBe("2026-12");
    expect(monthKey(at, "Asia/Bangkok")).toBe("2027-01");
  });
});

describe("day boundary differs between UTC and Asia/Bangkok", () => {
  // 10:00Z is 17:00 in Bangkok on Mar 5. 18:00Z is 01:00 in Bangkok on Mar 6.
  const list = [mk("early", "2026-03-05T10:00:00Z"), mk("late", "2026-03-05T18:00:00Z")];
  const policy = { ...OFF, daily: 2 };

  it("keeps both in Asia/Bangkok because they are on different local days", () => {
    const r = selectBackupsToDelete(list, policy, NOW, "Asia/Bangkok");
    expect(ids(r.keep)).toEqual(["late", "early"]);
  });

  it("keeps only the newest in UTC because they are on the same day", () => {
    const r = selectBackupsToDelete(list, policy, NOW, "UTC");
    expect(ids(r.keep)).toEqual(["late"]);
    expect(ids(r.delete)).toEqual(["early"]);
  });
});

describe("week boundaries", () => {
  it("keeps one backup per ISO week, the newest", () => {
    const list = [
      mk("mon", "2026-03-02T05:00:00Z"),
      mk("wed", "2026-03-04T05:00:00Z"),
      mk("sun-prev", "2026-03-01T05:00:00Z"),
    ];
    const r = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, NOW, "UTC");
    expect(ids(r.keep)).toEqual(["wed", "sun-prev"]);
    expect(ids(r.delete)).toEqual(["mon"]);
  });

  it("moves a Sunday-night UTC backup into Monday's week in Asia/Bangkok", () => {
    // 2026-03-01T17:30Z is Monday 00:30 in Bangkok, so it shares W10 with Wednesday.
    const list = [mk("wed", "2026-03-04T05:00:00Z"), mk("sun-night-utc", "2026-03-01T17:30:00Z")];
    const bkk = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, NOW, "Asia/Bangkok");
    expect(ids(bkk.keep)).toEqual(["wed"]);
    const utc = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, NOW, "UTC");
    expect(ids(utc.keep)).toEqual(["wed", "sun-night-utc"]);
  });

  it("puts late December and early January in one ISO week when they share it", () => {
    const list = [mk("jan", "2027-01-02T05:00:00Z"), mk("dec", "2026-12-29T05:00:00Z")];
    const r = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, new Date("2027-01-05T00:00:00Z"), "UTC");
    expect(ids(r.keep)).toEqual(["jan"]);
    expect(ids(r.delete)).toEqual(["dec"]);
  });
});

describe("month boundaries and year rollover", () => {
  it("keeps the newest backup of each month across a year change", () => {
    const list = [
      mk("dec-early", "2026-12-02T05:00:00Z"),
      mk("dec-late", "2026-12-30T05:00:00Z"),
      mk("jan", "2027-01-10T05:00:00Z"),
    ];
    const r = selectBackupsToDelete(list, { ...OFF, monthly: 2 }, new Date("2027-01-15T00:00:00Z"), "UTC");
    expect(ids(r.keep)).toEqual(["jan", "dec-late"]);
    expect(ids(r.delete)).toEqual(["dec-early"]);
  });

  it("uses the local month: Dec 31 17:30Z is already January in Asia/Bangkok", () => {
    const list = [mk("dec31", "2026-12-31T17:30:00Z"), mk("dec15", "2026-12-15T05:00:00Z")];
    const now = new Date("2027-01-15T00:00:00Z");
    const bkk = selectBackupsToDelete(list, { ...OFF, monthly: 2 }, now, "Asia/Bangkok");
    expect(ids(bkk.keep)).toEqual(["dec31", "dec15"]);
    const utc = selectBackupsToDelete(list, { ...OFF, monthly: 2 }, now, "UTC");
    expect(ids(utc.keep)).toEqual(["dec31"]);
  });
});

describe("max_age_days", () => {
  const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY_MS).toISOString();
  const wide = { keep_last: 10, daily: 10, weekly: 10, monthly: 10 };

  it("keeps only the latest success when max_age_days is shorter than every backup's age", () => {
    const list = [mk("a", daysAgo(5)), mk("b", daysAgo(6)), mk("c", daysAgo(40))];
    const r = selectBackupsToDelete(list, { ...wide, max_age_days: 1 }, NOW, "UTC");
    expect(ids(r.keep)).toEqual(["a"]);
    expect(r.reasons).toEqual({ a: ["latest_success"] });
    expect(ids(r.delete)).toEqual(["b", "c"]);
  });

  it("deletes age-eligible rule keeps that are too old", () => {
    const list = [mk("new", daysAgo(1)), mk("mid", daysAgo(10)), mk("old", daysAgo(40)), mk("older", daysAgo(100))];
    const r = selectBackupsToDelete(list, { ...wide, max_age_days: 30 }, NOW, "UTC");
    expect(ids(r.keep)).toEqual(["new", "mid"]);
    expect(ids(r.delete)).toEqual(["old", "older"]);
  });

  it("keeps a backup that is exactly max_age_days old and deletes one a millisecond older", () => {
    const edge = new Date(NOW.getTime() - 30 * DAY_MS);
    const list = [
      mk("fresh", daysAgo(1)),
      mk("edge", edge.toISOString()),
      mk("just-over", new Date(edge.getTime() - 1).toISOString()),
    ];
    const r = selectBackupsToDelete(list, { ...wide, max_age_days: 30 }, NOW, "UTC");
    expect(ids(r.keep)).toEqual(["fresh", "edge"]);
    expect(ids(r.delete)).toEqual(["just-over"]);
  });

  it("treats null, 0, and omitted max_age_days as no age limit", () => {
    const list = [mk("new", daysAgo(1)), mk("ancient", daysAgo(900))];
    for (const max_age_days of [null, 0, undefined]) {
      const r = selectBackupsToDelete(list, { ...wide, max_age_days }, NOW, "UTC");
      expect(ids(r.keep)).toEqual(["new", "ancient"]);
    }
  });
});
