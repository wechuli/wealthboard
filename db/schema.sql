CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_key` text NOT NULL,
	`succeeded` integer DEFAULT false NOT NULL,
	`attempted_at` text NOT NULL
);

CREATE TABLE "users" (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'active' NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

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

CREATE TABLE `beneficiaries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`relationship` text,
	`contact_summary` text,
	`notes` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE `estate_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT 'My estate plan' NOT NULL,
	`jurisdiction` text,
	`last_reviewed_date` text,
	`review_reminder_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE `idempotency_keys` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`result_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `institutions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`website_url` text,
	`country_code` text,
	`address` text,
	`notes` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `investment_instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`symbol` text,
	`identifier_type` text NOT NULL,
	`identifier` text,
	`exchange_mic` text,
	`asset_type` text NOT NULL,
	`quote_currency` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `oidc_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_login_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

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
	`updated_at` text NOT NULL, `position_stale_days_stock` integer DEFAULT 7 NOT NULL, `position_stale_days_etf` integer DEFAULT 7 NOT NULL, `position_stale_days_fund` integer DEFAULT 31 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "accounts" (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category_id` text NOT NULL,
	`institution_id` text,
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
	`updated_at` text NOT NULL, `tracking_mode` text DEFAULT 'balance' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`category_id`) REFERENCES `categories`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`institution_id`) REFERENCES `institutions`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict
);

CREATE TABLE `estate_plan_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`estate_plan_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`value_as_of_date` text NOT NULL,
	`base_currency` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`generated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`estate_plan_id`) REFERENCES `estate_plans`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `estate_residuary_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`estate_plan_id` text NOT NULL,
	`beneficiary_id` text NOT NULL,
	`tier` text NOT NULL,
	`allocation_bps` integer NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`estate_plan_id`) REFERENCES `estate_plans`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`beneficiary_id`) REFERENCES `beneficiaries`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict
);

CREATE TABLE `security_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`external_id` text,
	`price` text NOT NULL,
	`currency` text NOT NULL,
	`effective_date` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`provenance` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`instrument_id`) REFERENCES `investment_instruments`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `account_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_account_id` text NOT NULL,
	`target_account_id` text NOT NULL,
	`conversion_date` text NOT NULL,
	`source_balance_minor` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`source_account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`target_account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `estate_account_directives` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`estate_plan_id` text NOT NULL,
	`account_id` text NOT NULL,
	`is_included` integer DEFAULT true NOT NULL,
	`ownership_share_bps` integer DEFAULT 10000 NOT NULL,
	`transfer_context` text DEFAULT 'unknown' NOT NULL,
	`distribution_method` text DEFAULT 'undecided' NOT NULL,
	`document_reference` text,
	`notes` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`estate_plan_id`) REFERENCES `estate_plans`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE "position_events" (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`related_instrument_id` text,
	`type` text NOT NULL,
	`quantity` text NOT NULL,
	`unit_price` text,
	`trade_currency` text NOT NULL,
	`gross_amount_minor` integer,
	`fee_amount_minor` integer,
	`fee_currency` text,
	`cash_effect_minor` integer DEFAULT 0 NOT NULL,
	`applied_exchange_rate` text,
	`opening_cost_basis_minor` integer,
	`action_ratio_numerator` text,
	`action_ratio_denominator` text,
	`trade_date` text NOT NULL,
	`event_sequence` integer DEFAULT 0 NOT NULL,
	`settlement_date` text,
	`external_id` text,
	`event_group_id` text,
	`idempotency_key` text,
	`description` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`instrument_id`) REFERENCES `investment_instruments`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`related_instrument_id`) REFERENCES `investment_instruments`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict
);

CREATE TABLE `position_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`observation_date` text NOT NULL,
	`reported_cash_minor` integer,
	`reported_total_minor` integer NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

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
	`updated_at` text NOT NULL, `external_id` text, `event_group_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`account_id`) REFERENCES `accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE `estate_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`estate_plan_id` text NOT NULL,
	`directive_id` text NOT NULL,
	`beneficiary_id` text NOT NULL,
	`tier` text NOT NULL,
	`allocation_bps` integer NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`estate_plan_id`,`directive_id`) REFERENCES `estate_account_directives`(`user_id`,`estate_plan_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`beneficiary_id`) REFERENCES `beneficiaries`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict
);

CREATE TABLE `goal_alert_dismissals` (
	`user_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`alert_key` text NOT NULL,
	`dismissed_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`goal_id`) REFERENCES `goals`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE UNIQUE INDEX `account_conversions_user_id_unique` ON `account_conversions` (`user_id`,`id`);

CREATE UNIQUE INDEX `account_conversions_user_idempotency_unique` ON `account_conversions` (`user_id`,`idempotency_key`);

CREATE UNIQUE INDEX `account_conversions_user_source_unique` ON `account_conversions` (`user_id`,`source_account_id`);

CREATE UNIQUE INDEX `account_conversions_user_target_unique` ON `account_conversions` (`user_id`,`target_account_id`);

CREATE INDEX `accounts_user_archived_idx` ON `accounts` (`user_id`,`archived_at`);

CREATE INDEX `accounts_user_category_idx` ON `accounts` (`user_id`,`category_id`);

CREATE INDEX `accounts_user_goal_idx` ON `accounts` (`user_id`,`goal_id`);

CREATE UNIQUE INDEX `accounts_user_id_unique` ON `accounts` (`user_id`,`id`);

CREATE UNIQUE INDEX `ai_provider_settings_user_unique` ON `ai_provider_settings` (`user_id`);

CREATE INDEX `ai_usage_user_created_idx` ON `ai_usage_events` (`user_id`,`created_at`);

CREATE INDEX `ai_usage_user_month_idx` ON `ai_usage_events` (`user_id`,`billing_month`);

CREATE INDEX `beneficiaries_user_archived_idx` ON `beneficiaries` (`user_id`,`archived_at`);

CREATE UNIQUE INDEX `beneficiaries_user_id_unique` ON `beneficiaries` (`user_id`,`id`);

CREATE UNIQUE INDEX `categories_user_id_unique` ON `categories` (`user_id`,`id`);

CREATE UNIQUE INDEX `categories_user_slug_unique` ON `categories` (`user_id`,`slug`);

CREATE UNIQUE INDEX `estate_allocations_user_directive_beneficiary_tier_unique` ON `estate_allocations` (`user_id`,`directive_id`,`beneficiary_id`,`tier`);

CREATE UNIQUE INDEX `estate_allocations_user_id_unique` ON `estate_allocations` (`user_id`,`id`);

CREATE INDEX `estate_allocations_user_plan_idx` ON `estate_allocations` (`user_id`,`estate_plan_id`);

CREATE UNIQUE INDEX `estate_directives_user_id_unique` ON `estate_account_directives` (`user_id`,`id`);

CREATE UNIQUE INDEX `estate_directives_user_plan_account_unique` ON `estate_account_directives` (`user_id`,`estate_plan_id`,`account_id`);

CREATE UNIQUE INDEX `estate_directives_user_plan_id_unique` ON `estate_account_directives` (`user_id`,`estate_plan_id`,`id`);

CREATE INDEX `estate_directives_user_plan_idx` ON `estate_account_directives` (`user_id`,`estate_plan_id`);

CREATE UNIQUE INDEX `estate_plans_user_id_unique` ON `estate_plans` (`user_id`,`id`);

CREATE UNIQUE INDEX `estate_plans_user_unique` ON `estate_plans` (`user_id`);

CREATE UNIQUE INDEX `estate_residuary_user_id_unique` ON `estate_residuary_allocations` (`user_id`,`id`);

CREATE UNIQUE INDEX `estate_residuary_user_plan_beneficiary_tier_unique` ON `estate_residuary_allocations` (`user_id`,`estate_plan_id`,`beneficiary_id`,`tier`);

CREATE INDEX `estate_residuary_user_plan_idx` ON `estate_residuary_allocations` (`user_id`,`estate_plan_id`);

CREATE UNIQUE INDEX `estate_snapshots_user_id_unique` ON `estate_plan_snapshots` (`user_id`,`id`);

CREATE INDEX `estate_snapshots_user_plan_generated_idx` ON `estate_plan_snapshots` (`user_id`,`estate_plan_id`,`generated_at`);

CREATE INDEX `exchange_rate_user_lookup_idx` ON `exchange_rates` (`user_id`,`base_currency`,`quote_currency`,`effective_date`);

CREATE UNIQUE INDEX `exchange_rate_user_pair_date_unique` ON `exchange_rates` (`user_id`,`base_currency`,`quote_currency`,`effective_date`);

CREATE INDEX `goal_alert_dismissals_user_dismissed_idx` ON `goal_alert_dismissals` (`user_id`,`dismissed_at`);

CREATE UNIQUE INDEX `goal_alert_dismissals_user_goal_key_unique` ON `goal_alert_dismissals` (`user_id`,`goal_id`,`alert_key`);

CREATE INDEX `goal_milestones_user_goal_target_idx` ON `goal_milestones` (`user_id`,`goal_id`,`target_amount_minor`);

CREATE INDEX `goal_plans_user_goal_idx` ON `goal_contribution_plans` (`user_id`,`goal_id`);

CREATE UNIQUE INDEX `goals_user_account_unique` ON `goals` (`user_id`,`linked_account_id`);

CREATE UNIQUE INDEX `goals_user_id_unique` ON `goals` (`user_id`,`id`);

CREATE INDEX `goals_user_status_idx` ON `goals` (`user_id`,`status`);

CREATE INDEX `idempotency_user_created_idx` ON `idempotency_keys` (`user_id`,`created_at`);

CREATE UNIQUE INDEX `idempotency_user_key_unique` ON `idempotency_keys` (`user_id`,`key`);

CREATE INDEX `institutions_user_archived_idx` ON `institutions` (`user_id`,`archived_at`);

CREATE UNIQUE INDEX `institutions_user_id_unique` ON `institutions` (`user_id`,`id`);

CREATE UNIQUE INDEX `institutions_user_name_unique` ON `institutions` (`user_id`,`normalized_name`);

CREATE INDEX `investment_instruments_user_archived_idx` ON `investment_instruments` (`user_id`,`archived_at`);

CREATE UNIQUE INDEX `investment_instruments_user_external_unique` ON `investment_instruments` (`user_id`,`external_id`);

CREATE UNIQUE INDEX `investment_instruments_user_id_unique` ON `investment_instruments` (`user_id`,`id`);

CREATE UNIQUE INDEX `investment_instruments_user_identifier_unique` ON `investment_instruments` (`user_id`,`identifier_type`,`identifier`,`exchange_mic`);

CREATE INDEX `login_attempt_client_time_idx` ON `login_attempts` (`client_key`,`attempted_at`);

CREATE UNIQUE INDEX `oidc_identities_issuer_subject_unique` ON `oidc_identities` (`issuer`,`subject`);

CREATE INDEX `oidc_identities_user_idx` ON `oidc_identities` (`user_id`);

CREATE UNIQUE INDEX `oidc_identities_user_issuer_unique` ON `oidc_identities` (`user_id`,`issuer`);

CREATE INDEX `position_events_user_account_date_idx` ON `position_events` (`user_id`,`account_id`,`trade_date`,`created_at`,`id`);

CREATE UNIQUE INDEX `position_events_user_account_external_unique` ON `position_events` (`user_id`,`account_id`,`external_id`);

CREATE UNIQUE INDEX `position_events_user_id_unique` ON `position_events` (`user_id`,`id`);

CREATE UNIQUE INDEX `position_events_user_idempotency_unique` ON `position_events` (`user_id`,`idempotency_key`);

CREATE INDEX `position_events_user_instrument_date_idx` ON `position_events` (`user_id`,`instrument_id`,`trade_date`);

CREATE INDEX `position_reconciliations_user_account_date_idx` ON `position_reconciliations` (`user_id`,`account_id`,`observation_date`);

CREATE UNIQUE INDEX `position_reconciliations_user_id_unique` ON `position_reconciliations` (`user_id`,`id`);

CREATE UNIQUE INDEX `security_prices_user_id_unique` ON `security_prices` (`user_id`,`id`);

CREATE UNIQUE INDEX `security_prices_user_instrument_date_unique` ON `security_prices` (`user_id`,`instrument_id`,`effective_date`);

CREATE UNIQUE INDEX `security_prices_user_instrument_external_unique` ON `security_prices` (`user_id`,`instrument_id`,`external_id`);

CREATE INDEX `security_prices_user_instrument_lookup_idx` ON `security_prices` (`user_id`,`instrument_id`,`effective_date`);

CREATE INDEX `transactions_user_account_date_created_id_idx` ON `transactions` (`user_id`,`account_id`,`transaction_date`,`created_at`,`id`);

CREATE UNIQUE INDEX `transactions_user_account_external_unique` ON `transactions` (`user_id`,`account_id`,`external_id`);

CREATE INDEX `transactions_user_date_created_id_idx` ON `transactions` (`user_id`,`transaction_date`,`created_at`,`id`);

CREATE INDEX `transactions_user_event_group_idx` ON `transactions` (`user_id`,`event_group_id`);

CREATE UNIQUE INDEX `transactions_user_idempotency_unique` ON `transactions` (`user_id`,`idempotency_key`);

CREATE INDEX `transactions_user_transfer_group_idx` ON `transactions` (`user_id`,`transfer_group_id`);

CREATE INDEX `transactions_user_type_date_created_id_idx` ON `transactions` (`user_id`,`type`,`transaction_date`,`created_at`,`id`);

CREATE UNIQUE INDEX `user_settings_user_unique` ON `user_settings` (`user_id`);

CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);

CREATE INDEX `valuations_user_account_date_idx` ON `valuation_snapshots` (`user_id`,`account_id`,`valuation_date`);
