PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`description` text,
	`category_id` text NOT NULL,
	`institution` text,
	`account_reference` text,
	`currency` text NOT NULL,
	`current_value_minor` integer DEFAULT 0 NOT NULL,
	`cost_basis_minor` integer,
	`is_liability` integer DEFAULT false NOT NULL,
	`is_included_in_net_worth` integer DEFAULT true NOT NULL,
	`goal_id` text,
	`notes` text,
	`opened_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`category_id`) REFERENCES `categories`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "user_id", "name", "description", "category_id", "institution", "account_reference", "currency", "current_value_minor", "cost_basis_minor", "is_liability", "is_included_in_net_worth", "goal_id", "notes", "opened_at", "archived_at", "created_at", "updated_at") SELECT "id", "user_id", "name", "description", "category_id", "institution", "account_reference", "currency", "current_value_minor", "cost_basis_minor", "is_liability", "is_included_in_net_worth", "goal_id", "notes", "opened_at", "archived_at", "created_at", "updated_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_id_unique` ON `accounts` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `accounts_user_category_idx` ON `accounts` (`user_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_goal_idx` ON `accounts` (`user_id`,`goal_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_archived_idx` ON `accounts` (`user_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `__new_goal_contribution_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`goal_id` text NOT NULL,
	`planned_contribution_minor` integer NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`goal_id`) REFERENCES `goals`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_goal_contribution_plans`("id", "user_id", "goal_id", "planned_contribution_minor", "frequency", "start_date", "end_date", "created_at", "updated_at") SELECT "id", "user_id", "goal_id", "planned_contribution_minor", "frequency", "start_date", "end_date", "created_at", "updated_at" FROM `goal_contribution_plans`;--> statement-breakpoint
DROP TABLE `goal_contribution_plans`;--> statement-breakpoint
ALTER TABLE `__new_goal_contribution_plans` RENAME TO `goal_contribution_plans`;--> statement-breakpoint
CREATE INDEX `goal_plans_user_goal_idx` ON `goal_contribution_plans` (`user_id`,`goal_id`);--> statement-breakpoint
CREATE TABLE `__new_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`description` text,
	`target_amount_minor` integer NOT NULL,
	`current_amount_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`target_date` text NOT NULL,
	`linked_account_id` text,
	`icon` text DEFAULT 'Target' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`assumed_annual_return_bps` integer DEFAULT 800 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`linked_account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_goals`("id", "user_id", "name", "description", "target_amount_minor", "current_amount_minor", "currency", "target_date", "linked_account_id", "icon", "status", "priority", "assumed_annual_return_bps", "created_at", "updated_at") SELECT "id", "user_id", "name", "description", "target_amount_minor", "current_amount_minor", "currency", "target_date", "linked_account_id", "icon", "status", "priority", "assumed_annual_return_bps", "created_at", "updated_at" FROM `goals`;--> statement-breakpoint
DROP TABLE `goals`;--> statement-breakpoint
ALTER TABLE `__new_goals` RENAME TO `goals`;--> statement-breakpoint
CREATE UNIQUE INDEX `goals_user_id_unique` ON `goals` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `goals_user_status_idx` ON `goals` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `goals_user_account_unique` ON `goals` (`user_id`,`linked_account_id`);--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`transaction_date` text NOT NULL,
	`description` text,
	`notes` text,
	`transfer_group_id` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "user_id", "account_id", "type", "amount_minor", "currency", "transaction_date", "description", "notes", "transfer_group_id", "idempotency_key", "created_at", "updated_at") SELECT "id", "user_id", "account_id", "type", "amount_minor", "currency", "transaction_date", "description", "notes", "transfer_group_id", "idempotency_key", "created_at", "updated_at" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
CREATE INDEX `transactions_user_account_date_idx` ON `transactions` (`user_id`,`account_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_user_transfer_group_idx` ON `transactions` (`user_id`,`transfer_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_idempotency_unique` ON `transactions` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `__new_valuation_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`account_id` text NOT NULL,
	`value_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`valuation_date` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_valuation_snapshots`("id", "user_id", "account_id", "value_minor", "currency", "valuation_date", "notes", "created_at") SELECT "id", "user_id", "account_id", "value_minor", "currency", "valuation_date", "notes", "created_at" FROM `valuation_snapshots`;--> statement-breakpoint
DROP TABLE `valuation_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_valuation_snapshots` RENAME TO `valuation_snapshots`;--> statement-breakpoint
CREATE INDEX `valuations_user_account_date_idx` ON `valuation_snapshots` (`user_id`,`account_id`,`valuation_date`);