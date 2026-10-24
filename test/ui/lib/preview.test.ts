import { describe, expect, it } from "vitest";
import type { RetentionPreview } from "../../../ui/src/api/types";
import { deletionRows } from "../../../ui/src/lib/preview";

const preview: RetentionPreview = {
  dryRun: true,
  keep: ["b3"],
  delete: [
    { id: "b1", startedAt: "2026-10-01T02:00:00.000Z", sizeBytes: 1024, reason: "max_age_days" },
    { id: "b2", startedAt: "2026-09-01T02:00:00.000Z", sizeBytes: null, reason: "no_rule_keeps_it" },
  ],
  reasons: { b3: ["keep_last"] },
};

describe("deletionRows", () => {
  it("uses each delete entry's start time, size and reason", () => {
    expect(deletionRows(preview)).toEqual([
      { id: "b1", startedAt: "2026-10-01T02:00:00.000Z", sizeBytes: 1024, reasons: ["max age days"] },
      { id: "b2", startedAt: "2026-09-01T02:00:00.000Z", sizeBytes: null, reasons: ["no rule keeps it"] },
    ]);
  });
  it("adds mapped reasons for a delete id without repeating the entry reason", () => {
    const rows = deletionRows({ ...preview, reasons: { b2: ["keep_last", "no_rule_keeps_it"] } });
    expect(rows[1]?.reasons).toEqual(["no rule keeps it", "keep last"]);
  });
});
