import { approxIntervalMs } from "../../../src/shared/cron";
import type { JobStatus, TargetSummary } from "../api/types";

export type TargetHealth = "failing" | "stale" | "ok" | "never" | "disabled";

const HOUR_MS = 3_600_000;
const STALE_GRACE_MS = 2 * HOUR_MS;

/** Mirrors the Phase 8 rule: `stale_after_hours`, else the schedule interval plus 2 hours (daily = 26 h). */
export function staleThresholdMs(target: Pick<TargetSummary, "staleAfterHours" | "scheduleCron" | "timezone">, now: Date): number {
  if (target.staleAfterHours !== null) return target.staleAfterHours * HOUR_MS;
  return approxIntervalMs(target.scheduleCron, target.timezone, now) + STALE_GRACE_MS;
}

export function classifyTarget(
  target: Pick<TargetSummary, "enabled" | "lastStatus" | "lastBackupAt" | "createdAt" | "staleAfterHours" | "scheduleCron" | "timezone">,
  now: Date,
): TargetHealth {
  if (!target.enabled) return "disabled";
  if (target.lastStatus === "failed" || target.lastStatus === "timed_out") return "failing";
  const reference = new Date(target.lastBackupAt ?? target.createdAt).getTime();
  if (now.getTime() - reference > staleThresholdMs(target, now)) return "stale";
  return target.lastBackupAt ? "ok" : "never";
}

export function isRedHealth(health: TargetHealth): boolean {
  return health === "failing" || health === "stale";
}

export function isActiveStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

export function isTerminalStatus(status: JobStatus): boolean {
  return !isActiveStatus(status);
}
