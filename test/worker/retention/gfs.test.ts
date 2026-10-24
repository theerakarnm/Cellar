import { describe, expect, it } from "vitest";
import { selectBackupsToDelete } from "../../../src/worker/retention/gfs";
import { OFF, ids, mk } from "./helpers";

const TZ = "Asia/Bangkok";
const NOW = new Date("2026-10-24T03:00:00+07:00");

describe("selectBackupsToDelete: basics", () => {
  it("returns empty results for an empty list", () => {
    const r = selectBackupsToDelete([], { keep_last: 3, daily: 7, weekly: 4, monthly: 6 }, NOW, TZ);
    expect(r).toEqual({ keep: [], delete: [], reasons: {} });
  });

  it("keeps a single backup when every rule is 0", () => {
    const r = selectBackupsToDelete([mk("a", "2026-10-20T00:00:00Z")], OFF, NOW, TZ);
    expect(ids(r.keep)).toEqual(["a"]);
    expect(r.delete).toEqual([]);
    expect(r.reasons).toEqual({ a: ["latest_success"] });
  });

  it("treats null and omitted rules as off", () => {
    const policy = { keep_last: null, daily: null, weekly: null, monthly: null };
    const r = selectBackupsToDelete(
      [mk("new", "2026-10-20T00:00:00Z"), mk("old", "2026-10-19T00:00:00Z")],
      policy,
      NOW,
      TZ,
    );
    expect(ids(r.keep)).toEqual(["new"]);
    expect(ids(r.delete)).toEqual(["old"]);
  });

  it("keep_last keeps the N newest successes", () => {
    const list = ["01", "02", "03", "04", "05"].map((d) => mk(`b${d}`, `2026-10-${d}T00:00:00Z`));
    const r = selectBackupsToDelete(list, { ...OFF, keep_last: 2 }, NOW, TZ);
    expect(ids(r.keep)).toEqual(["b05", "b04"]);
    expect(ids(r.delete)).toEqual(["b03", "b02", "b01"]);
    expect(r.reasons).toEqual({ b05: ["keep_last", "latest_success"], b04: ["keep_last"] });
  });

  it("keeps only the newest backup of a day for the daily rule", () => {
    const list = [
      mk("d1-early", "2026-10-10T01:00:00Z"),
      mk("d1-mid", "2026-10-10T05:00:00Z"),
      mk("d1-late", "2026-10-10T09:00:00Z"),
      mk("d2", "2026-10-11T02:00:00Z"),
    ];
    const r = selectBackupsToDelete(list, { ...OFF, daily: 2 }, NOW, TZ);
    expect(ids(r.keep)).toEqual(["d2", "d1-late"]);
    expect(ids(r.delete)).toEqual(["d1-mid", "d1-early"]);
    expect(r.reasons).toEqual({ d2: ["daily", "latest_success"], "d1-late": ["daily"] });
  });

  it("counts days that have a backup, so gaps do not use up the daily quota", () => {
    const list = ["2026-10-01", "2026-10-02", "2026-10-10", "2026-10-11", "2026-10-20"].map((d) =>
      mk(d, `${d}T05:00:00Z`),
    );
    const r = selectBackupsToDelete(list, { ...OFF, daily: 3 }, NOW, TZ);
    expect(ids(r.keep)).toEqual(["2026-10-20", "2026-10-11", "2026-10-10"]);
  });

  it("counts weeks that have a backup, so gaps do not use up the weekly quota", () => {
    // ISO weeks 2026-W36 (Sep 1), W38 (Sep 16), W42 (Oct 14), W43 (Oct 21)
    const list = ["2026-09-01", "2026-09-16", "2026-10-14", "2026-10-21"].map((d) => mk(d, `${d}T05:00:00Z`));
    const r = selectBackupsToDelete(list, { ...OFF, weekly: 3 }, NOW, TZ);
    expect(ids(r.keep)).toEqual(["2026-10-21", "2026-10-14", "2026-09-16"]);
    expect(ids(r.delete)).toEqual(["2026-09-01"]);
  });

  it("counts months that have a backup, so gaps do not use up the monthly quota", () => {
    const list = ["2026-01-15", "2026-02-15", "2026-06-15", "2026-10-15"].map((d) => mk(d, `${d}T05:00:00Z`));
    const r = selectBackupsToDelete(list, { ...OFF, monthly: 3 }, NOW, TZ);
    expect(ids(r.keep)).toEqual(["2026-10-15", "2026-06-15", "2026-02-15"]);
  });

  it("lists every rule that keeps a backup, in a fixed order", () => {
    const r = selectBackupsToDelete([mk("a", "2026-10-20T00:00:00Z")], { keep_last: 1, daily: 1, weekly: 1, monthly: 1 }, NOW, TZ);
    expect(r.reasons).toEqual({ a: ["keep_last", "daily", "weekly", "monthly", "latest_success"] });
  });
});

describe("selectBackupsToDelete: non-success backups", () => {
  it("never puts failed, running, or timed_out backups in keep or delete", () => {
    const list = [
      mk("ok-new", "2026-10-20T00:00:00Z"),
      mk("failed", "2026-10-22T00:00:00Z", "failed"),
      mk("running", "2026-10-23T00:00:00Z", "running"),
      mk("timed", "2026-10-21T00:00:00Z", "timed_out"),
      mk("ok-old", "2026-10-01T00:00:00Z"),
    ];
    const r = selectBackupsToDelete(list, { ...OFF, keep_last: 1 }, NOW, TZ);
    const seen = [...ids(r.keep), ...ids(r.delete)].sort();
    expect(seen).toEqual(["ok-new", "ok-old"]);
    expect(ids(r.keep)).toEqual(["ok-new"]);
  });

  it("does not count failed backups toward keep_last or as the latest success", () => {
    const list = [mk("failed-new", "2026-10-23T00:00:00Z", "failed"), mk("ok", "2026-10-01T00:00:00Z")];
    const r = selectBackupsToDelete(list, OFF, NOW, TZ);
    expect(r.reasons).toEqual({ ok: ["latest_success"] });
    expect(r.delete).toEqual([]);
  });

  it("returns empty results when no backup succeeded", () => {
    const r = selectBackupsToDelete([mk("f", "2026-10-23T00:00:00Z", "failed")], OFF, NOW, TZ);
    expect(r).toEqual({ keep: [], delete: [], reasons: {} });
  });
});

describe("selectBackupsToDelete: determinism", () => {
  it("does not depend on input order and breaks identical timestamps by id", () => {
    const a = mk("a", "2026-10-20T00:00:00Z");
    const b = mk("b", "2026-10-20T00:00:00Z");
    const c = mk("c", "2026-10-19T00:00:00Z");
    const p = { ...OFF, keep_last: 1 };
    const r1 = selectBackupsToDelete([a, b, c], p, NOW, TZ);
    const r2 = selectBackupsToDelete([c, b, a], p, NOW, TZ);
    expect(r1).toEqual(r2);
    expect(ids(r1.keep)).toEqual(["b"]);
  });

  it("does not mutate its input", () => {
    const list = [mk("a", "2026-10-20T00:00:00Z"), mk("b", "2026-10-21T00:00:00Z")];
    const copy = JSON.parse(JSON.stringify(list)) as typeof list;
    selectBackupsToDelete(list, OFF, NOW, TZ);
    expect(list).toEqual(copy);
  });

  it("throws RangeError for an unparseable created_at", () => {
    expect(() => selectBackupsToDelete([mk("x", "not a date")], OFF, NOW, TZ)).toThrow(RangeError);
  });
});
