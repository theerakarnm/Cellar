import { describe, expect, it } from "vitest";
import { createTargetSchema, TARGET_DEFAULTS, updateTargetSchema } from "../../src/shared/target-schema";

const base = {
  name: "Shop DB",
  connectionUrl: "postgres://backup:s3cret@db.example.com:5432/shop",
  tunnel: { hostname: "db.example.com", tokenId: "id-1", tokenSecret: "secret-1" },
};

function paths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("createTargetSchema", () => {
  it("fills the owner defaults", () => {
    const parsed = createTargetSchema.parse(base);
    expect(parsed).toMatchObject({
      scheduleCron: TARGET_DEFAULTS.scheduleCron,
      timezone: "Asia/Bangkok",
      jobDeadlineMinutes: 120,
      alertFailureThreshold: 3,
      enabled: true,
      alertChannelIds: [],
    });
    expect(parsed.retention).toBeUndefined();
  });

  it("rejects each invalid input at its own field", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ scheduleCron: "61 * * * *" }, "scheduleCron"],
      [{ scheduleCron: "* * * *" }, "scheduleCron"],
      [{ timezone: "Mars/Base" }, "timezone"],
      [{ connectionUrl: "mysql://u:p@h/db" }, "connectionUrl"],
      [{ restoreUrl: "nonsense" }, "restoreUrl"],
      [{ name: "   " }, "name"],
      [{ tunnel: undefined }, "tunnel"],
      [{ tunnel: { hostname: "db.example.com", tokenId: "id-1" } }, "tunnel.tokenSecret"],
      [{ tunnel: { hostname: "not a host", tokenId: "a", tokenSecret: "b" } }, "tunnel.hostname"],
      [{ connectionMode: "tunnel" }, ""],
      [{ dbName: "shop" }, ""],
      [{ retention: { keepLast: -1 } }, "retention.keepLast"],
      [{ retention: { maxAgeDays: 0 } }, "retention.maxAgeDays"],
      [{ jobDeadlineMinutes: 1 }, "jobDeadlineMinutes"],
      [{ staleAfterHours: 0 }, "staleAfterHours"],
      [{ alertFailureThreshold: 0 }, "alertFailureThreshold"],
      [{ alertFailureThreshold: 101 }, "alertFailureThreshold"],
      [{ alertFailureThreshold: 2.5 }, "alertFailureThreshold"],
      [{ enabled: "yes" }, "enabled"],
    ];
    for (const [override, path] of cases) {
      const result = createTargetSchema.safeParse({ ...base, ...override });
      expect(result.success, JSON.stringify(override)).toBe(false);
      expect(paths(result), JSON.stringify(override)).toContain(path);
    }
  });

  it("allows null to switch retention rules off and de-duplicates channel ids", () => {
    const parsed = createTargetSchema.parse({ ...base, retention: { keepLast: null, maxAgeDays: 90 }, alertChannelIds: ["a", "b", "a"] });
    expect(parsed.retention).toEqual({ keepLast: null, maxAgeDays: 90 });
    expect(parsed.alertChannelIds).toEqual(["a", "b"]);
  });

  it("never puts a submitted secret into an error message", () => {
    const result = createTargetSchema.safeParse({ ...base, connectionUrl: "mysql://u:leak-pw@h/db", tunnel: { hostname: "x", tokenId: "leak-id", tokenSecret: "" } });
    expect(JSON.stringify(result.error?.issues)).not.toMatch(/leak/);
  });
});

describe("updateTargetSchema", () => {
  it("accepts a single field and leaves the rest undefined", () => {
    expect(updateTargetSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("accepts partial tunnel and retention objects, and null to clear", () => {
    const parsed = updateTargetSchema.parse({ tunnel: { tokenSecret: "new" }, retention: { daily: null }, restoreUrl: null, projectTag: null });
    expect(parsed).toEqual({ tunnel: { tokenSecret: "new" }, retention: { daily: null }, restoreUrl: null, projectTag: null });
  });

  it("rejects an empty body and unknown keys, including connectionMode", () => {
    expect(updateTargetSchema.safeParse({}).success).toBe(false);
    expect(updateTargetSchema.safeParse({ dbName: "x" }).success).toBe(false);
    expect(updateTargetSchema.safeParse({ connectionMode: "tunnel" }).success).toBe(false);
  });

  it("validates the same field rules as create", () => {
    for (const override of [{ scheduleCron: "nope" }, { timezone: "x/y" }, { connectionUrl: "http://h/db" }, { tunnel: { hostname: "bad host" } }, { alertFailureThreshold: 0 }]) {
      expect(updateTargetSchema.safeParse(override).success, JSON.stringify(override)).toBe(false);
    }
  });
});
