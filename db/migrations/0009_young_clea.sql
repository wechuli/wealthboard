PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`base_currency` text DEFAULT 'KES' NOT NULL,
	`supported_currencies` text DEFAULT '["KES","USD"]' NOT NULL,
	`timezone` text DEFAULT 'Africa/Nairobi' NOT NULL,
	`preferred_date_format` text DEFAULT 'dd MMM yyyy' NOT NULL,
	`app_name` text DEFAULT 'Wealthboard' NOT NULL,
	`default_dashboard_period` text DEFAULT '1y' NOT NULL,
	`session_timeout_minutes` integer DEFAULT 10080 NOT NULL,
	`default_goal_return_bps` integer DEFAULT 800 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("id", "user_id", "display_name", "base_currency", "supported_currencies", "timezone", "preferred_date_format", "app_name", "default_dashboard_period", "session_timeout_minutes", "default_goal_return_bps", "created_at", "updated_at") SELECT "id", "user_id", "display_name", "base_currency", "supported_currencies", "timezone", "preferred_date_format", "app_name", "default_dashboard_period", "session_timeout_minutes", "default_goal_return_bps", "created_at", "updated_at" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_unique` ON `user_settings` (`user_id`);