package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type assistantFixture struct {
	db                     *sql.DB
	userID, categoryID     uuid.UUID
	savingsID, brokerageID uuid.UUID
	ledger                 *LedgerService
	statements             *StatementImportService
	batches                *ImportBatchService
	investments            *InvestmentMutations
	metadata               *MetadataMutations
}

func seedAssistantFixture(t *testing.T, db *sql.DB, name string) assistantFixture {
	t.Helper()
	ctx := context.Background()
	fixture := assistantFixture{db: db, userID: uuid.New(), categoryID: uuid.New(), ledger: NewLedgerService(db),
		statements: NewStatementImportService(db), batches: NewImportBatchService(db), investments: NewInvestmentMutations(db),
		metadata: &MetadataMutations{db: db, now: time.Now}}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{fixture.userID, name + "-" + fixture.userID.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,$3,'["KES","USD"]','Africa/Nairobi',now(),now())`, []any{uuid.New(), fixture.userID, name}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Investments',$3,'asset',now(),now())`, []any{fixture.categoryID, fixture.userID, "investments-" + fixture.categoryID.String()}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}
	opened := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	var err error
	fixture.savingsID, err = fixture.ledger.CreateAccount(ctx, fixture.userID, AccountMutationInput{
		Name: name + " money market", CategoryID: fixture.categoryID, Currency: "KES", TrackingMode: "balance",
		OpeningValueMinor: 43333363, IsIncludedInNetWorth: true, OpenedAt: &opened,
	})
	if err != nil {
		t.Fatalf("create savings: %v", err)
	}
	fixture.brokerageID, err = fixture.ledger.CreateAccount(ctx, fixture.userID, AccountMutationInput{
		Name: name + " brokerage", CategoryID: fixture.categoryID, Currency: "USD", TrackingMode: "positions",
		IsIncludedInNetWorth: true, OpenedAt: &opened,
	})
	if err != nil {
		t.Fatalf("create brokerage: %v", err)
	}
	return fixture
}

func (fixture assistantFixture) balance(t *testing.T, accountID uuid.UUID) int64 {
	t.Helper()
	var value int64
	if err := fixture.db.QueryRow(`SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, fixture.userID, accountID).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func (fixture assistantFixture) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	if err := fixture.db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func (fixture assistantFixture) holding(t *testing.T, instrumentID uuid.UUID) string {
	t.Helper()
	tx, err := fixture.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	holdings, err := holdingsOnDate(context.Background(), tx, fixture.userID, fixture.brokerageID, farFuture)
	if err != nil {
		t.Fatal(err)
	}
	return canonicalRat(cloneRat(holdings[instrumentID]))
}

func (fixture assistantFixture) cash(t *testing.T) int64 {
	t.Helper()
	value, err := balanceOnDate(context.Background(), fixture.db, fixture.userID, fixture.brokerageID, "positions", farFuture, nil)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

// eticaStatement is 51 days of net interest from 17 September plus two deposits.
func eticaStatement() ([]StatementTransaction, int64) {
	rows := []StatementTransaction{}
	total := int64(0)
	start := time.Date(2026, time.September, 17, 0, 0, 0, 0, time.UTC)
	for day := 0; day < 51; day++ {
		cents := int64(12261 + day)
		rows = append(rows, StatementTransaction{
			ExternalID: fmt.Sprintf("etica-%s-interest", start.AddDate(0, 0, day).Format(time.DateOnly)),
			Date:       start.AddDate(0, 0, day).Format(time.DateOnly), Type: "interest",
			Amount: fmt.Sprintf("%d.%02d", cents/100, cents%100), Currency: "KES", Description: "Daily net interest",
		})
		total += cents
	}
	rows = append(rows,
		StatementTransaction{ExternalID: "etica-2026-10-06-deposit", Date: "2026-10-06", Type: "deposit", Amount: "130000.00", Currency: "KES", Description: "Investment deposit"},
		StatementTransaction{ExternalID: "etica-2026-10-20-deposit", Date: "2026-10-20", Type: "deposit", Amount: "130000.00", Currency: "KES", Description: "Investment deposit"},
	)
	return rows, total + 2*13000000
}

func TestStatementImportIsAtomicIdempotentAndReconcilesBalances(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	other := seedAssistantFixture(t, db, "other")
	rows, sum := eticaStatement()
	opening := fixture.balance(t, fixture.savingsID)
	key := uuid.New()
	input := StatementImportInput{AccountID: fixture.savingsID, Source: "etica_statement", Transactions: rows,
		ClosingBalance: &StatementBalance{Date: "2026-11-06", Amount: formatDerivedAmount(opening+sum-1, "KES")}}

	preview := input
	preview.DryRun = true
	previewed, err := fixture.statements.Import(ctx, fixture.userID, preview)
	if err != nil {
		t.Fatal(err)
	}
	if previewed.Status != "preview" || previewed.Created != 53 || previewed.BalanceAfterMinor != opening+sum || fixture.balance(t, fixture.savingsID) != opening {
		t.Fatalf("preview = %+v, balance %d", previewed, fixture.balance(t, fixture.savingsID))
	}
	if previewed.ClosingBalance == nil || previewed.ClosingBalance.DifferenceMinor != 1 || !strings.Contains(strings.Join(previewed.Warnings, " "), "differs by 0.01 KES") {
		t.Fatalf("closing check = %+v warnings %v", previewed.ClosingBalance, previewed.Warnings)
	}

	commit := input
	commit.IdempotencyKey, commit.ExpectedHash = &key, previewed.Hash
	imported, err := fixture.statements.Import(ctx, fixture.userID, commit)
	if err != nil {
		t.Fatal(err)
	}
	if imported.Status != "completed" || imported.Created != 53 || imported.ImportID == nil || imported.BalanceBeforeMinor != opening || imported.BalanceAfterMinor != opening+sum {
		t.Fatalf("import = %+v", imported)
	}
	if got := fixture.balance(t, fixture.savingsID); got != opening+sum {
		t.Fatalf("balance = %d, want %d", got, opening+sum)
	}
	// The statement differed by a cent; nothing balancing was created.
	if n := fixture.count(t, `SELECT count(*) FROM transactions WHERE account_id=$1 AND type='manual_adjustment'`, fixture.savingsID); n != 0 {
		t.Fatalf("balancing adjustments = %d", n)
	}
	if n := fixture.count(t, `SELECT count(*) FROM transactions WHERE import_batch_id=$1`, *imported.ImportID); n != 53 {
		t.Fatalf("batch transactions = %d", n)
	}

	replayed, err := fixture.statements.Import(ctx, fixture.userID, commit)
	if err != nil || replayed.Status != "replayed" || replayed.Created != 53 || *replayed.ImportID != *imported.ImportID {
		t.Fatalf("idempotent retry = %+v, %v", replayed, err)
	}
	changed := commit
	changed.ExpectedHash, changed.Transactions = "", rows[:2]
	if _, err := fixture.statements.Import(ctx, fixture.userID, changed); !errors.Is(err, ErrLedgerConflict) {
		t.Fatalf("reused key with another import err = %v", err)
	}

	again := input
	reimported, err := fixture.statements.Import(ctx, fixture.userID, again)
	if err != nil || reimported.Status != "unchanged" || reimported.Duplicates != 53 || reimported.Created != 0 || reimported.ImportID != nil {
		t.Fatalf("second import = %+v, %v", reimported, err)
	}
	if got := fixture.balance(t, fixture.savingsID); got != opening+sum {
		t.Fatalf("balance after re-import = %d", got)
	}
	if _, err := fixture.statements.Import(ctx, other.userID, input); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("another user's import err = %v", err)
	}
}

func TestStatementImportMatchingKeepsLegitimateRepeatsAndReportsAmbiguity(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	opening := fixture.balance(t, fixture.savingsID)

	identical := []StatementTransaction{
		{Date: "2026-10-01", Type: "deposit", Amount: "500.00"},
		{Date: "2026-10-01", Type: "deposit", Amount: "500.00"},
	}
	first, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: identical})
	if err != nil || first.Created != 2 {
		t.Fatalf("identical rows = %+v, %v", first, err)
	}
	second, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: identical})
	if err != nil || second.Created != 0 || second.Duplicates != 2 {
		t.Fatalf("identical rows again = %+v, %v", second, err)
	}

	if _, err := fixture.ledger.CreateTransaction(ctx, fixture.userID, TransactionMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.savingsID, Type: "interest", AmountMinor: 4200, TransactionDate: time.Date(2026, time.October, 31, 0, 0, 0, 0, time.UTC)}); err != nil {
		t.Fatal(err)
	}
	statement := []StatementTransaction{
		{ExternalID: "mmf-2026-10-interest", Date: "2026-10-31", Type: "interest", Amount: "42.00"},
		{ExternalID: "mmf-2026-10-interest-b", Date: "2026-10-31", Type: "interest", Amount: "42.00"},
	}
	ambiguous, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: statement})
	if err != nil || ambiguous.PossibleDuplicates != 1 || ambiguous.Created != 1 || ambiguous.Rows[0].Status != "possible_duplicate" {
		t.Fatalf("possible duplicate = %+v, %v", ambiguous, err)
	}
	allowed, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: statement[:1], AllowPossibleDuplicates: true})
	if err != nil || allowed.Created != 1 {
		t.Fatalf("allowed possible duplicate = %+v, %v", allowed, err)
	}
	if got, want := fixture.balance(t, fixture.savingsID), opening+100000+4200*3; got != want {
		t.Fatalf("balance = %d, want %d", got, want)
	}

	before := fixture.balance(t, fixture.savingsID)
	bad := []StatementTransaction{
		{ExternalID: "ok-1", Date: "2026-10-02", Type: "deposit", Amount: "10.00"},
		{ExternalID: "bad-1", Date: "2026-10-02", Type: "deposit", Amount: "10.005"},
		{ExternalID: "bad-2", Date: "2026-10-02", Type: "transfer", Amount: "10.00"},
		{ExternalID: "bad-3", Date: "2026-10-02", Type: "deposit", Amount: "10.00", Currency: "USD"},
		{ExternalID: "mmf-2026-10-interest", Date: "2026-10-31", Type: "interest", Amount: "43.00"},
	}
	rejected, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: bad})
	if err != nil || rejected.Status != "rejected" || rejected.Created != 0 || rejected.Rejected != 3 || rejected.Conflicts != 1 || fixture.balance(t, fixture.savingsID) != before {
		t.Fatalf("atomic rejection = %+v, %v", rejected, err)
	}
	partial, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: bad, AllowPartial: true})
	if err != nil || partial.Status != "completed" || partial.Created != 1 || fixture.balance(t, fixture.savingsID) != before+1000 {
		t.Fatalf("partial import = %+v, %v", partial, err)
	}
	// The conflicting row left the existing record untouched.
	if n := fixture.count(t, `SELECT count(*) FROM transactions WHERE account_id=$1 AND external_id='mmf-2026-10-interest' AND amount_minor=4200`, fixture.savingsID); n != 1 {
		t.Fatalf("conflicting record was overwritten")
	}
}

func TestStatementReconciliationMatchesMonthlyInterestAndTaxIndependently(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	if _, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: []StatementTransaction{
		{ExternalID: "madison-2026-09-interest", Date: "2026-09-30", Type: "interest", Amount: "3500.00"},
		{ExternalID: "madison-2026-09-wht", Date: "2026-09-30", Type: "fee", Amount: "525.00", Description: "Withholding tax"},
		{ExternalID: "madison-2026-10-interest", Date: "2026-10-31", Type: "interest", Amount: "3600.00"},
	}}); err != nil {
		t.Fatal(err)
	}
	extra, err := fixture.ledger.CreateTransaction(ctx, fixture.userID, TransactionMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.savingsID, Type: "deposit", AmountMinor: 100, TransactionDate: time.Date(2026, time.October, 15, 0, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	before := fixture.count(t, `SELECT count(*) FROM transactions WHERE account_id=$1`, fixture.savingsID)
	statement := []StatementTransaction{
		{ExternalID: "madison-2026-09-interest", Date: "2026-09-30", Type: "interest", Amount: "3500.00"},
		{ExternalID: "madison-2026-09-wht", Date: "2026-09-30", Type: "fee", Amount: "525.00"},
		{ExternalID: "madison-2026-10-interest", Date: "2026-10-31", Type: "interest", Amount: "3600.00"},
		{ExternalID: "madison-2026-10-wht", Date: "2026-10-31", Type: "fee", Amount: "540.00"},
	}
	result, err := fixture.statements.Reconcile(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: statement})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "reconciled" || result.Duplicates != 3 || result.Created != 0 || result.Rows[3].Status != "create" || result.Rows[3].Date != "2026-10-31" {
		t.Fatalf("reconciliation = %+v", result)
	}
	if len(result.UnmatchedExisting) != 1 || result.UnmatchedExisting[0].ID != extra {
		t.Fatalf("unmatched existing = %+v", result.UnmatchedExisting)
	}
	if after := fixture.count(t, `SELECT count(*) FROM transactions WHERE account_id=$1`, fixture.savingsID); after != before {
		t.Fatalf("reconciliation wrote %d records", after-before)
	}
	if _, err := fixture.ledger.CreateTransaction(ctx, fixture.userID, TransactionMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.savingsID, Type: "fee", AmountMinor: 300, TransactionDate: time.Date(2026, time.October, 5, 0, 0, 0, 0, time.UTC)}); err != nil {
		t.Fatal(err)
	}
	tax, err := (&FeatureReads{db: db, now: time.Now}).TaxReport(ctx, fixture.userID, 2026, &fixture.savingsID)
	if err != nil || len(tax.Accounts) != 1 {
		t.Fatalf("tax report = %+v, %v", tax, err)
	}
	if line := tax.Accounts[0]; line.InterestMinor != "710000" || line.WithholdingTaxMinor != "52500" || line.FeesMinor != "300" {
		t.Fatalf("tax totals = %+v", line)
	}
}

func TestImportRollbackRefusesEditedRecordsAndRestoresBalances(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	other := seedAssistantFixture(t, db, "other")
	opening := fixture.balance(t, fixture.savingsID)
	edited, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: []StatementTransaction{
		{ExternalID: "a", Date: "2026-10-01", Type: "deposit", Amount: "100.00"},
		{ExternalID: "b", Date: "2026-10-02", Type: "deposit", Amount: "200.00"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	untouched, err := fixture.statements.Import(ctx, fixture.userID, StatementImportInput{AccountID: fixture.savingsID, Transactions: []StatementTransaction{
		{ExternalID: "c", Date: "2026-10-03", Type: "interest", Amount: "7.00"},
	}, ClosingBalance: &StatementBalance{Date: "2026-10-03", Amount: formatDerivedAmount(opening+30700, "KES")}})
	if err != nil || untouched.ClosingBalance == nil || !untouched.ClosingBalance.Matches {
		t.Fatalf("second import = %+v, %v", untouched, err)
	}
	statuses, err := fixture.batches.ReconciliationStatus(ctx, fixture.userID, &fixture.savingsID)
	if err != nil || statuses[0].Status != "reconciled" {
		t.Fatalf("reconciliation status = %+v, %v", statuses, err)
	}

	editedID := *edited.Rows[0].TransactionID
	if err := fixture.ledger.UpdateTransaction(ctx, fixture.userID, editedID, TransactionMutationInput{Type: "deposit", AmountMinor: 15000, TransactionDate: time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC), ExternalID: "a"}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.batches.Rollback(ctx, fixture.userID, *edited.ImportID); !errors.Is(err, ErrLedgerConflict) || !strings.Contains(err.Error(), "edited") {
		t.Fatalf("rollback of edited import err = %v", err)
	}
	// The edit moved the statement date's balance, so the reconciled statement is now out of balance.
	statuses, _ = fixture.batches.ReconciliationStatus(ctx, fixture.userID, &fixture.savingsID)
	if statuses[0].Status != "out_of_balance" || *statuses[0].DifferenceMinor != "5000" {
		t.Fatalf("status after edit = %+v", statuses[0])
	}
	if _, err := fixture.batches.Rollback(ctx, other.userID, *untouched.ImportID); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("another user's rollback err = %v", err)
	}
	rolled, err := fixture.batches.Rollback(ctx, fixture.userID, *untouched.ImportID)
	if err != nil || rolled.DeletedTransactions != 1 || rolled.BalanceAfterMinor != opening+35000 || fixture.balance(t, fixture.savingsID) != opening+35000 {
		t.Fatalf("rollback = %+v, %v", rolled, err)
	}
	if _, err := fixture.batches.Rollback(ctx, fixture.userID, *untouched.ImportID); !errors.Is(err, ErrLedgerConflict) {
		t.Fatalf("second rollback err = %v", err)
	}
	// Unrelated records survive: both edited-batch rows remain.
	if n := fixture.count(t, `SELECT count(*) FROM transactions WHERE import_batch_id=$1`, *edited.ImportID); n != 2 {
		t.Fatalf("edited batch rows = %d", n)
	}
	history, err := fixture.batches.List(ctx, fixture.userID, ImportBatchFilter{AccountID: &fixture.savingsID, Page: ReadPage{Limit: 10}})
	if err != nil || len(history.Items) != 2 || history.Items[0].Status != "rolled_back" || history.Items[1].TransactionCount != 2 {
		t.Fatalf("history = %+v, %v", history, err)
	}
}

func TestBulkTransactionChangesAreAtomicAndReplayBalances(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	other := seedAssistantFixture(t, db, "other")
	opening := fixture.balance(t, fixture.savingsID)
	date := func(day int) time.Time { return time.Date(2026, time.October, day, 0, 0, 0, 0, time.UTC) }
	create := func(day int, amount int64) uuid.UUID {
		id, err := fixture.ledger.CreateTransaction(ctx, fixture.userID, TransactionMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.savingsID, Type: "deposit", AmountMinor: amount, TransactionDate: date(day)})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	first, second, third := create(1, 1000), create(2, 2000), create(3, 3000)
	detail, err := fixture.ledger.GetTransaction(ctx, fixture.userID, first)
	if err != nil || detail.AmountMinor != "1000" {
		t.Fatalf("detail = %+v, %v", detail, err)
	}
	stale := detail.UpdatedAt.Add(-time.Second)
	_, err = fixture.ledger.BulkUpdateTransactions(ctx, fixture.userID, []TransactionUpdate{
		{ID: second, Input: TransactionMutationInput{Type: "deposit", AmountMinor: 9999, TransactionDate: date(2)}},
		{ID: first, Input: TransactionMutationInput{Type: "deposit", AmountMinor: 5000, TransactionDate: date(1)}, ExpectedUpdatedAt: &stale},
	})
	if !errors.Is(err, ErrLedgerConflict) || !strings.Contains(err.Error(), "item 2") {
		t.Fatalf("stale update err = %v", err)
	}
	if got := fixture.balance(t, fixture.savingsID); got != opening+6000 {
		t.Fatalf("a failed bulk update changed the balance: %d", got)
	}
	if _, err := fixture.ledger.BulkUpdateTransactions(ctx, fixture.userID, []TransactionUpdate{
		{ID: first, Input: TransactionMutationInput{Type: "withdrawal", AmountMinor: 500, TransactionDate: date(1)}, ExpectedUpdatedAt: &detail.UpdatedAt},
		{ID: second, Input: TransactionMutationInput{Type: "deposit", AmountMinor: 2500, TransactionDate: date(4)}},
	}); err != nil {
		t.Fatal(err)
	}
	if got := fixture.balance(t, fixture.savingsID); got != opening-500+2500+3000 {
		t.Fatalf("balance after bulk update = %d", got)
	}
	if _, err := fixture.ledger.BulkUpdateTransactions(ctx, other.userID, []TransactionUpdate{{ID: third, Input: TransactionMutationInput{Type: "deposit", AmountMinor: 1, TransactionDate: date(3)}}}); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("cross-user update err = %v", err)
	}
	if _, err := fixture.ledger.BulkDeleteTransactions(ctx, fixture.userID, []uuid.UUID{third, uuid.New()}); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("delete with missing ID err = %v", err)
	}
	if fixture.count(t, `SELECT count(*) FROM transactions WHERE id=$1`, third) != 1 {
		t.Fatal("a failed bulk delete removed a record")
	}
	if _, err := fixture.ledger.BulkDeleteTransactions(ctx, other.userID, []uuid.UUID{third}); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("cross-user delete err = %v", err)
	}

	// A historical edit before a valuation doesn't move the balance after the valuation.
	valuationID, err := fixture.ledger.CreateValuation(ctx, fixture.userID, ValuationMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.savingsID, ValueMinor: 1_000_000, ValuationDate: date(10)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.ledger.BulkDeleteTransactions(ctx, fixture.userID, []uuid.UUID{third}); err != nil {
		t.Fatal(err)
	}
	if got := fixture.balance(t, fixture.savingsID); got != 1_000_000 {
		t.Fatalf("balance after deleting a pre-valuation record = %d", got)
	}
	if err := fixture.ledger.UpdateValuation(ctx, fixture.userID, valuationID, ValuationMutationInput{ValueMinor: 1_200_000, ValuationDate: date(11)}); err != nil {
		t.Fatal(err)
	}
	if got := fixture.balance(t, fixture.savingsID); got != 1_200_000 {
		t.Fatalf("balance after valuation update = %d", got)
	}
	if err := fixture.ledger.UpdateValuation(ctx, other.userID, valuationID, ValuationMutationInput{ValueMinor: 1, ValuationDate: date(11)}); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("cross-user valuation update err = %v", err)
	}
}

func expectedPositionValue(t *testing.T, quantity, price string) int64 {
	t.Helper()
	value, err := decimalProductMinor(quantity, price, "USD")
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestPositionSnapshotsTradesAndCashAreNotDoubleCounted(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	other := seedAssistantFixture(t, db, "other")
	if _, err := fixture.ledger.CreateTransaction(ctx, fixture.userID, TransactionMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.brokerageID, Type: "deposit", AmountMinor: 1_200_000, TransactionDate: time.Date(2026, time.March, 1, 0, 0, 0, 0, time.UTC)}); err != nil {
		t.Fatal(err)
	}
	asOf := time.Date(2026, time.November, 5, 0, 0, 0, 0, time.UTC)
	vwra := InstrumentRef{ISIN: "IE00BK5BQT80", Symbol: "VWRA", ExchangeMIC: "XLON", Name: "Vanguard FTSE All-World", AssetType: "etf", QuoteCurrency: "USD"}
	xuse := InstrumentRef{ISIN: "IE00BK5BR626", Symbol: "XUSE", ExchangeMIC: "XLON", Name: "Xtrackers MSCI World ex USA", AssetType: "etf", QuoteCurrency: "USD"}
	eimi := InstrumentRef{ISIN: "IE00BKM4GZ66", Symbol: "EIMI", ExchangeMIC: "XLON", Name: "iShares Core MSCI EM IMI", AssetType: "etf", QuoteCurrency: "USD"}
	sync := PositionSyncInput{AccountID: fixture.brokerageID, AsOf: asOf, Source: "interactive_brokers", CreateMissingInstruments: true,
		Positions: []PositionSnapshotInput{{Instrument: vwra, Quantity: "50.9006", UnitPrice: "184.98", Currency: "USD"}, {Instrument: xuse, Quantity: "157", UnitPrice: "6.977"}, {Instrument: eimi, Quantity: "14", UnitPrice: "48.91"}},
		Cash:      map[string]string{"USD": "96.39"}}
	if _, err := fixture.investments.SyncPositions(ctx, other.userID, sync); !errors.Is(err, ErrLedgerNotFound) {
		t.Fatalf("another user's sync err = %v", err)
	}
	preview := sync
	preview.DryRun = true
	if previewed, err := fixture.investments.SyncPositions(ctx, fixture.userID, preview); err != nil || previewed.Status != "preview" || fixture.count(t, `SELECT count(*) FROM investment_instruments WHERE user_id=$1`, fixture.userID) != 0 {
		t.Fatalf("dry-run sync = %+v, %v", previewed, err)
	}
	synced, err := fixture.investments.SyncPositions(ctx, fixture.userID, sync)
	if err != nil {
		t.Fatal(err)
	}
	if synced.Status != "completed" || synced.InstrumentsCreated != 3 || synced.PricesRecorded != 3 || synced.Cash.TargetMinor != 9639 || synced.ImportID == nil {
		t.Fatalf("sync = %+v", synced)
	}
	vwraID := uuid.MustParse(synced.Positions[0].InstrumentID)
	positions := expectedPositionValue(t, "50.9006", "184.98") + expectedPositionValue(t, "157", "6.977") + expectedPositionValue(t, "14", "48.91")
	if got := fixture.balance(t, fixture.brokerageID); got != 9639+positions || synced.AccountValueAfterMinor != got {
		t.Fatalf("account value = %d (result %d), want %d", got, synced.AccountValueAfterMinor, 9639+positions)
	}
	if n := fixture.count(t, `SELECT count(*) FROM position_events WHERE account_id=$1 AND type IN ('buy','sell')`, fixture.brokerageID); n != 0 {
		t.Fatalf("sync invented %d trades", n)
	}
	// Retrying the same snapshot changes nothing.
	if again, err := fixture.investments.SyncPositions(ctx, fixture.userID, sync); err != nil || again.Status != "unchanged" || again.Positions[0].Status != "unchanged" {
		t.Fatalf("repeat sync = %+v, %v", again, err)
	}

	trades := TradeImportInput{AccountID: fixture.brokerageID, Source: "interactive_brokers", Trades: []TradeInput{
		{Instrument: InstrumentRef{ISIN: vwra.ISIN}, ExternalID: "ibkr-1", TradeDate: "2026-10-01", SettlementDate: "2026-10-03", Side: "buy", Quantity: "1", Price: "180", Commission: "1.25"},
		{Instrument: InstrumentRef{Symbol: "VWRA", ExchangeMIC: "XLON"}, ExternalID: "ibkr-2", TradeDate: "2026-11-06", Side: "buy", Quantity: "2", Price: "185", Commission: "1.00", OtherFees: "0.50"},
	}}
	imported, err := fixture.investments.ImportTrades(ctx, fixture.userID, trades)
	if err != nil || imported.Created != 2 || imported.Status != "completed" {
		t.Fatalf("trade import = %+v, %v", imported, err)
	}
	// The October trade is already inside the 5 November snapshot; only the later trade adds.
	if got := fixture.holding(t, vwraID); got != "52.9006" {
		t.Fatalf("VWRA holding = %s, want 52.9006", got)
	}
	if got := fixture.cash(t); got != 9639-37150 {
		t.Fatalf("cash = %d, want %d", got, 9639-37150)
	}
	duplicate, err := fixture.investments.ImportTrades(ctx, fixture.userID, trades)
	if err != nil || duplicate.Created != 0 || duplicate.Duplicates != 2 || duplicate.Status != "unchanged" {
		t.Fatalf("repeat trade import = %+v, %v", duplicate, err)
	}
	conflicting := trades
	conflicting.Trades = []TradeInput{{Instrument: InstrumentRef{ISIN: vwra.ISIN}, ExternalID: "ibkr-2", TradeDate: "2026-11-06", Side: "buy", Quantity: "3", Price: "185"}}
	if result, err := fixture.investments.ImportTrades(ctx, fixture.userID, conflicting); err != nil || result.Status != "rejected" || result.Conflicts != 1 {
		t.Fatalf("conflicting trade = %+v, %v", result, err)
	}
	oversell := trades
	oversell.Trades = []TradeInput{{Instrument: InstrumentRef{ISIN: eimi.ISIN}, TradeDate: "2026-11-06", Side: "sell", Quantity: "15", Price: "49"}}
	if result, err := fixture.investments.ImportTrades(ctx, fixture.userID, oversell); err != nil || result.Status != "rejected" || result.Rows[0].Status != "rejected" {
		t.Fatalf("oversell = %+v, %v", result, err)
	}
	ambiguous := trades
	ambiguous.Trades = []TradeInput{{Instrument: InstrumentRef{Symbol: "NOPE"}, TradeDate: "2026-11-06", Side: "buy", Quantity: "1", Price: "1"}}
	if result, err := fixture.investments.ImportTrades(ctx, fixture.userID, ambiguous); err != nil || result.Rows[0].Code != "instrument_not_found" {
		t.Fatalf("missing instrument = %+v, %v", result, err)
	}

	// An older snapshot is history: it doesn't change current holdings.
	older := PositionSyncInput{AccountID: fixture.brokerageID, AsOf: time.Date(2026, time.October, 15, 0, 0, 0, 0, time.UTC), Source: "interactive_brokers",
		Positions: []PositionSnapshotInput{{Instrument: InstrumentRef{ISIN: vwra.ISIN}, Quantity: "40"}}}
	historical, err := fixture.investments.SyncPositions(ctx, fixture.userID, older)
	if err != nil || historical.Positions[0].Status != "historical" {
		t.Fatalf("older snapshot = %+v, %v", historical, err)
	}
	if got := fixture.holding(t, vwraID); got != "52.9006" {
		t.Fatalf("holding after older snapshot = %s", got)
	}

	// Rolling back the trades leaves the snapshot quantity.
	if _, err := fixture.batches.Rollback(ctx, fixture.userID, *imported.ImportID); err != nil {
		t.Fatal(err)
	}
	if got := fixture.holding(t, vwraID); got != "50.9006" {
		t.Fatalf("holding after trade rollback = %s", got)
	}
	if got := fixture.cash(t); got != 9639 {
		t.Fatalf("cash after trade rollback = %d", got)
	}

	cashOnly, err := fixture.investments.SyncPositions(ctx, fixture.userID, PositionSyncInput{AccountID: fixture.brokerageID, AsOf: time.Date(2026, time.November, 6, 0, 0, 0, 0, time.UTC), Cash: map[string]string{"USD": "120.00"}})
	if err != nil || cashOnly.Cash.PreviousMinor != 9639 || fixture.cash(t) != 12000 {
		t.Fatalf("cash sync = %+v, %v (cash %d)", cashOnly, err, fixture.cash(t))
	}
	// Editing only a snapshot's description keeps it absolute: a deposit backfilled before it
	// is absorbed rather than added on top.
	var snapshotID uuid.UUID
	var snapshotAmount int64
	if err := db.QueryRow(`SELECT id,amount_minor FROM transactions WHERE account_id=$1 AND cash_snapshot_minor=12000`, fixture.brokerageID).Scan(&snapshotID, &snapshotAmount); err != nil {
		t.Fatal(err)
	}
	snapshotDate := time.Date(2026, time.November, 6, 0, 0, 0, 0, time.UTC)
	if err := fixture.ledger.UpdateTransaction(ctx, fixture.userID, snapshotID, TransactionMutationInput{Type: "manual_adjustment", AmountMinor: snapshotAmount, TransactionDate: snapshotDate, Description: "Statement cash"}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.ledger.CreateTransaction(ctx, fixture.userID, TransactionMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.brokerageID, Type: "deposit", AmountMinor: 5000, TransactionDate: time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC)}); err != nil {
		t.Fatal(err)
	}
	if got := fixture.cash(t); got != 12000 {
		t.Fatalf("cash after text edit and backfill = %d, want 12000", got)
	}
	// Changing the amount makes it a fixed adjustment.
	if err := fixture.ledger.UpdateTransaction(ctx, fixture.userID, snapshotID, TransactionMutationInput{Type: "manual_adjustment", AmountMinor: 100, TransactionDate: snapshotDate}); err != nil {
		t.Fatal(err)
	}
	if fixture.count(t, `SELECT count(*) FROM transactions WHERE id=$1 AND cash_snapshot_minor IS NULL`, snapshotID) != 1 {
		t.Fatal("an amount edit kept the snapshot")
	}
	// A dry run may reuse the key of a committed sync.
	keyed := uuid.New()
	resync := PositionSyncInput{AccountID: fixture.brokerageID, AsOf: snapshotDate, IdempotencyKey: &keyed, Cash: map[string]string{"USD": "120.00"}}
	if _, err := fixture.investments.SyncPositions(ctx, fixture.userID, resync); err != nil {
		t.Fatal(err)
	}
	resync.DryRun = true
	if previewed, err := fixture.investments.SyncPositions(ctx, fixture.userID, resync); err != nil || previewed.Status != "preview" {
		t.Fatalf("dry run with a used key = %+v, %v", previewed, err)
	}
	if result, err := fixture.investments.SyncPositions(ctx, fixture.userID, PositionSyncInput{AccountID: fixture.brokerageID, AsOf: asOf, Cash: map[string]string{"KES": "1"}}); err != nil || result.Status != "rejected" {
		t.Fatalf("foreign cash currency = %+v, %v", result, err)
	}
	if _, err := fixture.investments.SyncPositions(ctx, fixture.userID, PositionSyncInput{AccountID: fixture.savingsID, AsOf: asOf, Cash: map[string]string{"KES": "1"}}); !errors.Is(err, ErrLedgerValidation) {
		t.Fatalf("sync of a balance account err = %v", err)
	}

	removed, err := fixture.investments.DeletePosition(ctx, fixture.userID, fixture.brokerageID, InstrumentRef{ISIN: eimi.ISIN}, nil, false)
	if err != nil || removed.DeletedSnapshots != 1 || removed.RemainingQuantity != "0" {
		t.Fatalf("delete position = %+v, %v", removed, err)
	}

	// A snapshot that confirms the current quantity stores a zero delta; exports leave
	// it out so the archive restores, and every value survives the round trip.
	confirmed, err := fixture.investments.SyncPositions(ctx, fixture.userID, PositionSyncInput{AccountID: fixture.brokerageID, AsOf: time.Date(2026, time.November, 6, 0, 0, 0, 0, time.UTC),
		Positions: []PositionSnapshotInput{{Instrument: InstrumentRef{ISIN: vwra.ISIN}, Quantity: "50.9006"}}, Cash: map[string]string{"USD": "120.00"}})
	if err != nil || confirmed.Positions[0].Status != "confirmed" {
		t.Fatalf("confirming snapshot = %+v, %v", confirmed, err)
	}
	valueBefore := fixture.balance(t, fixture.brokerageID)
	portability := NewPortabilityService(db)
	archive, err := portability.ExportJSON(ctx, fixture.userID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := portability.RestoreJSON(ctx, fixture.userID, archive); err != nil {
		t.Fatalf("restore after sync: %v", err)
	}
	var restored int64
	if err := db.QueryRow(`SELECT current_value_minor FROM accounts WHERE user_id=$1 AND tracking_mode='positions'`, fixture.userID).Scan(&restored); err != nil || restored != valueBefore {
		t.Fatalf("restored value = %d, want %d (%v)", restored, valueBefore, err)
	}
}

func TestPricesAndExchangeRatesAreEffectiveDatedAndScoped(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	other := seedAssistantFixture(t, db, "other")
	instrumentID, err := fixture.investments.CreateInstrument(ctx, fixture.userID, InstrumentMutationInput{Name: "Fund", IdentifierType: "isin", Identifier: "IE0000000001", AssetType: "fund", QuoteCurrency: "USD"})
	if err != nil {
		t.Fatal(err)
	}
	ref := InstrumentRef{InstrumentID: &instrumentID}
	result, err := fixture.investments.BulkUpsertPrices(ctx, fixture.userID, []PriceInput{
		{Instrument: ref, Date: "2026-11-01", Price: "10.5", Source: "ibkr"},
		{Instrument: ref, Date: "2026-10-01", Price: "9.75"},
	})
	if err != nil || result.Created != 2 || !result.Rows[1].Historical || result.Rows[0].Historical {
		t.Fatalf("prices = %+v, %v", result, err)
	}
	if again, err := fixture.investments.BulkUpsertPrices(ctx, fixture.userID, []PriceInput{{Instrument: ref, Date: "2026-11-01", Price: "10.50", Source: "ibkr"}}); err != nil || again.Unchanged != 1 {
		t.Fatalf("same price = %+v, %v", again, err)
	}
	if mismatch, err := fixture.investments.BulkUpsertPrices(ctx, fixture.userID, []PriceInput{{Instrument: ref, Date: "2026-11-02", Price: "1", Currency: "KES"}, {Instrument: ref, Date: "2026-11-03", Price: "1"}}); err != nil || mismatch.Status != "rejected" || mismatch.Rows[0].Code != "currency_mismatch" {
		t.Fatalf("currency mismatch = %+v, %v", mismatch, err)
	}
	if fixture.count(t, `SELECT count(*) FROM security_prices WHERE instrument_id=$1`, instrumentID) != 2 {
		t.Fatal("a rejected batch stored a price")
	}
	if foreign, err := fixture.investments.BulkUpsertPrices(ctx, other.userID, []PriceInput{{Instrument: ref, Date: "2026-11-01", Price: "1"}}); err != nil || foreign.Rows[0].Code != "instrument_not_found" {
		t.Fatalf("another user's instrument = %+v, %v", foreign, err)
	}
	history, err := (&FeatureReads{db: db, now: func() time.Time { return time.Date(2026, time.December, 31, 12, 0, 0, 0, time.UTC) }}).PriceHistory(ctx, fixture.userID, instrumentID, nil, nil, 10)
	if err != nil || len(history.Prices) != 2 || history.Prices[0].PriceCategory != "stale" || history.Prices[1].PriceCategory != "historical" || !history.Stale {
		t.Fatalf("price history = %+v, %v", history, err)
	}

	rates, err := fixture.metadata.UpsertExchangeRates(ctx, fixture.userID, []ExchangeRateUpsert{
		{BaseCurrency: "USD", QuoteCurrency: "KES", Rate: "129.25", EffectiveDate: "2026-11-01", Source: "cbk"},
		{BaseCurrency: "USD", QuoteCurrency: "KES", Rate: "128.10", EffectiveDate: "2026-10-01"},
	})
	if err != nil || rates.Created != 2 || !rates.Rows[1].Historical {
		t.Fatalf("rates = %+v, %v", rates, err)
	}
	updated, err := fixture.metadata.UpsertExchangeRates(ctx, fixture.userID, []ExchangeRateUpsert{{BaseCurrency: "USD", QuoteCurrency: "KES", Rate: "129.30", EffectiveDate: "2026-11-01", Source: "cbk"}})
	if err != nil || updated.Updated != 1 {
		t.Fatalf("rate update = %+v, %v", updated, err)
	}
	if reverse, err := fixture.metadata.UpsertExchangeRates(ctx, fixture.userID, []ExchangeRateUpsert{{BaseCurrency: "KES", QuoteCurrency: "USD", Rate: "0.0077", EffectiveDate: "2026-11-02"}}); err != nil || reverse.Status != "rejected" {
		t.Fatalf("reverse pair = %+v, %v", reverse, err)
	}
	var stored string
	if err := db.QueryRow(`SELECT rate::TEXT FROM exchange_rates WHERE user_id=$1 AND effective_date='2026-11-01'`, fixture.userID).Scan(&stored); err != nil || !equalDecimals(stored, "129.30") {
		t.Fatalf("stored rate = %s, %v", stored, err)
	}
	if fixture.count(t, `SELECT count(*) FROM exchange_rates WHERE user_id=$1`, other.userID) != 0 {
		t.Fatal("rates leaked to another user")
	}
	listed, err := (&FeatureReads{db: db, now: time.Now}).ExchangeRates(ctx, fixture.userID, ExchangeRateFilter{Currency: "KES", Page: ReadPage{Limit: 10}})
	if err != nil || len(listed.Items) != 2 || !listed.Items[0].Latest || listed.Items[1].Latest {
		t.Fatalf("listed rates = %+v, %v", listed, err)
	}
}

func TestAuditLogIsOwnerScoped(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	other := seedAssistantFixture(t, db, "other")
	log := NewAuditLog(db)
	recordID := uuid.New()
	if err := log.Record(ctx, fixture.userID, AuditEntry{Channel: "mcp", Client: "key:1", Tool: "update_transaction", Action: "update", RecordType: "transaction", RecordIDs: []uuid.UUID{recordID}, AccountID: &fixture.savingsID}); err != nil {
		t.Fatal(err)
	}
	owned, err := log.List(ctx, fixture.userID, AuditFilter{Page: ReadPage{Limit: 10}})
	if err != nil || len(owned.Items) != 1 || owned.Items[0].RecordIDs[0] != recordID || owned.Items[0].Tool != "update_transaction" {
		t.Fatalf("owner audit = %+v, %v", owned, err)
	}
	foreign, err := log.List(ctx, other.userID, AuditFilter{Page: ReadPage{Limit: 10}})
	if err != nil || len(foreign.Items) != 0 {
		t.Fatalf("another user's audit = %+v, %v", foreign, err)
	}
}

func TestPerformanceReportSeparatesContributionsFromReturns(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	fixture := seedAssistantFixture(t, db, "owner")
	for _, item := range []struct {
		kind   string
		amount int64
		date   time.Time
	}{
		{"deposit", 10_000_000, time.Date(2026, time.June, 1, 0, 0, 0, 0, time.UTC)},
		{"interest", 100_000, time.Date(2026, time.July, 15, 0, 0, 0, 0, time.UTC)},
	} {
		if _, err := fixture.ledger.CreateTransaction(ctx, fixture.userID, TransactionMutationInput{IdempotencyKey: uuid.New(), AccountID: fixture.savingsID, Type: item.kind, AmountMinor: item.amount, TransactionDate: item.date}); err != nil {
			t.Fatal(err)
		}
	}
	report, err := NewInsightsService(NewSQLGoalsReportsRepository(db)).PerformanceReport(ctx, fixture.userID, "all")
	if err != nil {
		t.Fatal(err)
	}
	// The deposit and opening balance are contributions; only the interest is a return.
	if report.InvestmentReturnMinor != "100000" || report.TimeWeightedReturnPercent == nil || report.MoneyWeightedReturnPercent == nil {
		t.Fatalf("performance = %+v", report)
	}
	start, _ := new(big.Rat).SetString(report.StartValueMinor)
	end, _ := new(big.Rat).SetString(report.EndValueMinor)
	net, _ := new(big.Rat).SetString(report.NetContributionsMinor)
	if new(big.Rat).Sub(new(big.Rat).Sub(end, start), net).Cmp(big.NewRat(100000, 1)) != 0 {
		t.Fatalf("return doesn't bridge start, end, and contributions: %+v", report)
	}
	if got := *percent(big.NewRat(1, 8)); got != "12.50" {
		t.Fatalf("percent = %s", got)
	}
}
