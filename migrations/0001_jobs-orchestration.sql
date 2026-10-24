CREATE TABLE `connection_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`queued_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`heartbeat_at` text,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_connection_tests_active_target` ON `connection_tests` (`target_id`) WHERE "connection_tests"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX `idx_connection_tests_status` ON `connection_tests` (`status`,`heartbeat_at`);--> statement-breakpoint
CREATE INDEX `idx_connection_tests_queued` ON `connection_tests` (`queued_at`);--> statement-breakpoint
ALTER TABLE `backups` ADD `last_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_backups_active_target` ON `backups` (`target_id`) WHERE "backups"."status" IN ('queued', 'running');