import { describe, expect, it } from "vitest";
import { clampDownloadTtl, destinationDbNameFromUrl } from "../../../src/worker/lib/restore-rules";

describe("clampDownloadTtl", () => {
  it.each([[undefined, 900], [null, 900], ["600", 900], [NaN, 900], [0, 900], [-5, 900], [0.5, 900], [1, 1], [300, 300], [300.9, 300], [900, 900], [3600, 900]])("%s -> %s", (raw, want) => {
    expect(clampDownloadTtl(raw)).toBe(want);
  });
});

describe("destinationDbNameFromUrl", () => {
  it.each([
    ["postgres://u:p@h:5432/scratch", "scratch"],
    ["postgresql://u:p%40ss@h/my%20db?sslmode=require", "my db"],
    ["postgres://u:p@h:5432/", null],
    ["postgres://u:p@h:5432", null],
    ["postgres://u:p@h/a%2Fb", null],
    ["mysql://u:p@h/db", null],
    ["not a url", null],
    ["postgres://u:p@h/%E0%A4%A", null],
  ])("%s -> %s", (url, want) => {
    expect(destinationDbNameFromUrl(url)).toBe(want);
  });
});
