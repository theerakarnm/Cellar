import { describe, expect, it } from "vitest";
import { buildAlertMessage, formatLocalTime, summarizeError, targetLink, truncate } from "../../../src/worker/alerts/message";

const target = { id: "0192f000-0000-7000-8000-000000000001", name: "shop-prod", projectTag: "shop", timezone: "Asia/Bangkok" };
const at = new Date("2026-10-24T07:05:00Z");
const BASE = "https://cellar.example.com/";

// Real-looking secrets. None of these may ever reach a message.
const SECRET_URL = "postgres://app:Sup3rS3cretPw@db.internal:5432/shop?sslmode=require";
const SECRET_PAIR = "password=hunter2-hunter2";

describe("formatLocalTime", () => {
  it("formats in the target timezone", () => {
    expect(formatLocalTime(at, "Asia/Bangkok")).toBe("2026-10-24 14:05 Asia/Bangkok");
    expect(formatLocalTime(at, "UTC")).toBe("2026-10-24 07:05 UTC");
  });
});

describe("truncate", () => {
  it("keeps short text and caps long text with an ellipsis", () => {
    expect(truncate("abc", 10)).toBe("abc");
    expect(truncate("abcdefghij", 8)).toBe("abcde...");
    expect(truncate("abcdefghij", 8).length).toBe(8);
  });

  it("does not leave half of a surrogate pair", () => {
    expect(truncate("ab\u{1F600}\u{1F600}\u{1F600}", 5)).toBe("ab...");
  });
});

describe("summarizeError", () => {
  it("redacts, collapses whitespace, and prefixes the code", () => {
    const out = summarizeError("DUMP_FAILED", `pg_dump: connection failed\n  to ${SECRET_URL} ${SECRET_PAIR}`);
    expect(out.startsWith("DUMP_FAILED: pg_dump: connection failed to postgres://app:***@db.internal")).toBe(true);
    expect(out).not.toContain("Sup3rS3cretPw");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("\n");
  });

  it("caps the length at 300", () => {
    expect(summarizeError("X", "e".repeat(5000)).length).toBe(300);
  });

  it("handles a missing code and message", () => {
    expect(summarizeError(null, null)).toBe("no details");
  });
});

describe("buildAlertMessage", () => {
  it("builds the failed message", () => {
    const text = buildAlertMessage(
      target,
      { event: "backup_failed", status: "failed", errorCode: "TUNNEL_FAILED", errorMessage: "tunnel did not come up" },
      at,
      BASE,
    );
    expect(text).toBe(
      [
        "[Cellar] Backup failed",
        "Target: shop-prod",
        "Project: shop",
        "Time: 2026-10-24 14:05 Asia/Bangkok",
        "Error: TUNNEL_FAILED: tunnel did not come up",
        "https://cellar.example.com/targets/0192f000-0000-7000-8000-000000000001",
      ].join("\n"),
    );
  });

  it("titles timed_out, consecutive failures, and stale", () => {
    const failed = { errorCode: null, errorMessage: null };
    expect(buildAlertMessage(target, { event: "backup_failed", status: "timed_out", ...failed }, at, BASE)).toContain("Backup timed out");
    expect(buildAlertMessage(target, { event: "backup_consecutive_failures", count: 3, ...failed }, at, BASE)).toContain(
      "3 consecutive backup failures",
    );
    const stale = buildAlertMessage(target, { event: "backup_stale", staleAfterHours: 26, lastSuccessAt: null }, at, BASE);
    expect(stale).toContain("No successful backup in 26 h");
    expect(stale).toContain("Last success: never");
  });

  it("omits the project line when there is no tag", () => {
    const text = buildAlertMessage({ ...target, projectTag: null }, { event: "backup_stale", staleAfterHours: 26, lastSuccessAt: at }, at, BASE);
    expect(text).not.toContain("Project:");
    expect(text).toContain("Last success: 2026-10-24 14:05 Asia/Bangkok");
  });

  it("never contains connection URLs or passwords", () => {
    const text = buildAlertMessage(
      target,
      { event: "backup_failed", status: "failed", errorCode: "DUMP_FAILED", errorMessage: `could not connect: ${SECRET_URL} ${SECRET_PAIR}` },
      at,
      BASE,
    );
    expect(text).not.toContain("Sup3rS3cretPw");
    expect(text).not.toContain("hunter2");
    expect(text).toContain("postgres://app:***@db.internal");
  });
});

describe("targetLink", () => {
  it("joins without a double slash", () => {
    expect(targetLink("https://cellar.example.com///", "abc")).toBe("https://cellar.example.com/targets/abc");
  });
});
