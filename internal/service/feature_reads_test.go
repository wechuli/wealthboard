package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wechuli/wealthboard/internal/aiworkflow"
)

func TestFeatureReadFinancialValuesSerializeAsStrings(t *testing.T) {
	payload, err := json.Marshal(struct {
		Price     SecurityPrice   `json:"price"`
		Directive EstateDirective `json:"directive"`
	}{
		Price:     SecurityPrice{Price: "1234567890.123456789"},
		Directive: EstateDirective{CurrentValueMinor: "9007199254740993"},
	})
	if err != nil {
		t.Fatalf("marshal feature values: %v", err)
	}
	body := string(payload)
	if !strings.Contains(body, `"price":"1234567890.123456789"`) {
		t.Fatalf("decimal was not serialized as a string: %s", body)
	}
	if !strings.Contains(body, `"currentValueMinor":"9007199254740993"`) {
		t.Fatalf("minor units were not serialized as a string: %s", body)
	}
}

func TestEstateWorkspaceDeclaresCachedValuesIncomplete(t *testing.T) {
	workspace := EstateWorkspaceRead{
		CurrentValuesComplete: false,
		CurrentValuesWarning:  estateCurrentValueWarning,
	}
	if workspace.CurrentValuesComplete {
		t.Fatal("cached estate values must not be reported as complete")
	}
	if !strings.Contains(workspace.CurrentValuesWarning, "cached current values") {
		t.Fatalf("warning = %q", workspace.CurrentValuesWarning)
	}
}

func TestFeatureInstrumentReadsAreOwnerScoped(t *testing.T) {
	db := openServiceTestDatabase(t)

	ctx := context.Background()
	ownerID, foreignID := uuid.New(), uuid.New()
	instrumentID, priceID := uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1, $2, now(), now())`, []any{ownerID, "feature-owner-" + ownerID.String()}},
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1, $2, now(), now())`, []any{foreignID, "feature-foreign-" + foreignID.String()}},
		{`INSERT INTO investment_instruments (
			id, user_id, name, identifier_type, asset_type, quote_currency, created_at, updated_at
		) VALUES ($1, $2, 'Owner instrument', 'custom', 'stock', 'USD', now(), now())`, []any{instrumentID, ownerID}},
		{`INSERT INTO security_prices (
			id, user_id, instrument_id, price, currency, effective_date, created_at, updated_at
		) VALUES ($1, $2, $3, 1234567890.123456789, 'USD', DATE '2026-09-20', now(), now())`, []any{priceID, ownerID, instrumentID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed feature reads: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{ownerID, foreignID})
	})

	reads := NewFeatureReads(db)
	detail, err := reads.Instrument(ctx, ownerID, instrumentID)
	if err != nil {
		t.Fatalf("read owner instrument: %v", err)
	}
	if detail.Instrument.Name != "Owner instrument" || len(detail.Prices) != 1 || detail.Prices[0].Price != "1234567890.123456789" {
		t.Fatalf("owner instrument = %+v", detail)
	}

	_, err = reads.Instrument(ctx, foreignID, instrumentID)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign read error = %v, want sql.ErrNoRows", err)
	}
}

func TestAIConversionFingerprintMatchesClientOutsideUTC(t *testing.T) {
	db := openServiceTestDatabase(t)
	previous := time.Local
	time.Local = time.FixedZone("UTC+3", 3*60*60)
	t.Cleanup(func() { time.Local = previous })

	ctx := context.Background()
	userID := uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1, $2, now(), now())`, []any{userID, "ai-fingerprint-" + userID.String()}},
		{`INSERT INTO ai_provider_settings (
			id, user_id, provider, base_url, model, max_output_tokens, created_at, updated_at
		) VALUES ($1, $2, 'anthropic', 'https://api.anthropic.com', 'claude-sonnet-5', 1200, now(), TIMESTAMPTZ '2026-10-15 14:00:19.099969+00')`, []any{uuid.New(), userID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed AI settings: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})

	read, err := NewFeatureReads(db).AI(ctx, userID)
	if err != nil {
		t.Fatalf("read AI settings: %v", err)
	}
	payload, err := json.Marshal(read.Settings)
	if err != nil {
		t.Fatal(err)
	}
	var client struct {
		Provider        string `json:"provider"`
		BaseURL         string `json:"baseUrl"`
		Model           string `json:"model"`
		MaxOutputTokens int    `json:"maxOutputTokens"`
		UpdatedAt       string `json:"updatedAt"`
	}
	if err := json.Unmarshal(payload, &client); err != nil {
		t.Fatal(err)
	}
	// Mirrors configurationHash in web/src/components/accounts/ai-document-import.tsx.
	fingerprint, _ := json.Marshal([]any{client.Provider, client.BaseURL, client.Model, client.MaxOutputTokens, client.UpdatedAt, "balance", "KES"})
	digest := sha256.Sum256(fingerprint)
	clientHash := hex.EncodeToString(digest[:])

	serverHash, err := aiworkflow.NewService(aiworkflow.NewPostgresRepository(db), nil, nil).ConfigurationHash(ctx, userID, "balance", "KES")
	if err != nil {
		t.Fatalf("server fingerprint: %v", err)
	}
	if clientHash != serverHash {
		t.Fatalf("client fingerprint of updatedAt %q does not match the server", client.UpdatedAt)
	}
	if client.UpdatedAt != "2026-10-15T14:00:19.099969Z" {
		t.Fatalf("updatedAt = %q, want UTC", client.UpdatedAt)
	}
}
