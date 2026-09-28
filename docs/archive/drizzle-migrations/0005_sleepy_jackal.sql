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
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_instruments_user_id_unique` ON `investment_instruments` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `investment_instruments_user_external_unique` ON `investment_instruments` (`user_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `investment_instruments_user_identifier_unique` ON `investment_instruments` (`user_id`,`identifier_type`,`identifier`,`exchange_mic`);--> statement-breakpoint
CREATE INDEX `investment_instruments_user_archived_idx` ON `investment_instruments` (`user_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `position_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
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
	`trade_date` text NOT NULL,
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
	FOREIGN KEY (`user_id`,`instrument_id`) REFERENCES `investment_instruments`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `position_events_user_id_unique` ON `position_events` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `position_events_user_account_external_unique` ON `position_events` (`user_id`,`account_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `position_events_user_idempotency_unique` ON `position_events` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `position_events_user_account_date_idx` ON `position_events` (`user_id`,`account_id`,`trade_date`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `position_events_user_instrument_date_idx` ON `position_events` (`user_id`,`instrument_id`,`trade_date`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `position_reconciliations_user_id_unique` ON `position_reconciliations` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `position_reconciliations_user_account_date_idx` ON `position_reconciliations` (`user_id`,`account_id`,`observation_date`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `security_prices_user_id_unique` ON `security_prices` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `security_prices_user_instrument_date_unique` ON `security_prices` (`user_id`,`instrument_id`,`effective_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `security_prices_user_instrument_external_unique` ON `security_prices` (`user_id`,`instrument_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `security_prices_user_instrument_lookup_idx` ON `security_prices` (`user_id`,`instrument_id`,`effective_date`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `tracking_mode` text DEFAULT 'balance' NOT NULL;