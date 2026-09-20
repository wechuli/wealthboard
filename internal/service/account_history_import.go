package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

var accountHistoryHeaders = []string{"external_id", "type", "amount", "date", "description", "notes"}

var accountHistoryTypes = map[string]bool{
	"deposit": true, "withdrawal": true, "interest": true, "dividend": true,
	"capital_gain": true, "capital_loss": true, "fee": true, "purchase": true,
	"sale": true, "manual_adjustment": true, "liability_payment": true,
	"liability_increase": true,
}

type AccountHistoryImportService struct {
	db  *sql.DB
	now func() time.Time
}

func NewAccountHistoryImportService(db *sql.DB) *AccountHistoryImportService {
	return &AccountHistoryImportService{db: db, now: time.Now}
}

type accountHistorySourceRow struct {
	ExternalID  *string `json:"external_id"`
	Type        string  `json:"type"`
	Amount      string  `json:"amount"`
	Date        string  `json:"date"`
	Description *string `json:"description"`
	Notes       *string `json:"notes"`
}

type accountHistoryEnvelope struct {
	Format       string                    `json:"format"`
	Version      int                       `json:"version"`
	Transactions []accountHistorySourceRow `json:"transactions"`
}

type AccountHistoryImportRow struct {
	Row           int        `json:"row"`
	ExternalID    *string    `json:"externalId"`
	Status        string     `json:"status"`
	Code          string     `json:"code"`
	Message       string     `json:"message"`
	TransactionID *uuid.UUID `json:"transactionId"`
	Type          string     `json:"type,omitempty"`
	Amount        string     `json:"amount,omitempty"`
	Date          string     `json:"date,omitempty"`
	prepared      *accountHistoryPreparedRow
}

type accountHistoryPreparedRow struct {
	externalID      string
	transactionType string
	amountMinor     int64
	date            time.Time
	description     *string
	notes           *string
}

type AccountHistoryImportSummary struct {
	Ready             int `json:"ready,omitempty"`
	Imported          int `json:"imported,omitempty"`
	SkippedDuplicates int `json:"skippedDuplicates"`
	Failed            int `json:"failed"`
}

type AccountHistoryImportResult struct {
	Hash                  string                      `json:"hash,omitempty"`
	Account               ImportAccount               `json:"account"`
	DateRange             *ImportDateRange            `json:"dateRange"`
	CurrentBalanceMinor   int64                       `json:"currentBalanceMinor,omitempty"`
	ProjectedBalanceMinor int64                       `json:"projectedBalanceMinor,omitempty"`
	FinalBalanceMinor     int64                       `json:"finalBalanceMinor,omitempty"`
	NetChangeMinor        int64                       `json:"netChangeMinor,omitempty"`
	Summary               AccountHistoryImportSummary `json:"summary"`
	Rows                  []AccountHistoryImportRow   `json:"rows"`
}

type ImportAccount struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Institution *string   `json:"institution,omitempty"`
	Currency    string    `json:"currency"`
}

type ImportDateRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type accountHistoryAccount struct {
	ImportAccount
	currentBalance int64
}

type importQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (service *AccountHistoryImportService) Preview(ctx context.Context, userID, accountID uuid.UUID, content []byte, format ImportFormat) (AccountHistoryImportResult, error) {
	if err := validateImportContent(content, format); err != nil {
		return AccountHistoryImportResult{}, err
	}
	sources, firstRow, err := parseAccountHistory(content, format)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	account, timezone, err := loadAccountHistoryContext(ctx, service.db, userID, accountID)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	rows, err := service.classifyAccountHistory(ctx, service.db, userID, account, timezone, sources, firstRow)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	projected, err := service.projectAccountHistory(ctx, service.db, userID, accountID, rows)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	return accountHistoryResult(importHash(content), account, rows, projected, false), nil
}

func (service *AccountHistoryImportService) Commit(ctx context.Context, userID, accountID uuid.UUID, content []byte, format ImportFormat, expectedHash string) (AccountHistoryImportResult, error) {
	if err := validateImportContent(content, format); err != nil {
		return AccountHistoryImportResult{}, err
	}
	if err := verifyImportHash(content, expectedHash); err != nil {
		return AccountHistoryImportResult{}, err
	}
	sources, firstRow, err := parseAccountHistory(content, format)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return AccountHistoryImportResult{}, fmt.Errorf("begin account-history import: %w", err)
	}
	defer tx.Rollback()
	account, timezone, err := loadAccountHistoryContext(ctx, tx, userID, accountID)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	rows, err := service.classifyAccountHistory(ctx, tx, userID, account, timezone, sources, firstRow)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	for _, row := range rows {
		if row.Status == "conflicting_existing" {
			return AccountHistoryImportResult{}, importConflict("an external ID belongs to a different transaction")
		}
	}
	now := service.now().UTC()
	imported := 0
	for index := range rows {
		row := &rows[index]
		if row.Status != "ready" || row.prepared == nil {
			continue
		}
		transactionID := uuid.New()
		_, err := tx.ExecContext(ctx, `
INSERT INTO transactions (
    id,user_id,account_id,type,amount_minor,currency,transaction_date,
    description,notes,external_id,created_at,updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`, transactionID, userID, accountID,
			row.prepared.transactionType, row.prepared.amountMinor, account.Currency, row.prepared.date,
			row.prepared.description, row.prepared.notes, row.prepared.externalID, now.Add(time.Duration(index)*time.Nanosecond))
		if err != nil {
			return AccountHistoryImportResult{}, fmt.Errorf("insert account-history transaction: %w", err)
		}
		row.Status, row.Code, row.Message, row.TransactionID = "imported", "imported", "Transaction imported.", &transactionID
		row.prepared = nil
		imported++
	}
	ledger := &LedgerService{db: service.db, now: service.now}
	finalBalance, err := ledger.replayBalance(ctx, tx, userID, accountID)
	if err != nil {
		return AccountHistoryImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return AccountHistoryImportResult{}, fmt.Errorf("commit account-history import: %w", err)
	}
	result := accountHistoryResult("", account, rows, finalBalance, true)
	result.Summary.Imported = imported
	result.Summary.Ready = 0
	return result, nil
}

func parseAccountHistory(content []byte, format ImportFormat) ([]accountHistorySourceRow, int, error) {
	if format == ImportFormatJSON {
		var envelope accountHistoryEnvelope
		if err := decodeStrictJSON(content, &envelope); err != nil || envelope.Format != "wealthboard-account-history" || envelope.Version != 1 {
			return nil, 0, importValidation("JSON must use wealthboard-account-history format version 1")
		}
		if len(envelope.Transactions) == 0 {
			return nil, 0, importValidation("the file contains no transaction rows")
		}
		if len(envelope.Transactions) > ImportMaxRecords {
			return nil, 0, importValidation("the import is limited to 10,000 records")
		}
		return envelope.Transactions, 1, nil
	}
	records, err := parseExactCSV(content, accountHistoryHeaders)
	if err != nil {
		return nil, 0, err
	}
	rows := make([]accountHistorySourceRow, 0, len(records)-1)
	for _, values := range records[1:] {
		record := csvRecord(records[0], values)
		rows = append(rows, accountHistorySourceRow{
			ExternalID: optionalImportText(record["external_id"]), Type: record["type"], Amount: record["amount"], Date: record["date"],
			Description: optionalImportTextUntrimmed(record["description"]), Notes: optionalImportTextUntrimmed(record["notes"]),
		})
	}
	return rows, 2, nil
}

func (service *AccountHistoryImportService) classifyAccountHistory(ctx context.Context, queryer importQueryer, userID uuid.UUID, account accountHistoryAccount, timezone string, sources []accountHistorySourceRow, firstRow int) ([]AccountHistoryImportRow, error) {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return nil, fmt.Errorf("load user timezone: %w", err)
	}
	today := service.now().In(location).Format(time.DateOnly)
	rows := make([]AccountHistoryImportRow, len(sources))
	counts := map[string]int{}
	for index, source := range sources {
		rows[index] = validateAccountHistoryRow(source, firstRow+index, account.Currency, today)
		if rows[index].ExternalID != nil {
			counts[*rows[index].ExternalID]++
		}
	}
	for index := range rows {
		if rows[index].ExternalID != nil && counts[*rows[index].ExternalID] > 1 {
			rows[index].Status, rows[index].Code, rows[index].Message, rows[index].prepared = "duplicate_in_file", "duplicate_in_file", "external_id occurs more than once in this file.", nil
		}
	}
	for index := range rows {
		row := &rows[index]
		if row.Status != "ready" || row.prepared == nil {
			continue
		}
		var id uuid.UUID
		var transactionType string
		var amount int64
		var currency string
		var date time.Time
		var description, notes sql.NullString
		err := queryer.QueryRowContext(ctx, `
SELECT id,type,amount_minor,currency,transaction_date,description,notes
FROM transactions WHERE user_id=$1 AND account_id=$2 AND external_id=$3`, userID, account.ID, row.prepared.externalID).
			Scan(&id, &transactionType, &amount, &currency, &date, &description, &notes)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("classify account-history duplicate: %w", err)
		}
		if transactionType == row.prepared.transactionType && amount == row.prepared.amountMinor && currency == account.Currency && sameDate(date, row.prepared.date) && nullStringEquals(description, row.prepared.description) && nullStringEquals(notes, row.prepared.notes) {
			row.Status, row.Code, row.Message, row.TransactionID = "duplicate_existing", "duplicate_existing", "This transaction is already imported.", &id
		} else {
			row.Status, row.Code, row.Message = "conflicting_existing", "conflicting_existing", "external_id already belongs to a different transaction."
		}
		row.prepared = nil
	}
	return rows, nil
}

func validateAccountHistoryRow(source accountHistorySourceRow, row int, currency, today string) AccountHistoryImportRow {
	result := AccountHistoryImportRow{Row: row, ExternalID: source.ExternalID, Status: "failed", Code: "invalid_row", Message: "The row is invalid.", Type: source.Type, Amount: source.Amount, Date: source.Date}
	if source.ExternalID != nil {
		trimmed := strings.TrimSpace(*source.ExternalID)
		if len(trimmed) > 200 {
			result.Code, result.Message = "invalid_external_id", "external_id must contain 200 characters or fewer."
			return result
		}
		result.ExternalID = &trimmed
	}
	if !accountHistoryTypes[source.Type] {
		result.Code, result.Message = "invalid_type", "The transaction type is not supported for account history import."
		return result
	}
	amount, err := parseInvestmentMoneyMinor(source.Amount, currency)
	if err != nil || amount == 0 || source.Type != "manual_adjustment" && amount < 0 {
		result.Code, result.Message = "invalid_amount", "amount has an invalid sign, precision, or value."
		return result
	}
	date, err := time.Parse(time.DateOnly, source.Date)
	if err != nil || date.Format(time.DateOnly) != source.Date {
		result.Code, result.Message = "invalid_date", "date must use YYYY-MM-DD."
		return result
	}
	if source.Date > today {
		result.Code, result.Message = "future_date", "date cannot be in the future."
		return result
	}
	if !validOptionalImportText(source.Description, 200) || !validOptionalImportText(source.Notes, 2000) {
		result.Code, result.Message = "invalid_text", "description or notes exceed the supported length."
		return result
	}
	externalID := ""
	if result.ExternalID != nil {
		externalID = *result.ExternalID
	}
	if externalID == "" {
		externalID = fmt.Sprintf("derived-%s-%s-%d", source.Date, source.Type, amount)
		result.ExternalID = &externalID
	}
	result.Status, result.Code, result.Message = "ready", "ready", "Ready to import."
	result.prepared = &accountHistoryPreparedRow{externalID: externalID, transactionType: source.Type, amountMinor: amount, date: date, description: normalizedOptionalText(source.Description), notes: normalizedOptionalText(source.Notes)}
	return result
}

type accountHistoryReplayEvent struct {
	date      time.Time
	createdAt time.Time
	kind      string
	eventType string
	amount    int64
	order     int
}

func (service *AccountHistoryImportService) projectAccountHistory(ctx context.Context, queryer importQueryer, userID, accountID uuid.UUID, imported []AccountHistoryImportRow) (int64, error) {
	rows, err := queryer.QueryContext(ctx, `
SELECT kind,type,amount_minor,event_date,created_at,kind_order FROM (
    SELECT 'transaction' AS kind,type,amount_minor,transaction_date AS event_date,created_at,0 AS kind_order
    FROM transactions WHERE user_id=$1 AND account_id=$2
    UNION ALL
    SELECT 'valuation','',value_minor,valuation_date,created_at,1
    FROM valuation_snapshots WHERE user_id=$1 AND account_id=$2
) events`, userID, accountID)
	if err != nil {
		return 0, fmt.Errorf("load account-history projection: %w", err)
	}
	defer rows.Close()
	events := []accountHistoryReplayEvent{}
	for rows.Next() {
		var event accountHistoryReplayEvent
		if err := rows.Scan(&event.kind, &event.eventType, &event.amount, &event.date, &event.createdAt, &event.order); err != nil {
			return 0, fmt.Errorf("scan account-history projection: %w", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate account-history projection: %w", err)
	}
	now := service.now().UTC()
	for index, row := range imported {
		if row.Status == "ready" && row.prepared != nil {
			events = append(events, accountHistoryReplayEvent{date: row.prepared.date, createdAt: now.Add(time.Duration(index) * time.Nanosecond), kind: "transaction", eventType: row.prepared.transactionType, amount: row.prepared.amountMinor})
		}
	}
	sort.SliceStable(events, func(left, right int) bool {
		if !events[left].date.Equal(events[right].date) {
			return events[left].date.Before(events[right].date)
		}
		if !events[left].createdAt.Equal(events[right].createdAt) {
			return events[left].createdAt.Before(events[right].createdAt)
		}
		return events[left].order < events[right].order
	})
	balance := new(big.Int)
	for _, event := range events {
		if event.kind == "valuation" {
			balance.SetInt64(event.amount)
			continue
		}
		effect, err := transactionEffect(event.eventType, event.amount)
		if err != nil {
			return 0, err
		}
		balance.Add(balance, big.NewInt(effect))
		if !balance.IsInt64() {
			return 0, importValidation("the projected balance is outside the supported range")
		}
	}
	return balance.Int64(), nil
}

func loadAccountHistoryContext(ctx context.Context, queryer importQueryer, userID, accountID uuid.UUID) (accountHistoryAccount, string, error) {
	var account accountHistoryAccount
	var institution sql.NullString
	var timezone string
	err := queryer.QueryRowContext(ctx, `
SELECT account.id,account.name,institution.name,account.currency,account.current_value_minor,settings.timezone
FROM accounts account
JOIN user_settings settings ON settings.user_id=account.user_id
LEFT JOIN institutions institution ON institution.user_id=account.user_id AND institution.id=account.institution_id
WHERE account.user_id=$1 AND account.id=$2 AND account.tracking_mode='balance' AND account.archived_at IS NULL
FOR UPDATE OF account`, userID, accountID).Scan(&account.ID, &account.Name, &institution, &account.Currency, &account.currentBalance, &timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return accountHistoryAccount{}, "", ErrImportNotFound
	}
	if err != nil {
		return accountHistoryAccount{}, "", fmt.Errorf("load account-history account: %w", err)
	}
	if institution.Valid {
		account.Institution = &institution.String
	}
	return account, timezone, nil
}

func accountHistoryResult(hash string, account accountHistoryAccount, rows []AccountHistoryImportRow, balance int64, committed bool) AccountHistoryImportResult {
	result := AccountHistoryImportResult{Hash: hash, Account: account.ImportAccount, Rows: rows, CurrentBalanceMinor: account.currentBalance, ProjectedBalanceMinor: balance, NetChangeMinor: balance - account.currentBalance}
	dates := []string{}
	for _, row := range rows {
		switch row.Status {
		case "ready":
			result.Summary.Ready++
		case "duplicate_existing":
			result.Summary.SkippedDuplicates++
		case "imported":
			result.Summary.Imported++
		default:
			result.Summary.Failed++
		}
		if row.prepared != nil {
			dates = append(dates, row.prepared.date.Format(time.DateOnly))
		}
	}
	if len(dates) > 0 {
		sort.Strings(dates)
		result.DateRange = &ImportDateRange{From: dates[0], To: dates[len(dates)-1]}
	}
	if committed {
		result.FinalBalanceMinor = balance
		result.CurrentBalanceMinor, result.ProjectedBalanceMinor, result.NetChangeMinor = 0, 0, 0
	}
	return result
}

func optionalImportText(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func optionalImportTextUntrimmed(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func validOptionalImportText(value *string, maximum int) bool {
	return value == nil || len(*value) <= maximum
}

func normalizedOptionalText(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	copy := *value
	return &copy
}

func nullStringEquals(value sql.NullString, expected *string) bool {
	if expected == nil {
		return !value.Valid || value.String == ""
	}
	return value.Valid && value.String == *expected
}
