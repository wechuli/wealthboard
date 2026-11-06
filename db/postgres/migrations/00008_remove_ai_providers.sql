-- +goose Up
-- Bring-your-own-key AI providers and AI import conversion were removed; AI
-- assistants connect over MCP instead. Stored provider settings, encrypted
-- provider keys, and usage metadata have no remaining reader.
DROP TABLE ai_usage_events;
DROP TABLE ai_provider_settings;

-- The ai:invoke API key scope authorized only the removed conversion endpoint.
-- Keys keep their other scopes; keys that had no other scope grant nothing and
-- are deleted rather than left with an empty (default read) scope list.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
UPDATE api_keys SET scopes = scopes - 'ai:invoke' WHERE scopes ? 'ai:invoke';
DELETE FROM api_keys WHERE jsonb_array_length(scopes) = 0;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check CHECK (
    jsonb_typeof(scopes) = 'array'
    AND jsonb_array_length(scopes) > 0
    AND scopes <@ '["portfolio:read","portfolio:write","imports:write","exports:read"]'::JSONB
);

-- +goose Down
-- Rolling back restores empty tables and the scope; removed settings, usage,
-- and deleted keys are not recovered.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check CHECK (
    jsonb_typeof(scopes) = 'array'
    AND jsonb_array_length(scopes) > 0
    AND scopes <@ '["portfolio:read","portfolio:write","imports:write","exports:read","ai:invoke"]'::JSONB
);

CREATE TABLE ai_provider_settings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    encrypted_api_key TEXT,
    api_key_hint TEXT,
    monthly_token_limit INTEGER NOT NULL DEFAULT 100000,
    max_output_tokens INTEGER NOT NULL DEFAULT 1200,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ai_provider_settings_user_unique UNIQUE (user_id),
    CONSTRAINT ai_provider_settings_provider_check CHECK (
        provider IN ('openai', 'deepseek', 'anthropic')
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
    request_type TEXT NOT NULL DEFAULT 'import_conversion',
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
        provider IN ('openai', 'deepseek', 'anthropic', 'custom')
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
