package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ImportBatch describes one committed import and the records it created.
type ImportBatch struct {
	ID                    uuid.UUID       `json:"id"`
	AccountID             uuid.UUID       `json:"accountId"`
	AccountName           string          `json:"accountName"`
	Currency              string          `json:"currency"`
	Kind                  string          `json:"kind"`
	Source                string          `json:"source,omitempty"`
	Status                string          `json:"status"`
	Summary               json.RawMessage `json:"summary"`
	StatementDate         *string         `json:"statementDate,omitempty"`
	StatementBalanceMinor *string         `json:"statementBalanceMinor,omitempty"`
	TransactionCount      int             `json:"transactionCount"`
	PositionEventCount    int             `json:"positionEventCount"`
	CreatedAt             time.Time       `json:"createdAt"`
	RolledBackAt          *time.Time      `json:"rolledBackAt,omitempty"`
}

// ImportBatchFilter narrows import history.
type ImportBatchFilter struct {
	AccountID *uuid.UUID
	Kind      string
	Status    string
	Page      ReadPage
}

// ImportBatchService lists, checks, and rolls back import batches.
type ImportBatchService struct {
	db  *sql.DB
	now func() time.Time
}

func NewImportBatchService(db *sql.DB) *ImportBatchService {
	return &ImportBatchService{db: db, now: time.Now}
}

var importBatchKinds = map[string]bool{"transactions": true, "trades": true, "positions": true}

func requestHash(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode import request: %w", err)
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func validImportSource(source string) (string, error) {
	source = strings.TrimSpace(source)
	if len(source) > 100 || strings.ContainsAny(source, "\x00\n\r\t") {
		return "", validation("source must be at most 100 characters on one line")
	}
	return source, nil
}

// replayedImport returns the stored summary when key already names a batch with the
// same request, so a retried call reports the original result without writing again.
func replayedImport(ctx context.Context, tx sqlTx, userID uuid.UUID, key *uuid.UUID, hash string) (*uuid.UUID, json.RawMessage, error) {
	if key == nil {
		return nil, nil, nil
	}
	if err := lockLedgerIdempotency(ctx, tx, userID, *key); err != nil {
		return nil, nil, err
	}
	var id uuid.UUID
	var storedHash string
	var summary []byte
	err := tx.QueryRowContext(ctx, `SELECT id,request_hash,summary FROM import_batches WHERE user_id=$1 AND idempotency_key=$2`, userID, *key).Scan(&id, &storedHash, &summary)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("check import idempotency: %w", err)
	}
	if storedHash != hash {
		return nil, nil, conflict("idempotency key was reused with a different import")
	}
	return &id, summary, nil
}

func insertImportBatch(ctx context.Context, tx sqlTx, userID, accountID uuid.UUID, kind, source string, key *uuid.UUID, hash string, now time.Time) (uuid.UUID, error) {
	id := uuid.New()
	_, err := tx.ExecContext(ctx, `
INSERT INTO import_batches (id,user_id,account_id,kind,source,idempotency_key,request_hash,created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, id, userID, accountID, kind, nullable(source), key, hash, now)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert import batch: %w", err)
	}
	return id, nil
}

// finishImportBatch stores the summary, or removes the batch when it created nothing.
func finishImportBatch(ctx context.Context, tx sqlTx, userID, id uuid.UUID, summary any, statementDate *time.Time, statementBalance *int64) (bool, error) {
	var linked bool
	if err := tx.QueryRowContext(ctx, `
SELECT EXISTS(SELECT 1 FROM transactions WHERE user_id=$1 AND import_batch_id=$2)
    OR EXISTS(SELECT 1 FROM position_events WHERE user_id=$1 AND import_batch_id=$2)`, userID, id).Scan(&linked); err != nil {
		return false, fmt.Errorf("check import batch records: %w", err)
	}
	if !linked {
		_, err := tx.ExecContext(ctx, `DELETE FROM import_batches WHERE user_id=$1 AND id=$2`, userID, id)
		return false, err
	}
	encoded, err := json.Marshal(summary)
	if err != nil {
		return false, fmt.Errorf("encode import summary: %w", err)
	}
	var date any
	if statementDate != nil {
		date = ledgerDateOnly(*statementDate)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE import_batches SET summary=$3,statement_date=$4,statement_balance_minor=$5 WHERE user_id=$1 AND id=$2`,
		userID, id, encoded, date, statementBalance); err != nil {
		return false, fmt.Errorf("store import summary: %w", err)
	}
	return true, nil
}

const importBatchColumns = `
SELECT b.id,b.account_id,a.name,a.currency,b.kind,COALESCE(b.source,''),b.status,b.summary,
       b.statement_date,b.statement_balance_minor,b.created_at,b.rolled_back_at,
       (SELECT count(*) FROM transactions t WHERE t.user_id=b.user_id AND t.import_batch_id=b.id),
       (SELECT count(*) FROM position_events e WHERE e.user_id=b.user_id AND e.import_batch_id=b.id)
FROM import_batches b JOIN accounts a ON a.user_id=b.user_id AND a.id=b.account_id`

func scanImportBatch(row interface{ Scan(...any) error }) (ImportBatch, error) {
	var batch ImportBatch
	var summary []byte
	var statementDate sql.NullTime
	var statementBalance sql.NullInt64
	var rolledBack sql.NullTime
	if err := row.Scan(&batch.ID, &batch.AccountID, &batch.AccountName, &batch.Currency, &batch.Kind, &batch.Source, &batch.Status, &summary,
		&statementDate, &statementBalance, &batch.CreatedAt, &rolledBack, &batch.TransactionCount, &batch.PositionEventCount); err != nil {
		return ImportBatch{}, err
	}
	batch.Summary = summary
	if statementDate.Valid {
		value := statementDate.Time.Format(time.DateOnly)
		batch.StatementDate = &value
	}
	batch.StatementBalanceMinor = optionalInt64String(statementBalance)
	if rolledBack.Valid {
		batch.RolledBackAt = &rolledBack.Time
	}
	return batch, nil
}

func (service *ImportBatchService) Get(ctx context.Context, userID, batchID uuid.UUID) (ImportBatch, error) {
	batch, err := scanImportBatch(service.db.QueryRowContext(ctx, importBatchColumns+` WHERE b.user_id=$1 AND b.id=$2`, userID, batchID))
	if errors.Is(err, sql.ErrNoRows) {
		return ImportBatch{}, ErrLedgerNotFound
	}
	if err != nil {
		return ImportBatch{}, fmt.Errorf("load import batch: %w", err)
	}
	return batch, nil
}

func (service *ImportBatchService) List(ctx context.Context, userID uuid.UUID, filter ImportBatchFilter) (Page[ImportBatch], error) {
	page, err := filter.Page.normalized()
	if err != nil {
		return Page[ImportBatch]{}, err
	}
	if filter.Kind != "" && !importBatchKinds[filter.Kind] {
		return Page[ImportBatch]{}, validation("kind must be transactions, trades, or positions")
	}
	if filter.Status != "" && filter.Status != "committed" && filter.Status != "rolled_back" {
		return Page[ImportBatch]{}, validation("status must be committed or rolled_back")
	}
	query := importBatchColumns + ` WHERE b.user_id=$1 AND ($2::UUID IS NULL OR b.account_id=$2) AND ($3='' OR b.kind=$3) AND ($4='' OR b.status=$4)
ORDER BY b.created_at DESC,b.id DESC LIMIT $5 OFFSET $6`
	var accountID any
	if filter.AccountID != nil {
		accountID = *filter.AccountID
	}
	rows, err := service.db.QueryContext(ctx, query, userID, accountID, filter.Kind, filter.Status, page.Limit+1, page.Offset)
	if err != nil {
		return Page[ImportBatch]{}, fmt.Errorf("list import batches: %w", err)
	}
	defer rows.Close()
	items := []ImportBatch{}
	for rows.Next() {
		batch, err := scanImportBatch(rows)
		if err != nil {
			return Page[ImportBatch]{}, fmt.Errorf("scan import batch: %w", err)
		}
		items = append(items, batch)
	}
	if err := rows.Err(); err != nil {
		return Page[ImportBatch]{}, fmt.Errorf("iterate import batches: %w", err)
	}
	hasMore := len(items) > page.Limit
	if hasMore {
		items = items[:page.Limit]
	}
	return Page[ImportBatch]{Items: items, Limit: page.Limit, Offset: page.Offset, HasMore: hasMore}, nil
}

// RollbackResult reports what a rollback removed.
type RollbackResult struct {
	BatchID              uuid.UUID `json:"batchId"`
	AccountID            uuid.UUID `json:"accountId"`
	DeletedTransactions  int       `json:"deletedTransactions"`
	DeletedPositionEvent int       `json:"deletedPositionEvents"`
	BalanceBeforeMinor   int64     `json:"balanceBeforeMinor"`
	BalanceAfterMinor    int64     `json:"balanceAfterMinor"`
	Warnings             []string  `json:"warnings"`
}

// Rollback deletes the records a batch created and replays the account. It refuses when
// any of those records was edited after the import, because deleting them would discard
// the user's later changes; records the user already deleted are simply absent.
func (service *ImportBatchService) Rollback(ctx context.Context, userID, batchID uuid.UUID) (RollbackResult, error) {
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return RollbackResult{}, fmt.Errorf("begin import rollback: %w", err)
	}
	defer tx.Rollback()
	var accountID uuid.UUID
	var status string
	var summary []byte
	err = tx.QueryRowContext(ctx, `SELECT account_id,status,summary FROM import_batches WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, batchID).Scan(&accountID, &status, &summary)
	if errors.Is(err, sql.ErrNoRows) {
		return RollbackResult{}, ErrLedgerNotFound
	}
	if err != nil {
		return RollbackResult{}, fmt.Errorf("load import batch: %w", err)
	}
	if status == "rolled_back" {
		return RollbackResult{}, conflict("this import was already rolled back")
	}
	account, err := getLedgerAccount(ctx, tx, userID, accountID, true)
	if err != nil {
		return RollbackResult{}, err
	}
	if account.ArchivedAt.Valid {
		return RollbackResult{}, validation("restore the archived account before rolling back its import")
	}
	var editedTransactions, editedEvents int
	if err := tx.QueryRowContext(ctx, `
SELECT (SELECT count(*) FROM transactions WHERE user_id=$1 AND import_batch_id=$2 AND updated_at<>created_at),
       (SELECT count(*) FROM position_events WHERE user_id=$1 AND import_batch_id=$2 AND updated_at<>created_at)`, userID, batchID).Scan(&editedTransactions, &editedEvents); err != nil {
		return RollbackResult{}, fmt.Errorf("check edited import records: %w", err)
	}
	if editedTransactions+editedEvents > 0 {
		return RollbackResult{}, conflict(fmt.Sprintf("%d imported records were edited after the import; delete or restore them individually instead", editedTransactions+editedEvents))
	}
	result := RollbackResult{BatchID: batchID, AccountID: accountID, BalanceBeforeMinor: account.CurrentValueMinor, Warnings: []string{}}
	deleted, err := tx.ExecContext(ctx, `DELETE FROM transactions WHERE user_id=$1 AND import_batch_id=$2`, userID, batchID)
	if err != nil {
		return RollbackResult{}, fmt.Errorf("delete imported transactions: %w", err)
	}
	count, _ := deleted.RowsAffected()
	result.DeletedTransactions = int(count)
	deleted, err = tx.ExecContext(ctx, `DELETE FROM position_events WHERE user_id=$1 AND import_batch_id=$2`, userID, batchID)
	if err != nil {
		return RollbackResult{}, fmt.Errorf("delete imported position events: %w", err)
	}
	count, _ = deleted.RowsAffected()
	result.DeletedPositionEvent = int(count)
	if account.TrackingMode == "positions" {
		// Removing trades can leave a later sale without holdings; replay rejects that.
		if err := validateAccountPositionReplay(ctx, tx, userID, accountID); err != nil {
			if errors.Is(err, ErrInvestmentMutationValidation) || errors.Is(err, ErrInvestmentMutationConflict) {
				return RollbackResult{}, conflict("rolling back this import would leave a later sale without holdings")
			}
			return RollbackResult{}, err
		}
	}
	ledger := &LedgerService{db: service.db, now: service.now}
	if result.BalanceAfterMinor, err = ledger.replayBalance(ctx, tx, userID, accountID); err != nil {
		return RollbackResult{}, err
	}
	var stored map[string]any
	if json.Unmarshal(summary, &stored) == nil {
		if replaced, _ := stored["replacedSnapshots"].(float64); replaced > 0 {
			result.Warnings = append(result.Warnings, "This import replaced earlier same-day snapshots; rolling it back does not restore them.")
		}
		if prices, _ := stored["pricesRecorded"].(float64); prices > 0 {
			result.Warnings = append(result.Warnings, "Prices recorded by this import were kept; delete them with delete_price if they are wrong.")
		}
	}
	if result.DeletedTransactions+result.DeletedPositionEvent == 0 {
		result.Warnings = append(result.Warnings, "Every record from this import had already been deleted.")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE import_batches SET status='rolled_back',rolled_back_at=$3 WHERE user_id=$1 AND id=$2`, userID, batchID, service.now().UTC()); err != nil {
		return RollbackResult{}, fmt.Errorf("mark import rolled back: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return RollbackResult{}, fmt.Errorf("commit import rollback: %w", err)
	}
	return result, nil
}

// ReconciliationStatus compares each statement balance recorded by an import with the
// balance Wealthboard calculates for that date now, so later edits that break a
// reconciled statement show up.
type ReconciliationStatus struct {
	AccountID             uuid.UUID `json:"accountId"`
	AccountName           string    `json:"accountName"`
	Currency              string    `json:"currency"`
	BalanceBasis          string    `json:"balanceBasis"`
	CurrentBalanceMinor   string    `json:"currentBalanceMinor"`
	LastImportID          *string   `json:"lastImportId,omitempty"`
	LastImportAt          *string   `json:"lastImportAt,omitempty"`
	StatementImportID     *string   `json:"statementImportId,omitempty"`
	StatementDate         *string   `json:"statementDate,omitempty"`
	StatementBalanceMinor *string   `json:"statementBalanceMinor,omitempty"`
	CalculatedMinor       *string   `json:"calculatedMinor,omitempty"`
	DifferenceMinor       *string   `json:"differenceMinor,omitempty"`
	Status                string    `json:"status"`
}

func (service *ImportBatchService) ReconciliationStatus(ctx context.Context, userID uuid.UUID, accountID *uuid.UUID) ([]ReconciliationStatus, error) {
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("begin reconciliation status: %w", err)
	}
	defer tx.Rollback()
	var filter any
	if accountID != nil {
		filter = *accountID
	}
	rows, err := tx.QueryContext(ctx, `
SELECT a.id,a.name,a.currency,a.tracking_mode,a.current_value_minor,
       last.id,last.created_at,stmt.id,stmt.statement_date,stmt.statement_balance_minor
FROM accounts a
LEFT JOIN LATERAL (SELECT id,created_at FROM import_batches b WHERE b.user_id=a.user_id AND b.account_id=a.id AND b.status='committed' ORDER BY created_at DESC LIMIT 1) last ON TRUE
LEFT JOIN LATERAL (SELECT id,statement_date,statement_balance_minor FROM import_batches b WHERE b.user_id=a.user_id AND b.account_id=a.id AND b.status='committed' AND b.statement_date IS NOT NULL ORDER BY statement_date DESC,created_at DESC LIMIT 1) stmt ON TRUE
WHERE a.user_id=$1 AND a.archived_at IS NULL AND ($2::UUID IS NULL OR a.id=$2)
ORDER BY a.name,a.id`, userID, filter)
	if err != nil {
		return nil, fmt.Errorf("load reconciliation status: %w", err)
	}
	type statusRow struct {
		status       ReconciliationStatus
		trackingMode string
		date         sql.NullTime
		balance      sql.NullInt64
	}
	loaded := []statusRow{}
	for rows.Next() {
		var row statusRow
		var current int64
		var lastID, statementID uuid.NullUUID
		var lastAt sql.NullTime
		if err := rows.Scan(&row.status.AccountID, &row.status.AccountName, &row.status.Currency, &row.trackingMode, &current,
			&lastID, &lastAt, &statementID, &row.date, &row.balance); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan reconciliation status: %w", err)
		}
		row.status.CurrentBalanceMinor = strconv.FormatInt(current, 10)
		if lastID.Valid {
			id, at := lastID.UUID.String(), lastAt.Time.UTC().Format(time.RFC3339)
			row.status.LastImportID, row.status.LastImportAt = &id, &at
		}
		if statementID.Valid {
			id := statementID.UUID.String()
			row.status.StatementImportID = &id
		}
		loaded = append(loaded, row)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if accountID != nil && len(loaded) == 0 {
		return nil, ErrLedgerNotFound
	}
	result := make([]ReconciliationStatus, 0, len(loaded))
	for _, row := range loaded {
		status := row.status
		status.BalanceBasis = balanceBasis(row.trackingMode)
		status.Status = "no_statement"
		if row.date.Valid {
			date := row.date.Time.Format(time.DateOnly)
			statement := row.balance.Int64
			calculated, err := balanceOnDate(ctx, tx, userID, status.AccountID, row.trackingMode, row.date.Time, nil)
			if err != nil {
				return nil, err
			}
			difference := calculated - statement
			status.StatementDate = &date
			status.StatementBalanceMinor = textPointer(strconv.FormatInt(statement, 10))
			status.CalculatedMinor = textPointer(strconv.FormatInt(calculated, 10))
			status.DifferenceMinor = textPointer(strconv.FormatInt(difference, 10))
			status.Status = "reconciled"
			if difference != 0 {
				status.Status = "out_of_balance"
			}
		}
		result = append(result, status)
	}
	return result, nil
}

func decodeStoredSummary(summary []byte, target any) error {
	if err := json.Unmarshal(summary, target); err != nil {
		return fmt.Errorf("decode stored import summary: %w", err)
	}
	return nil
}

func balanceBasis(trackingMode string) string {
	if trackingMode == "positions" {
		return "cash"
	}
	return "balance"
}

func textPointer(value string) *string { return &value }
