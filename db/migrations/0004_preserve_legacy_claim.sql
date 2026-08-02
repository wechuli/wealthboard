INSERT INTO `legacy_claims` (
  `id`,
  `settings_id`,
  `password_hash`,
  `session_version`,
  `created_at`
)
SELECT
  'singleton',
  `id`,
  `password_hash`,
  `session_version`,
  `created_at`
FROM `user_settings`
WHERE `id` = 'single-user' AND `user_id` IS NULL
LIMIT 1;