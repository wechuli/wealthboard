CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
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
CREATE UNIQUE INDEX `accounts_user_id_unique` ON `accounts` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `accounts_user_category_idx` ON `accounts` (`user_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_goal_idx` ON `accounts` (`user_id`,`goal_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_archived_idx` ON `accounts` (`user_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `ai_provider_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`encrypted_api_key` text,
	`api_key_hint` text,
	`include_exact_amounts` integer DEFAULT false NOT NULL,
	`include_account_names` integer DEFAULT false NOT NULL,
	`monthly_token_limit` integer DEFAULT 100000 NOT NULL,
	`max_output_tokens` integer DEFAULT 1200 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_settings_user_unique` ON `ai_provider_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `ai_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`endpoint_host` text NOT NULL,
	`model` text NOT NULL,
	`request_type` text DEFAULT 'portfolio_review' NOT NULL,
	`status` text NOT NULL,
	`billing_month` text NOT NULL,
	`charged_tokens` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_month_idx` ON `ai_usage_events` (`user_id`,`billing_month`);--> statement-breakpoint
CREATE INDEX `ai_usage_user_created_idx` ON `ai_usage_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
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
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_id_unique` ON `categories` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_slug_unique` ON `categories` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` text NOT NULL,
	`effective_date` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_rate_user_pair_date_unique` ON `exchange_rates` (`user_id`,`base_currency`,`quote_currency`,`effective_date`);--> statement-breakpoint
CREATE INDEX `exchange_rate_user_lookup_idx` ON `exchange_rates` (`user_id`,`base_currency`,`quote_currency`,`effective_date`);--> statement-breakpoint
CREATE TABLE `goal_alert_dismissals` (
	`user_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`alert_key` text NOT NULL,
	`dismissed_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`goal_id`) REFERENCES `goals`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_alert_dismissals_user_goal_key_unique` ON `goal_alert_dismissals` (`user_id`,`goal_id`,`alert_key`);--> statement-breakpoint
CREATE INDEX `goal_alert_dismissals_user_dismissed_idx` ON `goal_alert_dismissals` (`user_id`,`dismissed_at`);--> statement-breakpoint
CREATE TABLE `goal_contribution_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
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
CREATE INDEX `goal_plans_user_goal_idx` ON `goal_contribution_plans` (`user_id`,`goal_id`);--> statement-breakpoint
CREATE TABLE `goal_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`name` text NOT NULL,
	`target_amount_minor` integer NOT NULL,
	`target_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`goal_id`) REFERENCES `goals`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_milestones_user_goal_target_idx` ON `goal_milestones` (`user_id`,`goal_id`,`target_amount_minor`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
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
CREATE UNIQUE INDEX `goals_user_id_unique` ON `goals` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `goals_user_status_idx` ON `goals` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `goals_user_account_unique` ON `goals` (`user_id`,`linked_account_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`result_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_user_key_unique` ON `idempotency_keys` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `idempotency_user_created_idx` ON `idempotency_keys` (`user_id`,`created_at`);--> statement-breakpoint
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
	`user_id` text NOT NULL,
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
CREATE INDEX `transactions_user_date_created_id_idx` ON `transactions` (`user_id`,`transaction_date`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_user_account_date_created_id_idx` ON `transactions` (`user_id`,`account_id`,`transaction_date`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_user_type_date_created_id_idx` ON `transactions` (`user_id`,`type`,`transaction_date`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_user_transfer_group_idx` ON `transactions` (`user_id`,`transfer_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_idempotency_unique` ON `transactions` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`base_currency` text DEFAULT 'KES' NOT NULL,
	`supported_currencies` text DEFAULT '["KES","USD","TZS","UGX"]' NOT NULL,
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
CREATE UNIQUE INDEX `user_settings_user_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
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
CREATE TABLE `valuation_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
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
CREATE INDEX `valuations_user_account_date_idx` ON `valuation_snapshots` (`user_id`,`account_id`,`valuation_date`);