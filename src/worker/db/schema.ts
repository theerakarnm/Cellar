import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const targets = sqliteTable(
  "targets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    dbName: text("db_name").notNull(),
    pgVersion: integer("pg_version"),
    connectionUrlEnc: text("connection_url_enc").notNull(),
    restoreUrlEnc: text("restore_url_enc"),
    projectTag: text("project_tag"),
    tunnelHostname: text("tunnel_hostname").notNull(),
    tunnelTokenIdEnc: text("tunnel_token_id_enc").notNull(),
    tunnelTokenSecretEnc: text("tunnel_token_secret_enc").notNull(),
    scheduleCron: text("schedule_cron").notNull().default("0 2 * * *"),
    timezone: text("timezone").notNull().default("Asia/Bangkok"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    keepLast: integer("keep_last").default(3),
    keepDaily: integer("keep_daily").default(7),
    keepWeekly: integer("keep_weekly").default(4),
    keepMonthly: integer("keep_monthly").default(6),
    maxAgeDays: integer("max_age_days"),
    jobDeadlineMinutes: integer("job_deadline_minutes").notNull().default(120),
    staleAfterHours: integer("stale_after_hours"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    failureAlertedAt: text("failure_alerted_at"),
    staleAlertedAt: text("stale_alerted_at"),
    alertFailureThreshold: integer("alert_failure_threshold").notNull().default(3),
    nextRunAt: text("next_run_at"),
    lastBackupAt: text("last_backup_at"),
    lastStatus: text("last_status"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_targets_name").on(t.name).where(sql`${t.deletedAt} IS NULL`),
    index("idx_targets_next_run").on(t.enabled, t.nextRunAt).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const backups = sqliteTable(
  "backups",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    status: text("status", { enum: ["queued", "running", "success", "failed", "timed_out"] }).notNull(),
    trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
    r2Key: text("r2_key"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    pgVersionServer: text("pg_version_server"),
    attempt: integer("attempt").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    scheduleSlot: text("schedule_slot"),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
    expiresAt: text("expires_at"),
    deletedAt: text("deleted_at"),
    deletedReason: text("deleted_reason"),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [
    index("idx_backups_target_time")
      .on(t.targetId, sql`${t.startedAt} DESC`)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_backups_status").on(t.status, t.heartbeatAt),
    uniqueIndex("uq_backups_r2_key").on(t.r2Key),
    uniqueIndex("uq_backups_target_slot")
      .on(t.targetId, t.scheduleSlot)
      .where(sql`${t.scheduleSlot} IS NOT NULL`),
    uniqueIndex("uq_backups_active_target")
      .on(t.targetId)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);

export const connectionTests = sqliteTable(
  "connection_tests",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    status: text("status", { enum: ["queued", "running", "success", "failed", "timed_out"] }).notNull(),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    lastSeq: integer("last_seq").notNull().default(0),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
  },
  (t) => [
    uniqueIndex("uq_connection_tests_active_target")
      .on(t.targetId)
      .where(sql`${t.status} IN ('queued', 'running')`),
    index("idx_connection_tests_status").on(t.status, t.heartbeatAt),
    index("idx_connection_tests_queued").on(t.queuedAt),
  ],
);

export const restores = sqliteTable(
  "restores",
  {
    id: text("id").primaryKey(),
    sourceBackupId: text("source_backup_id")
      .notNull()
      .references(() => backups.id),
    destinationTargetId: text("destination_target_id")
      .notNull()
      .references(() => targets.id),
    destinationDbName: text("destination_db_name").notNull(),
    status: text("status", { enum: ["queued", "running", "success", "failed", "timed_out"] }).notNull(),
    actor: text("actor").notNull(),
    isSourceOverwrite: integer("is_source_overwrite", { mode: "boolean" }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    queuedAt: text("queued_at"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [
    index("idx_restores_destination").on(t.destinationTargetId, sql`${t.queuedAt} DESC`),
    index("idx_restores_source").on(t.sourceBackupId),
    index("idx_restores_status").on(t.status, t.heartbeatAt),
    uniqueIndex("uq_restores_active_destination")
      .on(t.destinationTargetId)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);

export const alertChannels = sqliteTable(
  "alert_channels",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["line", "discord"] }).notNull(),
    name: text("name").notNull(),
    credentialEnc: text("credential_enc").notNull(),
    events: text("events").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_alert_channels_enabled_type").on(t.enabled, t.type)],
);

export const targetAlertChannels = sqliteTable(
  "target_alert_channels",
  {
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    channelId: text("channel_id")
      .notNull()
      .references(() => alertChannels.id),
  },
  (t) => [primaryKey({ columns: [t.targetId, t.channelId] }), index("idx_target_alert_channels_channel").on(t.channelId)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: text("details"),
    ip: text("ip"),
  },
  (t) => [
    index("idx_audit_logs_at").on(sql`${t.at} DESC`),
    index("idx_audit_logs_entity").on(t.entityType, t.entityId, sql`${t.at} DESC`),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
