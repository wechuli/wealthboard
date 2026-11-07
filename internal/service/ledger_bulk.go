package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// MaxBulkLedgerRecords bounds one atomic bulk change.
const MaxBulkLedgerRecords = 1000

// TransactionDetail is one transaction with the metadata needed to edit it safely.
type TransactionDetail struct {
	Transaction
	TrackingMode      string     `json:"trackingMode"`
	ImportBatchID     *uuid.UUID `json:"importBatchId,omitempty"`
	CashSnapshotMinor *string    `json:"cashSnapshotMinor,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

func (service *LedgerService) GetTransaction(ctx context.Context, userID, transactionID uuid.UUID) (TransactionDetail, error) {
	var detail TransactionDetail
	var amount int64
	var date time.Time
	var description, notes, externalID sql.NullString
	var transferGroup, eventGroup, batch uuid.NullUUID
	var snapshot sql.NullInt64
	err := service.db.QueryRowContext(ctx, `
SELECT t.id,t.account_id,a.name,a.tracking_mode,t.type,t.amount_minor,t.currency,t.transaction_date,
       t.description,t.notes,t.external_id,t.transfer_group_id,t.event_group_id,t.import_batch_id,
       t.cash_snapshot_minor,t.created_at,t.updated_at
FROM transactions t JOIN accounts a ON a.user_id=t.user_id AND a.id=t.account_id
WHERE t.user_id=$1 AND t.id=$2`, userID, transactionID).Scan(&detail.ID, &detail.AccountID, &detail.AccountName, &detail.TrackingMode,
		&detail.Type, &amount, &detail.Currency, &date, &description, &notes, &externalID, &transferGroup, &eventGroup, &batch,
		&snapshot, &detail.CreatedAt, &detail.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return TransactionDetail{}, ErrLedgerNotFound
	}
	if err != nil {
		return TransactionDetail{}, fmt.Errorf("load transaction: %w", err)
	}
	detail.AmountMinor = strconv.FormatInt(amount, 10)
	detail.TransactionDate = date.Format(time.DateOnly)
	detail.Description, detail.Notes, detail.ExternalID = description.String, notes.String, externalID.String
	detail.TransferGroupID, detail.EventGroupID, detail.ImportBatchID = uuidPointer(transferGroup), uuidPointer(eventGroup), uuidPointer(batch)
	detail.CashSnapshotMinor = optionalInt64String(snapshot)
	return detail, nil
}

// TransactionUpdate replaces the editable fields of one transaction.
type TransactionUpdate struct {
	ID    uuid.UUID
	Input TransactionMutationInput
	// ExpectedUpdatedAt, when set, makes the update fail if the record changed after it was read.
	ExpectedUpdatedAt *time.Time
}

// LedgerBulkResult lists the accounts a bulk change replayed.
type LedgerBulkResult struct {
	AccountIDs []uuid.UUID
}

// BulkUpdateTransactions applies every update or none, then replays each affected account once.
func (service *LedgerService) BulkUpdateTransactions(ctx context.Context, userID uuid.UUID, updates []TransactionUpdate) (LedgerBulkResult, error) {
	if len(updates) == 0 || len(updates) > MaxBulkLedgerRecords {
		return LedgerBulkResult{}, validation(fmt.Sprintf("send between 1 and %d updates", MaxBulkLedgerRecords))
	}
	seen := map[uuid.UUID]bool{}
	for index, update := range updates {
		if seen[update.ID] {
			return LedgerBulkResult{}, validation(fmt.Sprintf("update %d repeats a transaction ID", index+1))
		}
		seen[update.ID] = true
		if err := validateTransactionInput(update.Input, false); err != nil {
			return LedgerBulkResult{}, indexedLedgerError(index, err)
		}
		if err := service.validateDate(ctx, userID, update.Input.TransactionDate); err != nil {
			return LedgerBulkResult{}, indexedLedgerError(index, err)
		}
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return LedgerBulkResult{}, fmt.Errorf("begin bulk transaction update: %w", err)
	}
	defer tx.Rollback()
	accounts := orderedIDs{}
	for index, update := range updates {
		accountID, err := service.updateTransactionTx(ctx, tx, userID, update.ID, update.Input, update.ExpectedUpdatedAt)
		if err != nil {
			return LedgerBulkResult{}, indexedLedgerError(index, err)
		}
		accounts.add(accountID)
	}
	if err := service.replayAccounts(ctx, tx, userID, accounts); err != nil {
		return LedgerBulkResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LedgerBulkResult{}, fmt.Errorf("commit bulk transaction update: %w", err)
	}
	return LedgerBulkResult{AccountIDs: accounts}, nil
}

// BulkDeleteTransactions deletes every listed transaction or none. Deleting one side of
// a transfer deletes both sides, as a single delete does.
func (service *LedgerService) BulkDeleteTransactions(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) (LedgerBulkResult, error) {
	if len(ids) == 0 || len(ids) > MaxBulkLedgerRecords {
		return LedgerBulkResult{}, validation(fmt.Sprintf("send between 1 and %d transaction IDs", MaxBulkLedgerRecords))
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return LedgerBulkResult{}, fmt.Errorf("begin bulk transaction deletion: %w", err)
	}
	defer tx.Rollback()
	groupOf := map[uuid.UUID]uuid.NullUUID{}
	for index, id := range ids {
		if _, repeated := groupOf[id]; repeated {
			return LedgerBulkResult{}, validation(fmt.Sprintf("ID %d is repeated", index+1))
		}
		var group uuid.NullUUID
		err := tx.QueryRowContext(ctx, `SELECT transfer_group_id FROM transactions WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, id).Scan(&group)
		if errors.Is(err, sql.ErrNoRows) {
			return LedgerBulkResult{}, indexedLedgerError(index, ErrLedgerNotFound)
		}
		if err != nil {
			return LedgerBulkResult{}, fmt.Errorf("load transaction: %w", err)
		}
		groupOf[id] = group
	}
	deletedGroups := map[uuid.UUID]bool{}
	accounts := orderedIDs{}
	for index, id := range ids {
		if group := groupOf[id]; group.Valid {
			if deletedGroups[group.UUID] {
				continue
			}
			deletedGroups[group.UUID] = true
		}
		affected, err := service.deleteTransactionTx(ctx, tx, userID, id)
		if err != nil {
			return LedgerBulkResult{}, indexedLedgerError(index, err)
		}
		for _, accountID := range affected {
			accounts.add(accountID)
		}
	}
	if err := service.replayAccounts(ctx, tx, userID, accounts); err != nil {
		return LedgerBulkResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LedgerBulkResult{}, fmt.Errorf("commit bulk transaction deletion: %w", err)
	}
	return LedgerBulkResult{AccountIDs: accounts}, nil
}

func (service *LedgerService) replayAccounts(ctx context.Context, tx *sql.Tx, userID uuid.UUID, accounts []uuid.UUID) error {
	for _, accountID := range accounts {
		if _, err := service.replayBalance(ctx, tx, userID, accountID); err != nil {
			return err
		}
	}
	return nil
}

// orderedIDs collects distinct IDs in first-seen order.
type orderedIDs []uuid.UUID

func (ids *orderedIDs) add(id uuid.UUID) {
	for _, existing := range *ids {
		if existing == id {
			return
		}
	}
	*ids = append(*ids, id)
}

// indexedLedgerError names the failing item of a bulk request while keeping the error's category.
func indexedLedgerError(index int, err error) error {
	for _, sentinel := range []error{ErrLedgerValidation, ErrLedgerConflict, ErrLedgerNotFound} {
		if errors.Is(err, sentinel) {
			detail := strings.TrimPrefix(strings.TrimPrefix(err.Error(), sentinel.Error()), ": ")
			if detail == "" {
				detail = sentinel.Error()
			}
			return fmt.Errorf("%w: item %d: %s", sentinel, index+1, detail)
		}
	}
	return err
}

// ValuationDetail is one valuation snapshot.
type ValuationDetail struct {
	Valuation
	CreatedAt time.Time `json:"createdAt"`
}

func (service *LedgerService) GetValuation(ctx context.Context, userID, valuationID uuid.UUID) (ValuationDetail, error) {
	var detail ValuationDetail
	var value int64
	var date time.Time
	var notes sql.NullString
	err := service.db.QueryRowContext(ctx, `
SELECT v.id,v.account_id,a.name,v.value_minor,v.currency,v.valuation_date,v.notes,v.created_at
FROM valuation_snapshots v JOIN accounts a ON a.user_id=v.user_id AND a.id=v.account_id
WHERE v.user_id=$1 AND v.id=$2`, userID, valuationID).Scan(&detail.ID, &detail.AccountID, &detail.AccountName, &value, &detail.Currency, &date, &notes, &detail.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ValuationDetail{}, ErrLedgerNotFound
	}
	if err != nil {
		return ValuationDetail{}, fmt.Errorf("load valuation: %w", err)
	}
	detail.ValueMinor, detail.ValuationDate, detail.Notes = strconv.FormatInt(value, 10), date.Format(time.DateOnly), notes.String
	return detail, nil
}

// UpdateValuation corrects a valuation's value, date, or notes and replays its account.
func (service *LedgerService) UpdateValuation(ctx context.Context, userID, valuationID uuid.UUID, input ValuationMutationInput) error {
	if input.ValueMinor < 0 || input.ValuationDate.IsZero() || !validLedgerText(input.Notes, 2000) {
		return validation("provide a valid valuation")
	}
	if err := service.validateDate(ctx, userID, input.ValuationDate); err != nil {
		return err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin valuation update: %w", err)
	}
	defer tx.Rollback()
	var accountID uuid.UUID
	err = tx.QueryRowContext(ctx, `SELECT account_id FROM valuation_snapshots WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, valuationID).Scan(&accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrLedgerNotFound
	}
	if err != nil {
		return fmt.Errorf("load valuation: %w", err)
	}
	if _, err := getLedgerAccount(ctx, tx, userID, accountID, false); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE valuation_snapshots SET value_minor=$3,valuation_date=$4,notes=$5 WHERE user_id=$1 AND id=$2`,
		userID, valuationID, input.ValueMinor, ledgerDateOnly(input.ValuationDate), nullable(input.Notes)); err != nil {
		return fmt.Errorf("update valuation: %w", err)
	}
	if _, err := service.replayBalance(ctx, tx, userID, accountID); err != nil {
		return err
	}
	return tx.Commit()
}
