CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `accounts_category_idx` ON `accounts` (`category_id`);--> statement-breakpoint
CREATE INDEX `accounts_goal_idx` ON `accounts` (`goal_id`);--> statement-breakpoint
CREATE INDEX `accounts_archived_idx` ON `accounts` (`archived_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`icon` text DEFAULT 'CircleDollarSign' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`asset_or_liability` text DEFAULT 'asset' NOT NULL,
	`description` text,
	`is_liquid` integer DEFAULT false NOT NULL,
	`is_investible` integer DEFAULT true NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` text NOT NULL,
	`effective_date` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_rate_pair_date_unique` ON `exchange_rates` (`base_currency`,`quote_currency`,`effective_date`);--> statement-breakpoint
CREATE INDEX `exchange_rate_lookup_idx` ON `exchange_rates` (`base_currency`,`quote_currency`,`effective_date`);--> statement-breakpoint
CREATE TABLE `goal_contribution_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`planned_contribution_minor` integer NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_plans_goal_idx` ON `goal_contribution_plans` (`goal_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`linked_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `goals_status_idx` ON `goals` (`status`);--> statement-breakpoint
CREATE INDEX `goals_account_idx` ON `goals` (`linked_account_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`result_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_key` text NOT NULL,
	`succeeded` integer DEFAULT false NOT NULL,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempt_client_time_idx` ON `login_attempts` (`client_key`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_group_idx` ON `transactions` (`transfer_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_idempotency_unique` ON `transactions` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`base_currency` text DEFAULT 'KES' NOT NULL,
	`supported_currencies` text DEFAULT '["KES","USD"]' NOT NULL,
	`timezone` text DEFAULT 'Africa/Nairobi' NOT NULL,
	`preferred_date_format` text DEFAULT 'dd MMM yyyy' NOT NULL,
	`app_name` text DEFAULT 'Worthboard' NOT NULL,
	`default_dashboard_period` text DEFAULT '1y' NOT NULL,
	`session_timeout_minutes` integer DEFAULT 10080 NOT NULL,
	`default_goal_return_bps` integer DEFAULT 800 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `valuation_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`value_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`valuation_date` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `valuations_account_date_idx` ON `valuation_snapshots` (`account_id`,`valuation_date`);