DROP INDEX `accounts_category_idx`;--> statement-breakpoint
DROP INDEX `accounts_goal_idx`;--> statement-breakpoint
DROP INDEX `accounts_archived_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_id_unique` ON `accounts` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `accounts_user_category_idx` ON `accounts` (`user_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_goal_idx` ON `accounts` (`user_id`,`goal_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_archived_idx` ON `accounts` (`user_id`,`archived_at`);--> statement-breakpoint
DROP INDEX `categories_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_id_unique` ON `categories` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_slug_unique` ON `categories` (`user_id`,`slug`);--> statement-breakpoint
DROP INDEX `exchange_rate_pair_date_unique`;--> statement-breakpoint
DROP INDEX `exchange_rate_lookup_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_rate_user_pair_date_unique` ON `exchange_rates` (`user_id`,`base_currency`,`quote_currency`,`effective_date`);--> statement-breakpoint
CREATE INDEX `exchange_rate_user_lookup_idx` ON `exchange_rates` (`user_id`,`base_currency`,`quote_currency`,`effective_date`);--> statement-breakpoint
DROP INDEX `goal_plans_goal_idx`;--> statement-breakpoint
CREATE INDEX `goal_plans_user_goal_idx` ON `goal_contribution_plans` (`user_id`,`goal_id`);--> statement-breakpoint
DROP INDEX `goals_status_idx`;--> statement-breakpoint
DROP INDEX `goals_account_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `goals_user_id_unique` ON `goals` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `goals_user_status_idx` ON `goals` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `goals_user_account_unique` ON `goals` (`user_id`,`linked_account_id`);--> statement-breakpoint
DROP INDEX `transactions_account_date_idx`;--> statement-breakpoint
DROP INDEX `transactions_transfer_group_idx`;--> statement-breakpoint
DROP INDEX `transactions_idempotency_unique`;--> statement-breakpoint
CREATE INDEX `transactions_user_account_date_idx` ON `transactions` (`user_id`,`account_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_user_transfer_group_idx` ON `transactions` (`user_id`,`transfer_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_idempotency_unique` ON `transactions` (`user_id`,`idempotency_key`);--> statement-breakpoint
DROP INDEX `valuations_account_date_idx`;--> statement-breakpoint
CREATE INDEX `valuations_user_account_date_idx` ON `valuation_snapshots` (`user_id`,`account_id`,`valuation_date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_idempotency_keys` (
	`user_id` text,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`result_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_idempotency_keys`("user_id", "key", "operation", "result_id", "created_at") SELECT "user_id", "key", "operation", "result_id", "created_at" FROM `idempotency_keys`;--> statement-breakpoint
DROP TABLE `idempotency_keys`;--> statement-breakpoint
ALTER TABLE `__new_idempotency_keys` RENAME TO `idempotency_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_user_key_unique` ON `idempotency_keys` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `idempotency_user_created_idx` ON `idempotency_keys` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `password_hash`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `session_version`;