CREATE TABLE `legacy_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`settings_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `categories` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `exchange_rates` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `goal_contribution_plans` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `goals` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
ALTER TABLE `valuation_snapshots` ADD `user_id` text REFERENCES users(id);