import { describe, expect, it } from "vitest";
import { canSubmitRestore, restoreRequest } from "../../../ui/src/lib/restore";

const ok = { typedName: "shop", destinationName: "shop", sameDatabase: false, acknowledged: false };

describe("canSubmitRestore", () => {
  it("needs the exact destination name", () => {
    expect(canSubmitRestore(ok)).toBe(true);
    expect(canSubmitRestore({ ...ok, typedName: "Shop" })).toBe(false);
    expect(canSubmitRestore({ ...ok, typedName: "shop " })).toBe(false);
    expect(canSubmitRestore({ ...ok, typedName: "" })).toBe(false);
  });
  it("needs a destination", () => {
    expect(canSubmitRestore({ ...ok, destinationName: "", typedName: "" })).toBe(false);
  });
  it("also needs the acknowledgement when restoring into the source", () => {
    expect(canSubmitRestore({ ...ok, sameDatabase: true })).toBe(false);
    expect(canSubmitRestore({ ...ok, sameDatabase: true, acknowledged: true })).toBe(true);
  });
});

describe("restoreRequest", () => {
  it("sends the destination and the typed name", () => {
    expect(restoreRequest("t2", "shop", false)).toEqual({ destinationTargetId: "t2", confirmName: "shop" });
  });
  it("adds acknowledgeOverwrite only when restoring into the source database", () => {
    expect(restoreRequest("t1", "shop", true)).toEqual({
      destinationTargetId: "t1",
      confirmName: "shop",
      acknowledgeOverwrite: true,
    });
  });
});
