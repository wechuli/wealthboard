-- +goose Up
-- AI workflows now run through fixed OpenAI, DeepSeek, and Anthropic
-- endpoints. Operator-approved custom endpoints are no longer supported, so
-- their settings (including any encrypted credential) are removed and those
-- users choose a supported provider again. Historical usage keeps its provider.
DELETE FROM ai_provider_settings WHERE provider NOT IN ('openai', 'deepseek');
ALTER TABLE ai_provider_settings DROP CONSTRAINT ai_provider_settings_provider_check;
ALTER TABLE ai_provider_settings ADD CONSTRAINT ai_provider_settings_provider_check CHECK (
    provider IN ('openai', 'deepseek', 'anthropic')
);
ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_provider_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_provider_check CHECK (
    provider IN ('openai', 'deepseek', 'anthropic', 'custom')
);

-- +goose Down
DELETE FROM ai_provider_settings WHERE provider = 'anthropic';
DELETE FROM ai_usage_events WHERE provider = 'anthropic';
ALTER TABLE ai_provider_settings DROP CONSTRAINT ai_provider_settings_provider_check;
ALTER TABLE ai_provider_settings ADD CONSTRAINT ai_provider_settings_provider_check CHECK (
    provider IN ('openai', 'deepseek', 'custom')
);
ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_provider_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_provider_check CHECK (
    provider IN ('openai', 'deepseek', 'custom')
);
