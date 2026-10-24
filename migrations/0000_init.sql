CREATE TABLE `alert_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`credential_enc` text NOT NULL,
	`events` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_alert_channels_enabled_type` ON `alert_channels` (`enabled`,`type`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`details` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_at` ON `audit_logs` ("at" DESC);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity` ON `audit_logs` (`entity_type`,`entity_id`,"at" DESC);--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`r2_key` text,
	`size_bytes` integer,
	`sha256` text,
	`pg_version_server` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`duration_ms` integer,
	`schedule_slot` text,
	`queued_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`heartbeat_at` text,
	`expires_at` text,
	`deleted_at` text,
	`deleted_reason` text,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_backups_target_time` ON `backups` (`target_id`,"started_at" DESC) WHERE "backups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_backups_status` ON `backups` (`status`,`heartbeat_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_backups_r2_key` ON `backups` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_backups_target_slot` ON `backups` (`target_id`,`schedule_slot`) WHERE "backups"."schedule_slot" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `restores` (
	`id` text PRIMARY KEY NOT NULL,
	`source_backup_id` text NOT NULL,
	`destination_target_id` text NOT NULL,
	`destination_db_name` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`is_source_overwrite` integer NOT NULL,
	`error_code` text,
	`error_message` text,
	`queued_at` text,
	`started_at` text,
	`finished_at` text,
	`heartbeat_at` text,
	FOREIGN KEY (`source_backup_id`) REFERENCES `backups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_restores_destination` ON `restores` (`destination_target_id`,"queued_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_restores_source` ON `restores` (`source_backup_id`);--> statement-breakpoint
CREATE INDEX `idx_restores_status` ON `restores` (`status`,`heartbeat_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `target_alert_channels` (
	`target_id` text NOT NULL,
	`channel_id` text NOT NULL,
	PRIMARY KEY(`target_id`, `channel_id`),
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `alert_channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_target_alert_channels_channel` ON `target_alert_channels` (`channel_id`);--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`db_name` text NOT NULL,
	`pg_version` integer,
	`connection_url_enc` text NOT NULL,
	`restore_url_enc` text,
	`project_tag` text,
	`tunnel_hostname` text NOT NULL,
	`tunnel_token_id_enc` text NOT NULL,
	`tunnel_token_secret_enc` text NOT NULL,
	`schedule_cron` text DEFAULT '0 2 * * *' NOT NULL,
	`timezone` text DEFAULT 'Asia/Bangkok' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`keep_last` integer DEFAULT 3,
	`keep_daily` integer DEFAULT 7,
	`keep_weekly` integer DEFAULT 4,
	`keep_monthly` integer DEFAULT 6,
	`max_age_days` integer,
	`job_deadline_minutes` integer DEFAULT 120 NOT NULL,
	`stale_after_hours` integer,
	`alert_failure_threshold` integer DEFAULT 3 NOT NULL,
	`next_run_at` text,
	`last_backup_at` text,
	`last_status` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_targets_name` ON `targets` (`name`) WHERE "targets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_targets_next_run` ON `targets` (`enabled`,`next_run_at`) WHERE "targets"."deleted_at" IS NULL;