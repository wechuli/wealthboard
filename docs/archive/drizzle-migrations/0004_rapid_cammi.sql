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
--> statement-breakpoint
CREATE UNIQUE INDEX `beneficiaries_user_id_unique` ON `beneficiaries` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `beneficiaries_user_archived_idx` ON `beneficiaries` (`user_id`,`archived_at`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `estate_directives_user_id_unique` ON `estate_account_directives` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_directives_user_plan_account_unique` ON `estate_account_directives` (`user_id`,`estate_plan_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_directives_user_plan_id_unique` ON `estate_account_directives` (`user_id`,`estate_plan_id`,`id`);--> statement-breakpoint
CREATE INDEX `estate_directives_user_plan_idx` ON `estate_account_directives` (`user_id`,`estate_plan_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `estate_allocations_user_id_unique` ON `estate_allocations` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_allocations_user_directive_beneficiary_tier_unique` ON `estate_allocations` (`user_id`,`directive_id`,`beneficiary_id`,`tier`);--> statement-breakpoint
CREATE INDEX `estate_allocations_user_plan_idx` ON `estate_allocations` (`user_id`,`estate_plan_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `estate_snapshots_user_id_unique` ON `estate_plan_snapshots` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `estate_snapshots_user_plan_generated_idx` ON `estate_plan_snapshots` (`user_id`,`estate_plan_id`,`generated_at`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `estate_plans_user_id_unique` ON `estate_plans` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_plans_user_unique` ON `estate_plans` (`user_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `estate_residuary_user_id_unique` ON `estate_residuary_allocations` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_residuary_user_plan_beneficiary_tier_unique` ON `estate_residuary_allocations` (`user_id`,`estate_plan_id`,`beneficiary_id`,`tier`);--> statement-breakpoint
CREATE INDEX `estate_residuary_user_plan_idx` ON `estate_residuary_allocations` (`user_id`,`estate_plan_id`);