export type JobStatus = "queued" | "running" | "success" | "failed" | "timed_out";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RetentionFields {
  keepLast: number | null;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  maxAgeDays: number | null;
}

export interface TargetSummary {
  id: string;
  name: string;
  projectTag: string | null;
  dbName: string;
  connection: { host: string; port: number; dbName: string; user: string };
  hasRestoreUrl: boolean;
  hasTunnelToken: boolean;
  tunnelHostname: string;
  scheduleCron: string;
  timezone: string;
  enabled: boolean;
  retention: RetentionFields;
  jobDeadlineMinutes: number;
  staleAfterHours: number | null;
  alertFailureThreshold: number;
  alertChannelIds: string[];
  lastStatus: JobStatus | null;
  lastBackupAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: { backupCount: number; totalBackupBytes: number };
}

export interface Backup {
  id: string;
  targetId: string;
  status: JobStatus;
  trigger: "schedule" | "manual";
  r2Key: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  pgVersionServer: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ConnectionTest {
  status: JobStatus;
  result?: { pgServerVersion?: string; hasReadAllData?: boolean | null };
  error?: { code: string; message: string | null };
}

export interface RestoreRun {
  id: string;
  sourceBackupId: string;
  destinationTargetId: string;
  destinationDbName: string;
  status: JobStatus;
  actor: string;
  sameDatabase: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RetentionPreview {
  dryRun: boolean;
  keep: string[];
  delete: { id: string; startedAt: string; sizeBytes: number | null; reason: string }[];
  reasons: Record<string, string[]>;
}

export type ChannelType = "line" | "discord";
export type ChannelEvent =
  | "backup_failed"
  | "backup_stale"
  | "backup_consecutive_failures"
  | "retention_failed"
  | "restore_finished";

export interface AlertChannel {
  id: string;
  type: ChannelType;
  name: string;
  events: ChannelEvent[];
  enabled: boolean;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  max_concurrent_jobs: number;
  retention_dry_run: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
  ip: string | null;
}
