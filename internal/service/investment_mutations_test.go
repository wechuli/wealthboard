package service

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestReplayPositionEventsRejectsNegativeQuantity(t *testing.T) {
	accountID, instrumentID := uuid.New(), uuid.New()
	events := []positionEventRow{
		{id: uuid.New(), accountID: accountID, instrumentID: instrumentID, eventType: "opening_position", quantity: "2.5"},
		{id: uuid.New(), accountID: accountID, instrumentID: instrumentID, eventType: "sell", quantity: "3"},
	}

	_, err := replayPositionEvents(events, true)
	if !errors.Is(err, ErrInvestmentMutationValidation) {
		t.Fatalf("replay error = %v, want validation error", err)
	}
}

func TestReplayPositionEventsValidatesExistingMerger(t *testing.T) {
	accountID, instrumentID := uuid.New(), uuid.New()
	events := []positionEventRow{
		{id: uuid.New(), accountID: accountID, instrumentID: instrumentID, eventType: "opening_position", quantity: "6"},
		{id: uuid.New(), accountID: accountID, instrumentID: instrumentID, eventType: "merger_out", quantity: "5"},
	}

	_, err := replayPositionEvents(events, true)
	if !errors.Is(err, ErrInvestmentMutationConflict) {
		t.Fatalf("replay error = %v, want corporate-action conflict", err)
	}
}

func TestInvestmentMutationsPostgreSQL(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	ownerID, foreignID := uuid.New(), uuid.New()
	categoryID, accountID := uuid.New(), uuid.New()
	seedInvestmentMutationUsers(t, db, ownerID, foreignID, categoryID, accountID)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{ownerID, foreignID})
	})

	mutations := NewInvestmentMutations(db)
	mutations.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	instrumentID, err := mutations.CreateInstrument(ctx, ownerID, InstrumentMutationInput{
		Name: "Owner Fund", IdentifierType: "custom", AssetType: "fund", QuoteCurrency: "USD",
	})
	if err != nil {
		t.Fatalf("create instrument: %v", err)
	}

	t.Run("foreign resources return not found", func(t *testing.T) {
		err := mutations.UpdateInstrument(ctx, foreignID, instrumentID, InstrumentMutationInput{
			Name: "Foreign edit", IdentifierType: "custom", AssetType: "fund", QuoteCurrency: "USD",
		})
		if !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("foreign update error = %v, want not found", err)
		}
	})

	t.Run("price upsert preserves date uniqueness and exact decimal", func(t *testing.T) {
		input := SecurityPriceMutationInput{
			InstrumentID: instrumentID, Price: "1234567890.123456789", EffectiveDate: testInvestmentDate(2026, 9, 19), Source: "manual",
		}
		firstID, err := mutations.UpsertSecurityPrice(ctx, ownerID, input)
		if err != nil {
			t.Fatalf("first upsert: %v", err)
		}
		input.Price = "9876543210.987654321"
		secondID, err := mutations.UpsertSecurityPrice(ctx, ownerID, input)
		if err != nil {
			t.Fatalf("second upsert: %v", err)
		}
		if firstID != secondID {
			t.Fatalf("upsert IDs differ: %s != %s", firstID, secondID)
		}
		var count int
		var price string
		if err := db.QueryRowContext(ctx, `
SELECT COUNT(*), MAX(price)::TEXT FROM security_prices
WHERE user_id = $1 AND instrument_id = $2 AND effective_date = DATE '2026-09-19'`, ownerID, instrumentID).Scan(&count, &price); err != nil {
			t.Fatalf("read upserted price: %v", err)
		}
		if count != 1 || price != input.Price {
			t.Fatalf("price rows = %d, price = %q", count, price)
		}
	})

	t.Run("position event idempotency and replay rollback", func(t *testing.T) {
		opening := PositionEventMutationInput{
			AccountID: accountID, InstrumentID: instrumentID, Type: "opening_position", Quantity: "5",
			TradeCurrency: "USD", OpeningCostBasis: "100.00", TradeDate: testInvestmentDate(2026, 9, 17),
			IdempotencyKey: uuid.New(),
		}
		openingID, err := mutations.CreatePositionEvent(ctx, ownerID, opening)
		if err != nil {
			t.Fatalf("create opening position: %v", err)
		}
		replayedID, err := mutations.CreatePositionEvent(ctx, ownerID, opening)
		if err != nil || replayedID != openingID {
			t.Fatalf("idempotent replay ID = %s, error = %v", replayedID, err)
		}
		sell := PositionEventMutationInput{
			AccountID: accountID, InstrumentID: instrumentID, Type: "sell", Quantity: "4", UnitPrice: "10.25",
			TradeCurrency: "USD", TradeDate: testInvestmentDate(2026, 9, 18), IdempotencyKey: uuid.New(),
		}
		if _, err := mutations.CreatePositionEvent(ctx, ownerID, sell); err != nil {
			t.Fatalf("create sell: %v", err)
		}
		opening.Quantity = "3"
		if _, err := mutations.UpdatePositionEvent(ctx, ownerID, openingID, opening); !errors.Is(err, ErrInvestmentMutationValidation) {
			t.Fatalf("negative replay update error = %v, want validation", err)
		}
		var stored string
		if err := db.QueryRowContext(ctx, `SELECT quantity::TEXT FROM position_events WHERE id = $1`, openingID).Scan(&stored); err != nil {
			t.Fatalf("read rolled-back event: %v", err)
		}
		if stored != "5" {
			t.Fatalf("rolled-back opening quantity = %s, want 5", stored)
		}
		var currentValue int64
		if err := db.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id = $1 AND id = $2`, ownerID, accountID).Scan(&currentValue); err != nil {
			t.Fatalf("read recalculated account value: %v", err)
		}
		if currentValue != 987654325199 {
			t.Fatalf("recalculated account value = %d, want 987654325199", currentValue)
		}
	})

	t.Run("position event reads are owner scoped and paginated", func(t *testing.T) {
		if _, err := mutations.PositionEvents(ctx, foreignID, accountID, ReadPage{}); !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("foreign event read error = %v, want not found", err)
		}
		first, err := mutations.PositionEvents(ctx, ownerID, accountID, ReadPage{Limit: 1})
		if err != nil {
			t.Fatalf("owner event read: %v", err)
		}
		if len(first.Items) != 1 || !first.HasMore || first.Items[0].Type != "sell" || first.Items[0].UnitPrice != "10.25" {
			t.Fatalf("first event page = %+v", first)
		}
		second, err := mutations.PositionEvents(ctx, ownerID, accountID, ReadPage{Limit: 1, Offset: 1})
		if err != nil {
			t.Fatalf("second event page: %v", err)
		}
		if len(second.Items) != 1 || second.HasMore || second.Items[0].Type != "opening_position" || second.Items[0].OpeningCostBasisMinor == nil || *second.Items[0].OpeningCostBasisMinor != "10000" {
			t.Fatalf("second event page = %+v", second)
		}
	})

	t.Run("reconciliation is owner scoped", func(t *testing.T) {
		input := PositionReconciliationMutationInput{
			AccountID: accountID, ObservationDate: testInvestmentDate(2026, 9, 19), ReportedCash: "25.00", ReportedTotal: "125.00",
		}
		if _, err := mutations.CreatePositionReconciliation(ctx, foreignID, input); !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("foreign create error = %v, want not found", err)
		}
		id, err := mutations.CreatePositionReconciliation(ctx, ownerID, input)
		if err != nil {
			t.Fatalf("owner create reconciliation: %v", err)
		}
		if _, err := mutations.PositionReconciliations(ctx, foreignID, accountID, ReadPage{}); !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("foreign reconciliation read error = %v, want not found", err)
		}
		page, err := mutations.PositionReconciliations(ctx, ownerID, accountID, ReadPage{Limit: 1})
		if err != nil {
			t.Fatalf("owner reconciliation read: %v", err)
		}
		if len(page.Items) != 1 || page.Items[0].ID != id || page.Items[0].ReportedCashMinor == nil || *page.Items[0].ReportedCashMinor != "2500" || page.Items[0].ReportedTotalMinor != "12500" {
			t.Fatalf("reconciliation page = %+v", page)
		}
		if err := mutations.DeletePositionReconciliation(ctx, foreignID, id); !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("foreign delete error = %v, want not found", err)
		}
		if err := mutations.DeletePositionReconciliation(ctx, ownerID, id); err != nil {
			t.Fatalf("owner delete reconciliation: %v", err)
		}
	})
}

func seedInvestmentMutationUsers(t *testing.T, db *sql.DB, ownerID, foreignID, categoryID, accountID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1, $2, now(), now())`, []any{ownerID, "investment-owner-" + ownerID.String()}},
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1, $2, now(), now())`, []any{foreignID, "investment-foreign-" + foreignID.String()}},
		{`INSERT INTO user_settings (id, user_id, display_name, base_currency, supported_currencies, timezone, created_at, updated_at) VALUES ($1, $2, 'Owner', 'USD', '["USD","KES"]', 'UTC', now(), now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO user_settings (id, user_id, display_name, base_currency, supported_currencies, timezone, created_at, updated_at) VALUES ($1, $2, 'Foreign', 'USD', '["USD","KES"]', 'UTC', now(), now())`, []any{uuid.New(), foreignID}},
		{`INSERT INTO categories (id, user_id, name, slug, created_at, updated_at) VALUES ($1, $2, 'Brokerage', $3, now(), now())`, []any{categoryID, ownerID, "brokerage-" + categoryID.String()}},
		{`INSERT INTO accounts (id, user_id, name, category_id, currency, tracking_mode, created_at, updated_at) VALUES ($1, $2, 'Positions', $3, 'USD', 'positions', now(), now())`, []any{accountID, ownerID, categoryID}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed investment mutations: %v", err)
		}
	}
}

func testInvestmentDate(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
