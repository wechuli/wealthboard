-- +goose Up
-- The in-app AI portfolio review was removed. Its per-user sharing preferences
-- have no remaining reader, and import conversion is now the only AI request.
-- Historical portfolio_review usage rows stay until the 90-day usage pruning.
ALTER TABLE ai_provider_settings DROP COLUMN include_exact_amounts;
ALTER TABLE ai_provider_settings DROP COLUMN include_account_names;
ALTER TABLE ai_usage_events ALTER COLUMN request_type SET DEFAULT 'import_conversion';

-- +goose Down
-- Restored preferences return to the previous private default.
ALTER TABLE ai_usage_events ALTER COLUMN request_type SET DEFAULT 'portfolio_review';
ALTER TABLE ai_provider_settings ADD COLUMN include_account_names BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_provider_settings ADD COLUMN include_exact_amounts BOOLEAN NOT NULL DEFAULT FALSE;
