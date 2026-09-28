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
--> statement-breakpoint
CREATE UNIQUE INDEX `account_conversions_user_id_unique` ON `account_conversions` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_conversions_user_source_unique` ON `account_conversions` (`user_id`,`source_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_conversions_user_target_unique` ON `account_conversions` (`user_id`,`target_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_conversions_user_idempotency_unique` ON `account_conversions` (`user_id`,`idempotency_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_position_events` (
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
--> statement-breakpoint
INSERT INTO `__new_position_events`("id", "user_id", "account_id", "instrument_id", "related_instrument_id", "type", "quantity", "unit_price", "trade_currency", "gross_amount_minor", "fee_amount_minor", "fee_currency", "cash_effect_minor", "applied_exchange_rate", "opening_cost_basis_minor", "action_ratio_numerator", "action_ratio_denominator", "trade_date", "event_sequence", "settlement_date", "external_id", "event_group_id", "idempotency_key", "description", "notes", "created_at", "updated_at") SELECT "id", "user_id", "account_id", "instrument_id", NULL, "type", "quantity", "unit_price", "trade_currency", "gross_amount_minor", "fee_amount_minor", "fee_currency", "cash_effect_minor", "applied_exchange_rate", "opening_cost_basis_minor", NULL, NULL, "trade_date", ROW_NUMBER() OVER (PARTITION BY "user_id", "account_id", "trade_date" ORDER BY "created_at", "id"), "settlement_date", "external_id", "event_group_id", "idempotency_key", "description", "notes", "created_at", "updated_at" FROM `position_events`;--> statement-breakpoint
DROP TABLE `position_events`;--> statement-breakpoint
ALTER TABLE `__new_position_events` RENAME TO `position_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `position_events_user_id_unique` ON `position_events` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `position_events_user_account_external_unique` ON `position_events` (`user_id`,`account_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `position_events_user_idempotency_unique` ON `position_events` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `position_events_user_account_date_idx` ON `position_events` (`user_id`,`account_id`,`trade_date`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `position_events_user_instrument_date_idx` ON `position_events` (`user_id`,`instrument_id`,`trade_date`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `event_group_id` text;--> statement-breakpoint
CREATE INDEX `transactions_user_event_group_idx` ON `transactions` (`user_id`,`event_group_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `position_stale_days_stock` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `position_stale_days_etf` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `position_stale_days_fund` integer DEFAULT 31 NOT NULL;