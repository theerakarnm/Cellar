import { getZonedParts } from "../../shared/tz";
import { redactSecrets } from "../lib/redact";

export const ERROR_SUMMARY_MAX = 300;

export interface AlertTarget {
  id: string;
  name: string;
  projectTag: string | null;
  timezone: string;
}

export type AlertDetail =
  | { event: "backup_failed"; status: "failed" | "timed_out"; errorCode: string | null; errorMessage: string | null }
  | { event: "backup_consecutive_failures"; count: number; errorCode: string | null; errorMessage: string | null }
  | { event: "backup_stale"; staleAfterHours: number; lastSuccessAt: Date | null };

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 3));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}...`;
}

export function formatLocalTime(date: Date, tz: string): string {
  const p = getZonedParts(date, tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)} ${tz}`;
}

export function summarizeError(code: string | null, message: string | null): string {
  const body = redactSecrets(message ?? "").replace(/\s+/g, " ").trim();
  const text = [code, body].filter((part) => part).join(": ");
  return truncate(text || "no details", ERROR_SUMMARY_MAX);
}

export function targetLink(appBaseUrl: string, targetId: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/targets/${targetId}`;
}

function title(detail: AlertDetail): string {
  switch (detail.event) {
    case "backup_failed":
      return detail.status === "timed_out" ? "Backup timed out" : "Backup failed";
    case "backup_consecutive_failures":
      return `${detail.count} consecutive backup failures`;
    case "backup_stale":
      return `No successful backup in ${detail.staleAfterHours} h`;
  }
}

export function buildAlertMessage(target: AlertTarget, detail: AlertDetail, at: Date, appBaseUrl: string): string {
  const lines = [`[Cellar] ${title(detail)}`, `Target: ${target.name}`];
  if (target.projectTag) lines.push(`Project: ${target.projectTag}`);
  lines.push(`Time: ${formatLocalTime(at, target.timezone)}`);
  if (detail.event === "backup_stale") {
    lines.push(`Last success: ${detail.lastSuccessAt ? formatLocalTime(detail.lastSuccessAt, target.timezone) : "never"}`);
  } else {
    lines.push(`Error: ${summarizeError(detail.errorCode, detail.errorMessage)}`);
  }
  lines.push(targetLink(appBaseUrl, target.id));
  return lines.join("\n");
}

export function buildTestMessage(channelName: string, at: Date): string {
  return `[Cellar] Test message\nChannel: ${channelName}\nTime: ${at.toISOString()}`;
}
