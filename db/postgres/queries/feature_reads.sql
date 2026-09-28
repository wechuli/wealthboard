-- name: GetFeatureSettings :one
SELECT
    display_name,
    app_name,
    base_currency,
    supported_currencies,
    timezone,
    preferred_date_format,
    default_dashboard_period,
    session_timeout_minutes,
    default_goal_return_bps,
    position_stale_days_stock,
    position_stale_days_etf,
    position_stale_days_fund,
    created_at,
    updated_at
FROM user_settings
WHERE user_id = $1;

-- name: ListReferencedCurrencies :many
SELECT DISTINCT referenced.currency
FROM (
    SELECT accounts.currency FROM accounts WHERE accounts.user_id = $1
    UNION ALL SELECT transactions.currency FROM transactions WHERE transactions.user_id = $1
    UNION ALL SELECT valuation_snapshots.currency FROM valuation_snapshots WHERE valuation_snapshots.user_id = $1
    UNION ALL SELECT goals.currency FROM goals WHERE goals.user_id = $1
    UNION ALL SELECT exchange_rates.base_currency FROM exchange_rates WHERE exchange_rates.user_id = $1
    UNION ALL SELECT exchange_rates.quote_currency FROM exchange_rates WHERE exchange_rates.user_id = $1
    UNION ALL SELECT investment_instruments.quote_currency FROM investment_instruments WHERE investment_instruments.user_id = $1
    UNION ALL SELECT position_events.trade_currency FROM position_events WHERE position_events.user_id = $1
    UNION ALL SELECT position_events.fee_currency FROM position_events WHERE position_events.user_id = $1 AND position_events.fee_currency IS NOT NULL
    UNION ALL SELECT security_prices.currency FROM security_prices WHERE security_prices.user_id = $1
) referenced(currency)
ORDER BY referenced.currency;

-- name: ListFeatureExchangeRates :many
SELECT id, base_currency, quote_currency, rate::TEXT, effective_date, source, created_at
FROM exchange_rates
WHERE user_id = $1
ORDER BY base_currency, quote_currency, effective_date DESC, created_at DESC, id;

-- name: GetFeatureAuthMethodState :one
SELECT status, password_hash IS NOT NULL AS has_password
FROM users
WHERE id = $1;

-- name: ListFeatureOIDCIdentities :many
SELECT id, issuer, created_at, updated_at, last_login_at
FROM oidc_identities
WHERE user_id = $1
ORDER BY issuer, id;

-- name: ListFeatureInstruments :many
SELECT
    instrument.id,
    instrument.external_id,
    instrument.name,
    instrument.symbol,
    instrument.identifier_type,
    instrument.identifier,
    instrument.exchange_mic,
    instrument.asset_type,
    instrument.quote_currency,
    instrument.archived_at,
    instrument.created_at,
    instrument.updated_at,
    price.id AS price_id,
    price.external_id AS price_external_id,
    price.price::TEXT AS price,
    price.currency AS price_currency,
    price.effective_date AS price_effective_date,
    price.source AS price_source,
    price.provenance AS price_provenance,
    price.created_at AS price_created_at,
    price.updated_at AS price_updated_at
FROM investment_instruments instrument
LEFT JOIN LATERAL (
    SELECT security_prices.*
    FROM security_prices
    WHERE security_prices.user_id = instrument.user_id
      AND security_prices.instrument_id = instrument.id
    ORDER BY security_prices.effective_date DESC, security_prices.created_at DESC, security_prices.id
    LIMIT 1
) price ON TRUE
WHERE instrument.user_id = $1
ORDER BY instrument.archived_at NULLS FIRST, instrument.name, instrument.id;

-- name: GetFeatureInstrument :one
SELECT
    id, external_id, name, symbol, identifier_type, identifier, exchange_mic,
    asset_type, quote_currency, archived_at, created_at, updated_at
FROM investment_instruments
WHERE user_id = $1 AND id = $2;

-- name: ListFeatureInstrumentPrices :many
SELECT id, external_id, price::TEXT, currency, effective_date, source, provenance, created_at, updated_at
FROM security_prices
WHERE user_id = $1 AND instrument_id = $2
ORDER BY effective_date DESC, created_at DESC, id;

-- name: GetFeatureEstatePlan :one
SELECT id, title, jurisdiction, last_reviewed_date, review_reminder_date, created_at, updated_at
FROM estate_plans
WHERE user_id = $1;

-- name: ListFeatureBeneficiaries :many
SELECT id, kind, name, relationship, contact_summary, notes, archived_at, created_at, updated_at
FROM beneficiaries
WHERE user_id = $1
ORDER BY archived_at NULLS FIRST, name, id;

-- name: ListFeatureEstateDirectives :many
SELECT
    directive.id,
    directive.estate_plan_id,
    directive.account_id,
    directive.is_included,
    directive.ownership_share_bps,
    directive.transfer_context,
    directive.distribution_method,
    directive.document_reference,
    directive.notes,
    directive.reviewed_at,
    directive.created_at,
    directive.updated_at,
    account.name AS account_name,
    account.currency,
    account.current_value_minor,
    account.is_liability,
    account.archived_at
FROM estate_account_directives directive
JOIN accounts account
  ON account.user_id = directive.user_id
 AND account.id = directive.account_id
WHERE directive.user_id = $1
ORDER BY account.name, directive.id;

-- name: ListFeatureEstateAllocations :many
SELECT id, estate_plan_id, directive_id, beneficiary_id, tier, allocation_bps, notes, created_at, updated_at
FROM estate_allocations
WHERE user_id = $1
ORDER BY directive_id, tier, beneficiary_id, id;

-- name: ListFeatureEstateResiduaryAllocations :many
SELECT id, estate_plan_id, beneficiary_id, tier, allocation_bps, notes, created_at, updated_at
FROM estate_residuary_allocations
WHERE user_id = $1
ORDER BY tier, beneficiary_id, id;

-- name: ListFeatureEstateSnapshots :many
SELECT id, estate_plan_id, version, title, value_as_of_date, base_currency, content_hash, generated_at
FROM estate_plan_snapshots
WHERE user_id = $1
ORDER BY generated_at DESC, id;

-- name: GetFeatureEstateSnapshot :one
SELECT id, estate_plan_id, version, title, value_as_of_date, base_currency, content, content_hash, generated_at
FROM estate_plan_snapshots
WHERE user_id = $1 AND id = $2;

-- name: GetFeatureAIProviderSettings :one
SELECT
    provider,
    base_url,
    model,
    encrypted_api_key IS NOT NULL AS has_stored_api_key,
    api_key_hint,
    include_exact_amounts,
    include_account_names,
    monthly_token_limit,
    max_output_tokens,
    created_at,
    updated_at
FROM ai_provider_settings
WHERE user_id = $1;

-- name: ListFeatureAIUsage :many
SELECT
    id, provider, endpoint_host, model, request_type, status, billing_month,
    charged_tokens, input_tokens, output_tokens, latency_ms, error_code, created_at, updated_at
FROM ai_usage_events
WHERE user_id = $1
ORDER BY created_at DESC, id;
