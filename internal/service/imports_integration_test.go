package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAccountHistoryImportPostgreSQLReplayRollbackAndOwnership(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 20, 12, 0, 0, 0, time.UTC)
	ownerID, otherID, ownerCategory, otherCategory := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	seedLedgerOwner(t, ctx, db, ownerID, ownerCategory, "account-import-owner-")
	seedLedgerOwner(t, ctx, db, otherID, otherCategory, "account-import-other-")
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=ANY($1)`, []uuid.UUID{ownerID, otherID})
	})
	ledger := NewLedgerService(db)
	ledger.now = func() time.Time { return now }
	opened := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	accountID := createLedgerAccount(t, ctx, ledger, ownerID, ownerCategory, "Imported history", 100, opened, uuid.New())
	foreignID := createLedgerAccount(t, ctx, ledger, otherID, otherCategory, "Foreign", 50, opened, uuid.New())
	if _, err := ledger.CreateValuation(ctx, ownerID, ValuationMutationInput{IdempotencyKey: uuid.New(), AccountID: accountID, ValueMinor: 500, ValuationDate: time.Date(2026, time.September, 10, 0, 0, 0, 0, time.UTC)}); err != nil {
		t.Fatal(err)
	}

	imports := NewAccountHistoryImportService(db)
	imports.now = func() time.Time { return now }
	content := []byte(`{"format":"wealthboard-account-history","version":1,"transactions":[{"external_id":"txn-1","type":"withdrawal","amount":"0.50","date":"2026-09-11","description":"Fee","notes":null}]}`)
	preview, err := imports.Preview(ctx, ownerID, accountID, content, ImportFormatJSON)
	if err != nil || preview.ProjectedBalanceMinor != 450 || preview.Summary.Ready != 1 {
		t.Fatalf("preview = %#v, error %v", preview, err)
	}
	committed, err := imports.Commit(ctx, ownerID, accountID, content, ImportFormatJSON, preview.Hash)
	if err != nil || committed.FinalBalanceMinor != 450 || committed.Summary.Imported != 1 {
		t.Fatalf("commit = %#v, error %v", committed, err)
	}
	replayed, err := imports.Commit(ctx, ownerID, accountID, content, ImportFormatJSON, preview.Hash)
	if err != nil || replayed.Summary.Imported != 0 || replayed.Summary.SkippedDuplicates != 1 {
		t.Fatalf("replay = %#v, error %v", replayed, err)
	}

	conflict := []byte(`{"format":"wealthboard-account-history","version":1,"transactions":[{"external_id":"rollback-new","type":"deposit","amount":"1.00","date":"2026-09-12"},{"external_id":"txn-1","type":"withdrawal","amount":"0.60","date":"2026-09-11"}]}`)
	if _, err := imports.Commit(ctx, ownerID, accountID, conflict, ImportFormatJSON, importHash(conflict)); !errors.Is(err, ErrImportConflict) {
		t.Fatalf("conflict error = %v", err)
	}
	assertImportRowCount(t, ctx, db, `SELECT count(*) FROM transactions WHERE user_id=$1 AND account_id=$2 AND external_id='rollback-new'`, ownerID, accountID, 0)
	if _, err := imports.Preview(ctx, otherID, accountID, content, ImportFormatJSON); !errors.Is(err, ErrImportNotFound) {
		t.Fatalf("cross-user preview error = %v", err)
	}
	if _, err := imports.Preview(ctx, ownerID, foreignID, content, ImportFormatJSON); !errors.Is(err, ErrImportNotFound) {
		t.Fatalf("foreign preview error = %v", err)
	}
}

func TestAccountHistoryImportDerivesExternalIDsFromRowData(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 20, 12, 0, 0, 0, time.UTC)
	ownerID, otherID, ownerCategory, otherCategory := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	seedLedgerOwner(t, ctx, db, ownerID, ownerCategory, "derived-import-owner-")
	seedLedgerOwner(t, ctx, db, otherID, otherCategory, "derived-import-other-")
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=ANY($1)`, []uuid.UUID{ownerID, otherID})
	})
	ledger := NewLedgerService(db)
	ledger.now = func() time.Time { return now }
	opened := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	accountID := createLedgerAccount(t, ctx, ledger, ownerID, ownerCategory, "Derived history", 0, opened, uuid.New())
	foreignID := createLedgerAccount(t, ctx, ledger, otherID, otherCategory, "Foreign derived", 0, opened, uuid.New())
	insertLegacy := func(userID, accountID uuid.UUID, externalID string) {
		t.Helper()
		if _, err := db.ExecContext(ctx, `
INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,external_id,created_at,updated_at)
SELECT $1,$2,$3,'deposit',1050,currency,'2026-09-05',$4,now(),now() FROM accounts WHERE user_id=$2 AND id=$3`, uuid.New(), userID, accountID, externalID); err != nil {
			t.Fatal(err)
		}
	}
	// Earlier imports stored minor-unit derived IDs; another user's identical record must not count.
	insertLegacy(ownerID, accountID, "derived-2026-09-05-deposit-1050")
	insertLegacy(otherID, foreignID, "derived-2026-09-06-fee-500")

	imports := NewAccountHistoryImportService(db)
	imports.now = func() time.Time { return now }
	content := []byte("external_id,type,amount,date,description,notes\n" +
		",deposit,10.50,2026-09-05,,\n" +
		",deposit,10.50,2026-09-05,,\n" +
		",fee,5.00,2026-09-06,ATM fee,\n" +
		",fee,5,2026-09-06,Card fee,\n")
	preview, err := imports.Preview(ctx, ownerID, accountID, content, ImportFormatCSV)
	if err != nil || preview.Summary.Ready != 3 || preview.Summary.SkippedDuplicates != 1 || preview.Summary.Failed != 0 {
		t.Fatalf("preview = %#v, error %v", preview, err)
	}
	wantIDs := []string{"derived-2026-09-05-deposit-10.50", "derived-2026-09-05-deposit-10.50-2", "derived-2026-09-06-fee-5.00", "derived-2026-09-06-fee-5.00-2"}
	for index, want := range wantIDs {
		if got := preview.Rows[index].ExternalID; got == nil || *got != want {
			t.Fatalf("row %d external ID = %v, want %s", index, got, want)
		}
	}
	if preview.Rows[0].Status != "duplicate_existing" {
		t.Fatalf("legacy derived ID row = %#v, want duplicate_existing", preview.Rows[0])
	}
	committed, err := imports.Commit(ctx, ownerID, accountID, content, ImportFormatCSV, preview.Hash)
	if err != nil || committed.Summary.Imported != 3 {
		t.Fatalf("commit = %#v, error %v", committed, err)
	}
	assertImportRowCount(t, ctx, db, `SELECT count(*) FROM transactions WHERE user_id=$1 AND account_id=$2 AND external_id IN ('derived-2026-09-05-deposit-10.50-2','derived-2026-09-06-fee-5.00','derived-2026-09-06-fee-5.00-2')`, ownerID, accountID, 3)

	replayed, err := imports.Commit(ctx, ownerID, accountID, content, ImportFormatCSV, preview.Hash)
	if err != nil || replayed.Summary.Imported != 0 || replayed.Summary.SkippedDuplicates != 4 {
		t.Fatalf("replay = %#v, error %v", replayed, err)
	}
	overlap := []byte(`{"format":"wealthboard-account-history","version":1,"transactions":[{"external_id":null,"type":"fee","amount":"5.00","date":"2026-09-06","description":"ATM fee"},{"external_id":"","type":"deposit","amount":"2.00","date":"2026-09-07"}]}`)
	overlapPreview, err := imports.Preview(ctx, ownerID, accountID, overlap, ImportFormatJSON)
	if err != nil || overlapPreview.Summary.SkippedDuplicates != 1 || overlapPreview.Summary.Ready != 1 {
		t.Fatalf("overlap preview = %#v, error %v", overlapPreview, err)
	}
	if got := overlapPreview.Rows[1].ExternalID; got == nil || *got != "derived-2026-09-07-deposit-2.00" {
		t.Fatalf("blank JSON external ID = %v", got)
	}
}

func TestInvestmentHistoryImportPostgreSQLReplayRollbackAndOwnership(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 20, 12, 0, 0, 0, time.UTC)
	ownerID, otherID, ownerCategory, otherCategory := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	seedLedgerOwner(t, ctx, db, ownerID, ownerCategory, "investment-import-owner-")
	seedLedgerOwner(t, ctx, db, otherID, otherCategory, "investment-import-other-")
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=ANY($1)`, []uuid.UUID{ownerID, otherID})
	})
	ledger := NewLedgerService(db)
	ledger.now = func() time.Time { return now }
	opened := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	key := uuid.New()
	accountID, err := ledger.CreateAccount(ctx, ownerID, AccountMutationInput{IdempotencyKey: &key, Name: "Imported positions", CategoryID: ownerCategory, Currency: "KES", TrackingMode: "positions", OpeningValueMinor: 0, IsIncludedInNetWorth: true, OpenedAt: &opened})
	if err != nil {
		t.Fatal(err)
	}
	foreignKey := uuid.New()
	foreignID, err := ledger.CreateAccount(ctx, otherID, AccountMutationInput{IdempotencyKey: &foreignKey, Name: "Foreign positions", CategoryID: otherCategory, Currency: "KES", TrackingMode: "positions", OpeningValueMinor: 0, IsIncludedInNetWorth: true, OpenedAt: &opened})
	if err != nil {
		t.Fatal(err)
	}

	imports := NewInvestmentHistoryImportService(db)
	imports.now = func() time.Time { return now }
	content := []byte(`{"format":"wealthboard-investment-history","version":1,"instruments":[{"external_id":"inst-1","name":"Example","symbol":"EX","identifier_type":"custom","identifier":"EX","exchange_mic":null,"asset_type":"stock","quote_currency":"KES"}],"position_events":[{"external_id":"event-1","instrument_external_id":"inst-1","type":"opening_position","quantity":"2","unit_price":null,"trade_currency":"KES","trade_date":"2026-09-10"}],"cash_transactions":[{"external_id":"cash-1","type":"deposit","amount":"100.00","date":"2026-09-10"}],"prices":[{"external_id":"price-1","instrument_external_id":"inst-1","price":"10.00","effective_date":"2026-09-10","source":"import"}]}`)
	preview, err := imports.Preview(ctx, ownerID, accountID, content, ImportFormatJSON)
	if err != nil || !preview.CanCommit || preview.Projected.TotalMinor != 12000 || len(preview.InstrumentChanges) != 1 || preview.InstrumentChanges[0].ProjectedQuantity != "2" {
		t.Fatalf("preview = %#v, error %v", preview, err)
	}
	committed, err := imports.Commit(ctx, ownerID, accountID, content, ImportFormatJSON, preview.Hash)
	if err != nil || committed.FinalBalanceMinor != 12000 || committed.Summary.Imported != 4 {
		t.Fatalf("commit = %#v, error %v", committed, err)
	}
	replayed, err := imports.Commit(ctx, ownerID, accountID, content, ImportFormatJSON, preview.Hash)
	if err != nil || replayed.Summary.Imported != 0 || replayed.Summary.SkippedDuplicates != 4 {
		t.Fatalf("replay = %#v, error %v", replayed, err)
	}

	rollback := []byte(`{"format":"wealthboard-investment-history","version":1,"instruments":[{"external_id":"inst-rollback","name":"Rollback","symbol":null,"identifier_type":"custom","identifier":null,"exchange_mic":null,"asset_type":"stock","quote_currency":"KES"}],"position_events":[{"external_id":"event-rollback","instrument_external_id":"inst-rollback","type":"sell","quantity":"1","unit_price":"1.00","trade_currency":"KES","trade_date":"2026-09-12"}],"cash_transactions":[],"prices":[]}`)
	if _, err := imports.Commit(ctx, ownerID, accountID, rollback, ImportFormatJSON, importHash(rollback)); !errors.Is(err, ErrImportValidation) {
		t.Fatalf("rollback error = %v", err)
	}
	assertImportRowCount(t, ctx, db, `SELECT count(*) FROM investment_instruments WHERE user_id=$1 AND external_id='inst-rollback'`, ownerID, uuid.Nil, 0)
	if _, err := imports.Preview(ctx, otherID, accountID, content, ImportFormatJSON); !errors.Is(err, ErrImportNotFound) {
		t.Fatalf("cross-user preview error = %v", err)
	}
	if _, err := imports.Preview(ctx, ownerID, foreignID, content, ImportFormatJSON); !errors.Is(err, ErrImportNotFound) {
		t.Fatalf("foreign preview error = %v", err)
	}
}

func TestInvestmentCashImportDerivesExternalIDsFromRowData(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 20, 12, 0, 0, 0, time.UTC)
	ownerID, otherID, ownerCategory, otherCategory := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	seedLedgerOwner(t, ctx, db, ownerID, ownerCategory, "derived-cash-owner-")
	seedLedgerOwner(t, ctx, db, otherID, otherCategory, "derived-cash-other-")
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=ANY($1)`, []uuid.UUID{ownerID, otherID})
	})
	ledger := NewLedgerService(db)
	ledger.now = func() time.Time { return now }
	opened := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	createPositions := func(userID, categoryID uuid.UUID, name string) uuid.UUID {
		t.Helper()
		key := uuid.New()
		id, err := ledger.CreateAccount(ctx, userID, AccountMutationInput{IdempotencyKey: &key, Name: name, CategoryID: categoryID, Currency: "KES", TrackingMode: "positions", OpeningValueMinor: 0, IsIncludedInNetWorth: true, OpenedAt: &opened})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	accountID := createPositions(ownerID, ownerCategory, "Derived cash")
	foreignID := createPositions(otherID, otherCategory, "Foreign cash")
	if _, err := db.ExecContext(ctx, `
INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,external_id,created_at,updated_at)
VALUES ($1,$2,$3,'deposit',10000,'KES','2026-09-10','derived-2026-09-10-deposit-10000',now(),now())`, uuid.New(), ownerID, accountID); err != nil {
		t.Fatal(err)
	}

	imports := NewInvestmentHistoryImportService(db)
	imports.now = func() time.Time { return now }
	content := []byte(`{"format":"wealthboard-investment-history","version":1,"cash_transactions":[{"type":"deposit","amount":"100.00","date":"2026-09-10"},{"type":"deposit","amount":"100","date":"2026-09-10"}]}`)
	preview, err := imports.Preview(ctx, ownerID, accountID, content, ImportFormatJSON)
	if err != nil || !preview.CanCommit || preview.Summary.SkippedDuplicates != 1 || preview.Summary.Ready != 1 {
		t.Fatalf("preview = %#v, error %v", preview, err)
	}
	wantIDs := []string{"derived-2026-09-10-deposit-100.00", "derived-2026-09-10-deposit-100.00-2"}
	for index, want := range wantIDs {
		if got := preview.Rows[index].ExternalID; got == nil || *got != want {
			t.Fatalf("cash row %d external ID = %v, want %s", index, got, want)
		}
	}
	if _, err := imports.Commit(ctx, ownerID, accountID, content, ImportFormatJSON, preview.Hash); err != nil {
		t.Fatal(err)
	}
	assertImportRowCount(t, ctx, db, `SELECT count(*) FROM transactions WHERE user_id=$1 AND account_id=$2 AND external_id='derived-2026-09-10-deposit-100.00-2'`, ownerID, accountID, 1)
	foreignPreview, err := imports.Preview(ctx, otherID, foreignID, content, ImportFormatJSON)
	if err != nil || foreignPreview.Summary.Ready != 2 || foreignPreview.Summary.SkippedDuplicates != 0 {
		t.Fatalf("foreign preview = %#v, error %v", foreignPreview, err)
	}
}

func assertImportRowCount(t *testing.T, ctx context.Context, db *sql.DB, query string, userID, accountID uuid.UUID, want int) {
	t.Helper()
	var got int
	args := []any{userID}
	if accountID != uuid.Nil {
		args = append(args, accountID)
	}
	if err := db.QueryRowContext(ctx, query, args...).Scan(&got); err != nil || got != want {
		t.Fatalf("row count = %d, error %v, want %d (%s)", got, err, want, fmt.Sprint(args))
	}
}
