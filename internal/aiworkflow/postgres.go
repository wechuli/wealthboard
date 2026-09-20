package aiworkflow

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/google/uuid"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (repository *PostgresRepository) GetSettings(ctx context.Context, userID uuid.UUID) (*Settings, error) {
	return scanSettings(repository.db.QueryRowContext(ctx, `
SELECT provider, base_url, model, encrypted_api_key, api_key_hint,
       include_exact_amounts, include_account_names, monthly_token_limit,
       max_output_tokens, updated_at
FROM ai_provider_settings
WHERE user_id = $1`, userID))
}

func (repository *PostgresRepository) SaveSettings(ctx context.Context, userID uuid.UUID, input SettingsInput) (*Settings, error) {
	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
INSERT INTO ai_provider_settings (
    id, user_id, provider, base_url, model, include_exact_amounts,
    include_account_names, monthly_token_limit, max_output_tokens, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
ON CONFLICT (user_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    base_url = EXCLUDED.base_url,
    model = EXCLUDED.model,
    include_exact_amounts = EXCLUDED.include_exact_amounts,
    include_account_names = EXCLUDED.include_account_names,
    monthly_token_limit = EXCLUDED.monthly_token_limit,
    max_output_tokens = EXCLUDED.max_output_tokens,
    updated_at = EXCLUDED.updated_at`,
		uuid.New(), userID, input.Provider, input.BaseURL, input.Model,
		input.IncludeExactAmounts, input.IncludeAccountNames, input.MonthlyTokenLimit,
		input.MaxOutputTokens, now)
	if err != nil {
		return nil, fmt.Errorf("save AI settings: %w", err)
	}
	return repository.GetSettings(ctx, userID)
}

func (repository *PostgresRepository) SaveCredential(ctx context.Context, userID uuid.UUID, encrypted, hint string) error {
	result, err := repository.db.ExecContext(ctx, `
UPDATE ai_provider_settings
SET encrypted_api_key = $2, api_key_hint = $3, updated_at = $4
WHERE user_id = $1`, userID, encrypted, hint, time.Now().UTC())
	return requireChanged(result, err, "save AI credential")
}

func (repository *PostgresRepository) DeleteCredential(ctx context.Context, userID uuid.UUID) error {
	result, err := repository.db.ExecContext(ctx, `
UPDATE ai_provider_settings
SET encrypted_api_key = NULL, api_key_hint = NULL, updated_at = $2
WHERE user_id = $1`, userID, time.Now().UTC())
	return requireChanged(result, err, "delete AI credential")
}

func (repository *PostgresRepository) DeleteSettings(ctx context.Context, userID uuid.UUID) error {
	result, err := repository.db.ExecContext(ctx, `DELETE FROM ai_provider_settings WHERE user_id = $1`, userID)
	return requireChanged(result, err, "disconnect AI provider")
}

func (repository *PostgresRepository) ClearUsage(ctx context.Context, userID uuid.UUID) (int64, error) {
	result, err := repository.db.ExecContext(ctx, `DELETE FROM ai_usage_events WHERE user_id = $1`, userID)
	if err != nil {
		return 0, fmt.Errorf("clear AI usage: %w", err)
	}
	return result.RowsAffected()
}

func (repository *PostgresRepository) ReserveUsage(ctx context.Context, userID uuid.UUID, estimatedTokens int, requestType string, now time.Time) (Reservation, error) {
	if estimatedTokens <= 0 {
		return Reservation{}, fmt.Errorf("%w: token reservation must be positive", ErrInvalidInput)
	}
	transaction, err := repository.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return Reservation{}, fmt.Errorf("begin AI usage reservation: %w", err)
	}
	defer transaction.Rollback()
	var provider Provider
	var baseURL, model string
	var monthlyLimit int
	if err := transaction.QueryRowContext(ctx, `
SELECT provider, base_url, model, monthly_token_limit
FROM ai_provider_settings
WHERE user_id = $1
FOR UPDATE`, userID).Scan(&provider, &baseURL, &model, &monthlyLimit); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Reservation{}, ErrNotConfigured
		}
		return Reservation{}, fmt.Errorf("lock AI settings: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, `DELETE FROM ai_usage_events WHERE user_id = $1 AND created_at < $2`, userID, now.Add(-90*24*time.Hour)); err != nil {
		return Reservation{}, fmt.Errorf("prune AI usage: %w", err)
	}
	var recent int
	if err := transaction.QueryRowContext(ctx, `
SELECT count(*)
FROM ai_usage_events
WHERE user_id = $1
  AND status IN ('started', 'success', 'error')
  AND created_at > $2`, userID, now.Add(-time.Minute)).Scan(&recent); err != nil {
		return Reservation{}, fmt.Errorf("count recent AI usage: %w", err)
	}
	host := endpointHost(baseURL)
	month := now.Format("2006-01")
	if recent >= 10 {
		if err := insertUsage(ctx, transaction, UsageEvent{ID: uuid.New(), UserID: userID, Provider: provider, EndpointHost: host, Model: model, RequestType: requestType, Status: "rate_limited", BillingMonth: month, ErrorCode: stringPointer("cooldown"), CreatedAt: now, UpdatedAt: now}); err != nil {
			return Reservation{}, err
		}
		if err := transaction.Commit(); err != nil {
			return Reservation{}, fmt.Errorf("record AI rate limit: %w", err)
		}
		return Reservation{}, ErrRateLimited
	}
	var used int
	if err := transaction.QueryRowContext(ctx, `
SELECT COALESCE(sum(charged_tokens), 0)
FROM ai_usage_events
WHERE user_id = $1 AND billing_month = $2`, userID, month).Scan(&used); err != nil {
		return Reservation{}, fmt.Errorf("sum AI usage: %w", err)
	}
	if used+estimatedTokens > monthlyLimit {
		if err := insertUsage(ctx, transaction, UsageEvent{ID: uuid.New(), UserID: userID, Provider: provider, EndpointHost: host, Model: model, RequestType: requestType, Status: "budget_exceeded", BillingMonth: month, ErrorCode: stringPointer("monthly_token_limit"), CreatedAt: now, UpdatedAt: now}); err != nil {
			return Reservation{}, err
		}
		if err := transaction.Commit(); err != nil {
			return Reservation{}, fmt.Errorf("record AI budget denial: %w", err)
		}
		return Reservation{}, ErrBudget
	}
	id := uuid.New()
	if err := insertUsage(ctx, transaction, UsageEvent{ID: id, UserID: userID, Provider: provider, EndpointHost: host, Model: model, RequestType: requestType, Status: "started", BillingMonth: month, ChargedTokens: estimatedTokens, CreatedAt: now, UpdatedAt: now}); err != nil {
		return Reservation{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Reservation{}, fmt.Errorf("commit AI usage reservation: %w", err)
	}
	return Reservation{ID: id, ReservedTokens: estimatedTokens}, nil
}

func (repository *PostgresRepository) CompleteUsage(ctx context.Context, userID, eventID uuid.UUID, completion CompleteUsage, now time.Time) error {
	chargedTokens := -1
	if completion.InputTokens != nil && completion.OutputTokens != nil {
		chargedTokens = max(0, *completion.InputTokens+*completion.OutputTokens)
	} else if completion.Status == "error" && !completion.RetainReservationOnError {
		chargedTokens = 0
	}
	result, err := repository.db.ExecContext(ctx, `
UPDATE ai_usage_events
SET status = $3,
    input_tokens = $4,
    output_tokens = $5,
    latency_ms = $6,
    error_code = NULLIF($7, ''),
    charged_tokens = CASE WHEN $8 < 0 THEN charged_tokens ELSE $8 END,
    updated_at = $9
WHERE user_id = $1 AND id = $2 AND status = 'started'`,
		userID, eventID, completion.Status, completion.InputTokens, completion.OutputTokens,
		max(0, completion.LatencyMS), truncate(completion.ErrorCode, 80), chargedTokens, now)
	return requireChanged(result, err, "complete AI usage")
}

type rowScanner interface {
	Scan(...any) error
}

func scanSettings(row rowScanner) (*Settings, error) {
	var settings Settings
	var encrypted, hint sql.NullString
	if err := row.Scan(&settings.Provider, &settings.BaseURL, &settings.Model, &encrypted, &hint, &settings.IncludeExactAmounts, &settings.IncludeAccountNames, &settings.MonthlyTokenLimit, &settings.MaxOutputTokens, &settings.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load AI settings: %w", err)
	}
	settings.EncryptedAPIKey = encrypted.String
	settings.HasStoredAPIKey = encrypted.Valid
	if hint.Valid {
		settings.APIKeyHint = &hint.String
	}
	return &settings, nil
}

func insertUsage(ctx context.Context, transaction *sql.Tx, event UsageEvent) error {
	_, err := transaction.ExecContext(ctx, `
INSERT INTO ai_usage_events (
    id, user_id, provider, endpoint_host, model, request_type, status,
    billing_month, charged_tokens, input_tokens, output_tokens, latency_ms,
    error_code, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		event.ID, event.UserID, event.Provider, event.EndpointHost, event.Model,
		event.RequestType, event.Status, event.BillingMonth, event.ChargedTokens,
		event.InputTokens, event.OutputTokens, event.LatencyMS, event.ErrorCode,
		event.CreatedAt, event.UpdatedAt)
	if err != nil {
		return fmt.Errorf("insert AI usage event: %w", err)
	}
	return nil
}

func requireChanged(result sql.Result, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s result: %w", operation, err)
	}
	if changed != 1 {
		return ErrNotConfigured
	}
	return nil
}

func endpointHost(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return "invalid"
	}
	return parsed.Host
}

func stringPointer(value string) *string { return &value }

func truncate(value string, maximum int) string {
	if len(value) <= maximum {
		return value
	}
	return value[:maximum]
}
