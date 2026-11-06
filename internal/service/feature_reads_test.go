package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
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
