import { describe, expect, it } from "vitest";
import type { TargetSummary } from "../../../ui/src/api/types";
import { emptyFormValues, fieldErrors, targetToFormValues, toPayload } from "../../../ui/src/lib/form";

const target: TargetSummary = {
  id: "t1",
  name: "shop",
  projectTag: null,
  dbName: "shop",
  connection: { host: "db.example.com", port: 5432, dbName: "shop", user: "backup" },
  hasRestoreUrl: true,
  hasTunnelToken: true,
  tunnelHostname: "pg.example.com",
  scheduleCron: "0 3 * * *",
  timezone: "UTC",
  enabled: true,
  retention: { keepLast: 3, daily: 7, weekly: null, monthly: 6, maxAgeDays: null },
  jobDeadlineMinutes: 90,
  staleAfterHours: null,
  alertFailureThreshold: 5,
  alertChannelIds: ["c1"],
  lastStatus: null,
  lastBackupAt: null,
  nextRunAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  stats: { backupCount: 0, totalBackupBytes: 0 },
};

describe("toPayload", () => {
  it("builds a nested create body with numbers and omits blanks", () => {
    const values = {
      ...emptyFormValues(),
      name: " shop ",
      connectionUrl: "postgres://u:p@h:5432/db",
      "tunnel.hostname": "pg.example.com",
      "tunnel.tokenId": "id",
      "tunnel.tokenSecret": "secret",
    };
    expect(toPayload(values, "create", ["c1"])).toEqual({
      name: "shop",
      connectionUrl: "postgres://u:p@h:5432/db",
      tunnel: { hostname: "pg.example.com", tokenId: "id", tokenSecret: "secret" },
      scheduleCron: "0 2 * * *",
      timezone: "Asia/Bangkok",
      retention: { keepLast: 3, daily: 7, weekly: 4, monthly: 6 },
      jobDeadlineMinutes: 120,
      alertFailureThreshold: 3,
      enabled: false,
      alertChannelIds: ["c1"],
    });
  });

  it("never sends blank secrets on edit, so the stored values are kept", () => {
    const body = toPayload(targetToFormValues(target), "edit", ["c1"]);
    expect(body).not.toHaveProperty("connectionUrl");
    expect(body).not.toHaveProperty("restoreUrl");
    expect(body.tunnel).toEqual({ hostname: "pg.example.com" });
  });

  it("sends null for cleared optional fields on edit", () => {
    const body = toPayload(targetToFormValues(target), "edit", []);
    expect(body.projectTag).toBeNull();
    expect(body.staleAfterHours).toBeNull();
    expect(body.retention).toEqual({ keepLast: 3, daily: 7, weekly: null, monthly: 6, maxAgeDays: null });
  });

  it("keeps the failure threshold from the stored target on edit", () => {
    expect(toPayload(targetToFormValues(target), "edit", []).alertFailureThreshold).toBe(5);
  });

  it("keeps a non-numeric number as text so validation can report it", () => {
    const body = toPayload({ ...emptyFormValues(), jobDeadlineMinutes: "abc" }, "create", []);
    expect(body.jobDeadlineMinutes).toBe("abc");
  });
});

describe("targetToFormValues", () => {
  it("starts a new target disabled, so it can be tested before it is enabled", () => {
    expect(emptyFormValues().enabled).toBe("false");
  });

  it("leaves every secret blank", () => {
    const values = targetToFormValues(target);
    expect([values.connectionUrl, values.restoreUrl, values["tunnel.tokenId"], values["tunnel.tokenSecret"]]).toEqual(["", "", "", ""]);
  });
});

describe("fieldErrors", () => {
  it("keeps the first message per dotted path and files pathless issues under _form", () => {
    const errors = fieldErrors([
      { path: ["tunnel", "hostname"], message: "Required" },
      { path: ["tunnel", "hostname"], message: "Second" },
      { path: [], message: "Tunnel mode needs a hostname" },
    ]);
    expect(errors).toEqual({ "tunnel.hostname": "Required", _form: "Tunnel mode needs a hostname" });
  });
});
