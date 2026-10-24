import { describe, expect, it } from "vitest";
import type { Backup, RetentionPreview } from "../../../ui/src/api/types";
import { deletionRows } from "../../../ui/src/lib/preview";

const backup = { id: "b1" } as Backup;
const preview: RetentionPreview = {
  dryRun: true,
  keep: ["b3"],
  delete: [
    { id: "b1", startedAt: "2026-10-01T02:00:00.000Z", sizeBytes: 1024, reason: "max_age_days" },
    { id: "b2", startedAt: "2026-09-01T02:00:00.000Z", sizeBytes: null, reason: "keep_last" },
  ],
  reasons: { b3: ["keep_last"] },
};

describe("deletionRows", () => {
  it("joins delete entries to loaded backups, with empty reasons when unmapped", () => {
    expect(deletionRows(preview, [backup])).toEqual([
      { id: "b1", backup, reasons: [] },
      { id: "b2", backup: undefined, reasons: [] },
    ]);
  });
  it("joins mapped reasons for a delete id", () => {
    const rows = deletionRows({ ...preview, reasons: { b2: ["keep_last"] } }, []);
    expect(rows).toEqual([
      { id: "b1", backup: undefined, reasons: [] },
      { id: "b2", backup: undefined, reasons: ["keep_last"] },
    ]);
  });
});
