-- +goose Up
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    session_version INTEGER NOT NULL DEFAULT 1,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT users_username_unique UNIQUE (username),
    CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
    CONSTRAINT users_session_version_check CHECK (session_version > 0)
);

CREATE TABLE oidc_identities (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    last_login_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT oidc_identities_issuer_subject_unique UNIQUE (issuer, subject),
    CONSTRAINT oidc_identities_user_issuer_unique UNIQUE (user_id, issuer)
);

CREATE INDEX oidc_identities_user_idx ON oidc_identities (user_id);

CREATE TABLE user_settings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    base_currency TEXT NOT NULL DEFAULT 'KES',
    supported_currencies TEXT NOT NULL DEFAULT '["KES","USD","TZS","UGX"]',
    timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    preferred_date_format TEXT NOT NULL DEFAULT 'dd MMM yyyy',
    app_name TEXT NOT NULL DEFAULT 'Wealthboard',
    default_dashboard_period TEXT NOT NULL DEFAULT '1y',
    session_timeout_minutes INTEGER NOT NULL DEFAULT 10080,
    default_goal_return_bps INTEGER NOT NULL DEFAULT 800,
    position_stale_days_stock INTEGER NOT NULL DEFAULT 7,
    position_stale_days_etf INTEGER NOT NULL DEFAULT 7,
    position_stale_days_fund INTEGER NOT NULL DEFAULT 31,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT user_settings_user_unique UNIQUE (user_id),
    CONSTRAINT user_settings_base_currency_check CHECK (base_currency ~ '^[A-Z]{3}$'),
    CONSTRAINT user_settings_session_timeout_check CHECK (session_timeout_minutes > 0),
    CONSTRAINT user_settings_stale_days_check CHECK (
        position_stale_days_stock > 0
        AND position_stale_days_etf > 0
        AND position_stale_days_fund > 0
    )
);

CREATE TABLE categories (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'CircleDollarSign',
    display_order INTEGER NOT NULL DEFAULT 0,
    asset_or_liability TEXT NOT NULL DEFAULT 'asset',
    description TEXT,
    is_liquid BOOLEAN NOT NULL DEFAULT FALSE,
    is_investible BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT categories_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT categories_user_slug_unique UNIQUE (user_id, slug),
    CONSTRAINT categories_asset_or_liability_check CHECK (
        asset_or_liability IN ('asset', 'liability')
    )
);

CREATE TABLE institutions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    website_url TEXT,
    country_code TEXT,
    address TEXT,
    notes TEXT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT institutions_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT institutions_user_name_unique UNIQUE (user_id, normalized_name),
    CONSTRAINT institutions_type_check CHECK (
        type IN (
            'bank', 'credit_union', 'brokerage', 'asset_manager',
            'pension_provider', 'insurer', 'lender', 'digital_wallet',
            'government', 'employer', 'other'
        )
    ),
    CONSTRAINT institutions_country_code_check CHECK (
        country_code IS NULL OR country_code ~ '^[A-Z]{2}$'
    )
);

CREATE INDEX institutions_user_archived_idx ON institutions (user_id, archived_at);

CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category_id UUID NOT NULL,
    institution_id UUID,
    account_reference TEXT,
    currency TEXT NOT NULL,
    tracking_mode TEXT NOT NULL DEFAULT 'balance',
    current_value_minor BIGINT NOT NULL DEFAULT 0,
    cost_basis_minor BIGINT,
    is_liability BOOLEAN NOT NULL DEFAULT FALSE,
    is_included_in_net_worth BOOLEAN NOT NULL DEFAULT TRUE,
    goal_id UUID,
    notes TEXT,
    opened_at DATE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT accounts_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT accounts_category_fk FOREIGN KEY (user_id, category_id)
        REFERENCES categories(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT accounts_institution_fk FOREIGN KEY (user_id, institution_id)
        REFERENCES institutions(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT accounts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT accounts_tracking_mode_check CHECK (tracking_mode IN ('balance', 'positions'))
);

CREATE INDEX accounts_user_category_idx ON accounts (user_id, category_id);
CREATE INDEX accounts_user_goal_idx ON accounts (user_id, goal_id);
CREATE INDEX accounts_user_archived_idx ON accounts (user_id, archived_at);

CREATE TABLE api_keys (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    display_prefix TEXT NOT NULL,
    token_hash BYTEA NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT ARRAY['portfolio:read']::TEXT[],
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT api_keys_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT api_keys_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT api_keys_name_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT api_keys_scopes_check CHECK (
        cardinality(scopes) > 0
        AND scopes <@ ARRAY[
            'portfolio:read',
            'portfolio:write',
            'imports:write',
            'exports:read',
            'ai:invoke'
        ]::TEXT[]
    ),
    CONSTRAINT api_keys_expiry_check CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX api_keys_user_created_idx ON api_keys (user_id, created_at DESC);

-- +goose Down
DROP TABLE api_keys;
DROP TABLE accounts;
DROP TABLE institutions;
DROP TABLE categories;
DROP TABLE user_settings;
DROP TABLE oidc_identities;
DROP TABLE users;