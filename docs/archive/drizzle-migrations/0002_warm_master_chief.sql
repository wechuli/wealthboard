ALTER TABLE `transactions` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_account_external_unique` ON `transactions` (`user_id`,`account_id`,`external_id`);