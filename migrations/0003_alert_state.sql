ALTER TABLE `targets` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `targets` ADD `failure_alerted_at` text;--> statement-breakpoint
ALTER TABLE `targets` ADD `stale_alerted_at` text;