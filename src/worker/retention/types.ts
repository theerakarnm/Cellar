export interface RetentionBackup {
  id: string;
  status: string;
  /** ISO-8601 UTC instant, for example "2026-10-24T19:00:00.000Z". */
  created_at: string;
}

/** A rule set to null, undefined, or 0 is off. */
export interface RetentionPolicy {
  keep_last: number | null;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  max_age_days?: number | null;
}

export interface RetentionDecision {
  keep: RetentionBackup[];
  delete: RetentionBackup[];
  /** One entry per kept backup, never for deleted or non-success backups. */
  reasons: Record<string, string[]>;
}
