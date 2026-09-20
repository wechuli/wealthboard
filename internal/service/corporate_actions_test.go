package service

import (
	"context"
	"database/sql"
	"errors"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestCorporateActionRatioUsesExactDecimalArithmetic(t *testing.T) {
	numerator, denominator, err := canonicalCorporateRatio("1.2500", "0.500")
	if err != nil {
		t.Fatalf("canonical ratio: %v", err)
	}
	if numerator != "1.25" || denominator != "0.5" {
		t.Fatalf("canonical ratio = %s:%s, want 1.25:0.5", numerator, denominator)
	}
	quantity, err := applyCorporateRatio(newRat(t, "9007199254740993.125"), numerator, denominator)
	if err != nil {
		t.Fatalf("apply ratio: %v", err)
	}
	if quantity != "22517998136852482.8125" {
		t.Fatalf("ratio quantity = %s", quantity)
	}
}

func TestCorporateActionsPostgreSQLParity(t *testing.T) {
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
	categoryID := uuid.New()
	sourceAccountID, destinationAccountID := uuid.New(), uuid.New()
	seedCorporateActionUsers(t, db, ownerID, foreignID, categoryID, sourceAccountID, destinationAccountID)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{ownerID, foreignID})
	})

	now := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	investments := NewInvestmentMutations(db)
	investments.now = func() time.Time { return now }
	actions := NewCorporateActions(db)
	actions.now = func() time.Time { return now }

	sourceInstrumentID := createCorporateInstrument(t, ctx, investments, ownerID, "Source Corp")
	spinoffInstrumentID := createCorporateInstrument(t, ctx, investments, ownerID, "Spin Corp")
	mergerInstrumentID := createCorporateInstrument(t, ctx, investments, ownerID, "Merged Corp")
	openingID, err := investments.CreatePositionEvent(ctx, ownerID, PositionEventMutationInput{
		AccountID: sourceAccountID, InstrumentID: sourceInstrumentID, Type: "opening_position",
		Quantity: "12", TradeCurrency: "USD", OpeningCostBasis: "120.00",
		TradeDate: testInvestmentDate(2026, 9, 10), IdempotencyKey: uuid.New(),
	})
	if err != nil {
		t.Fatalf("create opening position: %v", err)
	}

	splitKey := uuid.New()
	splitGroupID, err := actions.RecordStockSplit(ctx, ownerID, StockSplitInput{
		AccountID: sourceAccountID, InstrumentID: sourceInstrumentID,
		Numerator: "3.000", Denominator: "2.00", ActionDate: testInvestmentDate(2026, 9, 11),
		IdempotencyKey: splitKey,
	})
	if err != nil {
		t.Fatalf("record split: %v", err)
	}
	replayedSplitID, err := actions.RecordStockSplit(ctx, ownerID, StockSplitInput{
		AccountID: sourceAccountID, InstrumentID: sourceInstrumentID,
		Numerator: "3", Denominator: "2", ActionDate: testInvestmentDate(2026, 9, 11),
		IdempotencyKey: splitKey,
	})
	if err != nil || replayedSplitID != splitGroupID {
		t.Fatalf("split replay = %s, %v; want %s", replayedSplitID, err, splitGroupID)
	}
	assertCorporateEvent(t, db, splitGroupID, "split", "0", "3", "2")

	if _, err := actions.RecordStockSplit(ctx, ownerID, StockSplitInput{
		AccountID: sourceAccountID, InstrumentID: spinoffInstrumentID,
		Numerator: "2", Denominator: "1", ActionDate: testInvestmentDate(2026, 9, 11),
		IdempotencyKey: splitKey,
	}); !errors.Is(err, ErrInvestmentMutationConflict) {
		t.Fatalf("incompatible split replay error = %v, want conflict", err)
	}

	spinoffGroupID, err := actions.RecordSpinoff(ctx, ownerID, SpinoffInput{
		AccountID: sourceAccountID, SourceInstrumentID: sourceInstrumentID,
		NewInstrumentID: spinoffInstrumentID, Numerator: "1", Denominator: "3",
		ActionDate: testInvestmentDate(2026, 9, 12), IdempotencyKey: uuid.New(),
	})
	if err != nil {
		t.Fatalf("record spinoff: %v", err)
	}
	assertCorporateEvent(t, db, spinoffGroupID, "spinoff", "6", "1", "3")

	mergerGroupID, err := actions.RecordMerger(ctx, ownerID, MergerInput{
		AccountID: sourceAccountID, SourceInstrumentID: sourceInstrumentID,
		DestinationInstrumentID: mergerInstrumentID, Numerator: "2", Denominator: "3",
		ActionDate: testInvestmentDate(2026, 9, 13), IdempotencyKey: uuid.New(),
	})
	if err != nil {
		t.Fatalf("record merger: %v", err)
	}
	assertCorporateGroupCount(t, db, mergerGroupID, 2, 0)
	assertCorporateEvent(t, db, mergerGroupID, "merger_out", "18", "2", "3")
	assertCorporateEvent(t, db, mergerGroupID, "merger_in", "12", "2", "3")

	dividendGroupID, err := actions.RecordDividendReinvestment(ctx, ownerID, DividendReinvestmentInput{
		AccountID: sourceAccountID, InstrumentID: mergerInstrumentID,
		DividendAmount: "12.34", Quantity: "1.25", UnitPrice: "9.872",
		ActivityDate: testInvestmentDate(2026, 9, 14), IdempotencyKey: uuid.New(),
	})
	if err != nil {
		t.Fatalf("record dividend reinvestment: %v", err)
	}
	assertCorporateGroupCount(t, db, dividendGroupID, 1, 1)

	transferGroupID, err := actions.RecordInKindTransfer(ctx, ownerID, InKindTransferInput{
		SourceAccountID: sourceAccountID, DestinationAccountID: destinationAccountID,
		InstrumentID: mergerInstrumentID, Quantity: "2", FeeAmount: "1.25",
		TransferDate: testInvestmentDate(2026, 9, 15), IdempotencyKey: uuid.New(),
	})
	if err != nil {
		t.Fatalf("record in-kind transfer: %v", err)
	}
	assertCorporateGroupCount(t, db, transferGroupID, 2, 1)

	t.Run("negative replay rolls back the whole group", func(t *testing.T) {
		key := uuid.New()
		if _, err := actions.RecordInKindTransfer(ctx, ownerID, InKindTransferInput{
			SourceAccountID: destinationAccountID, DestinationAccountID: sourceAccountID,
			InstrumentID: mergerInstrumentID, Quantity: "3", TransferDate: testInvestmentDate(2026, 9, 16),
			IdempotencyKey: key,
		}); !errors.Is(err, ErrInvestmentMutationValidation) {
			t.Fatalf("negative transfer error = %v, want validation", err)
		}
		var count int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM position_events WHERE user_id = $1 AND idempotency_key = $2`, ownerID, key).Scan(&count); err != nil {
			t.Fatalf("count rolled-back transfer: %v", err)
		}
		if count != 0 {
			t.Fatalf("rolled-back transfer rows = %d, want 0", count)
		}
	})

	t.Run("foreign and archived resources are not found", func(t *testing.T) {
		if _, err := actions.RecordStockSplit(ctx, foreignID, StockSplitInput{
			AccountID: sourceAccountID, InstrumentID: sourceInstrumentID,
			Numerator: "2", Denominator: "1", ActionDate: testInvestmentDate(2026, 9, 16),
			IdempotencyKey: uuid.New(),
		}); !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("foreign split error = %v, want not found", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE accounts SET archived_at = now() WHERE user_id = $1 AND id = $2`, ownerID, destinationAccountID); err != nil {
			t.Fatalf("archive destination: %v", err)
		}
		if _, err := actions.RecordInKindTransfer(ctx, ownerID, InKindTransferInput{
			SourceAccountID: sourceAccountID, DestinationAccountID: destinationAccountID,
			InstrumentID: mergerInstrumentID, Quantity: "1", TransferDate: testInvestmentDate(2026, 9, 16),
			IdempotencyKey: uuid.New(),
		}); !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("archived transfer error = %v, want not found", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE accounts SET archived_at = NULL WHERE user_id = $1 AND id = $2`, ownerID, destinationAccountID); err != nil {
			t.Fatalf("restore destination: %v", err)
		}
	})

	t.Run("group deletion is atomic and replay safe", func(t *testing.T) {
		mergerEventID := corporateGroupEventID(t, db, mergerGroupID, "merger_in")
		if err := actions.DeleteGroup(ctx, foreignID, mergerEventID); !errors.Is(err, ErrInvestmentMutationNotFound) {
			t.Fatalf("foreign delete error = %v, want not found", err)
		}
		if err := actions.DeleteGroup(ctx, ownerID, mergerEventID); !errors.Is(err, ErrInvestmentMutationValidation) {
			t.Fatalf("unsafe merger deletion error = %v, want validation", err)
		}
		assertCorporateGroupCount(t, db, mergerGroupID, 2, 0)

		if err := actions.DeleteGroup(ctx, ownerID, corporateGroupEventID(t, db, transferGroupID, "transfer_out")); err != nil {
			t.Fatalf("delete transfer group: %v", err)
		}
		assertCorporateGroupCount(t, db, transferGroupID, 0, 0)
		if err := actions.DeleteGroup(ctx, ownerID, mergerEventID); err != nil {
			t.Fatalf("delete merger group: %v", err)
		}
		assertCorporateGroupCount(t, db, mergerGroupID, 0, 0)
		if err := actions.DeleteGroup(ctx, ownerID, corporateGroupEventID(t, db, dividendGroupID, "buy")); err != nil {
			t.Fatalf("delete dividend reinvestment group: %v", err)
		}
		assertCorporateGroupCount(t, db, dividendGroupID, 0, 0)
		if err := actions.DeleteGroup(ctx, ownerID, corporateGroupEventID(t, db, spinoffGroupID, "spinoff")); err != nil {
			t.Fatalf("delete spinoff group: %v", err)
		}
		if err := actions.DeleteGroup(ctx, ownerID, corporateGroupEventID(t, db, splitGroupID, "split")); err != nil {
			t.Fatalf("delete split group: %v", err)
		}
		if err := actions.DeleteGroup(ctx, ownerID, openingID); !errors.Is(err, ErrInvestmentMutationConflict) {
			t.Fatalf("ungrouped delete error = %v, want conflict", err)
		}
	})
}

func newRat(t *testing.T, value string) *big.Rat {
	t.Helper()
	result, ok := new(big.Rat).SetString(value)
	if !ok {
		t.Fatalf("parse rational %q", value)
	}
	return result
}

func seedCorporateActionUsers(t *testing.T, db *sql.DB, ownerID, foreignID, categoryID, sourceAccountID, destinationAccountID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1, $2, now(), now())`, []any{ownerID, "corporate-owner-" + ownerID.String()}},
		{`INSERT INTO users (id, username, created_at, updated_at) VALUES ($1, $2, now(), now())`, []any{foreignID, "corporate-foreign-" + foreignID.String()}},
		{`INSERT INTO user_settings (id, user_id, display_name, base_currency, supported_currencies, timezone, created_at, updated_at) VALUES ($1, $2, 'Owner', 'USD', '["USD"]', 'UTC', now(), now())`, []any{uuid.New(), ownerID}},
		{`INSERT INTO user_settings (id, user_id, display_name, base_currency, supported_currencies, timezone, created_at, updated_at) VALUES ($1, $2, 'Foreign', 'USD', '["USD"]', 'UTC', now(), now())`, []any{uuid.New(), foreignID}},
		{`INSERT INTO categories (id, user_id, name, slug, created_at, updated_at) VALUES ($1, $2, 'Brokerage', $3, now(), now())`, []any{categoryID, ownerID, "corporate-" + categoryID.String()}},
		{`INSERT INTO accounts (id, user_id, name, category_id, currency, tracking_mode, created_at, updated_at) VALUES ($1, $2, 'Source', $3, 'USD', 'positions', now(), now())`, []any{sourceAccountID, ownerID, categoryID}},
		{`INSERT INTO accounts (id, user_id, name, category_id, currency, tracking_mode, created_at, updated_at) VALUES ($1, $2, 'Destination', $3, 'USD', 'positions', now(), now())`, []any{destinationAccountID, ownerID, categoryID}},
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed corporate actions: %v", err)
		}
	}
}

func createCorporateInstrument(t *testing.T, ctx context.Context, investments *InvestmentMutations, userID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id, err := investments.CreateInstrument(ctx, userID, InstrumentMutationInput{
		Name: name, IdentifierType: "custom", AssetType: "stock", QuoteCurrency: "USD",
	})
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
	return id
}

func assertCorporateEvent(t *testing.T, db *sql.DB, groupID uuid.UUID, eventType, quantity, numerator, denominator string) {
	t.Helper()
	var storedQuantity, storedNumerator, storedDenominator string
	if err := db.QueryRow(`
SELECT quantity::TEXT, action_ratio_numerator::TEXT, action_ratio_denominator::TEXT
FROM position_events WHERE event_group_id = $1 AND type = $2`, groupID, eventType).
		Scan(&storedQuantity, &storedNumerator, &storedDenominator); err != nil {
		t.Fatalf("read %s event: %v", eventType, err)
	}
	if storedQuantity != quantity || storedNumerator != numerator || storedDenominator != denominator {
		t.Fatalf("%s event = quantity %s ratio %s:%s, want %s %s:%s", eventType, storedQuantity, storedNumerator, storedDenominator, quantity, numerator, denominator)
	}
}

func assertCorporateGroupCount(t *testing.T, db *sql.DB, groupID uuid.UUID, eventCount, transactionCount int) {
	t.Helper()
	var storedEvents, storedTransactions int
	if err := db.QueryRow(`SELECT COUNT(*) FROM position_events WHERE event_group_id = $1`, groupID).Scan(&storedEvents); err != nil {
		t.Fatalf("count group events: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM transactions WHERE event_group_id = $1`, groupID).Scan(&storedTransactions); err != nil {
		t.Fatalf("count group transactions: %v", err)
	}
	if storedEvents != eventCount || storedTransactions != transactionCount {
		t.Fatalf("group %s counts = events %d transactions %d, want %d and %d", groupID, storedEvents, storedTransactions, eventCount, transactionCount)
	}
}

func corporateGroupEventID(t *testing.T, db *sql.DB, groupID uuid.UUID, eventType string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRow(`SELECT id FROM position_events WHERE event_group_id = $1 AND type = $2`, groupID, eventType).Scan(&id); err != nil {
		t.Fatalf("read %s group event: %v", eventType, err)
	}
	return id
}
