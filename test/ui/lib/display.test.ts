import { describe, expect, it } from "vitest";
import { connectionLabel, formatBytes, formatDuration, secretLabel, shortId } from "../../../ui/src/lib/display";

describe("display", () => {
  it.each([
    [null, "-"],
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KiB"],
    [1536 * 1024, "1.5 MiB"],
    [5 * 1024 ** 3, "5.0 GiB"],
    [150 * 1024 ** 2, "150 MiB"],
  ])("formatBytes(%s) = %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it.each([
    [null, "-"],
    [4_000, "4 s"],
    [125_000, "2 min 5 s"],
    [3_900_000, "1 h 5 min"],
  ])("formatDuration(%s) = %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it("labels secrets as set or not set and never takes a value", () => {
    expect(secretLabel(true)).toBe("set");
    expect(secretLabel(false)).toBe("not set");
  });

  it("labels an id by its last 8 characters", () => {
    expect(shortId("0190f2a8-1c3d-7e4f-9a2b-6c5d4e3f2a1b")).toBe("4e3f2a1b");
  });

  it("formats the masked connection without a password", () => {
    expect(connectionLabel({ host: "db.example.com", port: 5432, dbName: "app", user: "backup" })).toBe("backup@db.example.com:5432/app");
  });
});
