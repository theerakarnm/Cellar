import { describe, expect, it } from "vitest";
import { selectBackupsToDelete } from "../../../src/worker/retention/gfs";
import { mk } from "./helpers";

const DAY_MS = 86_400_000;
const POLICY = { keep_last: 3, daily: 7, weekly: 4, monthly: 6 };

describe("README example: keep_last=3, daily=7, weekly=4, monthly=6 over 200 days", () => {
  // One backup per day at 02:00 Asia/Bangkok for 200 days. b0 is the newest, on Sat 2026-10-24.
  // now is 03:00 the same morning.
  const newest = Date.parse("2026-10-24T02:00:00+07:00");
  const now = new Date("2026-10-24T03:00:00+07:00");
  const backups = Array.from({ length: 200 }, (_, i) => mk(`b${i}`, new Date(newest - i * DAY_MS).toISOString()));

  it("keeps exactly 14 and deletes 186", () => {
    const r = selectBackupsToDelete(backups, POLICY, now, "Asia/Bangkok");
    expect(r.keep).toHaveLength(14);
    expect(r.delete).toHaveLength(186);
  });

  it("keeps these backups: 7 newest days, 2 older weeks, 5 older months", () => {
    const r = selectBackupsToDelete(backups, POLICY, now, "Asia/Bangkok");
    // b0..b6 = daily (b0..b2 also keep_last). b13, b20 = weeks W41 and W40 (b0 and b6 cover W43 and W42).
    // b24, b54, b85, b116, b146 = last day of Sep, Aug, Jul, Jun, May (b0 covers Oct).
    expect(r.keep.map((b) => b.id)).toEqual([
      "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b13", "b20", "b24", "b54", "b85", "b116", "b146",
    ]);
    expect(r.reasons["b0"]).toEqual(["keep_last", "daily", "weekly", "monthly", "latest_success"]);
    expect(r.reasons["b6"]).toEqual(["daily", "weekly"]);
    expect(r.reasons["b13"]).toEqual(["weekly"]);
    expect(r.reasons["b146"]).toEqual(["monthly"]);
  });

  it("is stable when the clock moves to the next day with no new backup", () => {
    const r = selectBackupsToDelete(backups, POLICY, new Date(now.getTime() + DAY_MS), "Asia/Bangkok");
    expect(r.keep).toHaveLength(14);
  });
});
