import { describe, expect, it } from "vitest";
import { uuidv7 } from "../../../src/worker/lib/uuidv7";

describe("uuidv7", () => {
  it("has the version 7 and variant 10 bits", () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("encodes the timestamp in the first 48 bits", () => {
    const ms = Date.UTC(2026, 9, 24, 12, 0, 0);
    const id = uuidv7(ms);
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(ms);
  });

  it("sorts by time as plain text", () => {
    const ids = [1000, 2000, 3000].map((ms) => uuidv7(ms));
    expect([...ids].reverse().sort()).toEqual(ids);
  });

  it("is unique across many calls in the same millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1_700_000_000_000)));
    expect(ids.size).toBe(1000);
  });
});
