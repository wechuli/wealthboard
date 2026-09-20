package service

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestLedgerPostgreSQLReplayTransfersIdempotencyAndOwnership(t *testing.T) {
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
	now := time.Date(2026, time.September, 20, 12, 0, 0, 0, time.UTC)
	service := NewLedgerService(db)
	service.now = func() time.Time { return now }
	userOne, userTwo := uuid.New(), uuid.New()
	categoryOne, categoryTwo := uuid.New(), uuid.New()
	seedLedgerOwner(t, ctx, db, userOne, categoryOne, "ledger-one-")
	seedLedgerOwner(t, ctx, db, userTwo, categoryTwo, "ledger-two-")
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{userOne, userTwo})
	})

	opened := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	sourceID := createLedgerAccount(t, ctx, service, userOne, categoryOne, "Source", 1000, opened, uuid.New())
	destinationID := createLedgerAccount(t, ctx, service, userOne, categoryOne, "Destination", 200, opened, uuid.New())
	foreignID := createLedgerAccount(t, ctx, service, userTwo, categoryTwo, "Foreign", 9999, opened, uuid.New())
	positionKey := uuid.New()
	positionID, err := service.CreateAccount(ctx, userOne, AccountMutationInput{
		IdempotencyKey: &positionKey, Name: "Positions", CategoryID: categoryOne, Currency: "KES",
		TrackingMode: "positions", OpeningValueMinor: 50, IsIncludedInNetWorth: true, OpenedAt: &opened,
	})
	if err != nil {
		t.Fatalf("create position account: %v", err)
	}
	if _, err := service.CreateTransaction(ctx, userOne, TransactionMutationInput{
		IdempotencyKey: uuid.New(), AccountID: positionID, Type: "deposit", AmountMinor: 25,
		TransactionDate: time.Date(2026, time.September, 8, 0, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("create position cash transaction: %v", err)
	}
	assertLedgerBalance(t, ctx, db, userOne, positionID, 75)

	depositKey := uuid.New()
	depositInput := TransactionMutationInput{
		IdempotencyKey: depositKey, AccountID: sourceID, Type: "deposit", AmountMinor: 100,
		TransactionDate: time.Date(2026, time.September, 10, 0, 0, 0, 0, time.UTC),
	}
	depositID, err := service.CreateTransaction(ctx, userOne, depositInput)
	if err != nil {
		t.Fatalf("create deposit: %v", err)
	}
	retryID, err := service.CreateTransaction(ctx, userOne, depositInput)
	if err != nil || retryID != depositID {
		t.Fatalf("idempotent deposit = %s, %v; want %s", retryID, err, depositID)
	}
	incompatible := depositInput
	incompatible.AmountMinor = 101
	if _, err := service.CreateTransaction(ctx, userOne, incompatible); !errors.Is(err, ErrLedgerConflict) {
		t.Fatalf("incompatible idempotency error = %v, want conflict", err)
	}
	if _, err := service.CreateValuation(ctx, userOne, ValuationMutationInput{
		IdempotencyKey: depositKey, AccountID: sourceID, ValueMinor: 100,
		ValuationDate: depositInput.TransactionDate,
	}); !errors.Is(err, ErrLedgerConflict) {
		t.Fatalf("cross-operation idempotency error = %v, want conflict", err)
	}

	concurrentInput := depositInput
	concurrentInput.IdempotencyKey = uuid.New()
	concurrentInput.TransactionDate = time.Date(2026, time.September, 9, 0, 0, 0, 0, time.UTC)
	var concurrentIDs [2]uuid.UUID
	var concurrentErrors [2]error
	var wait sync.WaitGroup
	for index := range concurrentIDs {
		wait.Add(1)
		go func() {
			defer wait.Done()
			concurrentIDs[index], concurrentErrors[index] = service.CreateTransaction(ctx, userOne, concurrentInput)
		}()
	}
	wait.Wait()
	if concurrentErrors[0] != nil || concurrentErrors[1] != nil || concurrentIDs[0] != concurrentIDs[1] {
		t.Fatalf("concurrent idempotent results = %v/%v and %s/%s", concurrentErrors[0], concurrentErrors[1], concurrentIDs[0], concurrentIDs[1])
	}
	if err := service.DeleteTransaction(ctx, userOne, concurrentIDs[0]); err != nil {
		t.Fatalf("delete concurrent idempotency probe: %v", err)
	}

	valuationID, err := service.CreateValuation(ctx, userOne, ValuationMutationInput{
		IdempotencyKey: uuid.New(), AccountID: sourceID, ValueMinor: 500,
		ValuationDate: time.Date(2026, time.September, 11, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create valuation: %v", err)
	}
	_, err = service.CreateTransaction(ctx, userOne, TransactionMutationInput{
		IdempotencyKey: uuid.New(), AccountID: sourceID, Type: "withdrawal", AmountMinor: 50,
		TransactionDate: time.Date(2026, time.September, 12, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create withdrawal: %v", err)
	}
	assertLedgerBalance(t, ctx, db, userOne, sourceID, 450)
	if err := service.DeleteValuation(ctx, userOne, valuationID); err != nil {
		t.Fatalf("delete valuation: %v", err)
	}
	assertLedgerBalance(t, ctx, db, userOne, sourceID, 1050)

	transferInput := TransferMutationInput{
		IdempotencyKey: uuid.New(), FromAccountID: sourceID, ToAccountID: destinationID,
		SourceAmountMinor: 300,
		TransactionDate:   time.Date(2026, time.September, 13, 0, 0, 0, 0, time.UTC),
	}
	groupID, err := service.CreateTransfer(ctx, userOne, transferInput)
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	retryGroupID, err := service.CreateTransfer(ctx, userOne, transferInput)
	if err != nil || retryGroupID != groupID {
		t.Fatalf("idempotent transfer = %s, %v; want %s", retryGroupID, err, groupID)
	}
	assertLedgerBalance(t, ctx, db, userOne, sourceID, 750)
	assertLedgerBalance(t, ctx, db, userOne, destinationID, 500)
	var transferRows int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM transactions WHERE user_id=$1 AND transfer_group_id=$2`, userOne, groupID).Scan(&transferRows); err != nil || transferRows != 2 {
		t.Fatalf("transfer row count = %d, %v; want 2", transferRows, err)
	}
	usdKey := uuid.New()
	usdAccountID, err := service.CreateAccount(ctx, userOne, AccountMutationInput{
		IdempotencyKey: &usdKey, Name: "USD", CategoryID: categoryOne, Currency: "USD",
		TrackingMode: "balance", OpeningValueMinor: 0, IsIncludedInNetWorth: true, OpenedAt: &opened,
	})
	if err != nil {
		t.Fatalf("create USD account: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO exchange_rates (id,user_id,base_currency,quote_currency,rate,effective_date,source,created_at)
		VALUES ($1,$2,'KES','USD',0.01,'2026-09-01','test',now())
	`, uuid.New(), userOne); err != nil {
		t.Fatalf("insert transfer exchange rate: %v", err)
	}
	if _, err := service.CreateTransfer(ctx, userOne, TransferMutationInput{
		IdempotencyKey: uuid.New(), FromAccountID: sourceID, ToAccountID: usdAccountID,
		SourceAmountMinor: 100, TransactionDate: time.Date(2026, time.September, 14, 0, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("create converted transfer: %v", err)
	}
	assertLedgerBalance(t, ctx, db, userOne, sourceID, 650)
	assertLedgerBalance(t, ctx, db, userOne, usdAccountID, 1)
	if err := service.SetAccountArchived(ctx, userOne, sourceID, true); err != nil {
		t.Fatalf("archive transferred account: %v", err)
	}
	if err := service.DeleteAccount(ctx, userOne, sourceID, "Source"); !errors.Is(err, ErrLedgerConflict) {
		t.Fatalf("linked transfer account deletion error = %v, want conflict", err)
	}
	if err := service.SetAccountArchived(ctx, userOne, sourceID, false); err != nil {
		t.Fatalf("restore transferred account: %v", err)
	}

	failedKey := uuid.New()
	_, err = service.CreateTransfer(ctx, userOne, TransferMutationInput{
		IdempotencyKey: failedKey, FromAccountID: sourceID, ToAccountID: foreignID,
		SourceAmountMinor: 25, DestinationAmountMinor: 25, TransactionDate: transferInput.TransactionDate,
	})
	if !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("foreign transfer error = %v, want not found", err)
	}
	var failedRows int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM idempotency_keys WHERE user_id=$1 AND key=$2`, userOne, failedKey).Scan(&failedRows); err != nil || failedRows != 0 {
		t.Fatalf("failed transfer persisted %d idempotency rows, err %v", failedRows, err)
	}
	assertLedgerBalance(t, ctx, db, userOne, sourceID, 650)
	overflowID := createLedgerAccount(t, ctx, service, userOne, categoryOne, "Overflow", math.MaxInt64, opened, uuid.New())
	rollbackKey := uuid.New()
	if _, err := service.CreateTransfer(ctx, userOne, TransferMutationInput{
		IdempotencyKey: rollbackKey, FromAccountID: sourceID, ToAccountID: overflowID,
		SourceAmountMinor: 1, DestinationAmountMinor: 1,
		TransactionDate: time.Date(2026, time.September, 15, 0, 0, 0, 0, time.UTC),
	}); !errors.Is(err, ErrLedgerValidation) {
		t.Fatalf("overflow transfer error = %v, want validation", err)
	}
	assertLedgerBalance(t, ctx, db, userOne, sourceID, 650)
	assertLedgerBalance(t, ctx, db, userOne, overflowID, math.MaxInt64)
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM idempotency_keys WHERE user_id=$1 AND key=$2`, userOne, rollbackKey).Scan(&failedRows); err != nil || failedRows != 0 {
		t.Fatalf("rolled-back transfer persisted %d idempotency rows, err %v", failedRows, err)
	}

	if err := service.UpdateAccount(ctx, userTwo, sourceID, AccountMutationInput{
		Name: "Stolen", CategoryID: categoryTwo, Currency: "KES", TrackingMode: "balance", IsIncludedInNetWorth: true,
	}); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("cross-user account update error = %v, want not found", err)
	}
	if _, err := service.CreateTransaction(ctx, userTwo, TransactionMutationInput{
		IdempotencyKey: uuid.New(), AccountID: sourceID, Type: "deposit", AmountMinor: 1,
		TransactionDate: transferInput.TransactionDate,
	}); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("cross-user transaction error = %v, want not found", err)
	}
}

func TestLedgerPostgreSQLAccountLifecycle(t *testing.T) {
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
	userID, categoryID := uuid.New(), uuid.New()
	seedLedgerOwner(t, ctx, db, userID, categoryID, "ledger-lifecycle-")
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=$1`, userID) })
	service := NewLedgerService(db)
	service.now = func() time.Time { return time.Date(2026, time.September, 20, 12, 0, 0, 0, time.UTC) }
	opened := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	key := uuid.New()
	accountID := createLedgerAccount(t, ctx, service, userID, categoryID, "Lifecycle", 25, opened, key)
	input := AccountMutationInput{
		IdempotencyKey: &key, Name: "Lifecycle", CategoryID: categoryID, Currency: "KES",
		TrackingMode: "balance", OpeningValueMinor: 25, IsIncludedInNetWorth: true, OpenedAt: &opened,
	}
	retryID, err := service.CreateAccount(ctx, userID, input)
	if err != nil || retryID != accountID {
		t.Fatalf("idempotent account = %s, %v; want %s", retryID, err, accountID)
	}
	input.OpeningValueMinor = 26
	if _, err := service.CreateAccount(ctx, userID, input); !errors.Is(err, ErrLedgerConflict) {
		t.Fatalf("incompatible account retry error = %v, want conflict", err)
	}
	if err := service.UpdateAccount(ctx, userID, accountID, AccountMutationInput{
		Name: "Lifecycle Updated", CategoryID: categoryID, Currency: "KES", TrackingMode: "balance", IsIncludedInNetWorth: false,
	}); err != nil {
		t.Fatalf("update account: %v", err)
	}
	if err := service.DeleteAccount(ctx, userID, accountID, "Lifecycle Updated"); !errors.Is(err, ErrLedgerValidation) {
		t.Fatalf("active account deletion error = %v, want validation", err)
	}
	if err := service.SetAccountArchived(ctx, userID, accountID, true); err != nil {
		t.Fatalf("archive account: %v", err)
	}
	if err := service.DeleteAccount(ctx, userID, accountID, "wrong"); !errors.Is(err, ErrLedgerValidation) {
		t.Fatalf("wrong confirmation error = %v, want validation", err)
	}
	if err := service.DeleteAccount(ctx, userID, accountID, "Lifecycle Updated"); err != nil {
		t.Fatalf("delete archived account: %v", err)
	}
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE user_id=$1 AND id=$2)`, userID, accountID).Scan(&exists); err != nil || exists {
		t.Fatalf("deleted account exists = %v, query error = %v", exists, err)
	}
}

func seedLedgerOwner(t *testing.T, ctx context.Context, db *sql.DB, userID, categoryID uuid.UUID, prefix string) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, userID, prefix+userID.String()); err != nil {
		t.Fatalf("insert ledger user: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO user_settings (id,user_id,display_name,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,'Ledger','["KES","USD"]','Africa/Nairobi',now(),now())`, uuid.New(), userID); err != nil {
		t.Fatalf("insert ledger settings: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Cash',$3,'asset',now(),now())`, categoryID, userID, "cash-"+categoryID.String()); err != nil {
		t.Fatalf("insert ledger category: %v", err)
	}
}

func createLedgerAccount(t *testing.T, ctx context.Context, service *LedgerService, userID, categoryID uuid.UUID, name string, opening int64, opened time.Time, key uuid.UUID) uuid.UUID {
	t.Helper()
	accountID, err := service.CreateAccount(ctx, userID, AccountMutationInput{
		IdempotencyKey: &key, Name: name, CategoryID: categoryID, Currency: "KES", TrackingMode: "balance",
		OpeningValueMinor: opening, IsIncludedInNetWorth: true, OpenedAt: &opened,
	})
	if err != nil {
		t.Fatalf("create %s account: %v", name, err)
	}
	return accountID
}

func assertLedgerBalance(t *testing.T, ctx context.Context, db *sql.DB, userID, accountID uuid.UUID, want int64) {
	t.Helper()
	var got int64
	if err := db.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, userID, accountID).Scan(&got); err != nil {
		t.Fatalf("load account balance: %v", err)
	}
	if got != want {
		t.Fatalf("account %s balance = %d, want %d", accountID, got, want)
	}
}
