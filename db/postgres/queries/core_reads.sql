-- name: GetCoreSettings :one
SELECT
    display_name,
    base_currency,
    supported_currencies,
    timezone,
    preferred_date_format,
    app_name,
    default_dashboard_period,
    session_timeout_minutes,
    default_goal_return_bps,
    position_stale_days_stock,
    position_stale_days_etf,
    position_stale_days_fund
FROM user_settings
WHERE user_id = $1;

-- name: ListCoreCategories :many
SELECT
    id,
    name,
    slug,
    icon,
    display_order,
    asset_or_liability,
    description,
    is_liquid,
    is_investible,
    is_archived,
    is_system
FROM categories
WHERE user_id = $1
ORDER BY display_order, name, id;

-- name: ListCoreInstitutions :many
SELECT
    id,
    name,
    type,
    website_url,
    country_code,
    address,
    notes,
    archived_at
FROM institutions
WHERE user_id = $1
ORDER BY name, id;

-- name: ListCoreAccounts :many
SELECT
    accounts.id,
    accounts.category_id,
    accounts.institution_id,
    accounts.name,
    accounts.description,
    accounts.account_reference,
    accounts.currency,
    accounts.tracking_mode,
    accounts.current_value_minor,
    accounts.cost_basis_minor,
    accounts.is_liability,
    accounts.is_included_in_net_worth,
    accounts.notes,
    accounts.opened_at,
    accounts.archived_at,
    categories.name AS category_name,
    institutions.name AS institution_name
FROM accounts
JOIN categories
  ON categories.user_id = accounts.user_id
 AND categories.id = accounts.category_id
LEFT JOIN institutions
  ON institutions.user_id = accounts.user_id
 AND institutions.id = accounts.institution_id
WHERE accounts.user_id = $1
  AND (
      $2::text = 'all'
      OR ($2::text = 'active' AND accounts.archived_at IS NULL)
      OR ($2::text = 'archived' AND accounts.archived_at IS NOT NULL)
  )
ORDER BY accounts.name, accounts.id;

-- name: GetCoreAccount :one
SELECT
    accounts.id,
    accounts.category_id,
    accounts.institution_id,
    accounts.name,
    accounts.description,
    accounts.account_reference,
    accounts.currency,
    accounts.tracking_mode,
    accounts.current_value_minor,
    accounts.cost_basis_minor,
    accounts.is_liability,
    accounts.is_included_in_net_worth,
    accounts.notes,
    accounts.opened_at,
    accounts.archived_at,
    categories.name AS category_name,
    institutions.name AS institution_name
FROM accounts
JOIN categories
  ON categories.user_id = accounts.user_id
 AND categories.id = accounts.category_id
LEFT JOIN institutions
  ON institutions.user_id = accounts.user_id
 AND institutions.id = accounts.institution_id
WHERE accounts.user_id = $1
  AND accounts.id = $2;

-- name: ListCoreTransactions :many
SELECT
    transactions.id,
    transactions.account_id,
    accounts.name AS account_name,
    transactions.type,
    transactions.amount_minor,
    transactions.currency,
    transactions.transaction_date,
    transactions.description,
    transactions.notes,
    transactions.external_id,
    transactions.transfer_group_id,
    transactions.event_group_id
FROM transactions
JOIN accounts
  ON accounts.user_id = transactions.user_id
 AND accounts.id = transactions.account_id
WHERE transactions.user_id = $1
  AND ($2::uuid IS NULL OR transactions.account_id = $2)
  AND ($3::text IS NULL OR transactions.type = $3)
  AND ($4::date IS NULL OR transactions.transaction_date >= $4)
  AND ($5::date IS NULL OR transactions.transaction_date <= $5)
ORDER BY transactions.transaction_date DESC, transactions.created_at DESC, transactions.id DESC
LIMIT $6 OFFSET $7;

-- name: ListCoreValuations :many
SELECT
    valuation_snapshots.id,
    valuation_snapshots.account_id,
    accounts.name AS account_name,
    valuation_snapshots.value_minor,
    valuation_snapshots.currency,
    valuation_snapshots.valuation_date,
    valuation_snapshots.notes
FROM valuation_snapshots
JOIN accounts
  ON accounts.user_id = valuation_snapshots.user_id
 AND accounts.id = valuation_snapshots.account_id
WHERE valuation_snapshots.user_id = $1
  AND valuation_snapshots.account_id = $2
  AND ($3::date IS NULL OR valuation_snapshots.valuation_date >= $3)
  AND ($4::date IS NULL OR valuation_snapshots.valuation_date <= $4)
ORDER BY valuation_snapshots.valuation_date DESC,
         valuation_snapshots.created_at DESC,
         valuation_snapshots.id DESC
LIMIT $5 OFFSET $6;

-- name: ListCoreAccountActivity :many
SELECT
    kind,
    id,
    account_id,
    account_name,
    type,
    amount_minor,
    currency,
    activity_date,
    description,
    notes,
    instrument_id,
    instrument_name,
    instrument_symbol,
    quantity,
    unit_price,
    event_group_id::text AS event_group_id
FROM (
    SELECT
        'transaction'::text AS kind,
        transactions.id,
        transactions.account_id,
        accounts.name AS account_name,
        transactions.type,
        transactions.amount_minor,
        transactions.currency,
        transactions.transaction_date AS activity_date,
        transactions.description,
        transactions.notes,
        transactions.created_at,
        ''::text AS instrument_id,
        ''::text AS instrument_name,
        ''::text AS instrument_symbol,
        ''::text AS quantity,
        ''::text AS unit_price,
        COALESCE(transactions.event_group_id::text, '') AS event_group_id
    FROM transactions
    JOIN accounts
      ON accounts.user_id = transactions.user_id
     AND accounts.id = transactions.account_id
    WHERE transactions.user_id = sqlc.arg(user_id)
      AND transactions.account_id = sqlc.arg(account_id)

    UNION ALL

    SELECT
        'valuation'::text AS kind,
        valuation_snapshots.id,
        valuation_snapshots.account_id,
        accounts.name AS account_name,
        'valuation'::text AS type,
        valuation_snapshots.value_minor AS amount_minor,
        valuation_snapshots.currency,
        valuation_snapshots.valuation_date AS activity_date,
        NULL::text AS description,
        valuation_snapshots.notes,
        valuation_snapshots.created_at,
        ''::text AS instrument_id,
        ''::text AS instrument_name,
        ''::text AS instrument_symbol,
        ''::text AS quantity,
        ''::text AS unit_price,
        ''::text AS event_group_id
    FROM valuation_snapshots
    JOIN accounts
      ON accounts.user_id = valuation_snapshots.user_id
     AND accounts.id = valuation_snapshots.account_id
    WHERE valuation_snapshots.user_id = sqlc.arg(user_id)
      AND valuation_snapshots.account_id = sqlc.arg(account_id)

    UNION ALL

    SELECT
        'position'::text AS kind,
        event.id,
        event.account_id,
        accounts.name AS account_name,
        event.type,
        event.cash_effect_minor AS amount_minor,
        accounts.currency,
        event.trade_date AS activity_date,
        event.description,
        event.notes,
        event.created_at,
        instrument.id::text AS instrument_id,
        instrument.name AS instrument_name,
        COALESCE(instrument.symbol, '') AS instrument_symbol,
        event.quantity::text,
        COALESCE(event.unit_price::text, '') AS unit_price,
        COALESCE(event.event_group_id::text, '') AS event_group_id
    FROM position_events event
    JOIN accounts ON accounts.user_id = event.user_id AND accounts.id = event.account_id
    JOIN investment_instruments instrument
      ON instrument.user_id = event.user_id AND instrument.id = event.instrument_id
    WHERE event.user_id = sqlc.arg(user_id)
      AND event.account_id = sqlc.arg(account_id)

    UNION ALL

    SELECT
        'price'::text AS kind,
        price.id,
        accounts.id AS account_id,
        accounts.name AS account_name,
        'security_price'::text AS type,
        0::bigint AS amount_minor,
        price.currency,
        price.effective_date AS activity_date,
        price.source AS description,
        NULL::text AS notes,
        price.created_at,
        instrument.id::text AS instrument_id,
        instrument.name AS instrument_name,
        COALESCE(instrument.symbol, '') AS instrument_symbol,
        ''::text AS quantity,
        price.price::text AS unit_price,
        ''::text AS event_group_id
    FROM security_prices price
    JOIN investment_instruments instrument
      ON instrument.user_id = price.user_id AND instrument.id = price.instrument_id
    JOIN accounts ON accounts.user_id = price.user_id AND accounts.id = sqlc.arg(account_id)
    WHERE price.user_id = sqlc.arg(user_id)
      AND EXISTS (
          SELECT 1 FROM position_events event
          WHERE event.user_id = price.user_id AND event.account_id = accounts.id
            AND (event.instrument_id = price.instrument_id OR event.related_instrument_id = price.instrument_id)
      )
) AS activity
WHERE (sqlc.narg(from_date)::date IS NULL OR activity_date >= sqlc.narg(from_date))
  AND (sqlc.narg(to_date)::date IS NULL OR activity_date <= sqlc.narg(to_date))
ORDER BY activity_date DESC, created_at DESC, kind DESC, id DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);