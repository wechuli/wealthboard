-- name: GetGoalsReportsSettings :one
SELECT base_currency, timezone, position_stale_days_stock, position_stale_days_etf, position_stale_days_fund
FROM user_settings
WHERE user_id = $1;

-- name: ListChartInstruments :many
SELECT id, name, COALESCE(symbol, '') AS symbol, quote_currency, asset_type, archived_at
FROM investment_instruments
WHERE user_id = $1
ORDER BY name, id;

-- name: ListChartPrices :many
SELECT price.instrument_id, instrument.name, COALESCE(instrument.symbol, '') AS symbol,
       instrument.quote_currency, price.price::text AS unit_price, price.effective_date, price.created_at, price.source
FROM security_prices price
JOIN investment_instruments instrument
  ON instrument.user_id = price.user_id AND instrument.id = price.instrument_id
WHERE price.user_id = $1
ORDER BY price.effective_date, price.created_at, price.id;

-- name: ListGoalsReportsGoals :many
SELECT
    goals.id,
    goals.name,
    goals.description,
    goals.target_amount_minor,
    goals.current_amount_minor,
    goals.currency,
    goals.target_date,
    goals.linked_account_id,
    goals.icon,
    goals.status,
    goals.priority,
    goals.assumed_annual_return_bps,
    goals.created_at,
    linked_account.name AS linked_account_name,
    linked_account.currency AS linked_account_currency,
    linked_account.current_value_minor AS linked_account_value_minor,
    plan.planned_contribution_minor,
    plan.frequency,
    plan.start_date,
    plan.end_date
FROM goals
LEFT JOIN accounts AS linked_account
  ON linked_account.user_id = goals.user_id
 AND linked_account.id = goals.linked_account_id
 AND linked_account.archived_at IS NULL
LEFT JOIN LATERAL (
    SELECT
        planned_contribution_minor,
        frequency,
        start_date,
        end_date
    FROM goal_contribution_plans
    WHERE user_id = goals.user_id
      AND goal_id = goals.id
    ORDER BY created_at, id
    LIMIT 1
) AS plan ON TRUE
WHERE goals.user_id = $1
ORDER BY goals.priority, goals.target_date, goals.id;

-- name: GetGoalsReportsGoal :one
SELECT
    goals.id,
    goals.name,
    goals.description,
    goals.target_amount_minor,
    goals.current_amount_minor,
    goals.currency,
    goals.target_date,
    goals.linked_account_id,
    goals.icon,
    goals.status,
    goals.priority,
    goals.assumed_annual_return_bps,
    goals.created_at,
    linked_account.name AS linked_account_name,
    linked_account.currency AS linked_account_currency,
    linked_account.current_value_minor AS linked_account_value_minor,
    plan.planned_contribution_minor,
    plan.frequency,
    plan.start_date,
    plan.end_date
FROM goals
LEFT JOIN accounts AS linked_account
  ON linked_account.user_id = goals.user_id
 AND linked_account.id = goals.linked_account_id
 AND linked_account.archived_at IS NULL
LEFT JOIN LATERAL (
    SELECT
        planned_contribution_minor,
        frequency,
        start_date,
        end_date
    FROM goal_contribution_plans
    WHERE user_id = goals.user_id
      AND goal_id = goals.id
    ORDER BY created_at, id
    LIMIT 1
) AS plan ON TRUE
WHERE goals.user_id = $1
  AND goals.id = $2;

-- name: ListGoalsReportsMilestones :many
SELECT id, goal_id, name, target_amount_minor, target_date
FROM goal_milestones
WHERE user_id = $1
  AND goal_id = $2
ORDER BY target_amount_minor, target_date, id;

-- name: ListGoalsReportsDismissedGoalIDs :many
SELECT goal_id
FROM goal_alert_dismissals
WHERE user_id = $1
  AND alert_key = $2;

-- name: ListGoalsReportsAccounts :many
SELECT
    accounts.id,
    accounts.currency,
    accounts.current_value_minor,
    accounts.is_liability,
    accounts.is_included_in_net_worth,
    categories.name AS category_name,
    categories.is_liquid,
    categories.is_investible,
    COALESCE(institutions.name, 'Unspecified') AS institution_name
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

-- name: CountGoalsReportsGoals :one
SELECT count(*)
FROM goals
WHERE user_id = $1;