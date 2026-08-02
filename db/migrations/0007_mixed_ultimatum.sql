DELETE FROM `goal_contribution_plans` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `transactions` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `valuation_snapshots` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `goals` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `accounts` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `categories` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `exchange_rates` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `idempotency_keys` WHERE `user_id` IS NULL;
--> statement-breakpoint
DELETE FROM `user_settings` WHERE `user_id` IS NULL;
--> statement-breakpoint
DROP TABLE `legacy_claims`;