package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrLedgerNotFound  = errors.New("ledger resource not found")
	ErrLedgerConflict  = errors.New("ledger conflict")
	ErrLedgerValidation = errors.New("ledger validation failed")
)

var ledgerCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

var transactionEffects = map[string]int64{
	"opening_balance": 1, "deposit": 1, "interest": 1, "dividend": 1,
	"capital_gain": 1, "purchase": 1, "liability_increase": 1,
	"withdrawal": -1, "capital_loss": -1, "fee": -1, "sale": -1,
	"liability_payment": -1,
}

var positionCashTypes = map[string]bool{
	"deposit": true, "withdrawal": true, "interest": true,
	"dividend": true, "fee": true, "manual_adjustment": true,
}

type LedgerService struct {
	db  *sql.DB
	now func() time.Time
}

func NewLedgerService(db *sql.DB) *LedgerService {
	return &LedgerService{db: db, now: time.Now}
}

type AccountMutationInput struct {
	IdempotencyKey      *uuid.UUID
	Name                string
	Description         string
	CategoryID          uuid.UUID
	InstitutionID       *uuid.UUID
	AccountReference    string
	Currency            string
	TrackingMode        string
	OpeningValueMinor   int64
	CostBasisMinor      *int64
	IsIncludedInNetWorth bool
	Notes               string
	OpenedAt            *time.Time
}

type TransactionMutationInput struct {
	IdempotencyKey uuid.UUID
	AccountID      uuid.UUID
	Type           string
	AmountMinor    int64
	TransactionDate time.Time
	Description    string
	ExternalID     string
	Notes          string
}

type ValuationMutationInput struct {
	IdempotencyKey uuid.UUID
	AccountID      uuid.UUID
	ValueMinor     int64
	ValuationDate  time.Time
	Notes          string
}

type TransferMutationInput struct {
	IdempotencyKey       uuid.UUID
	FromAccountID        uuid.UUID
	ToAccountID          uuid.UUID
	SourceAmountMinor    int64
	DestinationAmountMinor int64
	TransactionDate      time.Time
	Description          string
}

type ledgerAccount struct {
	ID, CategoryID uuid.UUID
	Name, Currency, TrackingMode string
	CurrentValueMinor int64
	IsLiability bool
	ArchivedAt sql.NullTime
}

func (service *LedgerService) CreateAccount(ctx context.Context, userID uuid.UUID, input AccountMutationInput) (uuid.UUID, error) {
	if err := validateAccountInput(input, true); err != nil {
		return uuid.Nil, err
	}
	if input.OpenedAt != nil {
		if err := service.validateDate(ctx, userID, *input.OpenedAt); err != nil {
			return uuid.Nil, err
		}
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin account creation: %w", err)
	}
	defer tx.Rollback()
	if input.IdempotencyKey != nil {
		resultID, operation, found, lookupErr := lookupIdempotency(ctx, tx, userID, *input.IdempotencyKey)
		if lookupErr != nil {
			return uuid.Nil, lookupErr
		}
		if found {
			if operation != "create-account" || resultID == nil {
				return uuid.Nil, conflict("idempotency key was already used for another request")
			}
			compatible, compareErr := accountCreateMatches(ctx, tx, userID, *resultID, input)
			if compareErr != nil {
				return uuid.Nil, compareErr
			}
			if !compatible {
				return uuid.Nil, conflict("idempotency key was reused with incompatible account data")
			}
			return *resultID, nil
		}
	}
	isLiability, err := validateLedgerCategory(ctx, tx, userID, input.CategoryID)
	if err != nil {
		return uuid.Nil, err
	}
	if input.TrackingMode == "positions" && isLiability {
		return uuid.Nil, validation("liability accounts cannot track positions")
	}
	if err := validateLedgerInstitution(ctx, tx, userID, input.InstitutionID, nil); err != nil {
		return uuid.Nil, err
	}
	if err := validateEnabledCurrency(ctx, tx, userID, input.Currency); err != nil {
		return uuid.Nil, err
	}
	now := service.now().UTC()
	accountID := uuid.New()
	openedAt := ledgerNullTime(input.OpenedAt)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO accounts (
			id, user_id, name, description, category_id, institution_id,
			account_reference, currency, tracking_mode, current_value_minor,
			cost_basis_minor, is_liability, is_included_in_net_worth, notes,
			opened_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
	`, accountID, userID, strings.TrimSpace(input.Name), nullable(input.Description), input.CategoryID,
		nullUUID(input.InstitutionID), nullable(input.AccountReference), input.Currency, input.TrackingMode,
		input.OpeningValueMinor, nullableInt64ForMode(input.CostBasisMinor, input.TrackingMode), isLiability,
		input.IsIncludedInNetWorth, nullable(input.Notes), openedAt, now)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert account: %w", err)
	}
	transactionDate := now
	if input.OpenedAt != nil {
		transactionDate = dateOnly(*input.OpenedAt)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO transactions (
			id,user_id,account_id,type,amount_minor,currency,transaction_date,
			description,created_at,updated_at
		) VALUES ($1,$2,$3,'opening_balance',$4,$5,$6,'Opening balance',$7,$7)
	`, uuid.New(), userID, accountID, input.OpeningValueMinor, input.Currency, transactionDate, now)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert opening balance: %w", err)
	}
	if input.IdempotencyKey != nil {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO idempotency_keys (user_id,key,operation,result_id,created_at)
			VALUES ($1,$2,'create-account',$3,$4)
		`, userID, *input.IdempotencyKey, accountID, now); err != nil {
			return uuid.Nil, fmt.Errorf("store account idempotency key: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return uuid.Nil, fmt.Errorf("commit account creation: %w", err)
	}
	return accountID, nil
}

func (service *LedgerService) UpdateAccount(ctx context.Context, userID, accountID uuid.UUID, input AccountMutationInput) error {
	if err := validateAccountInput(input, false); err != nil {
		return err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin account update: %w", err)
	}
	defer tx.Rollback()
	existing, err := getLedgerAccount(ctx, tx, userID, accountID, true)
	if err != nil {
		return err
	}
	if existing.ArchivedAt.Valid {
		return validation("archived accounts cannot be changed")
	}
	if existing.Currency != input.Currency {
		return validation("account currency cannot be changed after creation")
	}
	if existing.TrackingMode != input.TrackingMode {
		return validation("account tracking mode cannot be changed")
	}
	isLiability, err := validateLedgerCategory(ctx, tx, userID, input.CategoryID)
	if err != nil {
		return err
	}
	if input.TrackingMode == "positions" && isLiability {
		return validation("liability accounts cannot track positions")
	}
	if err := validateLedgerInstitution(ctx, tx, userID, input.InstitutionID, nil); err != nil {
		return err
	}
	if err := validateEnabledCurrency(ctx, tx, userID, input.Currency); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE accounts SET name=$3,description=$4,category_id=$5,institution_id=$6,
			account_reference=$7,cost_basis_minor=$8,is_liability=$9,
			is_included_in_net_worth=$10,notes=$11,updated_at=$12
		WHERE user_id=$1 AND id=$2
	`, userID, accountID, strings.TrimSpace(input.Name), nullable(input.Description), input.CategoryID,
		nullUUID(input.InstitutionID), nullable(input.AccountReference), nullableInt64ForMode(input.CostBasisMinor, input.TrackingMode),
		isLiability, input.IsIncludedInNetWorth, nullable(input.Notes), service.now().UTC())
	if err != nil {
		return fmt.Errorf("update account: %w", err)
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	return tx.Commit()
}

func (service *LedgerService) SetAccountArchived(ctx context.Context, userID, accountID uuid.UUID, archived bool) error {
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin account archive: %w", err)
	}
	defer tx.Rollback()
	if _, err := getLedgerAccount(ctx, tx, userID, accountID, true); err != nil {
		return err
	}
	if !archived {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM account_conversions WHERE user_id=$1 AND source_account_id=$2)`, userID, accountID).Scan(&exists); err != nil {
			return fmt.Errorf("check account conversion: %w", err)
		}
		if exists {
			return conflict("a converted source account cannot be restored")
		}
		if _, err := service.replayBalance(ctx, tx, userID, accountID); err != nil {
			return err
		}
	}
	var archivedAt any
	if archived {
		archivedAt = service.now().UTC()
	}
	_, err = tx.ExecContext(ctx, `UPDATE accounts SET archived_at=$3,updated_at=$4 WHERE user_id=$1 AND id=$2`, userID, accountID, archivedAt, service.now().UTC())
	if err != nil {
		return fmt.Errorf("set account archive state: %w", err)
	}
	return tx.Commit()
}

func (service *LedgerService) DeleteAccount(ctx context.Context, userID, accountID uuid.UUID, confirmationName string) error {
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin account deletion: %w", err)
	}
	defer tx.Rollback()
	account, err := getLedgerAccount(ctx, tx, userID, accountID, true)
	if err != nil {
		return err
	}
	if !account.ArchivedAt.Valid {
		return validation("archive the account before deleting it")
	}
	if confirmationName != account.Name {
		return validation("account confirmation name does not match")
	}
	var linked bool
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM transactions owned
			JOIN transactions linked ON linked.user_id=owned.user_id
				AND linked.transfer_group_id=owned.transfer_group_id
			WHERE owned.user_id=$1 AND owned.account_id=$2
				AND owned.transfer_group_id IS NOT NULL AND linked.account_id<>$2
		)
	`, userID, accountID).Scan(&linked)
	if err != nil {
		return fmt.Errorf("check linked transfers: %w", err)
	}
	if linked {
		return conflict("remove linked transfers before deleting this account")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE goals SET linked_account_id=NULL,current_amount_minor=0,updated_at=$3 WHERE user_id=$1 AND linked_account_id=$2`, userID, accountID, service.now().UTC()); err != nil {
		return fmt.Errorf("unlink account goals: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM account_conversions WHERE user_id=$1 AND (source_account_id=$2 OR target_account_id=$2)`, userID, accountID); err != nil {
		return fmt.Errorf("delete account conversion: %w", err)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM accounts WHERE user_id=$1 AND id=$2`, userID, accountID)
	if err != nil {
		return fmt.Errorf("delete account: %w", err)
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	return tx.Commit()
}

func (service *LedgerService) CreateTransaction(ctx context.Context, userID uuid.UUID, input TransactionMutationInput) (uuid.UUID, error) {
	if err := validateTransactionInput(input, true); err != nil {
		return uuid.Nil, err
	}
	if err := service.validateDate(ctx, userID, input.TransactionDate); err != nil {
		return uuid.Nil, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin transaction creation: %w", err)
	}
	defer tx.Rollback()
	var existingID, existingAccount uuid.UUID
	var existingType string
	var existingAmount int64
	var existingDate time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT id,account_id,type,amount_minor,transaction_date
		FROM transactions WHERE user_id=$1 AND idempotency_key=$2
	`, userID, input.IdempotencyKey).Scan(&existingID, &existingAccount, &existingType, &existingAmount, &existingDate)
	if err == nil {
		if existingAccount != input.AccountID || existingType != input.Type || existingAmount != input.AmountMinor || !sameDate(existingDate, input.TransactionDate) {
			return uuid.Nil, conflict("idempotency key was reused with incompatible transaction data")
		}
		return existingID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, fmt.Errorf("check transaction idempotency: %w", err)
	}
	account, err := getLedgerAccount(ctx, tx, userID, input.AccountID, false)
	if err != nil {
		return uuid.Nil, err
	}
	if err := validateTransactionForAccount(input.Type, account.TrackingMode); err != nil {
		return uuid.Nil, err
	}
	transactionID := uuid.New()
	now := service.now().UTC()
	externalID := strings.TrimSpace(input.ExternalID)
	if externalID == "" {
		externalID = fmt.Sprintf("derived-%s-%s-%d", input.TransactionDate.Format(time.DateOnly), input.Type, input.AmountMinor)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO transactions (
			id,user_id,account_id,type,amount_minor,currency,transaction_date,
			description,notes,external_id,idempotency_key,created_at,updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
	`, transactionID, userID, input.AccountID, input.Type, input.AmountMinor, account.Currency,
		dateOnly(input.TransactionDate), nullable(input.Description), nullable(input.Notes), externalID, input.IdempotencyKey, now)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert transaction: %w", err)
	}
	if _, err := service.replayBalance(ctx, tx, userID, input.AccountID); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(); err != nil {
		return uuid.Nil, fmt.Errorf("commit transaction creation: %w", err)
	}
	return transactionID, nil
}

func (service *LedgerService) UpdateTransaction(ctx context.Context, userID, transactionID uuid.UUID, input TransactionMutationInput) error {
	if err := validateTransactionInput(input, false); err != nil {
		return err
	}
	if err := service.validateDate(ctx, userID, input.TransactionDate); err != nil {
		return err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction update: %w", err)
	}
	defer tx.Rollback()
	var accountID uuid.UUID
	var existingType string
	var eventGroupID uuid.NullUUID
	err = tx.QueryRowContext(ctx, `SELECT account_id,type,event_group_id FROM transactions WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, transactionID).Scan(&accountID, &existingType, &eventGroupID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrLedgerNotFound
	}
	if err != nil {
		return fmt.Errorf("load transaction: %w", err)
	}
	if existingType == "opening_balance" || existingType == "transfer" || eventGroupID.Valid {
		return validation("opening balances, transfers, and grouped investment activity cannot be edited individually")
	}
	account, err := getLedgerAccount(ctx, tx, userID, accountID, false)
	if err != nil {
		return err
	}
	if err := validateTransactionForAccount(input.Type, account.TrackingMode); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE transactions SET type=$3,amount_minor=$4,transaction_date=$5,
			description=$6,notes=$7,external_id=$8,updated_at=$9
		WHERE user_id=$1 AND id=$2
	`, userID, transactionID, input.Type, input.AmountMinor, dateOnly(input.TransactionDate), nullable(input.Description), nullable(input.Notes), nullable(input.ExternalID), service.now().UTC())
	if err != nil {
		return fmt.Errorf("update transaction: %w", err)
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	if _, err := service.replayBalance(ctx, tx, userID, accountID); err != nil {
		return err
	}
	return tx.Commit()
}

func (service *LedgerService) DeleteTransaction(ctx context.Context, userID, transactionID uuid.UUID) error {
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction deletion: %w", err)
	}
	defer tx.Rollback()
	var accountID uuid.UUID
	var transactionType string
	var transferGroupID, eventGroupID uuid.NullUUID
	err = tx.QueryRowContext(ctx, `SELECT account_id,type,transfer_group_id,event_group_id FROM transactions WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, transactionID).Scan(&accountID, &transactionType, &transferGroupID, &eventGroupID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrLedgerNotFound
	}
	if err != nil {
		return fmt.Errorf("load transaction: %w", err)
	}
	if _, err := getLedgerAccount(ctx, tx, userID, accountID, false); err != nil {
		return err
	}
	if transactionType == "opening_balance" {
		return validation("the opening balance cannot be deleted")
	}
	if eventGroupID.Valid {
		return validation("use the position workflow for grouped investment activity")
	}
	affected := []uuid.UUID{accountID}
	if transferGroupID.Valid {
		rows, queryErr := tx.QueryContext(ctx, `SELECT DISTINCT account_id FROM transactions WHERE user_id=$1 AND transfer_group_id=$2`, userID, transferGroupID.UUID)
		if queryErr != nil {
			return fmt.Errorf("load transfer accounts: %w", queryErr)
		}
		affected = nil
		for rows.Next() {
			var id uuid.UUID
			if scanErr := rows.Scan(&id); scanErr != nil {
				rows.Close()
				return fmt.Errorf("scan transfer account: %w", scanErr)
			}
			affected = append(affected, id)
		}
		rows.Close()
		_, err = tx.ExecContext(ctx, `DELETE FROM transactions WHERE user_id=$1 AND transfer_group_id=$2`, userID, transferGroupID.UUID)
	} else {
		_, err = tx.ExecContext(ctx, `DELETE FROM transactions WHERE user_id=$1 AND id=$2`, userID, transactionID)
	}
	if err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}
	for _, id := range affected {
		if _, err := service.replayBalance(ctx, tx, userID, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (service *LedgerService) CreateValuation(ctx context.Context, userID uuid.UUID, input ValuationMutationInput) (uuid.UUID, error) {
	if input.IdempotencyKey == uuid.Nil || input.AccountID == uuid.Nil || input.ValueMinor < 0 || input.ValuationDate.IsZero() {
		return uuid.Nil, validation("provide a valid valuation")
	}
	if err := service.validateDate(ctx, userID, input.ValuationDate); err != nil {
		return uuid.Nil, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin valuation creation: %w", err)
	}
	defer tx.Rollback()
	resultID, operation, found, err := lookupIdempotency(ctx, tx, userID, input.IdempotencyKey)
	if err != nil {
		return uuid.Nil, err
	}
	if found {
		if operation != "valuation" || resultID == nil {
			return uuid.Nil, conflict("idempotency key was already used for another request")
		}
		var accountID uuid.UUID
		var value int64
		var date time.Time
		err = tx.QueryRowContext(ctx, `SELECT account_id,value_minor,valuation_date FROM valuation_snapshots WHERE user_id=$1 AND id=$2`, userID, *resultID).Scan(&accountID, &value, &date)
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, conflict("idempotency result no longer exists")
		}
		if err != nil {
			return uuid.Nil, fmt.Errorf("load idempotent valuation: %w", err)
		}
		if accountID != input.AccountID || value != input.ValueMinor || !sameDate(date, input.ValuationDate) {
			return uuid.Nil, conflict("idempotency key was reused with incompatible valuation data")
		}
		return *resultID, nil
	}
	account, err := getLedgerAccount(ctx, tx, userID, input.AccountID, false)
	if err != nil {
		return uuid.Nil, err
	}
	if account.TrackingMode != "balance" {
		return uuid.Nil, validation("position accounts must be valued through instrument prices")
	}
	valuationID := uuid.New()
	now := service.now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO valuation_snapshots (id,user_id,account_id,value_minor,currency,valuation_date,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, valuationID, userID, input.AccountID, input.ValueMinor, account.Currency, dateOnly(input.ValuationDate), nullable(input.Notes), now); err != nil {
		return uuid.Nil, fmt.Errorf("insert valuation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO idempotency_keys (user_id,key,operation,result_id,created_at) VALUES ($1,$2,'valuation',$3,$4)`, userID, input.IdempotencyKey, valuationID, now); err != nil {
		return uuid.Nil, fmt.Errorf("store valuation idempotency key: %w", err)
	}
	if _, err := service.replayBalance(ctx, tx, userID, input.AccountID); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(); err != nil {
		return uuid.Nil, fmt.Errorf("commit valuation creation: %w", err)
	}
	return valuationID, nil
}

func (service *LedgerService) DeleteValuation(ctx context.Context, userID, valuationID uuid.UUID) error {
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin valuation deletion: %w", err)
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM valuation_snapshots WHERE user_id=$1 AND id=$2`, userID, valuationID); err != nil {
		return fmt.Errorf("delete valuation: %w", err)
	}
	if _, err := service.replayBalance(ctx, tx, userID, accountID); err != nil {
		return err
	}
	return tx.Commit()
}

func (service *LedgerService) CreateTransfer(ctx context.Context, userID uuid.UUID, input TransferMutationInput) (uuid.UUID, error) {
	if input.IdempotencyKey == uuid.Nil || input.FromAccountID == uuid.Nil || input.ToAccountID == uuid.Nil || input.FromAccountID == input.ToAccountID || input.SourceAmountMinor <= 0 || input.DestinationAmountMinor <= 0 || input.TransactionDate.IsZero() {
		return uuid.Nil, validation("provide a valid transfer")
	}
	if err := service.validateDate(ctx, userID, input.TransactionDate); err != nil {
		return uuid.Nil, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin transfer: %w", err)
	}
	defer tx.Rollback()
	resultID, operation, found, err := lookupIdempotency(ctx, tx, userID, input.IdempotencyKey)
	if err != nil {
		return uuid.Nil, err
	}
	if found {
		if operation != "transfer" || resultID == nil {
			return uuid.Nil, conflict("idempotency key was already used for another request")
		}
		compatible, compareErr := transferMatches(ctx, tx, userID, *resultID, input)
		if compareErr != nil {
			return uuid.Nil, compareErr
		}
		if !compatible {
			return uuid.Nil, conflict("idempotency key was reused with incompatible transfer data")
		}
		return *resultID, nil
	}
	source, err := getLedgerAccount(ctx, tx, userID, input.FromAccountID, false)
	if err != nil {
		return uuid.Nil, ErrLedgerNotFound
	}
	destination, err := getLedgerAccount(ctx, tx, userID, input.ToAccountID, false)
	if err != nil {
		return uuid.Nil, ErrLedgerNotFound
	}
	if source.IsLiability || destination.IsLiability {
		return uuid.Nil, validation("transfers are available only between asset accounts")
	}
	if source.TrackingMode != "balance" || destination.TrackingMode != "balance" {
		return uuid.Nil, validation("this ledger transfer workflow supports balance accounts only")
	}
	groupID := uuid.New()
	now := service.now().UTC()
	descriptionOut := strings.TrimSpace(input.Description)
	descriptionIn := descriptionOut
	if descriptionOut == "" {
		descriptionOut = "Transfer to " + destination.Name
		descriptionIn = "Transfer from " + source.Name
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,description,transfer_group_id,created_at,updated_at)
		VALUES ($1,$2,$3,'transfer',$4,$5,$6,$7,$8,$9,$9),($10,$2,$11,'transfer',$12,$13,$6,$14,$8,$9,$9)
	`, uuid.New(), userID, source.ID, -input.SourceAmountMinor, source.Currency, dateOnly(input.TransactionDate), descriptionOut, groupID, now,
		uuid.New(), destination.ID, input.DestinationAmountMinor, destination.Currency, descriptionIn); err != nil {
		return uuid.Nil, fmt.Errorf("insert transfer pair: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO idempotency_keys (user_id,key,operation,result_id,created_at) VALUES ($1,$2,'transfer',$3,$4)`, userID, input.IdempotencyKey, groupID, now); err != nil {
		return uuid.Nil, fmt.Errorf("store transfer idempotency key: %w", err)
	}
	if _, err := service.replayBalance(ctx, tx, userID, source.ID); err != nil {
		return uuid.Nil, err
	}
	if _, err := service.replayBalance(ctx, tx, userID, destination.ID); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(); err != nil {
		return uuid.Nil, fmt.Errorf("commit transfer: %w", err)
	}
	return groupID, nil
}

type sqlTx interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (service *LedgerService) replayBalance(ctx context.Context, tx sqlTx, userID, accountID uuid.UUID) (int64, error) {
	account, err := getLedgerAccount(ctx, tx, userID, accountID, true)
	if err != nil {
		return 0, err
	}
	if account.TrackingMode != "balance" {
		return 0, validation("balance replay is unavailable for position accounts")
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT kind,type,amount_minor,event_date FROM (
			SELECT 'transaction' AS kind,type,amount_minor,transaction_date AS event_date,created_at,0 AS kind_order
			FROM transactions WHERE user_id=$1 AND account_id=$2
			UNION ALL
			SELECT 'valuation','',value_minor,valuation_date,created_at,1
			FROM valuation_snapshots WHERE user_id=$1 AND account_id=$2
		) events ORDER BY event_date,created_at,kind_order
	`, userID, accountID)
	if err != nil {
		return 0, fmt.Errorf("load account events: %w", err)
	}
	defer rows.Close()
	var balance int64
	for rows.Next() {
		var kind, transactionType string
		var amount int64
		var eventDate time.Time
		if err := rows.Scan(&kind, &transactionType, &amount, &eventDate); err != nil {
			return 0, fmt.Errorf("scan account event: %w", err)
		}
		if kind == "valuation" {
			balance = amount
			continue
		}
		effect, err := transactionEffect(transactionType, amount)
		if err != nil {
			return 0, err
		}
		balance += effect
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate account events: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET current_value_minor=$3,updated_at=$4 WHERE user_id=$1 AND id=$2`, userID, accountID, balance, service.now().UTC()); err != nil {
		return 0, fmt.Errorf("store replayed balance: %w", err)
	}
	return balance, nil
}

func transactionEffect(transactionType string, amount int64) (int64, error) {
	if transactionType == "manual_adjustment" || transactionType == "transfer" {
		return amount, nil
	}
	sign, ok := transactionEffects[transactionType]
	if !ok {
		return 0, validation("unsupported transaction type")
	}
	if amount < 0 {
		amount = -amount
	}
	return sign * amount, nil
}

func validateAccountInput(input AccountMutationInput, creating bool) error {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 100 || strings.ContainsAny(input.Name, "\x00\n\r\t") || input.CategoryID == uuid.Nil || !ledgerCurrencyPattern.MatchString(input.Currency) {
		return validation("provide valid account details")
	}
	if input.TrackingMode == "" {
		input.TrackingMode = "balance"
	}
	if input.TrackingMode != "balance" && input.TrackingMode != "positions" {
		return validation("tracking mode must be balance or positions")
	}
	if creating && input.OpeningValueMinor < 0 {
		return validation("opening value cannot be negative")
	}
	return nil
}

func validateTransactionInput(input TransactionMutationInput, creating bool) error {
	if input.AccountID == uuid.Nil || input.TransactionDate.IsZero() || (creating && input.IdempotencyKey == uuid.Nil) {
		return validation("provide a valid transaction")
	}
	if input.Type == "opening_balance" || input.Type == "transfer" {
		return validation("use the dedicated workflow for this transaction type")
	}
	if _, ok := transactionEffects[input.Type]; !ok && input.Type != "manual_adjustment" {
		return validation("unsupported transaction type")
	}
	if input.Type == "manual_adjustment" && input.AmountMinor == 0 {
		return validation("adjustment cannot be zero")
	}
	if input.Type != "manual_adjustment" && input.AmountMinor <= 0 {
		return validation("amount must be greater than zero")
	}
	return nil
}

func validateTransactionForAccount(transactionType, trackingMode string) error {
	if trackingMode == "positions" && !positionCashTypes[transactionType] {
		return validation("use the position workflow for this activity")
	}
	if trackingMode == "positions" {
		return validation("cash replay for position accounts is not available in this ledger slice")
	}
	return nil
}

func (service *LedgerService) validateDate(ctx context.Context, userID uuid.UUID, value time.Time) error {
	var timezone string
	if err := service.db.QueryRowContext(ctx, `SELECT timezone FROM user_settings WHERE user_id=$1`, userID).Scan(&timezone); errors.Is(err, sql.ErrNoRows) {
		return ErrLedgerNotFound
	} else if err != nil {
		return fmt.Errorf("load user timezone: %w", err)
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("load user timezone: %w", err)
	}
	if value.Format(time.DateOnly) > service.now().In(location).Format(time.DateOnly) {
		return validation("financial activity cannot be dated in the future")
	}
	return nil
}

func getLedgerAccount(ctx context.Context, tx sqlTx, userID, accountID uuid.UUID, includeArchived bool) (ledgerAccount, error) {
	query := `SELECT id,category_id,name,currency,tracking_mode,current_value_minor,is_liability,archived_at FROM accounts WHERE user_id=$1 AND id=$2`
	if !includeArchived {
		query += ` AND archived_at IS NULL`
	}
	var account ledgerAccount
	err := tx.QueryRowContext(ctx, query, userID, accountID).Scan(&account.ID, &account.CategoryID, &account.Name, &account.Currency, &account.TrackingMode, &account.CurrentValueMinor, &account.IsLiability, &account.ArchivedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ledgerAccount{}, ErrLedgerNotFound
	}
	if err != nil {
		return ledgerAccount{}, fmt.Errorf("load account: %w", err)
	}
	return account, nil
}

func validateLedgerCategory(ctx context.Context, tx sqlTx, userID, categoryID uuid.UUID) (bool, error) {
	var kind string
	err := tx.QueryRowContext(ctx, `SELECT asset_or_liability FROM categories WHERE user_id=$1 AND id=$2 AND is_archived=FALSE`, userID, categoryID).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrLedgerNotFound
	}
	if err != nil {
		return false, fmt.Errorf("load category: %w", err)
	}
	return kind == "liability", nil
}

func validateLedgerInstitution(ctx context.Context, tx sqlTx, userID uuid.UUID, institutionID, currentID *uuid.UUID) error {
	if institutionID == nil {
		return nil
	}
	var archivedAt sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT archived_at FROM institutions WHERE user_id=$1 AND id=$2`, userID, *institutionID).Scan(&archivedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrLedgerNotFound
	}
	if err != nil {
		return fmt.Errorf("load institution: %w", err)
	}
	if archivedAt.Valid && (currentID == nil || *currentID != *institutionID) {
		return validation("the selected institution is unavailable")
	}
	return nil
}

func validateEnabledCurrency(ctx context.Context, tx sqlTx, userID uuid.UUID, currency string) error {
	var raw string
	if err := tx.QueryRowContext(ctx, `SELECT supported_currencies FROM user_settings WHERE user_id=$1`, userID).Scan(&raw); errors.Is(err, sql.ErrNoRows) {
		return ErrLedgerNotFound
	} else if err != nil {
		return fmt.Errorf("load supported currencies: %w", err)
	}
	var currencies []string
	if err := json.Unmarshal([]byte(raw), &currencies); err != nil {
		return fmt.Errorf("decode supported currencies: %w", err)
	}
	for _, enabled := range currencies {
		if enabled == currency {
			return nil
		}
	}
	return validation("currency is not enabled")
}

func lookupIdempotency(ctx context.Context, tx sqlTx, userID, key uuid.UUID) (*uuid.UUID, string, bool, error) {
	var operation string
	var result uuid.NullUUID
	err := tx.QueryRowContext(ctx, `SELECT operation,result_id FROM idempotency_keys WHERE user_id=$1 AND key=$2`, userID, key).Scan(&operation, &result)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, fmt.Errorf("check idempotency key: %w", err)
	}
	if result.Valid {
		return &result.UUID, operation, true, nil
	}
	return nil, operation, true, nil
}

func accountCreateMatches(ctx context.Context, tx sqlTx, userID, accountID uuid.UUID, input AccountMutationInput) (bool, error) {
	var name, currency, trackingMode string
	var categoryID uuid.UUID
	var opening int64
	err := tx.QueryRowContext(ctx, `
		SELECT a.name,a.category_id,a.currency,a.tracking_mode,t.amount_minor
		FROM accounts a JOIN transactions t ON t.user_id=a.user_id AND t.account_id=a.id AND t.type='opening_balance'
		WHERE a.user_id=$1 AND a.id=$2
	`, userID, accountID).Scan(&name, &categoryID, &currency, &trackingMode, &opening)
	if errors.Is(err, sql.ErrNoRows) {
		return false, conflict("idempotency result no longer exists")
	}
	if err != nil {
		return false, fmt.Errorf("load idempotent account: %w", err)
	}
	return name == strings.TrimSpace(input.Name) && categoryID == input.CategoryID && currency == input.Currency && trackingMode == input.TrackingMode && opening == input.OpeningValueMinor, nil
}

func transferMatches(ctx context.Context, tx sqlTx, userID, groupID uuid.UUID, input TransferMutationInput) (bool, error) {
	rows, err := tx.QueryContext(ctx, `SELECT account_id,amount_minor,transaction_date FROM transactions WHERE user_id=$1 AND transfer_group_id=$2 ORDER BY amount_minor`, userID, groupID)
	if err != nil {
		return false, fmt.Errorf("load idempotent transfer: %w", err)
	}
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var accountID uuid.UUID
		var amount int64
		var date time.Time
		if err := rows.Scan(&accountID, &amount, &date); err != nil {
			return false, fmt.Errorf("scan idempotent transfer: %w", err)
		}
		matches := (accountID == input.FromAccountID && amount == -input.SourceAmountMinor) || (accountID == input.ToAccountID && amount == input.DestinationAmountMinor)
		if !matches || !sameDate(date, input.TransactionDate) {
			return false, nil
		}
		seen++
	}
	return seen == 2, rows.Err()
}

func validation(message string) error { return fmt.Errorf("%w: %s", ErrLedgerValidation, message) }
func conflict(message string) error { return fmt.Errorf("%w: %s", ErrLedgerConflict, message) }

func nullable(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nullUUID(value *uuid.UUID) any {
	if value == nil {
		return nil
	}
	return *value
}

func ledgerNullTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return dateOnly(*value)
}

func nullableInt64ForMode(value *int64, trackingMode string) any {
	if value == nil || trackingMode != "balance" {
		return nil
	}
	return *value
}

func dateOnly(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func sameDate(left, right time.Time) bool { return left.Format(time.DateOnly) == right.Format(time.DateOnly) }

func requireAffected(result sql.Result) error {
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read affected rows: %w", err)
	}
	if count != 1 {
		return ErrLedgerNotFound
	}
	return nil
}

func ParseMinorUnits(value string) (int64, error) {
	if value == "" || strings.TrimSpace(value) != value {
		return 0, validation("minor units must be an integer string")
	}
	amount, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, validation("minor units must fit PostgreSQL bigint")
	}
	return amount, nil
}