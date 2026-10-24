import type { RetentionBackup, RetentionPolicy } from "../../../src/worker/retention/types";

export const OFF: RetentionPolicy = { keep_last: 0, daily: 0, weekly: 0, monthly: 0 };

export function mk(id: string, createdAt: string, status = "success"): RetentionBackup {
  return { id, status, created_at: createdAt };
}

export function ids(list: RetentionBackup[]): string[] {
  return list.map((b) => b.id);
}
