-- +goose Up
CREATE TABLE investment_instruments (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id TEXT,
    name TEXT NOT NULL,
    symbol TEXT,
    identifier_type TEXT NOT NULL,
    identifier TEXT,
    exchange_mic TEXT,
    asset_type TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT investment_instruments_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT investment_instruments_user_external_unique UNIQUE (user_id, external_id),
    CONSTRAINT investment_instruments_user_identifier_unique UNIQUE (
        user_id, identifier_type, identifier, exchange_mic
    ),
    CONSTRAINT investment_instruments_identifier_type_check CHECK (
        identifier_type IN ('isin', 'ticker_exchange', 'custom')
    ),
    CONSTRAINT investment_instruments_asset_type_check CHECK (
        asset_type IN ('stock', 'etf', 'fund')
    ),
    CONSTRAINT investment_instruments_currency_check CHECK (quote_currency ~ '^[A-Z]{3}$')
);

CREATE INDEX investment_instruments_user_archived_idx
    ON investment_instruments (user_id, archived_at);

CREATE TABLE account_conversions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_account_id UUID NOT NULL,
    target_account_id UUID NOT NULL,
    conversion_date DATE NOT NULL,
    source_balance_minor BIGINT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT account_conversions_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT account_conversions_user_source_unique UNIQUE (user_id, source_account_id),
    CONSTRAINT account_conversions_user_target_unique UNIQUE (user_id, target_account_id),
    CONSTRAINT account_conversions_user_idempotency_unique UNIQUE (user_id, idempotency_key),
    CONSTRAINT account_conversions_source_fk FOREIGN KEY (user_id, source_account_id)
        REFERENCES accounts(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT account_conversions_target_fk FOREIGN KEY (user_id, target_account_id)
        REFERENCES accounts(user_id, id) ON DELETE CASCADE
);

CREATE TABLE position_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    instrument_id UUID NOT NULL,
    related_instrument_id UUID,
    type TEXT NOT NULL,
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC,
    trade_currency TEXT NOT NULL,
    gross_amount_minor BIGINT,
    fee_amount_minor BIGINT,
    fee_currency TEXT,
    cash_effect_minor BIGINT NOT NULL DEFAULT 0,
    applied_exchange_rate NUMERIC,
    opening_cost_basis_minor BIGINT,
    action_ratio_numerator NUMERIC,
    action_ratio_denominator NUMERIC,
    trade_date DATE NOT NULL,
    event_sequence INTEGER NOT NULL DEFAULT 0,
    settlement_date DATE,
    external_id TEXT,
    event_group_id UUID,
    idempotency_key TEXT,
    description TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT position_events_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT position_events_user_account_external_unique UNIQUE (
        user_id, account_id, external_id
    ),
    CONSTRAINT position_events_user_idempotency_unique UNIQUE (user_id, idempotency_key),
    CONSTRAINT position_events_account_fk FOREIGN KEY (user_id, account_id)
        REFERENCES accounts(user_id, id) ON DELETE CASCADE,
    CONSTRAINT position_events_instrument_fk FOREIGN KEY (user_id, instrument_id)
        REFERENCES investment_instruments(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT position_events_related_instrument_fk FOREIGN KEY (user_id, related_instrument_id)
        REFERENCES investment_instruments(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT position_events_type_check CHECK (
        type IN (
            'opening_position', 'buy', 'sell', 'quantity_adjustment',
            'transfer_in', 'transfer_out', 'split', 'spinoff',
            'merger_in', 'merger_out'
        )
    ),
    CONSTRAINT position_events_trade_currency_check CHECK (trade_currency ~ '^[A-Z]{3}$'),
    CONSTRAINT position_events_fee_currency_check CHECK (
        fee_currency IS NULL OR fee_currency ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT position_events_event_sequence_check CHECK (event_sequence >= 0)
);

CREATE INDEX position_events_user_account_date_idx
    ON position_events (user_id, account_id, trade_date, created_at, id);
CREATE INDEX position_events_user_instrument_date_idx
    ON position_events (user_id, instrument_id, trade_date);

CREATE TABLE security_prices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instrument_id UUID NOT NULL,
    external_id TEXT,
    price NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    effective_date DATE NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    provenance TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT security_prices_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT security_prices_user_instrument_date_unique UNIQUE (
        user_id, instrument_id, effective_date
    ),
    CONSTRAINT security_prices_user_instrument_external_unique UNIQUE (
        user_id, instrument_id, external_id
    ),
    CONSTRAINT security_prices_instrument_fk FOREIGN KEY (user_id, instrument_id)
        REFERENCES investment_instruments(user_id, id) ON DELETE CASCADE,
    CONSTRAINT security_prices_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX security_prices_user_instrument_lookup_idx
    ON security_prices (user_id, instrument_id, effective_date);

CREATE TABLE position_reconciliations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    observation_date DATE NOT NULL,
    reported_cash_minor BIGINT,
    reported_total_minor BIGINT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT position_reconciliations_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT position_reconciliations_account_fk FOREIGN KEY (user_id, account_id)
        REFERENCES accounts(user_id, id) ON DELETE CASCADE
);

CREATE INDEX position_reconciliations_user_account_date_idx
    ON position_reconciliations (user_id, account_id, observation_date);

CREATE TABLE transactions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    type TEXT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT,
    notes TEXT,
    external_id TEXT,
    transfer_group_id UUID,
    event_group_id UUID,
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT transactions_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT transactions_user_idempotency_unique UNIQUE (user_id, idempotency_key),
    CONSTRAINT transactions_user_account_external_unique UNIQUE (user_id, account_id, external_id),
    CONSTRAINT transactions_account_fk FOREIGN KEY (user_id, account_id)
        REFERENCES accounts(user_id, id) ON DELETE CASCADE,
    CONSTRAINT transactions_type_check CHECK (
        type IN (
            'opening_balance', 'deposit', 'withdrawal', 'interest', 'dividend',
            'capital_gain', 'capital_loss', 'fee', 'purchase', 'sale',
            'manual_adjustment', 'liability_payment', 'liability_increase', 'transfer'
        )
    ),
    CONSTRAINT transactions_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX transactions_user_date_created_id_idx
    ON transactions (user_id, transaction_date, created_at, id);
CREATE INDEX transactions_user_account_date_created_id_idx
    ON transactions (user_id, account_id, transaction_date, created_at, id);
CREATE INDEX transactions_user_type_date_created_id_idx
    ON transactions (user_id, type, transaction_date, created_at, id);
CREATE INDEX transactions_user_transfer_group_idx
    ON transactions (user_id, transfer_group_id);
CREATE INDEX transactions_user_event_group_idx
    ON transactions (user_id, event_group_id);

CREATE TABLE valuation_snapshots (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    value_minor BIGINT NOT NULL,
    currency TEXT NOT NULL,
    valuation_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT valuation_snapshots_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT valuation_snapshots_account_fk FOREIGN KEY (user_id, account_id)
        REFERENCES accounts(user_id, id) ON DELETE CASCADE,
    CONSTRAINT valuation_snapshots_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX valuations_user_account_date_idx
    ON valuation_snapshots (user_id, account_id, valuation_date);

CREATE TABLE exchange_rates (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    rate NUMERIC NOT NULL,
    effective_date DATE NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT exchange_rates_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT exchange_rate_user_pair_date_unique UNIQUE (
        user_id, base_currency, quote_currency, effective_date
    ),
    CONSTRAINT exchange_rates_base_currency_check CHECK (base_currency ~ '^[A-Z]{3}$'),
    CONSTRAINT exchange_rates_quote_currency_check CHECK (quote_currency ~ '^[A-Z]{3}$'),
    CONSTRAINT exchange_rates_distinct_currency_check CHECK (base_currency <> quote_currency),
    CONSTRAINT exchange_rates_positive_rate_check CHECK (rate > 0)
);

CREATE INDEX exchange_rate_user_lookup_idx
    ON exchange_rates (user_id, base_currency, quote_currency, effective_date);

CREATE TABLE goals (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    target_amount_minor BIGINT NOT NULL,
    current_amount_minor BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL,
    target_date DATE NOT NULL,
    linked_account_id UUID,
    icon TEXT NOT NULL DEFAULT 'Target',
    status TEXT NOT NULL DEFAULT 'active',
    priority INTEGER NOT NULL DEFAULT 0,
    assumed_annual_return_bps INTEGER NOT NULL DEFAULT 800,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT goals_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT goals_user_account_unique UNIQUE (user_id, linked_account_id),
    CONSTRAINT goals_linked_account_fk FOREIGN KEY (user_id, linked_account_id)
        REFERENCES accounts(user_id, id) ON DELETE SET NULL (linked_account_id),
    CONSTRAINT goals_status_check CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    CONSTRAINT goals_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX goals_user_status_idx ON goals (user_id, status);

CREATE TABLE goal_contribution_plans (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL,
    planned_contribution_minor BIGINT NOT NULL,
    frequency TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT goal_contribution_plans_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT goal_contribution_plans_goal_fk FOREIGN KEY (user_id, goal_id)
        REFERENCES goals(user_id, id) ON DELETE CASCADE,
    CONSTRAINT goal_contribution_plans_frequency_check CHECK (
        frequency IN ('weekly', 'monthly', 'quarterly', 'annually', 'custom')
    ),
    CONSTRAINT goal_contribution_plans_dates_check CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX goal_plans_user_goal_idx ON goal_contribution_plans (user_id, goal_id);

CREATE TABLE goal_milestones (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL,
    name TEXT NOT NULL,
    target_amount_minor BIGINT NOT NULL,
    target_date DATE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT goal_milestones_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT goal_milestones_goal_fk FOREIGN KEY (user_id, goal_id)
        REFERENCES goals(user_id, id) ON DELETE CASCADE
);

CREATE INDEX goal_milestones_user_goal_target_idx
    ON goal_milestones (user_id, goal_id, target_amount_minor);

CREATE TABLE goal_alert_dismissals (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL,
    alert_key TEXT NOT NULL,
    dismissed_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT goal_alert_dismissals_user_goal_key_unique UNIQUE (user_id, goal_id, alert_key),
    CONSTRAINT goal_alert_dismissals_goal_fk FOREIGN KEY (user_id, goal_id)
        REFERENCES goals(user_id, id) ON DELETE CASCADE
);

CREATE INDEX goal_alert_dismissals_user_dismissed_idx
    ON goal_alert_dismissals (user_id, dismissed_at);

CREATE TABLE beneficiaries (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    relationship TEXT,
    contact_summary TEXT,
    notes TEXT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT beneficiaries_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT beneficiaries_kind_check CHECK (kind IN ('person', 'organization', 'trust'))
);

CREATE INDEX beneficiaries_user_archived_idx ON beneficiaries (user_id, archived_at);

CREATE TABLE estate_plans (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'My estate plan',
    jurisdiction TEXT,
    last_reviewed_date DATE,
    review_reminder_date DATE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT estate_plans_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT estate_plans_user_unique UNIQUE (user_id)
);

CREATE TABLE estate_account_directives (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    estate_plan_id UUID NOT NULL,
    account_id UUID NOT NULL,
    is_included BOOLEAN NOT NULL DEFAULT TRUE,
    ownership_share_bps INTEGER NOT NULL DEFAULT 10000,
    transfer_context TEXT NOT NULL DEFAULT 'unknown',
    distribution_method TEXT NOT NULL DEFAULT 'undecided',
    document_reference TEXT,
    notes TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT estate_directives_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT estate_directives_user_plan_account_unique UNIQUE (
        user_id, estate_plan_id, account_id
    ),
    CONSTRAINT estate_directives_user_plan_id_unique UNIQUE (user_id, estate_plan_id, id),
    CONSTRAINT estate_directives_plan_fk FOREIGN KEY (user_id, estate_plan_id)
        REFERENCES estate_plans(user_id, id) ON DELETE CASCADE,
    CONSTRAINT estate_directives_account_fk FOREIGN KEY (user_id, account_id)
        REFERENCES accounts(user_id, id) ON DELETE CASCADE,
    CONSTRAINT estate_directives_ownership_share_check CHECK (
        ownership_share_bps BETWEEN 0 AND 10000
    ),
    CONSTRAINT estate_directives_transfer_context_check CHECK (
        transfer_context IN (
            'estate', 'joint_survivorship', 'provider_designation',
            'trust_entity', 'unknown'
        )
    ),
    CONSTRAINT estate_directives_distribution_method_check CHECK (
        distribution_method IN (
            'transfer_asset', 'sell_and_divide', 'cash_equivalent', 'undecided'
        )
    )
);

CREATE INDEX estate_directives_user_plan_idx
    ON estate_account_directives (user_id, estate_plan_id);

CREATE TABLE estate_allocations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    estate_plan_id UUID NOT NULL,
    directive_id UUID NOT NULL,
    beneficiary_id UUID NOT NULL,
    tier TEXT NOT NULL,
    allocation_bps INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT estate_allocations_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT estate_allocations_user_directive_beneficiary_tier_unique UNIQUE (
        user_id, directive_id, beneficiary_id, tier
    ),
    CONSTRAINT estate_allocations_directive_fk FOREIGN KEY (
        user_id, estate_plan_id, directive_id
    ) REFERENCES estate_account_directives(user_id, estate_plan_id, id) ON DELETE CASCADE,
    CONSTRAINT estate_allocations_beneficiary_fk FOREIGN KEY (user_id, beneficiary_id)
        REFERENCES beneficiaries(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT estate_allocations_tier_check CHECK (tier IN ('primary', 'contingent')),
    CONSTRAINT estate_allocations_bps_check CHECK (allocation_bps BETWEEN 0 AND 10000)
);

CREATE INDEX estate_allocations_user_plan_idx
    ON estate_allocations (user_id, estate_plan_id);

CREATE TABLE estate_residuary_allocations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    estate_plan_id UUID NOT NULL,
    beneficiary_id UUID NOT NULL,
    tier TEXT NOT NULL,
    allocation_bps INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT estate_residuary_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT estate_residuary_user_plan_beneficiary_tier_unique UNIQUE (
        user_id, estate_plan_id, beneficiary_id, tier
    ),
    CONSTRAINT estate_residuary_plan_fk FOREIGN KEY (user_id, estate_plan_id)
        REFERENCES estate_plans(user_id, id) ON DELETE CASCADE,
    CONSTRAINT estate_residuary_beneficiary_fk FOREIGN KEY (user_id, beneficiary_id)
        REFERENCES beneficiaries(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT estate_residuary_tier_check CHECK (tier IN ('primary', 'contingent')),
    CONSTRAINT estate_residuary_bps_check CHECK (allocation_bps BETWEEN 0 AND 10000)
);

CREATE INDEX estate_residuary_user_plan_idx
    ON estate_residuary_allocations (user_id, estate_plan_id);

CREATE TABLE estate_plan_snapshots (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    estate_plan_id UUID NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    value_as_of_date DATE NOT NULL,
    base_currency TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT estate_snapshots_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT estate_snapshots_plan_fk FOREIGN KEY (user_id, estate_plan_id)
        REFERENCES estate_plans(user_id, id) ON DELETE CASCADE,
    CONSTRAINT estate_snapshots_version_check CHECK (version > 0),
    CONSTRAINT estate_snapshots_currency_check CHECK (base_currency ~ '^[A-Z]{3}$')
);

CREATE INDEX estate_snapshots_user_plan_generated_idx
    ON estate_plan_snapshots (user_id, estate_plan_id, generated_at);

CREATE TABLE login_attempts (
    id UUID PRIMARY KEY,
    client_key TEXT NOT NULL,
    succeeded BOOLEAN NOT NULL DEFAULT FALSE,
    attempted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX login_attempt_client_time_idx ON login_attempts (client_key, attempted_at);

CREATE TABLE idempotency_keys (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key UUID NOT NULL,
    operation TEXT NOT NULL,
    result_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT idempotency_user_key_unique UNIQUE (user_id, key)
);

CREATE INDEX idempotency_user_created_idx ON idempotency_keys (user_id, created_at);

CREATE TABLE ai_provider_settings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    encrypted_api_key TEXT,
    api_key_hint TEXT,
    include_exact_amounts BOOLEAN NOT NULL DEFAULT FALSE,
    include_account_names BOOLEAN NOT NULL DEFAULT FALSE,
    monthly_token_limit INTEGER NOT NULL DEFAULT 100000,
    max_output_tokens INTEGER NOT NULL DEFAULT 1200,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ai_provider_settings_user_unique UNIQUE (user_id),
    CONSTRAINT ai_provider_settings_provider_check CHECK (
        provider IN ('openai', 'deepseek', 'custom')
    ),
    CONSTRAINT ai_provider_settings_token_limits_check CHECK (
        monthly_token_limit > 0 AND max_output_tokens > 0
    )
);

CREATE TABLE ai_usage_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    endpoint_host TEXT NOT NULL,
    model TEXT NOT NULL,
    request_type TEXT NOT NULL DEFAULT 'portfolio_review',
    status TEXT NOT NULL,
    billing_month TEXT NOT NULL,
    charged_tokens INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    latency_ms INTEGER,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ai_usage_events_provider_check CHECK (
        provider IN ('openai', 'deepseek', 'custom')
    ),
    CONSTRAINT ai_usage_events_status_check CHECK (
        status IN ('started', 'success', 'error', 'rate_limited', 'budget_exceeded')
    ),
    CONSTRAINT ai_usage_events_billing_month_check CHECK (billing_month ~ '^[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT ai_usage_events_token_counts_check CHECK (
        charged_tokens >= 0
        AND (input_tokens IS NULL OR input_tokens >= 0)
        AND (output_tokens IS NULL OR output_tokens >= 0)
    )
);

CREATE INDEX ai_usage_user_month_idx ON ai_usage_events (user_id, billing_month);
CREATE INDEX ai_usage_user_created_idx ON ai_usage_events (user_id, created_at);

-- +goose Down
DROP TABLE ai_usage_events;
DROP TABLE ai_provider_settings;
DROP TABLE idempotency_keys;
DROP TABLE login_attempts;
DROP TABLE estate_plan_snapshots;
DROP TABLE estate_residuary_allocations;
DROP TABLE estate_allocations;
DROP TABLE estate_account_directives;
DROP TABLE estate_plans;
DROP TABLE beneficiaries;
DROP TABLE goal_alert_dismissals;
DROP TABLE goal_milestones;
DROP TABLE goal_contribution_plans;
DROP TABLE goals;
DROP TABLE exchange_rates;
DROP TABLE valuation_snapshots;
DROP TABLE transactions;
DROP TABLE position_reconciliations;
DROP TABLE security_prices;
DROP TABLE position_events;
DROP TABLE account_conversions;
DROP TABLE investment_instruments;