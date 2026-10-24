import type { TargetSummary } from "../api/types";

export const DEFAULT_TIMEZONE = "Asia/Bangkok";

/** `2026-10-24 02:00 GMT+7`. Returns "-" for missing or invalid input. */
export function formatInTimeZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
}

/** `5 min ago`, `3 h ago`, `in 2 d`. */
export function formatRelative(iso: string | null | undefined, now: Date): string {
  if (!iso) return "-";
  const diffMs = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(diffMs)) return "-";
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return "just now";
  const unit =
    abs < 3_600_000
      ? `${Math.round(abs / 60_000)} min`
      : abs < 86_400_000
        ? `${Math.round(abs / 3_600_000)} h`
        : `${Math.round(abs / 86_400_000)} d`;
  return diffMs < 0 ? `${unit} ago` : `in ${unit}`;
}

/** Audit rows use the target's zone when the entity is a known target, else the default zone. */
export function timeZoneForAudit(
  entityType: string,
  entityId: string | null,
  targets: readonly Pick<TargetSummary, "id" | "timezone">[],
): string {
  if (entityType !== "target" || !entityId) return DEFAULT_TIMEZONE;
  return targets.find((t) => t.id === entityId)?.timezone ?? DEFAULT_TIMEZONE;
}
