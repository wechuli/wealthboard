-- name: GetOverviewSettings :one
SELECT
    display_name,
    app_name,
    base_currency,
    timezone,
    preferred_date_format,
    default_dashboard_period
FROM user_settings
WHERE user_id = $1;

-- name: ListOverviewAccounts :many
SELECT
    accounts.id,
    accounts.name,
    accounts.currency,
    accounts.current_value_minor,
    accounts.is_liability,
    accounts.is_included_in_net_worth,
    categories.name AS category_name,
    categories.is_liquid,
    categories.is_investible,
    COALESCE(institutions.name, '') AS institution_name
FROM accounts
JOIN categories
  ON categories.user_id = accounts.user_id
 AND categories.id = accounts.category_id
LEFT JOIN institutions
  ON institutions.user_id = accounts.user_id
 AND institutions.id = accounts.institution_id
WHERE accounts.user_id = $1
  AND accounts.archived_at IS NULL
ORDER BY accounts.name, accounts.id;

-- name: CountOverviewGoals :one
SELECT count(*)
FROM goals
WHERE user_id = $1
  AND status = 'active';