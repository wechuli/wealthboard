DROP INDEX `goals_account_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `goals_account_unique` ON `goals` (`linked_account_id`);