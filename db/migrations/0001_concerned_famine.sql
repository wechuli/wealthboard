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
--> statement-breakpoint
CREATE UNIQUE INDEX `institutions_user_id_unique` ON `institutions` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `institutions_user_name_unique` ON `institutions` (`user_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `institutions_user_archived_idx` ON `institutions` (`user_id`,`archived_at`);--> statement-breakpoint
WITH RECURSIVE `legacy_institution_names` (`user_id`, `name`, `normalized_name`, `created_at`, `updated_at`) AS (
	SELECT
		`user_id`,
		TRIM(REPLACE(REPLACE(REPLACE(`institution`, CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' ')),
		LOWER(TRIM(REPLACE(REPLACE(REPLACE(`institution`, CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '))),
		`created_at`,
		`updated_at`
	FROM `accounts`
	WHERE `institution` IS NOT NULL
	UNION ALL
	SELECT
		`user_id`,
		REPLACE(`name`, '  ', ' '),
		REPLACE(`normalized_name`, '  ', ' '),
		`created_at`,
		`updated_at`
	FROM `legacy_institution_names`
	WHERE INSTR(`normalized_name`, '  ') > 0
),
`normalized_institution_names` AS (
	SELECT `user_id`, `name`, `normalized_name`, `created_at`, `updated_at`
	FROM `legacy_institution_names`
	WHERE INSTR(`normalized_name`, '  ') = 0 AND `normalized_name` <> ''
)
INSERT INTO `institutions` (`id`, `user_id`, `name`, `normalized_name`, `type`, `created_at`, `updated_at`)
SELECT
	LOWER(
		HEX(RANDOMBLOB(4)) || '-' ||
		HEX(RANDOMBLOB(2)) || '-4' || SUBSTR(HEX(RANDOMBLOB(2)), 2) || '-' ||
		SUBSTR('89ab', (RANDOM() & 3) + 1, 1) || SUBSTR(HEX(RANDOMBLOB(2)), 2) || '-' ||
		HEX(RANDOMBLOB(6))
	),
	`user_id`,
	MIN(`name`),
	`normalized_name`,
	'other',
	MIN(`created_at`),
	MAX(`updated_at`)
FROM `normalized_institution_names`
GROUP BY `user_id`, `normalized_name`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
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
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`category_id`) REFERENCES `categories`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`institution_id`) REFERENCES `institutions`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
WITH RECURSIVE `legacy_account_institutions` (`id`, `user_id`, `normalized_name`) AS (
	SELECT
		`id`,
		`user_id`,
		LOWER(TRIM(REPLACE(REPLACE(REPLACE(COALESCE(`institution`, ''), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' ')))
	FROM `accounts`
	UNION ALL
	SELECT `id`, `user_id`, REPLACE(`normalized_name`, '  ', ' ')
	FROM `legacy_account_institutions`
	WHERE INSTR(`normalized_name`, '  ') > 0
),
`normalized_account_institutions` AS (
	SELECT `id`, `user_id`, `normalized_name`
	FROM `legacy_account_institutions`
	WHERE INSTR(`normalized_name`, '  ') = 0
)
INSERT INTO `__new_accounts`("id", "user_id", "name", "description", "category_id", "institution_id", "account_reference", "currency", "current_value_minor", "cost_basis_minor", "is_liability", "is_included_in_net_worth", "goal_id", "notes", "opened_at", "archived_at", "created_at", "updated_at")
SELECT
	`accounts`.`id`,
	`accounts`.`user_id`,
	`accounts`.`name`,
	`accounts`.`description`,
	`accounts`.`category_id`,
	`institutions`.`id`,
	`accounts`.`account_reference`,
	`accounts`.`currency`,
	`accounts`.`current_value_minor`,
	`accounts`.`cost_basis_minor`,
	`accounts`.`is_liability`,
	`accounts`.`is_included_in_net_worth`,
	`accounts`.`goal_id`,
	`accounts`.`notes`,
	`accounts`.`opened_at`,
	`accounts`.`archived_at`,
	`accounts`.`created_at`,
	`accounts`.`updated_at`
FROM `accounts`
INNER JOIN `normalized_account_institutions`
	ON `normalized_account_institutions`.`user_id` = `accounts`.`user_id`
	AND `normalized_account_institutions`.`id` = `accounts`.`id`
LEFT JOIN `institutions`
	ON `institutions`.`user_id` = `accounts`.`user_id`
	AND `institutions`.`normalized_name` = `normalized_account_institutions`.`normalized_name`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_id_unique` ON `accounts` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `accounts_user_category_idx` ON `accounts` (`user_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_goal_idx` ON `accounts` (`user_id`,`goal_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_archived_idx` ON `accounts` (`user_id`,`archived_at`);