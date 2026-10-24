import type { TargetSummary } from "../api/types";

/** Form state is flat: each key is the dotted path of the field in the API payload. */
export type FormValues = Record<string, string>;
export type FormMode = "create" | "edit";

const NUMBER_KEYS = new Set([
  "retention.keepLast",
  "retention.daily",
  "retention.weekly",
  "retention.monthly",
  "retention.maxAgeDays",
  "jobDeadlineMinutes",
  "staleAfterHours",
  "alertFailureThreshold",
]);
const SECRET_KEYS = new Set(["connectionUrl", "restoreUrl", "tunnel.tokenId", "tunnel.tokenSecret"]);
const CLEARABLE_KEYS = new Set([
  "projectTag",
  "staleAfterHours",
  "retention.keepLast",
  "retention.daily",
  "retention.weekly",
  "retention.monthly",
  "retention.maxAgeDays",
]);

export function emptyFormValues(): FormValues {
  return {
    name: "",
    projectTag: "",
    connectionUrl: "",
    restoreUrl: "",
    "tunnel.hostname": "",
    "tunnel.tokenId": "",
    "tunnel.tokenSecret": "",
    scheduleCron: "0 2 * * *",
    timezone: "Asia/Bangkok",
    "retention.keepLast": "3",
    "retention.daily": "7",
    "retention.weekly": "4",
    "retention.monthly": "6",
    "retention.maxAgeDays": "",
    jobDeadlineMinutes: "120",
    staleAfterHours: "",
    alertFailureThreshold: "3",
    enabled: "false",
  };
}

/** Secret fields start blank: the API never returns them. */
export function targetToFormValues(target: TargetSummary): FormValues {
  const text = (value: number | string | null) => (value === null ? "" : String(value));
  return {
    ...emptyFormValues(),
    name: target.name,
    projectTag: text(target.projectTag),
    "tunnel.hostname": text(target.tunnelHostname),
    scheduleCron: target.scheduleCron,
    timezone: target.timezone,
    "retention.keepLast": text(target.retention.keepLast),
    "retention.daily": text(target.retention.daily),
    "retention.weekly": text(target.retention.weekly),
    "retention.monthly": text(target.retention.monthly),
    "retention.maxAgeDays": text(target.retention.maxAgeDays),
    jobDeadlineMinutes: String(target.jobDeadlineMinutes),
    staleAfterHours: text(target.staleAfterHours),
    alertFailureThreshold: String(target.alertFailureThreshold),
    enabled: String(target.enabled),
  };
}

function setDeep(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (typeof next === "object" && next !== null) {
      cursor = next as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      cursor[part] = created;
      cursor = created;
    }
  }
  cursor[parts[parts.length - 1] as string] = value;
}

/**
 * Builds the API body. Blank secrets are always omitted (edit keeps the stored value).
 * Blank clearable fields are omitted on create and sent as null on edit.
 * A non-numeric number field stays a string so Zod reports it.
 */
export function toPayload(values: FormValues, mode: FormMode, alertChannelIds: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (key === "enabled") {
      setDeep(payload, key, value === "true");
    } else if (value === "") {
      if (mode === "edit" && CLEARABLE_KEYS.has(key)) setDeep(payload, key, null);
    } else if (NUMBER_KEYS.has(key)) {
      setDeep(payload, key, Number.isFinite(Number(value)) ? Number(value) : value);
    } else {
      setDeep(payload, key, SECRET_KEYS.has(key) ? raw : value);
    }
  }
  payload.alertChannelIds = alertChannelIds;
  return payload;
}

/** First message per field. Issues with no path go under `_form`. */
export function fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length === 0 ? "_form" : issue.path.map(String).join(".");
    errors[key] ??= issue.message;
  }
  return errors;
}
