import { describe, expect, it } from "vitest";
import { getZonedParts } from "../../../src/shared/tz";

describe("Phase 2 contract: getZonedParts", () => {
  it("returns 1-based month and day in the requested zone", () => {
    const p = getZonedParts(new Date("2026-03-05T18:30:00Z"), "Asia/Bangkok");
    expect(p).toMatchObject({ year: 2026, month: 3, day: 6, hour: 1, minute: 30 });
  });
});
