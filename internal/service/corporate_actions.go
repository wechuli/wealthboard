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

	"github.com/wechuli/wealthboard/internal/domain"
)

type CorporateActions struct {
	db          *sql.DB
	investments *InvestmentMutations
	now         func() time.Time
}

func NewCorporateActions(db *sql.DB) *CorporateActions {
	actions := &CorporateActions{db: db, now: time.Now}
	actions.investments = NewInvestmentMutations(db)
	actions.investments.now = func() time.Time { return actions.now() }
	return actions
}

type StockSplitInput struct {
	AccountID      uuid.UUID
	InstrumentID   uuid.UUID
	Numerator      string
	Denominator    string
	ActionDate     time.Time
	IdempotencyKey uuid.UUID
	Notes          string
}

type SpinoffInput struct {
	AccountID          uuid.UUID
	SourceInstrumentID uuid.UUID
	NewInstrumentID    uuid.UUID
	Numerator          string
	Denominator        string
	ActionDate         time.Time
	IdempotencyKey     uuid.UUID
	Notes              string
}

type MergerInput struct {
	AccountID               uuid.UUID
	SourceInstrumentID      uuid.UUID
	DestinationInstrumentID uuid.UUID
	Numerator               string
	Denominator             string
	ActionDate              time.Time
	IdempotencyKey          uuid.UUID
	Notes                   string
}

type DividendReinvestmentInput struct {
	AccountID           uuid.UUID
	InstrumentID        uuid.UUID
	DividendAmount      string
	Quantity            string
	UnitPrice           string
	TradeCurrency       string
	FeeAmount           string
	FeeCurrency         string
	CashEffect          string
	AppliedExchangeRate string
	ActivityDate        time.Time
	IdempotencyKey      uuid.UUID
	Notes               string
}

type InKindTransferInput struct {
	SourceAccountID      uuid.UUID
	DestinationAccountID uuid.UUID
	InstrumentID         uuid.UUID
	Quantity             string
	TransferDate         time.Time
	FeeAmount            string
	IdempotencyKey       uuid.UUID
	Notes                string
}

type corporateAccount struct {
	id       uuid.UUID
	name     string
	currency string
}

type corporateInstrument struct {
	id            uuid.UUID
	name          string
	quoteCurrency string
}

type specialPositionEventInput struct {
	userID                 uuid.UUID
	accountID              uuid.UUID
	instrumentID           uuid.UUID
	relatedInstrumentID    *uuid.UUID
	eventType              string
	quantity               string
	tradeCurrency          string
	tradeDate              time.Time
	eventGroupID           uuid.UUID
	idempotencyKey         uuid.UUID
	actionRatioNumerator   string
	actionRatioDenominator string
	description            string
	notes                  string
	unitPrice              string
	grossAmountMinor       *int64
	feeAmountMinor         *int64
	feeCurrency            string
	cashEffectMinor        int64
	appliedExchangeRate    string
}

func (service *CorporateActions) RecordStockSplit(ctx context.Context, userID uuid.UUID, input StockSplitInput) (uuid.UUID, error) {
	if err := validateCorporateInput(input.AccountID, input.InstrumentID, input.IdempotencyKey, input.Notes); err != nil {
		return uuid.Nil, err
	}
	numerator, denominator, err := canonicalCorporateRatio(input.Numerator, input.Denominator)
	if err != nil {
		return uuid.Nil, err
	}
	if err := service.validateDate(ctx, userID, input.ActionDate); err != nil {
		return uuid.Nil, err
	}
	return service.record(ctx, userID, input.IdempotencyKey, func(tx *sql.Tx) (uuid.UUID, error) {
		if groupID, found, err := corporateIdempotency(ctx, tx, userID, input.IdempotencyKey, "split", input.AccountID, input.InstrumentID, nil); found || err != nil {
			return groupID, err
		}
		account, err := requireCorporateAccount(ctx, tx, userID, input.AccountID)
		if err != nil {
			return uuid.Nil, err
		}
		instrument, err := requireCorporateInstrument(ctx, tx, userID, input.InstrumentID)
		if err != nil {
			return uuid.Nil, err
		}
		quantity, err := corporateQuantityAt(ctx, tx, userID, account.id, instrument.id, input.ActionDate)
		if err != nil {
			return uuid.Nil, err
		}
		if quantity.Sign() <= 0 {
			return uuid.Nil, investmentValidationError("the account has no position to split on that date")
		}
		groupID := uuid.New()
		if _, err := service.insertSpecialPositionEvent(ctx, tx, specialPositionEventInput{
			userID: userID, accountID: account.id, instrumentID: instrument.id, eventType: "split",
			quantity: "0", tradeCurrency: instrument.quoteCurrency, tradeDate: input.ActionDate,
			eventGroupID: groupID, idempotencyKey: input.IdempotencyKey,
			actionRatioNumerator: numerator, actionRatioDenominator: denominator,
			description: numerator + ":" + denominator + " stock split", notes: input.Notes,
		}); err != nil {
			return uuid.Nil, err
		}
		if err := service.validateAndRecalculate(ctx, tx, userID, account.id); err != nil {
			return uuid.Nil, err
		}
		return groupID, nil
	})
}

func (service *CorporateActions) RecordSpinoff(ctx context.Context, userID uuid.UUID, input SpinoffInput) (uuid.UUID, error) {
	if input.SourceInstrumentID == input.NewInstrumentID {
		return uuid.Nil, investmentValidationError("choose a different spin-off instrument")
	}
	if err := validateCorporateInput(input.AccountID, input.SourceInstrumentID, input.IdempotencyKey, input.Notes); err != nil || input.NewInstrumentID == uuid.Nil {
		if err != nil {
			return uuid.Nil, err
		}
		return uuid.Nil, investmentValidationError("corporate action identifiers are required")
	}
	numerator, denominator, err := canonicalCorporateRatio(input.Numerator, input.Denominator)
	if err != nil {
		return uuid.Nil, err
	}
	if err := service.validateDate(ctx, userID, input.ActionDate); err != nil {
		return uuid.Nil, err
	}
	return service.record(ctx, userID, input.IdempotencyKey, func(tx *sql.Tx) (uuid.UUID, error) {
		if groupID, found, err := corporateIdempotency(ctx, tx, userID, input.IdempotencyKey, "spinoff", input.AccountID, input.NewInstrumentID, &input.SourceInstrumentID); found || err != nil {
			return groupID, err
		}
		account, err := requireCorporateAccount(ctx, tx, userID, input.AccountID)
		if err != nil {
			return uuid.Nil, err
		}
		source, err := requireCorporateInstrument(ctx, tx, userID, input.SourceInstrumentID)
		if err != nil {
			return uuid.Nil, err
		}
		destination, err := requireCorporateInstrument(ctx, tx, userID, input.NewInstrumentID)
		if err != nil {
			return uuid.Nil, err
		}
		sourceQuantity, err := corporateQuantityAt(ctx, tx, userID, account.id, source.id, input.ActionDate)
		if err != nil {
			return uuid.Nil, err
		}
		if sourceQuantity.Sign() <= 0 {
			return uuid.Nil, investmentValidationError("the source position is unavailable on that date")
		}
		quantity, err := applyCorporateRatio(sourceQuantity, numerator, denominator)
		if err != nil {
			return uuid.Nil, err
		}
		groupID := uuid.New()
		if _, err := service.insertSpecialPositionEvent(ctx, tx, specialPositionEventInput{
			userID: userID, accountID: account.id, instrumentID: destination.id,
			relatedInstrumentID: &source.id, eventType: "spinoff", quantity: quantity,
			tradeCurrency: destination.quoteCurrency, tradeDate: input.ActionDate,
			eventGroupID: groupID, idempotencyKey: input.IdempotencyKey,
			actionRatioNumerator: numerator, actionRatioDenominator: denominator,
			description: "Spin-off from " + source.name, notes: input.Notes,
		}); err != nil {
			return uuid.Nil, err
		}
		if err := service.validateAndRecalculate(ctx, tx, userID, account.id); err != nil {
			return uuid.Nil, err
		}
		return groupID, nil
	})
}

func (service *CorporateActions) RecordMerger(ctx context.Context, userID uuid.UUID, input MergerInput) (uuid.UUID, error) {
	if input.SourceInstrumentID == input.DestinationInstrumentID {
		return uuid.Nil, investmentValidationError("choose a different merger instrument")
	}
	if err := validateCorporateInput(input.AccountID, input.SourceInstrumentID, input.IdempotencyKey, input.Notes); err != nil || input.DestinationInstrumentID == uuid.Nil {
		if err != nil {
			return uuid.Nil, err
		}
		return uuid.Nil, investmentValidationError("corporate action identifiers are required")
	}
	numerator, denominator, err := canonicalCorporateRatio(input.Numerator, input.Denominator)
	if err != nil {
		return uuid.Nil, err
	}
	if err := service.validateDate(ctx, userID, input.ActionDate); err != nil {
		return uuid.Nil, err
	}
	return service.record(ctx, userID, input.IdempotencyKey, func(tx *sql.Tx) (uuid.UUID, error) {
		if groupID, found, err := corporateIdempotency(ctx, tx, userID, input.IdempotencyKey, "merger_out", input.AccountID, input.SourceInstrumentID, &input.DestinationInstrumentID); found || err != nil {
			return groupID, err
		}
		account, err := requireCorporateAccount(ctx, tx, userID, input.AccountID)
		if err != nil {
			return uuid.Nil, err
		}
		source, err := requireCorporateInstrument(ctx, tx, userID, input.SourceInstrumentID)
		if err != nil {
			return uuid.Nil, err
		}
		destination, err := requireCorporateInstrument(ctx, tx, userID, input.DestinationInstrumentID)
		if err != nil {
			return uuid.Nil, err
		}
		sourceQuantity, err := corporateQuantityAt(ctx, tx, userID, account.id, source.id, input.ActionDate)
		if err != nil {
			return uuid.Nil, err
		}
		if sourceQuantity.Sign() <= 0 {
			return uuid.Nil, investmentValidationError("the source position is unavailable on that date")
		}
		destinationQuantity, err := applyCorporateRatio(sourceQuantity, numerator, denominator)
		if err != nil {
			return uuid.Nil, err
		}
		groupID := uuid.New()
		if _, err := service.insertSpecialPositionEvent(ctx, tx, specialPositionEventInput{
			userID: userID, accountID: account.id, instrumentID: source.id,
			relatedInstrumentID: &destination.id, eventType: "merger_out", quantity: canonicalRat(sourceQuantity),
			tradeCurrency: source.quoteCurrency, tradeDate: input.ActionDate,
			eventGroupID: groupID, idempotencyKey: input.IdempotencyKey,
			actionRatioNumerator: numerator, actionRatioDenominator: denominator,
			description: "Surrendered in merger with " + destination.name, notes: input.Notes,
		}); err != nil {
			return uuid.Nil, err
		}
		if _, err := service.insertSpecialPositionEvent(ctx, tx, specialPositionEventInput{
			userID: userID, accountID: account.id, instrumentID: destination.id,
			relatedInstrumentID: &source.id, eventType: "merger_in", quantity: destinationQuantity,
			tradeCurrency: destination.quoteCurrency, tradeDate: input.ActionDate,
			eventGroupID: groupID, actionRatioNumerator: numerator, actionRatioDenominator: denominator,
			description: "Received in merger from " + source.name, notes: input.Notes,
		}); err != nil {
			return uuid.Nil, err
		}
		if err := service.validateAndRecalculate(ctx, tx, userID, account.id); err != nil {
			return uuid.Nil, err
		}
		return groupID, nil
	})
}

func (service *CorporateActions) RecordDividendReinvestment(ctx context.Context, userID uuid.UUID, input DividendReinvestmentInput) (uuid.UUID, error) {
	if err := validateCorporateInput(input.AccountID, input.InstrumentID, input.IdempotencyKey, input.Notes); err != nil {
		return uuid.Nil, err
	}
	if err := service.validateDate(ctx, userID, input.ActivityDate); err != nil {
		return uuid.Nil, err
	}
	quantity, err := canonicalDecimal(input.Quantity, false, false, "quantity")
	if err != nil {
		return uuid.Nil, err
	}
	unitPrice, err := canonicalDecimal(input.UnitPrice, false, false, "unit price")
	if err != nil {
		return uuid.Nil, err
	}
	return service.record(ctx, userID, input.IdempotencyKey, func(tx *sql.Tx) (uuid.UUID, error) {
		if groupID, found, err := corporateIdempotency(ctx, tx, userID, input.IdempotencyKey, "buy", input.AccountID, input.InstrumentID, nil); found || err != nil {
			return groupID, err
		}
		account, err := requireCorporateAccount(ctx, tx, userID, input.AccountID)
		if err != nil {
			return uuid.Nil, err
		}
		instrument, err := requireCorporateInstrument(ctx, tx, userID, input.InstrumentID)
		if err != nil {
			return uuid.Nil, err
		}
		dividendMinor, err := parseInvestmentMoneyMinor(input.DividendAmount, account.currency)
		if err != nil {
			return uuid.Nil, err
		}
		if dividendMinor <= 0 {
			return uuid.Nil, investmentValidationError("dividend amount must be greater than zero")
		}
		tradeCurrency := domain.NormalizeCurrency(input.TradeCurrency)
		if tradeCurrency == "" {
			tradeCurrency = instrument.quoteCurrency
		}
		if err := requireEnabledCurrency(ctx, tx, userID, tradeCurrency); err != nil {
			return uuid.Nil, err
		}
		grossMinorValue, err := decimalProductMinor(quantity, unitPrice, tradeCurrency)
		if err != nil {
			return uuid.Nil, err
		}
		grossMinor := &grossMinorValue
		var feeMinor *int64
		feeCurrency := ""
		if strings.TrimSpace(input.FeeAmount) != "" {
			feeCurrency = domain.NormalizeCurrency(input.FeeCurrency)
			if feeCurrency == "" {
				feeCurrency = tradeCurrency
			}
			if err := requireEnabledCurrency(ctx, tx, userID, feeCurrency); err != nil {
				return uuid.Nil, err
			}
			value, err := parseInvestmentMoneyMinor(input.FeeAmount, feeCurrency)
			if err != nil {
				return uuid.Nil, err
			}
			if value < 0 {
				return uuid.Nil, investmentValidationError("fee cannot be negative")
			}
			feeMinor = &value
		}
		appliedRate := ""
		if strings.TrimSpace(input.AppliedExchangeRate) != "" {
			appliedRate, err = canonicalDecimal(input.AppliedExchangeRate, false, false, "applied exchange rate")
			if err != nil {
				return uuid.Nil, err
			}
			if tradeCurrency == account.currency {
				return uuid.Nil, investmentValidationError("an applied settlement rate is only valid for cross-currency trades")
			}
		}
		if tradeCurrency != account.currency && strings.TrimSpace(input.CashEffect) == "" && appliedRate == "" {
			return uuid.Nil, investmentValidationError("cross-currency trades require an actual cash effect or applied settlement rate")
		}
		cashEffect, err := service.investments.positionCashEffect(ctx, tx, userID, PositionEventMutationInput{
			Type: "buy", CashEffect: input.CashEffect, TradeDate: input.ActivityDate,
		}, account.currency, tradeCurrency, feeCurrency, appliedRate, grossMinor, feeMinor)
		if err != nil {
			return uuid.Nil, err
		}
		groupID := uuid.New()
		now := service.now().UTC()
		if _, err := tx.ExecContext(ctx, `
INSERT INTO transactions (
    id, user_id, account_id, type, amount_minor, currency, transaction_date,
    description, notes, event_group_id, created_at, updated_at
) VALUES ($1, $2, $3, 'dividend', $4, $5, $6, 'Dividend reinvestment income', $7, $8, $9, $9)`,
			uuid.New(), userID, account.id, dividendMinor, account.currency,
			investmentDateOnly(input.ActivityDate), optionalString(input.Notes), groupID, now); err != nil {
			return uuid.Nil, mutationDatabaseError(err, "record dividend reinvestment income")
		}
		if _, err := service.insertSpecialPositionEvent(ctx, tx, specialPositionEventInput{
			userID: userID, accountID: account.id, instrumentID: instrument.id, eventType: "buy",
			quantity: quantity, unitPrice: unitPrice, tradeCurrency: tradeCurrency,
			tradeDate: input.ActivityDate, eventGroupID: groupID, idempotencyKey: input.IdempotencyKey,
			grossAmountMinor: grossMinor, feeAmountMinor: feeMinor, feeCurrency: feeCurrency,
			cashEffectMinor: cashEffect, appliedExchangeRate: appliedRate,
			description: "Dividend reinvestment purchase", notes: input.Notes,
		}); err != nil {
			return uuid.Nil, err
		}
		if err := service.validateAndRecalculate(ctx, tx, userID, account.id); err != nil {
			return uuid.Nil, err
		}
		return groupID, nil
	})
}

func (service *CorporateActions) RecordInKindTransfer(ctx context.Context, userID uuid.UUID, input InKindTransferInput) (uuid.UUID, error) {
	if input.SourceAccountID == input.DestinationAccountID {
		return uuid.Nil, investmentValidationError("choose two different position accounts")
	}
	if err := validateCorporateInput(input.SourceAccountID, input.InstrumentID, input.IdempotencyKey, input.Notes); err != nil || input.DestinationAccountID == uuid.Nil {
		if err != nil {
			return uuid.Nil, err
		}
		return uuid.Nil, investmentValidationError("corporate action identifiers are required")
	}
	if err := service.validateDate(ctx, userID, input.TransferDate); err != nil {
		return uuid.Nil, err
	}
	quantity, err := canonicalDecimal(input.Quantity, false, false, "quantity")
	if err != nil {
		return uuid.Nil, err
	}
	return service.record(ctx, userID, input.IdempotencyKey, func(tx *sql.Tx) (uuid.UUID, error) {
		if groupID, found, err := corporateIdempotency(ctx, tx, userID, input.IdempotencyKey, "transfer_out", input.SourceAccountID, input.InstrumentID, nil); found || err != nil {
			return groupID, err
		}
		accounts, err := requireCorporateAccounts(ctx, tx, userID, input.SourceAccountID, input.DestinationAccountID)
		if err != nil {
			return uuid.Nil, err
		}
		source := accounts[input.SourceAccountID]
		destination := accounts[input.DestinationAccountID]
		instrument, err := requireCorporateInstrument(ctx, tx, userID, input.InstrumentID)
		if err != nil {
			return uuid.Nil, err
		}
		groupID := uuid.New()
		if _, err := service.insertSpecialPositionEvent(ctx, tx, specialPositionEventInput{
			userID: userID, accountID: source.id, instrumentID: instrument.id, eventType: "transfer_out",
			quantity: quantity, tradeCurrency: instrument.quoteCurrency, tradeDate: input.TransferDate,
			eventGroupID: groupID, idempotencyKey: input.IdempotencyKey,
			description: "In-kind transfer to " + destination.name, notes: input.Notes,
		}); err != nil {
			return uuid.Nil, err
		}
		if _, err := service.insertSpecialPositionEvent(ctx, tx, specialPositionEventInput{
			userID: userID, accountID: destination.id, instrumentID: instrument.id, eventType: "transfer_in",
			quantity: quantity, tradeCurrency: instrument.quoteCurrency, tradeDate: input.TransferDate,
			eventGroupID: groupID, description: "In-kind transfer from " + source.name, notes: input.Notes,
		}); err != nil {
			return uuid.Nil, err
		}
		if strings.TrimSpace(input.FeeAmount) != "" {
			feeMinor, err := parseInvestmentMoneyMinor(input.FeeAmount, source.currency)
			if err != nil {
				return uuid.Nil, err
			}
			if feeMinor <= 0 {
				return uuid.Nil, investmentValidationError("fee must be greater than zero")
			}
			now := service.now().UTC()
			if _, err := tx.ExecContext(ctx, `
INSERT INTO transactions (
    id, user_id, account_id, type, amount_minor, currency, transaction_date,
    description, notes, event_group_id, created_at, updated_at
) VALUES ($1, $2, $3, 'fee', $4, $5, $6, 'In-kind transfer fee', $7, $8, $9, $9)`,
				uuid.New(), userID, source.id, feeMinor, source.currency,
				investmentDateOnly(input.TransferDate), optionalString(input.Notes), groupID, now); err != nil {
				return uuid.Nil, mutationDatabaseError(err, "record in-kind transfer fee")
			}
		}
		if err := service.validateAndRecalculate(ctx, tx, userID, source.id); err != nil {
			return uuid.Nil, err
		}
		if err := service.validateAndRecalculate(ctx, tx, userID, destination.id); err != nil {
			return uuid.Nil, err
		}
		return groupID, nil
	})
}

func (service *CorporateActions) DeleteGroup(ctx context.Context, userID, eventID uuid.UUID) error {
	if eventID == uuid.Nil {
		return ErrInvestmentMutationNotFound
	}
	return service.investments.withTx(ctx, func(tx *sql.Tx) error {
		var groupID uuid.NullUUID
		if err := tx.QueryRowContext(ctx, `
SELECT event_group_id FROM position_events
WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, eventID).Scan(&groupID); err != nil {
			return mutationNotFound(err)
		}
		if !groupID.Valid {
			return investmentConflictError("use ordinary position event deletion for ungrouped activity")
		}
		rows, err := tx.QueryContext(ctx, `
SELECT account_id FROM position_events
WHERE user_id = $1 AND event_group_id = $2
ORDER BY account_id FOR UPDATE`, userID, groupID.UUID)
		if err != nil {
			return fmt.Errorf("lock corporate action accounts: %w", err)
		}
		var accountIDs []uuid.UUID
		seenAccounts := make(map[uuid.UUID]bool)
		for rows.Next() {
			var accountID uuid.UUID
			if err := rows.Scan(&accountID); err != nil {
				rows.Close()
				return fmt.Errorf("scan corporate action account: %w", err)
			}
			if !seenAccounts[accountID] {
				seenAccounts[accountID] = true
				accountIDs = append(accountIDs, accountID)
			}
		}
		if err := rows.Close(); err != nil {
			return fmt.Errorf("close corporate action accounts: %w", err)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate corporate action accounts: %w", err)
		}
		for _, accountID := range accountIDs {
			if _, err := requireCorporateAccount(ctx, tx, userID, accountID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM transactions WHERE user_id = $1 AND event_group_id = $2`, userID, groupID.UUID); err != nil {
			return mutationDatabaseError(err, "delete corporate action cash transactions")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM position_events WHERE user_id = $1 AND event_group_id = $2`, userID, groupID.UUID); err != nil {
			return mutationDatabaseError(err, "delete corporate action position events")
		}
		for _, accountID := range accountIDs {
			if err := service.validateAndRecalculate(ctx, tx, userID, accountID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (service *CorporateActions) validateDate(ctx context.Context, userID uuid.UUID, value time.Time) error {
	return service.investments.validateDate(ctx, service.db, userID, value)
}

func (service *CorporateActions) record(ctx context.Context, userID, key uuid.UUID, operation func(*sql.Tx) (uuid.UUID, error)) (uuid.UUID, error) {
	var groupID uuid.UUID
	err := service.investments.withTx(ctx, func(tx *sql.Tx) error {
		if err := lockLedgerIdempotency(ctx, tx, userID, key); err != nil {
			return err
		}
		var err error
		groupID, err = operation(tx)
		return err
	})
	return groupID, err
}

func (service *CorporateActions) validateAndRecalculate(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) error {
	if err := validateAccountPositionReplay(ctx, tx, userID, accountID); err != nil {
		return err
	}
	return service.investments.recalculatePositionAccount(ctx, tx, userID, accountID)
}

func (service *CorporateActions) insertSpecialPositionEvent(ctx context.Context, tx *sql.Tx, input specialPositionEventInput) (uuid.UUID, error) {
	var sequence int
	if err := tx.QueryRowContext(ctx, `
SELECT COALESCE(MAX(event_sequence), 0) + 1 FROM position_events
WHERE user_id = $1 AND account_id = $2 AND trade_date = $3`, input.userID, input.accountID, investmentDateOnly(input.tradeDate)).Scan(&sequence); err != nil {
		return uuid.Nil, fmt.Errorf("select corporate action event sequence: %w", err)
	}
	id := uuid.New()
	now := service.now().UTC()
	_, err := tx.ExecContext(ctx, `
INSERT INTO position_events (
    id, user_id, account_id, instrument_id, related_instrument_id, type, quantity,
    unit_price, trade_currency, gross_amount_minor, fee_amount_minor, fee_currency,
    cash_effect_minor, applied_exchange_rate, opening_cost_basis_minor,
    action_ratio_numerator, action_ratio_denominator, trade_date, event_sequence,
    settlement_date, external_id, event_group_id, idempotency_key,
    description, notes, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7::NUMERIC,
    NULLIF($8, '')::NUMERIC, $9, $10, $11, $12,
    $13, NULLIF($14, '')::NUMERIC, NULL,
    NULLIF($15, '')::NUMERIC, NULLIF($16, '')::NUMERIC, $17, $18,
    NULL, NULL, $19, $20, $21, $22, $23, $23
)`, id, input.userID, input.accountID, input.instrumentID, input.relatedInstrumentID,
		input.eventType, input.quantity, input.unitPrice, input.tradeCurrency,
		input.grossAmountMinor, input.feeAmountMinor, optionalString(input.feeCurrency),
		input.cashEffectMinor, input.appliedExchangeRate, input.actionRatioNumerator,
		input.actionRatioDenominator, investmentDateOnly(input.tradeDate), sequence,
		input.eventGroupID, optionalUUID(input.idempotencyKey), input.description,
		optionalString(input.notes), now)
	if err != nil {
		return uuid.Nil, mutationDatabaseError(err, "record corporate action position event")
	}
	return id, nil
}

func validateCorporateInput(accountID, instrumentID, key uuid.UUID, notes string) error {
	if accountID == uuid.Nil || instrumentID == uuid.Nil || key == uuid.Nil {
		return investmentValidationError("corporate action identifiers and idempotency key are required")
	}
	if len(strings.TrimSpace(notes)) > 2000 {
		return investmentValidationError("notes are too long")
	}
	return nil
}

func canonicalCorporateRatio(numeratorInput, denominatorInput string) (string, string, error) {
	numerator, err := canonicalDecimal(numeratorInput, false, false, "ratio numerator")
	if err != nil {
		return "", "", err
	}
	denominator, err := canonicalDecimal(denominatorInput, false, false, "ratio denominator")
	if err != nil {
		return "", "", err
	}
	return numerator, denominator, nil
}

func applyCorporateRatio(quantity *big.Rat, numerator, denominator string) (string, error) {
	numeratorRat, denominatorRat, err := positiveRatio(numerator, denominator)
	if err != nil {
		return "", err
	}
	result := new(big.Rat).Mul(quantity, numeratorRat)
	result.Quo(result, denominatorRat)
	return canonicalRat(result), nil
}

func corporateIdempotency(ctx context.Context, tx *sql.Tx, userID, key uuid.UUID, eventType string, accountID, instrumentID uuid.UUID, relatedInstrumentID *uuid.UUID) (uuid.UUID, bool, error) {
	var groupID uuid.NullUUID
	var existingType string
	var existingAccountID, existingInstrumentID uuid.UUID
	var existingRelatedID uuid.NullUUID
	err := tx.QueryRowContext(ctx, `
SELECT event_group_id, type, account_id, instrument_id, related_instrument_id
FROM position_events WHERE user_id = $1 AND idempotency_key = $2`, userID, key).
		Scan(&groupID, &existingType, &existingAccountID, &existingInstrumentID, &existingRelatedID)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("check corporate action idempotency: %w", err)
	}
	matchesRelated := relatedInstrumentID == nil && !existingRelatedID.Valid ||
		relatedInstrumentID != nil && existingRelatedID.Valid && existingRelatedID.UUID == *relatedInstrumentID
	if !groupID.Valid || existingType != eventType || existingAccountID != accountID || existingInstrumentID != instrumentID || !matchesRelated {
		return uuid.Nil, true, investmentConflictError("idempotency key was already used for another operation")
	}
	return groupID.UUID, true, nil
}

func requireCorporateAccount(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) (corporateAccount, error) {
	var account corporateAccount
	err := tx.QueryRowContext(ctx, `
SELECT id, name, currency FROM accounts
WHERE user_id = $1 AND id = $2 AND tracking_mode = 'positions' AND archived_at IS NULL
FOR UPDATE`, userID, accountID).Scan(&account.id, &account.name, &account.currency)
	if err != nil {
		return corporateAccount{}, mutationNotFound(err)
	}
	return account, nil
}

func requireCorporateAccounts(ctx context.Context, tx *sql.Tx, userID uuid.UUID, accountIDs ...uuid.UUID) (map[uuid.UUID]corporateAccount, error) {
	ordered := append([]uuid.UUID(nil), accountIDs...)
	sort.Slice(ordered, func(left, right int) bool { return ordered[left].String() < ordered[right].String() })
	result := make(map[uuid.UUID]corporateAccount, len(ordered))
	for _, accountID := range ordered {
		account, err := requireCorporateAccount(ctx, tx, userID, accountID)
		if err != nil {
			return nil, err
		}
		result[accountID] = account
	}
	return result, nil
}

func requireCorporateInstrument(ctx context.Context, tx *sql.Tx, userID, instrumentID uuid.UUID) (corporateInstrument, error) {
	var instrument corporateInstrument
	err := tx.QueryRowContext(ctx, `
SELECT id, name, quote_currency FROM investment_instruments
WHERE user_id = $1 AND id = $2 AND archived_at IS NULL
FOR UPDATE`, userID, instrumentID).Scan(&instrument.id, &instrument.name, &instrument.quoteCurrency)
	if err != nil {
		return corporateInstrument{}, mutationNotFound(err)
	}
	return instrument, nil
}

func corporateQuantityAt(ctx context.Context, tx *sql.Tx, userID, accountID, instrumentID uuid.UUID, throughDate time.Time) (*big.Rat, error) {
	events, err := loadPositionEvents(ctx, tx, userID, &accountID)
	if err != nil {
		return nil, err
	}
	through := investmentDateOnly(throughDate)
	filtered := make([]positionEventRow, 0, len(events))
	for _, event := range events {
		if investmentDateOnly(event.tradeDate) <= through {
			filtered = append(filtered, event)
		}
	}
	quantities, err := replayPositionEvents(filtered, false)
	if err != nil {
		return nil, err
	}
	return cloneRat(quantities[positionKey{accountID: accountID, instrumentID: instrumentID}]), nil
}
