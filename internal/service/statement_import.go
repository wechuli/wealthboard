package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/domain"
)

// MaxStatementRows bounds one statement import or reconciliation.
const MaxStatementRows = 1000

// StatementTransaction is one row an assistant extracted from an external statement.
type StatementTransaction struct {
	ExternalID  string `json:"externalId,omitempty"`
	Date        string `json:"date"`
	Type        string `json:"type"`
	Amount      string `json:"amount"`
	Currency    string `json:"currency,omitempty"`
	Description string `json:"description,omitempty"`
	Notes       string `json:"notes,omitempty"`
}

// StatementBalance is a balance printed on a statement.
type StatementBalance struct {
	Date   string `json:"date"`
	Amount string `json:"amount"`
}

type StatementImportInput struct {
	AccountID      uuid.UUID
	Source         string
	IdempotencyKey *uuid.UUID
	DryRun         bool
	// AllowPartial imports the valid rows when others are rejected or conflict.
	AllowPartial bool
	// AllowPossibleDuplicates creates rows that only structurally match an existing record.
	AllowPossibleDuplicates bool
	// ExpectedHash, when set, must equal the hash a preview of the same request returned.
	ExpectedHash   string
	ClosingBalance *StatementBalance
	Transactions   []StatementTransaction
	// From and To widen the reconciliation period; they default to the statement's dates.
	From, To *time.Time
}

type StatementRow struct {
	Index                int        `json:"index"`
	ExternalID           string     `json:"externalId,omitempty"`
	Date                 string     `json:"date"`
	Type                 string     `json:"type"`
	Amount               string     `json:"amount"`
	Status               string     `json:"status"`
	Code                 string     `json:"code"`
	Message              string     `json:"message"`
	TransactionID        *uuid.UUID `json:"transactionId,omitempty"`
	MatchedTransactionID *uuid.UUID `json:"matchedTransactionId,omitempty"`
	prepared             *accountHistoryPreparedRow
}

type BalanceCheck struct {
	Date            string `json:"date"`
	StatementMinor  int64  `json:"statementMinor"`
	CalculatedMinor int64  `json:"calculatedMinor"`
	DifferenceMinor int64  `json:"differenceMinor"`
	Matches         bool   `json:"matches"`
}

type StatementImportResult struct {
	ImportID           *uuid.UUID       `json:"importId,omitempty"`
	Status             string           `json:"status"`
	Hash               string           `json:"hash"`
	AccountID          uuid.UUID        `json:"accountId"`
	AccountName        string           `json:"accountName"`
	Currency           string           `json:"currency"`
	BalanceBasis       string           `json:"balanceBasis"`
	Created            int              `json:"created"`
	Updated            int              `json:"updated"`
	Skipped            int              `json:"skipped"`
	Duplicates         int              `json:"duplicates"`
	PossibleDuplicates int              `json:"possibleDuplicates"`
	Conflicts          int              `json:"conflicts"`
	Rejected           int              `json:"rejected"`
	BalanceBeforeMinor int64            `json:"balanceBeforeMinor"`
	BalanceAfterMinor  int64            `json:"balanceAfterMinor"`
	DateRange          *ImportDateRange `json:"dateRange,omitempty"`
	ClosingBalance     *BalanceCheck    `json:"closingBalance,omitempty"`
	Warnings           []string         `json:"warnings"`
	Rows               []StatementRow   `json:"rows"`
	// UnmatchedExisting lists records in the period that the statement doesn't contain.
	UnmatchedExisting []Transaction `json:"unmatchedExisting,omitempty"`
}

type StatementImportService struct {
	db  *sql.DB
	now func() time.Time
}

func NewStatementImportService(db *sql.DB) *StatementImportService {
	return &StatementImportService{db: db, now: time.Now}
}

type statementAccount struct {
	ID             uuid.UUID
	Name, Currency string
	TrackingMode   string
	CurrentValue   int64
	Archived       bool
	Timezone       string
}

// Import validates and classifies every row, then creates the new ones in one
// database transaction. Nothing is written for a dry run or a rejected request.
func (service *StatementImportService) Import(ctx context.Context, userID uuid.UUID, input StatementImportInput) (StatementImportResult, error) {
	return service.run(ctx, userID, input, false)
}

// Reconcile classifies a statement against existing records without writing anything and
// also lists records in the statement period that the statement doesn't contain.
func (service *StatementImportService) Reconcile(ctx context.Context, userID uuid.UUID, input StatementImportInput) (StatementImportResult, error) {
	input.DryRun = true
	return service.run(ctx, userID, input, true)
}

type statementHashInput struct {
	AccountID               uuid.UUID              `json:"accountId"`
	Source                  string                 `json:"source"`
	AllowPartial            bool                   `json:"allowPartial"`
	AllowPossibleDuplicates bool                   `json:"allowPossibleDuplicates"`
	ClosingBalance          *StatementBalance      `json:"closingBalance"`
	Transactions            []StatementTransaction `json:"transactions"`
}

func (service *StatementImportService) run(ctx context.Context, userID uuid.UUID, input StatementImportInput, reconcile bool) (StatementImportResult, error) {
	if len(input.Transactions) == 0 || len(input.Transactions) > MaxStatementRows {
		return StatementImportResult{}, validation(fmt.Sprintf("send between 1 and %d transactions", MaxStatementRows))
	}
	source, err := validImportSource(input.Source)
	if err != nil {
		return StatementImportResult{}, err
	}
	hash, err := requestHash(statementHashInput{input.AccountID, source, input.AllowPartial, input.AllowPossibleDuplicates, input.ClosingBalance, input.Transactions})
	if err != nil {
		return StatementImportResult{}, err
	}
	if input.ExpectedHash != "" && input.ExpectedHash != hash {
		return StatementImportResult{}, conflict("the import differs from the preview; preview it again")
	}
	options := &sql.TxOptions{ReadOnly: true}
	if !input.DryRun {
		options = &sql.TxOptions{Isolation: sql.LevelSerializable}
	}
	tx, err := service.db.BeginTx(ctx, options)
	if err != nil {
		return StatementImportResult{}, fmt.Errorf("begin statement import: %w", err)
	}
	defer tx.Rollback()
	if !input.DryRun {
		if id, summary, err := replayedImport(ctx, tx, userID, input.IdempotencyKey, hash); err != nil {
			return StatementImportResult{}, err
		} else if id != nil {
			return replayedStatementResult(*id, hash, summary)
		}
	}
	account, err := loadStatementAccount(ctx, tx, userID, input.AccountID, !input.DryRun)
	if err != nil {
		return StatementImportResult{}, err
	}
	location, err := time.LoadLocation(account.Timezone)
	if err != nil {
		return StatementImportResult{}, fmt.Errorf("load user timezone: %w", err)
	}
	today, err := time.Parse(time.DateOnly, service.now().In(location).Format(time.DateOnly))
	if err != nil {
		return StatementImportResult{}, err
	}
	var closingDate time.Time
	var closingAmount int64
	if input.ClosingBalance != nil {
		closingDate, err = time.Parse(time.DateOnly, strings.TrimSpace(input.ClosingBalance.Date))
		if err != nil {
			return StatementImportResult{}, validation("closingBalance.date must be a YYYY-MM-DD date")
		}
		if closingAmount, err = parseInvestmentMoneyMinor(input.ClosingBalance.Amount, account.Currency); err != nil {
			return StatementImportResult{}, validation("closingBalance.amount must be a plain decimal in the account currency")
		}
	}
	rows, err := classifyStatement(ctx, tx, userID, account, today.Format(time.DateOnly), input)
	if err != nil {
		return StatementImportResult{}, err
	}
	result := StatementImportResult{
		Hash: hash, AccountID: account.ID, AccountName: account.Name, Currency: account.Currency,
		BalanceBasis: balanceBasis(account.TrackingMode), Rows: rows, Warnings: []string{},
	}
	extras := []projectedTransaction{}
	dates := []string{}
	for _, row := range rows {
		switch row.Status {
		case "create":
			extras = append(extras, projectedTransaction{date: row.prepared.date, transactionType: row.prepared.transactionType, amount: row.prepared.amountMinor})
			dates = append(dates, row.Date)
		case "duplicate":
			result.Duplicates++
		case "possible_duplicate":
			result.PossibleDuplicates++
		case "conflict":
			result.Conflicts++
		default:
			result.Rejected++
		}
	}
	result.Skipped = result.Duplicates + result.PossibleDuplicates
	if len(dates) > 0 {
		sort.Strings(dates)
		result.DateRange = &ImportDateRange{From: dates[0], To: dates[len(dates)-1]}
	}
	if result.BalanceBeforeMinor, err = balanceOnDate(ctx, tx, userID, account.ID, account.TrackingMode, today, nil); err != nil {
		return StatementImportResult{}, err
	}
	blocked := (result.Rejected > 0 || result.Conflicts > 0) && !input.AllowPartial
	if blocked {
		extras = nil
	}
	if result.BalanceAfterMinor, err = balanceOnDate(ctx, tx, userID, account.ID, account.TrackingMode, today, extras); err != nil {
		return StatementImportResult{}, err
	}
	if input.ClosingBalance != nil {
		if result.ClosingBalance, err = closingCheck(ctx, tx, userID, account, closingDate, closingAmount, extras); err != nil {
			return StatementImportResult{}, err
		}
	}
	if len(extras) > 0 && account.TrackingMode == "balance" {
		if warning, err := valuationWarning(ctx, tx, userID, account.ID, extras); err != nil {
			return StatementImportResult{}, err
		} else if warning != "" {
			result.Warnings = append(result.Warnings, warning)
		}
	}
	if result.PossibleDuplicates > 0 {
		result.Warnings = append(result.Warnings, fmt.Sprintf("%d rows match an existing record's date, type, and amount but not its ID; they were skipped for review. Resend with allowPossibleDuplicates to create them.", result.PossibleDuplicates))
	}
	if reconcile {
		result.Status = "reconciled"
		if result.UnmatchedExisting, err = unmatchedExisting(ctx, tx, userID, account, rows, input.From, input.To); err != nil {
			return StatementImportResult{}, err
		}
		addClosingWarning(&result)
		return result, nil
	}
	switch {
	case blocked:
		result.Status = "rejected"
		result.Warnings = append(result.Warnings, "Nothing was imported because some rows were rejected or conflict with existing records. Fix them, or resend with allowPartial to import the valid rows.")
		markRows(result.Rows, "create", "not_imported", "Not imported because other rows failed.")
		addClosingWarning(&result)
		return result, nil
	case input.DryRun:
		result.Status = "preview"
		result.Created = len(extras)
		addClosingWarning(&result)
		return result, nil
	}
	now := service.now().UTC()
	batchID, err := insertImportBatch(ctx, tx, userID, account.ID, "transactions", source, input.IdempotencyKey, hash, now)
	if err != nil {
		return StatementImportResult{}, err
	}
	for index := range result.Rows {
		row := &result.Rows[index]
		if row.Status != "create" {
			continue
		}
		id := uuid.New()
		created := now.Add(time.Duration(index) * time.Nanosecond)
		if _, err := tx.ExecContext(ctx, `
INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,description,notes,external_id,import_batch_id,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`, id, userID, account.ID, row.prepared.transactionType, row.prepared.amountMinor,
			account.Currency, row.prepared.date, row.prepared.description, row.prepared.notes, row.prepared.externalID, batchID, created); err != nil {
			return StatementImportResult{}, fmt.Errorf("insert statement transaction: %w", err)
		}
		row.Status, row.Code, row.Message, row.TransactionID = "created", "created", "Transaction created.", &id
		result.Created++
	}
	ledger := &LedgerService{db: service.db, now: service.now}
	if _, err := ledger.replayBalance(ctx, tx, userID, account.ID); err != nil {
		return StatementImportResult{}, err
	}
	if result.BalanceAfterMinor, err = balanceOnDate(ctx, tx, userID, account.ID, account.TrackingMode, today, nil); err != nil {
		return StatementImportResult{}, err
	}
	var statementDate *time.Time
	var statementBalance *int64
	if input.ClosingBalance != nil {
		if result.ClosingBalance, err = closingCheck(ctx, tx, userID, account, closingDate, closingAmount, nil); err != nil {
			return StatementImportResult{}, err
		}
		statementDate, statementBalance = &closingDate, &closingAmount
	}
	addClosingWarning(&result)
	result.Status = "completed"
	if result.Created == 0 {
		result.Status = "unchanged"
	}
	summary := result
	summary.Rows = nil
	kept, err := finishImportBatch(ctx, tx, userID, batchID, summary, statementDate, statementBalance)
	if err != nil {
		return StatementImportResult{}, err
	}
	if kept {
		result.ImportID = &batchID
	}
	if err := tx.Commit(); err != nil {
		return StatementImportResult{}, fmt.Errorf("commit statement import: %w", err)
	}
	return result, nil
}

func replayedStatementResult(id uuid.UUID, hash string, summary []byte) (StatementImportResult, error) {
	var result StatementImportResult
	if err := decodeStoredSummary(summary, &result); err != nil {
		return StatementImportResult{}, err
	}
	result.ImportID, result.Hash, result.Status, result.Rows = &id, hash, "replayed", []StatementRow{}
	result.Warnings = append(result.Warnings, "This idempotency key was already used for the same import; nothing new was written.")
	return result, nil
}

func markRows(rows []StatementRow, status, code, message string) {
	for index := range rows {
		if rows[index].Status == status {
			rows[index].Status, rows[index].Code, rows[index].Message = code, code, message
		}
	}
}

func addClosingWarning(result *StatementImportResult) {
	if result.ClosingBalance == nil || result.ClosingBalance.Matches {
		return
	}
	difference := result.ClosingBalance.DifferenceMinor
	if difference < 0 {
		difference = -difference
	}
	text, _ := domain.FormatMinorUnits(strconv.FormatInt(difference, 10), result.Currency)
	result.Warnings = append(result.Warnings, fmt.Sprintf("Statement closing balance differs by %s %s. No balancing adjustment was made.", text, result.Currency))
}

func loadStatementAccount(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID, lock bool) (statementAccount, error) {
	query := `
SELECT a.id,a.name,a.currency,a.tracking_mode,a.current_value_minor,a.archived_at IS NOT NULL,s.timezone
FROM accounts a JOIN user_settings s ON s.user_id=a.user_id
WHERE a.user_id=$1 AND a.id=$2`
	if lock {
		query += ` FOR UPDATE OF a`
	}
	var account statementAccount
	err := tx.QueryRowContext(ctx, query, userID, accountID).Scan(&account.ID, &account.Name, &account.Currency, &account.TrackingMode, &account.CurrentValue, &account.Archived, &account.Timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return statementAccount{}, ErrLedgerNotFound
	}
	if err != nil {
		return statementAccount{}, fmt.Errorf("load statement account: %w", err)
	}
	if account.Archived {
		return statementAccount{}, validation("this account is archived; restore it before importing")
	}
	return account, nil
}

func classifyStatement(ctx context.Context, tx *sql.Tx, userID uuid.UUID, account statementAccount, today string, input StatementImportInput) ([]StatementRow, error) {
	rows := make([]StatementRow, len(input.Transactions))
	derived := derivedExternalIDs{}
	for index, source := range input.Transactions {
		row := &rows[index]
		row.Index, row.Date, row.Type, row.Amount, row.ExternalID = index+1, strings.TrimSpace(source.Date), strings.TrimSpace(source.Type), strings.TrimSpace(source.Amount), strings.TrimSpace(source.ExternalID)
		history := accountHistorySourceRow{Type: row.Type, Amount: row.Amount, Date: row.Date}
		if row.ExternalID != "" {
			history.ExternalID = &row.ExternalID
		}
		if description := strings.TrimSpace(source.Description); description != "" {
			history.Description = &description
		}
		if notes := strings.TrimSpace(source.Notes); notes != "" {
			history.Notes = &notes
		}
		validated := validateAccountHistoryRow(history, index+1, account.Currency, today)
		row.prepared = validated.prepared
		row.Status, row.Code, row.Message = "create", "ready", "Ready to create."
		if validated.prepared == nil {
			row.Status, row.Code, row.Message = "rejected", validated.Code, validated.Message
		}
		if currency := domain.NormalizeCurrency(source.Currency); source.Currency != "" && currency != account.Currency {
			row.Status, row.Code, row.Message, row.prepared = "rejected", "currency_mismatch", "The account holds "+account.Currency+"; convert the amount or use an account in this currency.", nil
		}
		if row.prepared != nil && account.TrackingMode == "positions" && !positionCashTypes[row.Type] {
			row.Status, row.Code, row.Message, row.prepared = "rejected", "use_trades", "Investment accounts accept only deposit, withdrawal, interest, dividend, fee, and manual_adjustment; import trades with bulk_import_trades.", nil
		}
		if row.ExternalID == "" {
			// Rows that fail later still take an occurrence, as in file imports, so fixing one doesn't renumber the rest.
			if amount, err := parseInvestmentMoneyMinor(row.Amount, account.Currency); err == nil {
				identity := derived.next(row.Date, row.Type, amount, account.Currency)
				if row.prepared != nil {
					row.prepared.externalID, row.prepared.legacyExternalID = identity.id, identity.legacy
					row.ExternalID = identity.id
				}
			}
		}
		if row.prepared != nil {
			row.Amount = formatDerivedAmount(row.prepared.amountMinor, account.Currency)
		}
	}
	seen := map[string]int{}
	for _, row := range rows {
		if row.ExternalID != "" && row.prepared != nil {
			seen[row.ExternalID]++
		}
	}
	for index := range rows {
		if rows[index].prepared != nil && seen[rows[index].ExternalID] > 1 {
			rows[index].Status, rows[index].Code, rows[index].Message, rows[index].prepared = "rejected", "duplicate_in_request", "This externalId appears more than once in the request.", nil
		}
	}
	matched := map[uuid.UUID]bool{}
	for index := range rows {
		row := &rows[index]
		if row.prepared == nil {
			continue
		}
		candidates := []string{row.prepared.externalID}
		if row.prepared.legacyExternalID != "" {
			candidates = append(candidates, row.prepared.legacyExternalID)
		}
		for _, candidate := range candidates {
			var id uuid.UUID
			var transactionType string
			var amount int64
			var date time.Time
			err := tx.QueryRowContext(ctx, `SELECT id,type,amount_minor,transaction_date FROM transactions WHERE user_id=$1 AND account_id=$2 AND external_id=$3`,
				userID, account.ID, candidate).Scan(&id, &transactionType, &amount, &date)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return nil, fmt.Errorf("match statement external ID: %w", err)
			}
			matched[id] = true
			row.MatchedTransactionID = &id
			if transactionType == row.prepared.transactionType && amount == row.prepared.amountMinor && sameDate(date, row.prepared.date) {
				row.Status, row.Code, row.Message = "duplicate", "duplicate", "Already recorded with this ID."
			} else {
				row.Status, row.Code, row.Message = "conflict", "conflicting_external_id", "This ID belongs to a record with a different date, type, or amount. Existing records are never overwritten."
			}
			row.prepared = nil
			break
		}
	}
	// Structured matching: a row with no ID match that has the same date, type, and amount as
	// an existing record is a possible duplicate. Each record matches at most one row, so two
	// legitimate identical rows are not both hidden by one existing record.
	var from, to string
	for _, row := range rows {
		if row.Status != "create" {
			continue
		}
		if from == "" || row.Date < from {
			from = row.Date
		}
		if row.Date > to {
			to = row.Date
		}
	}
	if from == "" {
		return rows, nil
	}
	existing, err := tx.QueryContext(ctx, `
SELECT id,type,amount_minor,transaction_date FROM transactions
WHERE user_id=$1 AND account_id=$2 AND transaction_date BETWEEN $3 AND $4
ORDER BY transaction_date,created_at,id`, userID, account.ID, from, to)
	if err != nil {
		return nil, fmt.Errorf("load statement period: %w", err)
	}
	pool := map[string][]uuid.UUID{}
	for existing.Next() {
		var id uuid.UUID
		var transactionType string
		var amount int64
		var date time.Time
		if err := existing.Scan(&id, &transactionType, &amount, &date); err != nil {
			existing.Close()
			return nil, fmt.Errorf("scan statement period: %w", err)
		}
		if !matched[id] {
			key := structuredKey(date, transactionType, amount)
			pool[key] = append(pool[key], id)
		}
	}
	if err := existing.Close(); err != nil {
		return nil, err
	}
	for index := range rows {
		row := &rows[index]
		if row.Status != "create" {
			continue
		}
		key := structuredKey(row.prepared.date, row.prepared.transactionType, row.prepared.amountMinor)
		if len(pool[key]) == 0 {
			continue
		}
		id := pool[key][0]
		pool[key] = pool[key][1:]
		row.MatchedTransactionID = &id
		if input.AllowPossibleDuplicates {
			row.Code, row.Message = "ready_possible_duplicate", "Will be created although a record with the same date, type, and amount exists."
			continue
		}
		row.Status, row.Code, row.Message, row.prepared = "possible_duplicate", "possible_duplicate", "A record with the same date, type, and amount exists but has a different or no ID. Skipped for review.", nil
	}
	return rows, nil
}

func structuredKey(date time.Time, transactionType string, amount int64) string {
	return date.Format(time.DateOnly) + "|" + transactionType + "|" + strconv.FormatInt(amount, 10)
}

func unmatchedExisting(ctx context.Context, tx *sql.Tx, userID uuid.UUID, account statementAccount, rows []StatementRow, from, to *time.Time) ([]Transaction, error) {
	matched := map[uuid.UUID]bool{}
	var first, last string
	for _, row := range rows {
		if row.MatchedTransactionID != nil {
			matched[*row.MatchedTransactionID] = true
		}
		if _, err := time.Parse(time.DateOnly, row.Date); err != nil {
			continue
		}
		if first == "" || row.Date < first {
			first = row.Date
		}
		if row.Date > last {
			last = row.Date
		}
	}
	if from != nil {
		first = from.Format(time.DateOnly)
	}
	if to != nil {
		last = to.Format(time.DateOnly)
	}
	if first == "" || last == "" {
		return []Transaction{}, nil
	}
	records, err := tx.QueryContext(ctx, `
SELECT id,type,amount_minor,transaction_date,COALESCE(description,''),COALESCE(external_id,''),transfer_group_id
FROM transactions WHERE user_id=$1 AND account_id=$2 AND transaction_date BETWEEN $3 AND $4 AND type<>'opening_balance'
ORDER BY transaction_date,created_at,id LIMIT 1000`, userID, account.ID, first, last)
	if err != nil {
		return nil, fmt.Errorf("load unmatched records: %w", err)
	}
	defer records.Close()
	result := []Transaction{}
	for records.Next() {
		var item Transaction
		var amount int64
		var date time.Time
		var group uuid.NullUUID
		if err := records.Scan(&item.ID, &item.Type, &amount, &date, &item.Description, &item.ExternalID, &group); err != nil {
			return nil, fmt.Errorf("scan unmatched record: %w", err)
		}
		if matched[item.ID] {
			continue
		}
		item.AccountID, item.AccountName, item.Currency = account.ID, account.Name, account.Currency
		item.AmountMinor, item.TransactionDate, item.TransferGroupID = strconv.FormatInt(amount, 10), date.Format(time.DateOnly), uuidPointer(group)
		result = append(result, item)
		if len(result) == 200 {
			break
		}
	}
	return result, records.Err()
}

func closingCheck(ctx context.Context, q importQueryer, userID uuid.UUID, account statementAccount, date time.Time, statement int64, extras []projectedTransaction) (*BalanceCheck, error) {
	calculated, err := balanceOnDate(ctx, q, userID, account.ID, account.TrackingMode, date, extras)
	if err != nil {
		return nil, err
	}
	return &BalanceCheck{Date: date.Format(time.DateOnly), StatementMinor: statement, CalculatedMinor: calculated,
		DifferenceMinor: calculated - statement, Matches: calculated == statement}, nil
}

func valuationWarning(ctx context.Context, q importQueryer, userID, accountID uuid.UUID, extras []projectedTransaction) (string, error) {
	earliest := extras[0].date
	for _, extra := range extras {
		if extra.date.Before(earliest) {
			earliest = extra.date
		}
	}
	var latest sql.NullTime
	if err := q.QueryRowContext(ctx, `SELECT MAX(valuation_date) FROM valuation_snapshots WHERE user_id=$1 AND account_id=$2 AND valuation_date>=$3`, userID, accountID, earliest).Scan(&latest); err != nil {
		return "", fmt.Errorf("check later valuations: %w", err)
	}
	if !latest.Valid {
		return "", nil
	}
	count := 0
	for _, extra := range extras {
		if !extra.date.After(latest.Time) {
			count++
		}
	}
	return fmt.Sprintf("%d new transactions are dated on or before a valuation on %s, which sets the balance on that date, so they don't change later balances.", count, latest.Time.Format(time.DateOnly)), nil
}

type projectedTransaction struct {
	date            time.Time
	transactionType string
	amount          int64
}

type balanceEvent struct {
	date      time.Time
	createdAt time.Time
	order     int
	kind      string
	eventType string
	amount    int64
	snapshot  sql.NullInt64
	id        string
}

// balanceOnDate replays an account up to and including asOf, adding the projected rows as
// if created now. Balance accounts replay transactions and valuations as replayBalance does;
// position accounts replay cash only, with cash snapshots setting an absolute value.
func balanceOnDate(ctx context.Context, q importQueryer, userID, accountID uuid.UUID, trackingMode string, asOf time.Time, extras []projectedTransaction) (int64, error) {
	var query string
	if trackingMode == "positions" {
		query = `
SELECT 'transaction',type,amount_minor,transaction_date,created_at,cash_snapshot_minor,id::TEXT FROM transactions WHERE user_id=$1 AND account_id=$2 AND transaction_date<=$3
UNION ALL
SELECT 'trade','',cash_effect_minor,trade_date,created_at,NULL,id::TEXT FROM position_events WHERE user_id=$1 AND account_id=$2 AND trade_date<=$3 AND cash_effect_minor<>0`
	} else {
		query = `
SELECT 'transaction',type,amount_minor,transaction_date,created_at,NULL::BIGINT,id::TEXT FROM transactions WHERE user_id=$1 AND account_id=$2 AND transaction_date<=$3
UNION ALL
SELECT 'valuation','',value_minor,valuation_date,created_at,NULL,id::TEXT FROM valuation_snapshots WHERE user_id=$1 AND account_id=$2 AND valuation_date<=$3`
	}
	rows, err := q.QueryContext(ctx, query, userID, accountID, ledgerDateOnly(asOf))
	if err != nil {
		return 0, fmt.Errorf("load balance events: %w", err)
	}
	events := []balanceEvent{}
	for rows.Next() {
		var event balanceEvent
		if err := rows.Scan(&event.kind, &event.eventType, &event.amount, &event.date, &event.createdAt, &event.snapshot, &event.id); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan balance event: %w", err)
		}
		if event.kind == "valuation" {
			event.order = 1
		}
		events = append(events, event)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	future := time.Date(9999, time.January, 1, 0, 0, 0, 0, time.UTC)
	for index, extra := range extras {
		if extra.date.After(ledgerDateOnly(asOf)) {
			continue
		}
		events = append(events, balanceEvent{date: extra.date, createdAt: future.Add(time.Duration(index)), kind: "transaction", eventType: extra.transactionType, amount: extra.amount})
	}
	sortBalanceEvents(events, trackingMode == "positions")
	balance := new(big.Int)
	for _, event := range events {
		switch {
		case event.kind == "valuation":
			balance.SetInt64(event.amount)
		case event.snapshot.Valid:
			balance.SetInt64(event.snapshot.Int64)
		case event.kind == "trade":
			balance.Add(balance, big.NewInt(event.amount))
		default:
			balance.Add(balance, investmentTransactionEffect(event.eventType, event.amount))
		}
	}
	return checkedInt64(balance)
}

// sortBalanceEvents orders events by date and creation; with snapshotsLast, cash snapshots
// close their day so same-day activity is included in the observed balance.
func sortBalanceEvents(events []balanceEvent, snapshotsLast bool) {
	sort.SliceStable(events, func(left, right int) bool {
		a, b := events[left], events[right]
		if !a.date.Equal(b.date) {
			return a.date.Before(b.date)
		}
		if snapshotsLast && a.snapshot.Valid != b.snapshot.Valid {
			return b.snapshot.Valid
		}
		if !a.createdAt.Equal(b.createdAt) {
			return a.createdAt.Before(b.createdAt)
		}
		if a.order != b.order {
			return a.order < b.order
		}
		return a.id < b.id
	})
}
