package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/domain"
)

var (
	ErrInvestmentMutationNotFound   = errors.New("investment resource not found")
	ErrInvestmentMutationConflict   = errors.New("investment mutation conflict")
	ErrInvestmentMutationValidation = errors.New("investment mutation validation failed")
)

var investmentDecimalPattern = regexp.MustCompile(`^-?\d+(?:\.\d+)?$`)

var ordinaryPositionEventTypes = map[string]bool{
	"opening_position":    true,
	"buy":                 true,
	"sell":                true,
	"quantity_adjustment": true,
}

type InvestmentMutations struct {
	db  *sql.DB
	now func() time.Time
}

func NewInvestmentMutations(db *sql.DB) *InvestmentMutations {
	return &InvestmentMutations{db: db, now: time.Now}
}

type InstrumentMutationInput struct {
	ExternalID     string `json:"externalId"`
	Name           string `json:"name"`
	Symbol         string `json:"symbol"`
	IdentifierType string `json:"identifierType"`
	Identifier     string `json:"identifier"`
	ExchangeMIC    string `json:"exchangeMic"`
	AssetType      string `json:"assetType"`
	QuoteCurrency  string `json:"quoteCurrency"`
}

type PositionEventMutationInput struct {
	AccountID           uuid.UUID  `json:"accountId"`
	InstrumentID        uuid.UUID  `json:"instrumentId"`
	Type                string     `json:"type"`
	Quantity            string     `json:"quantity"`
	UnitPrice           string     `json:"unitPrice"`
	TradeCurrency       string     `json:"tradeCurrency"`
	FeeAmount           string     `json:"feeAmount"`
	FeeCurrency         string     `json:"feeCurrency"`
	CashEffect          string     `json:"cashEffect"`
	AppliedExchangeRate string     `json:"appliedExchangeRate"`
	OpeningCostBasis    string     `json:"openingCostBasis"`
	TradeDate           time.Time  `json:"tradeDate"`
	SettlementDate      *time.Time `json:"settlementDate"`
	ExternalID          string     `json:"externalId"`
	IdempotencyKey      uuid.UUID  `json:"idempotencyKey"`
	Description         string     `json:"description"`
	Notes               string     `json:"notes"`
}

type SecurityPriceMutationInput struct {
	InstrumentID  uuid.UUID `json:"instrumentId"`
	ExternalID    string    `json:"externalId"`
	Price         string    `json:"price"`
	EffectiveDate time.Time `json:"effectiveDate"`
	Source        string    `json:"source"`
	Provenance    string    `json:"provenance"`
}

type PositionReconciliationMutationInput struct {
	AccountID       uuid.UUID `json:"accountId"`
	ObservationDate time.Time `json:"observationDate"`
	ReportedCash    string    `json:"reportedCash"`
	ReportedTotal   string    `json:"reportedTotal"`
	Notes           string    `json:"notes"`
}

func (service *InvestmentMutations) CreateInstrument(ctx context.Context, userID uuid.UUID, input InstrumentMutationInput) (uuid.UUID, error) {
	validated, err := service.validateInstrument(ctx, service.db, userID, input)
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.New()
	externalID := optionalString(validated.ExternalID)
	if externalID == nil {
		value := "manual:" + id.String()
		externalID = &value
	}
	now := service.now().UTC()
	_, err = service.db.ExecContext(ctx, `
INSERT INTO investment_instruments (
    id, user_id, external_id, name, symbol, identifier_type, identifier,
    exchange_mic, asset_type, quote_currency, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
		id, userID, externalID, validated.Name, optionalString(validated.Symbol),
		validated.IdentifierType, optionalString(validated.Identifier), optionalString(validated.ExchangeMIC),
		validated.AssetType, validated.QuoteCurrency, now)
	if err != nil {
		return uuid.Nil, mutationDatabaseError(err, "create instrument")
	}
	return id, nil
}

func (service *InvestmentMutations) UpdateInstrument(ctx context.Context, userID, instrumentID uuid.UUID, input InstrumentMutationInput) error {
	return service.withTx(ctx, func(tx *sql.Tx) error {
		var existingExternalID sql.NullString
		var existingCurrency string
		if err := tx.QueryRowContext(ctx, `
SELECT external_id, quote_currency
FROM investment_instruments
WHERE user_id = $1 AND id = $2
FOR UPDATE`, userID, instrumentID).Scan(&existingExternalID, &existingCurrency); err != nil {
			return mutationNotFound(err)
		}
		validated, err := service.validateInstrument(ctx, tx, userID, input)
		if err != nil {
			return err
		}
		if validated.QuoteCurrency != existingCurrency {
			var hasHistory bool
			if err := tx.QueryRowContext(ctx, `
SELECT EXISTS (
    SELECT 1 FROM position_events WHERE user_id = $1 AND instrument_id = $2
    UNION ALL
    SELECT 1 FROM security_prices WHERE user_id = $1 AND instrument_id = $2
)`, userID, instrumentID).Scan(&hasHistory); err != nil {
				return fmt.Errorf("check instrument history: %w", err)
			}
			if hasHistory {
				return investmentValidationError("instrument quote currency cannot change after activity exists")
			}
		}
		externalID := optionalString(validated.ExternalID)
		if externalID == nil && existingExternalID.Valid {
			externalID = &existingExternalID.String
		}
		_, err = tx.ExecContext(ctx, `
UPDATE investment_instruments
SET external_id = $3, name = $4, symbol = $5, identifier_type = $6,
    identifier = $7, exchange_mic = $8, asset_type = $9, quote_currency = $10,
    updated_at = $11
WHERE user_id = $1 AND id = $2`, userID, instrumentID, externalID, validated.Name,
			optionalString(validated.Symbol), validated.IdentifierType, optionalString(validated.Identifier),
			optionalString(validated.ExchangeMIC), validated.AssetType, validated.QuoteCurrency, service.now().UTC())
		return mutationDatabaseError(err, "update instrument")
	})
}

func (service *InvestmentMutations) SetInstrumentArchived(ctx context.Context, userID, instrumentID uuid.UUID, archived bool) error {
	return service.withTx(ctx, func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRowContext(ctx, `
SELECT TRUE FROM investment_instruments WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, instrumentID).Scan(&exists); err != nil {
			return mutationNotFound(err)
		}
		if archived {
			rows, err := loadPositionEvents(ctx, tx, userID, nil)
			if err != nil {
				return err
			}
			targetRows := make([]positionEventRow, 0, len(rows))
			for _, row := range rows {
				if row.instrumentID == instrumentID {
					targetRows = append(targetRows, row)
				}
			}
			quantities, err := replayPositionEvents(targetRows, false)
			if err != nil {
				return err
			}
			for key, quantity := range quantities {
				if key.instrumentID == instrumentID && quantity.Sign() != 0 {
					return investmentValidationError("close every holding before archiving this instrument")
				}
			}
		}
		var archivedAt any
		if archived {
			archivedAt = service.now().UTC()
		}
		_, err := tx.ExecContext(ctx, `
UPDATE investment_instruments SET archived_at = $3, updated_at = $4
WHERE user_id = $1 AND id = $2`, userID, instrumentID, archivedAt, service.now().UTC())
		return mutationDatabaseError(err, "archive instrument")
	})
}

func (service *InvestmentMutations) DeleteInstrument(ctx context.Context, userID, instrumentID uuid.UUID) error {
	return service.withTx(ctx, func(tx *sql.Tx) error {
		var referenced bool
		err := tx.QueryRowContext(ctx, `
SELECT EXISTS (
    SELECT 1 FROM position_events
    WHERE user_id = $1 AND (instrument_id = $2 OR related_instrument_id = $2)
)
FROM investment_instruments
WHERE user_id = $1 AND id = $2
FOR UPDATE`, userID, instrumentID).Scan(&referenced)
		if err != nil {
			return mutationNotFound(err)
		}
		if referenced {
			return investmentConflictError("instrument is linked to position history")
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM investment_instruments WHERE user_id = $1 AND id = $2`, userID, instrumentID)
		if err != nil {
			return mutationDatabaseError(err, "delete instrument")
		}
		return requireInvestmentAffected(result)
	})
}

func (service *InvestmentMutations) UpsertSecurityPrice(ctx context.Context, userID uuid.UUID, input SecurityPriceMutationInput) (uuid.UUID, error) {
	price, err := canonicalDecimal(input.Price, false, false, "unit price")
	if err != nil {
		return uuid.Nil, err
	}
	if err := service.validateDate(ctx, service.db, userID, input.EffectiveDate); err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = service.withTx(ctx, func(tx *sql.Tx) error {
		var currency string
		if err := tx.QueryRowContext(ctx, `
SELECT quote_currency FROM investment_instruments
WHERE user_id = $1 AND id = $2 AND archived_at IS NULL
FOR UPDATE`, userID, input.InstrumentID).Scan(&currency); err != nil {
			return mutationNotFound(err)
		}
		id = uuid.New()
		source := strings.TrimSpace(input.Source)
		if source == "" {
			source = "manual"
		}
		if len(source) > 100 || len(strings.TrimSpace(input.Provenance)) > 500 || len(strings.TrimSpace(input.ExternalID)) > 200 {
			return investmentValidationError("security price metadata is too long")
		}
		now := service.now().UTC()
		if err := mutationDatabaseError(tx.QueryRowContext(ctx, `
INSERT INTO security_prices (
    id, user_id, instrument_id, external_id, price, currency, effective_date,
    source, provenance, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5::NUMERIC, $6, $7, $8, $9, $10, $10)
ON CONFLICT (user_id, instrument_id, effective_date) DO UPDATE
SET external_id = COALESCE(EXCLUDED.external_id, security_prices.external_id),
    price = EXCLUDED.price, source = EXCLUDED.source, provenance = EXCLUDED.provenance,
    updated_at = EXCLUDED.updated_at
RETURNING id`, id, userID, input.InstrumentID, optionalString(input.ExternalID), price, currency,
			investmentDateOnly(input.EffectiveDate), source, optionalString(input.Provenance), now).Scan(&id), "upsert security price"); err != nil {
			return err
		}
		return service.recalculateInstrumentAccounts(ctx, tx, userID, input.InstrumentID)
	})
	return id, err
}

func (service *InvestmentMutations) DeleteSecurityPrice(ctx context.Context, userID, priceID uuid.UUID) error {
	return service.withTx(ctx, func(tx *sql.Tx) error {
		var instrumentID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
SELECT instrument_id FROM security_prices WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, priceID).Scan(&instrumentID); err != nil {
			return mutationNotFound(err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM security_prices WHERE user_id = $1 AND id = $2`, userID, priceID); err != nil {
			return mutationDatabaseError(err, "delete security price")
		}
		return service.recalculateInstrumentAccounts(ctx, tx, userID, instrumentID)
	})
}

func (service *InvestmentMutations) CreatePositionEvent(ctx context.Context, userID uuid.UUID, input PositionEventMutationInput) (uuid.UUID, error) {
	return service.savePositionEvent(ctx, userID, uuid.Nil, input)
}

func (service *InvestmentMutations) UpdatePositionEvent(ctx context.Context, userID, eventID uuid.UUID, input PositionEventMutationInput) (uuid.UUID, error) {
	return service.savePositionEvent(ctx, userID, eventID, input)
}

func (service *InvestmentMutations) savePositionEvent(ctx context.Context, userID, eventID uuid.UUID, input PositionEventMutationInput) (uuid.UUID, error) {
	if !ordinaryPositionEventTypes[input.Type] {
		return uuid.Nil, investmentValidationError("use the dedicated workflow for this position activity")
	}
	if eventID == uuid.Nil && input.IdempotencyKey == uuid.Nil {
		return uuid.Nil, investmentValidationError("idempotency key is required")
	}
	if len(strings.TrimSpace(input.ExternalID)) > 200 || len(strings.TrimSpace(input.Description)) > 200 || len(strings.TrimSpace(input.Notes)) > 2000 {
		return uuid.Nil, investmentValidationError("position event metadata is too long")
	}
	if err := service.validateDate(ctx, service.db, userID, input.TradeDate); err != nil {
		return uuid.Nil, err
	}
	if input.SettlementDate != nil {
		if err := service.validateDate(ctx, service.db, userID, *input.SettlementDate); err != nil {
			return uuid.Nil, err
		}
	}
	quantity, err := canonicalDecimal(input.Quantity, input.Type == "quantity_adjustment", false, "quantity")
	if err != nil {
		return uuid.Nil, err
	}
	var resultID uuid.UUID
	err = service.withTx(ctx, func(tx *sql.Tx) error {
		var accountCurrency, instrumentCurrency string
		if err := tx.QueryRowContext(ctx, `
SELECT currency FROM accounts
WHERE user_id = $1 AND id = $2 AND tracking_mode = 'positions' AND archived_at IS NULL
FOR UPDATE`, userID, input.AccountID).Scan(&accountCurrency); err != nil {
			return mutationNotFound(err)
		}
		if err := tx.QueryRowContext(ctx, `
SELECT quote_currency FROM investment_instruments
WHERE user_id = $1 AND id = $2 AND archived_at IS NULL
FOR UPDATE`, userID, input.InstrumentID).Scan(&instrumentCurrency); err != nil {
			return mutationNotFound(err)
		}

		var existingAccountID uuid.UUID
		var existingType string
		var existingGroupID sql.NullString
		var existingSequence int
		var existingTradeDate time.Time
		if eventID != uuid.Nil {
			err := tx.QueryRowContext(ctx, `
SELECT account_id, type, event_group_id::TEXT, event_sequence, trade_date
FROM position_events WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, eventID).
				Scan(&existingAccountID, &existingType, &existingGroupID, &existingSequence, &existingTradeDate)
			if err != nil {
				return mutationNotFound(err)
			}
			if existingAccountID != input.AccountID {
				return investmentValidationError("a position event cannot move between accounts")
			}
			if !ordinaryPositionEventTypes[existingType] || existingGroupID.Valid {
				return investmentConflictError("use the dedicated workflow for grouped activity")
			}
		} else if input.IdempotencyKey != uuid.Nil {
			var duplicateID uuid.UUID
			err := tx.QueryRowContext(ctx, `
SELECT id FROM position_events WHERE user_id = $1 AND idempotency_key = $2`, userID, input.IdempotencyKey).Scan(&duplicateID)
			if err == nil {
				resultID = duplicateID
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("check position event idempotency: %w", err)
			}
		}

		tradeCurrency := domain.NormalizeCurrency(input.TradeCurrency)
		if tradeCurrency == "" {
			tradeCurrency = instrumentCurrency
		}
		if err := requireEnabledCurrency(ctx, tx, userID, tradeCurrency); err != nil {
			return err
		}
		unitPrice := ""
		if strings.TrimSpace(input.UnitPrice) != "" {
			unitPrice, err = canonicalDecimal(input.UnitPrice, false, false, "unit price")
			if err != nil {
				return err
			}
		}
		if (input.Type == "buy" || input.Type == "sell") && unitPrice == "" {
			return investmentValidationError("enter the execution price")
		}
		if input.Type != "buy" && input.Type != "sell" && (strings.TrimSpace(input.FeeAmount) != "" || strings.TrimSpace(input.CashEffect) != "") {
			return investmentValidationError("fees and settlement amounts apply only to buys and sells")
		}

		var grossMinor, feeMinor *int64
		var feeCurrency string
		if unitPrice != "" {
			value, calcErr := decimalProductMinor(quantity, unitPrice, tradeCurrency)
			if calcErr != nil {
				return calcErr
			}
			grossMinor = &value
		}
		if strings.TrimSpace(input.FeeAmount) != "" {
			feeCurrency = domain.NormalizeCurrency(input.FeeCurrency)
			if feeCurrency == "" {
				feeCurrency = tradeCurrency
			}
			if err := requireEnabledCurrency(ctx, tx, userID, feeCurrency); err != nil {
				return err
			}
			value, parseErr := parseInvestmentMoneyMinor(input.FeeAmount, feeCurrency)
			if parseErr != nil {
				return parseErr
			}
			if value < 0 {
				return investmentValidationError("fee cannot be negative")
			}
			feeMinor = &value
		}
		appliedRate := ""
		if strings.TrimSpace(input.AppliedExchangeRate) != "" {
			appliedRate, err = canonicalDecimal(input.AppliedExchangeRate, false, false, "applied exchange rate")
			if err != nil {
				return err
			}
			if input.Type != "buy" && input.Type != "sell" || tradeCurrency == accountCurrency {
				return investmentValidationError("an applied settlement rate is only valid for cross-currency trades")
			}
		}
		if (input.Type == "buy" || input.Type == "sell") && tradeCurrency != accountCurrency && strings.TrimSpace(input.CashEffect) == "" && appliedRate == "" {
			return investmentValidationError("cross-currency trades require an actual cash effect or applied settlement rate")
		}
		cashEffectMinor, calcErr := service.positionCashEffect(ctx, tx, userID, input, accountCurrency, tradeCurrency, feeCurrency, appliedRate, grossMinor, feeMinor)
		if calcErr != nil {
			return calcErr
		}
		var openingCostBasis *int64
		if strings.TrimSpace(input.OpeningCostBasis) != "" {
			if input.Type != "opening_position" {
				return investmentValidationError("opening cost basis applies only to an opening position")
			}
			value, parseErr := parseInvestmentMoneyMinor(input.OpeningCostBasis, accountCurrency)
			if parseErr != nil {
				return parseErr
			}
			if value < 0 {
				return investmentValidationError("opening cost basis cannot be negative")
			}
			openingCostBasis = &value
		}

		sequence := existingSequence
		if eventID == uuid.Nil || investmentDateOnly(existingTradeDate) != investmentDateOnly(input.TradeDate) {
			if err := tx.QueryRowContext(ctx, `
SELECT COALESCE(MAX(event_sequence), 0) + 1 FROM position_events
WHERE user_id = $1 AND account_id = $2 AND trade_date = $3`, userID, input.AccountID, investmentDateOnly(input.TradeDate)).Scan(&sequence); err != nil {
				return fmt.Errorf("select position event sequence: %w", err)
			}
		}
		now := service.now().UTC()
		if eventID == uuid.Nil {
			resultID = uuid.New()
			_, err = tx.ExecContext(ctx, `
INSERT INTO position_events (
    id, user_id, account_id, instrument_id, type, quantity, unit_price,
    trade_currency, gross_amount_minor, fee_amount_minor, fee_currency,
    cash_effect_minor, applied_exchange_rate, opening_cost_basis_minor,
    trade_date, event_sequence, settlement_date, external_id, idempotency_key,
    description, notes, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6::NUMERIC, NULLIF($7, '')::NUMERIC,
    $8, $9, $10, $11, $12, NULLIF($13, '')::NUMERIC, $14,
    $15, $16, $17, $18, $19, $20, $21, $22, $22
)`, resultID, userID, input.AccountID, input.InstrumentID, input.Type, quantity, unitPrice,
				tradeCurrency, grossMinor, feeMinor, optionalString(feeCurrency), cashEffectMinor, appliedRate,
				openingCostBasis, investmentDateOnly(input.TradeDate), sequence, optionalDate(input.SettlementDate),
				optionalString(input.ExternalID), optionalUUID(input.IdempotencyKey), optionalString(input.Description),
				optionalString(input.Notes), now)
		} else {
			resultID = eventID
			_, err = tx.ExecContext(ctx, `
UPDATE position_events
SET instrument_id = $3, type = $4, quantity = $5::NUMERIC,
    unit_price = NULLIF($6, '')::NUMERIC, trade_currency = $7,
    gross_amount_minor = $8, fee_amount_minor = $9, fee_currency = $10,
    cash_effect_minor = $11, applied_exchange_rate = NULLIF($12, '')::NUMERIC,
    opening_cost_basis_minor = $13, trade_date = $14, event_sequence = $15,
    settlement_date = $16, external_id = $17, description = $18, notes = $19,
    related_instrument_id = NULL, action_ratio_numerator = NULL,
    action_ratio_denominator = NULL, updated_at = $20
WHERE user_id = $1 AND id = $2`, userID, eventID, input.InstrumentID, input.Type, quantity, unitPrice,
				tradeCurrency, grossMinor, feeMinor, optionalString(feeCurrency), cashEffectMinor, appliedRate,
				openingCostBasis, investmentDateOnly(input.TradeDate), sequence, optionalDate(input.SettlementDate),
				optionalString(input.ExternalID), optionalString(input.Description), optionalString(input.Notes), now)
		}
		if err != nil {
			return mutationDatabaseError(err, "save position event")
		}
		if err := validateAccountPositionReplay(ctx, tx, userID, input.AccountID); err != nil {
			return err
		}
		return service.recalculatePositionAccount(ctx, tx, userID, input.AccountID)
	})
	return resultID, err
}

func (service *InvestmentMutations) DeletePositionEvent(ctx context.Context, userID, eventID uuid.UUID) error {
	return service.withTx(ctx, func(tx *sql.Tx) error {
		var accountID uuid.UUID
		var eventType string
		var eventGroupID sql.NullString
		if err := tx.QueryRowContext(ctx, `
SELECT account_id, type, event_group_id::TEXT FROM position_events
WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, eventID).Scan(&accountID, &eventType, &eventGroupID); err != nil {
			return mutationNotFound(err)
		}
		if !ordinaryPositionEventTypes[eventType] || eventGroupID.Valid {
			return investmentConflictError("use the dedicated workflow for grouped activity")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM position_events WHERE user_id = $1 AND id = $2`, userID, eventID); err != nil {
			return mutationDatabaseError(err, "delete position event")
		}
		if err := validateAccountPositionReplay(ctx, tx, userID, accountID); err != nil {
			return err
		}
		return service.recalculatePositionAccount(ctx, tx, userID, accountID)
	})
}

func (service *InvestmentMutations) CreatePositionReconciliation(ctx context.Context, userID uuid.UUID, input PositionReconciliationMutationInput) (uuid.UUID, error) {
	if err := service.validateDate(ctx, service.db, userID, input.ObservationDate); err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err := service.withTx(ctx, func(tx *sql.Tx) error {
		var currency string
		if err := tx.QueryRowContext(ctx, `
SELECT currency FROM accounts
WHERE user_id = $1 AND id = $2 AND tracking_mode = 'positions' AND archived_at IS NULL
FOR UPDATE`, userID, input.AccountID).Scan(&currency); err != nil {
			return mutationNotFound(err)
		}
		total, err := parseInvestmentMoneyMinor(input.ReportedTotal, currency)
		if err != nil {
			return err
		}
		var cash *int64
		if strings.TrimSpace(input.ReportedCash) != "" {
			value, parseErr := parseInvestmentMoneyMinor(input.ReportedCash, currency)
			if parseErr != nil {
				return parseErr
			}
			cash = &value
		}
		if len(strings.TrimSpace(input.Notes)) > 2000 {
			return investmentValidationError("notes are too long")
		}
		id = uuid.New()
		now := service.now().UTC()
		_, err = tx.ExecContext(ctx, `
INSERT INTO position_reconciliations (
    id, user_id, account_id, observation_date, reported_cash_minor,
    reported_total_minor, notes, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, id, userID, input.AccountID,
			investmentDateOnly(input.ObservationDate), cash, total, optionalString(input.Notes), now)
		return mutationDatabaseError(err, "create position reconciliation")
	})
	return id, err
}

func (service *InvestmentMutations) DeletePositionReconciliation(ctx context.Context, userID, reconciliationID uuid.UUID) error {
	result, err := service.db.ExecContext(ctx, `
DELETE FROM position_reconciliations WHERE user_id = $1 AND id = $2`, userID, reconciliationID)
	if err != nil {
		return mutationDatabaseError(err, "delete position reconciliation")
	}
	return requireInvestmentAffected(result)
}

func (service *InvestmentMutations) validateInstrument(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, userID uuid.UUID, input InstrumentMutationInput) (InstrumentMutationInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.ExternalID = strings.TrimSpace(input.ExternalID)
	input.Symbol = strings.ToUpper(strings.TrimSpace(input.Symbol))
	input.Identifier = strings.ToUpper(strings.TrimSpace(input.Identifier))
	input.ExchangeMIC = strings.ToUpper(strings.TrimSpace(input.ExchangeMIC))
	input.QuoteCurrency = domain.NormalizeCurrency(input.QuoteCurrency)
	if input.Name == "" || len(input.Name) > 100 || len(input.ExternalID) > 200 || len(input.Symbol) > 30 || len(input.Identifier) > 100 || len(input.ExchangeMIC) > 20 {
		return InstrumentMutationInput{}, investmentValidationError("instrument fields are invalid")
	}
	if input.IdentifierType != "isin" && input.IdentifierType != "ticker_exchange" && input.IdentifierType != "custom" {
		return InstrumentMutationInput{}, investmentValidationError("identifier type is invalid")
	}
	if input.AssetType != "stock" && input.AssetType != "etf" && input.AssetType != "fund" {
		return InstrumentMutationInput{}, investmentValidationError("asset type is invalid")
	}
	if err := requireEnabledCurrency(ctx, queryer, userID, input.QuoteCurrency); err != nil {
		return InstrumentMutationInput{}, err
	}
	return input, nil
}

func (service *InvestmentMutations) validateDate(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, userID uuid.UUID, value time.Time) error {
	if value.IsZero() {
		return investmentValidationError("enter a valid date")
	}
	var timezone string
	if err := queryer.QueryRowContext(ctx, `SELECT timezone FROM user_settings WHERE user_id = $1`, userID).Scan(&timezone); err != nil {
		return mutationNotFound(err)
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("load user timezone: %w", err)
	}
	if investmentDateOnly(value) > service.now().In(location).Format(time.DateOnly) {
		return investmentValidationError("financial activity cannot be dated in the future")
	}
	return nil
}

func (service *InvestmentMutations) positionCashEffect(ctx context.Context, tx *sql.Tx, userID uuid.UUID, input PositionEventMutationInput, accountCurrency, tradeCurrency, feeCurrency, appliedRate string, grossMinor, feeMinor *int64) (int64, error) {
	if input.Type != "buy" && input.Type != "sell" {
		return 0, nil
	}
	if strings.TrimSpace(input.CashEffect) != "" {
		value, err := parseInvestmentMoneyMinor(input.CashEffect, accountCurrency)
		if err != nil {
			return 0, err
		}
		if value <= 0 {
			return 0, investmentValidationError("cash effect must be greater than zero")
		}
		if input.Type == "buy" {
			return -value, nil
		}
		return value, nil
	}
	convert := func(amount int64, from string) (int64, error) {
		if from == accountCurrency {
			return amount, nil
		}
		if appliedRate != "" && from == tradeCurrency {
			return convertMinorAtRate(amount, from, accountCurrency, appliedRate, false)
		}
		var base, quote, rate string
		err := tx.QueryRowContext(ctx, `
SELECT base_currency, quote_currency, rate::TEXT
FROM exchange_rates
WHERE user_id = $1
  AND ((base_currency = $2 AND quote_currency = $3) OR (base_currency = $3 AND quote_currency = $2))
  AND effective_date <= $4
ORDER BY effective_date DESC, created_at DESC, id
LIMIT 1`, userID, from, accountCurrency, investmentDateOnly(input.TradeDate)).Scan(&base, &quote, &rate)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return 0, investmentValidationError("no exchange rate is configured for this trade")
			}
			return 0, fmt.Errorf("load exchange rate: %w", err)
		}
		return convertMinorAtRate(amount, from, accountCurrency, rate, base != from)
	}
	gross, err := convert(valueOrZero(grossMinor), tradeCurrency)
	if err != nil {
		return 0, err
	}
	fee := int64(0)
	if feeMinor != nil {
		fee, err = convert(*feeMinor, feeCurrency)
		if err != nil {
			return 0, err
		}
	}
	if input.Type == "buy" {
		return checkedInt64(new(big.Int).Neg(new(big.Int).Add(big.NewInt(gross), big.NewInt(fee))))
	}
	return checkedInt64(new(big.Int).Sub(big.NewInt(gross), big.NewInt(fee)))
}

type positionEventRow struct {
	id                     uuid.UUID
	accountID              uuid.UUID
	instrumentID           uuid.UUID
	relatedInstrumentID    *uuid.UUID
	eventType              string
	quantity               string
	tradeDate              time.Time
	eventSequence          int
	actionRatioNumerator   string
	actionRatioDenominator string
	createdAt              time.Time
}

type positionKey struct {
	accountID    uuid.UUID
	instrumentID uuid.UUID
}

func loadPositionEvents(ctx context.Context, tx *sql.Tx, userID uuid.UUID, accountID *uuid.UUID) ([]positionEventRow, error) {
	query := `
SELECT id, account_id, instrument_id, related_instrument_id, type, quantity::TEXT,
       trade_date, event_sequence, COALESCE(action_ratio_numerator::TEXT, ''),
       COALESCE(action_ratio_denominator::TEXT, ''), created_at
FROM position_events
WHERE user_id = $1`
	args := []any{userID}
	if accountID != nil {
		query += ` AND account_id = $2`
		args = append(args, *accountID)
	}
	query += ` ORDER BY account_id, trade_date, event_sequence, created_at, id`
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load position events: %w", err)
	}
	defer rows.Close()
	result := []positionEventRow{}
	for rows.Next() {
		var row positionEventRow
		var related sql.NullString
		if err := rows.Scan(&row.id, &row.accountID, &row.instrumentID, &related, &row.eventType, &row.quantity,
			&row.tradeDate, &row.eventSequence, &row.actionRatioNumerator, &row.actionRatioDenominator, &row.createdAt); err != nil {
			return nil, fmt.Errorf("scan position event: %w", err)
		}
		if related.Valid {
			parsed, parseErr := uuid.Parse(related.String)
			if parseErr != nil {
				return nil, fmt.Errorf("parse related instrument: %w", parseErr)
			}
			row.relatedInstrumentID = &parsed
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func replayPositionEvents(events []positionEventRow, validateCorporateActions bool) (map[positionKey]*big.Rat, error) {
	quantities := map[positionKey]*big.Rat{}
	for _, event := range events {
		key := positionKey{accountID: event.accountID, instrumentID: event.instrumentID}
		current := cloneRat(quantities[key])
		quantity, ok := new(big.Rat).SetString(event.quantity)
		if !ok {
			return nil, fmt.Errorf("parse stored position quantity")
		}
		next := cloneRat(current)
		switch event.eventType {
		case "sell", "transfer_out", "merger_out":
			next.Sub(next, absRat(quantity))
		case "quantity_adjustment":
			next.Add(next, quantity)
		case "split":
			numerator, denominator, err := positiveRatio(event.actionRatioNumerator, event.actionRatioDenominator)
			if err != nil {
				return nil, err
			}
			next.Mul(next, numerator).Quo(next, denominator)
		default:
			next.Add(next, absRat(quantity))
		}
		if next.Sign() < 0 {
			return nil, investmentValidationError("a position cannot have a negative quantity")
		}
		if validateCorporateActions {
			var expected *big.Rat
			switch event.eventType {
			case "spinoff":
				if event.relatedInstrumentID == nil {
					return nil, investmentConflictError("recorded spinoff is missing its source instrument")
				}
				numerator, denominator, err := positiveRatio(event.actionRatioNumerator, event.actionRatioDenominator)
				if err != nil {
					return nil, err
				}
				source := cloneRat(quantities[positionKey{accountID: event.accountID, instrumentID: *event.relatedInstrumentID}])
				expected = source.Mul(source, numerator).Quo(source, denominator)
			case "merger_out":
				expected = current
			}
			if expected != nil && expected.Cmp(quantity) != 0 {
				return nil, investmentConflictError("this change would invalidate a recorded corporate action")
			}
		}
		quantities[key] = next
	}
	return quantities, nil
}

func validateAccountPositionReplay(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) error {
	events, err := loadPositionEvents(ctx, tx, userID, &accountID)
	if err != nil {
		return err
	}
	_, err = replayPositionEvents(events, true)
	return err
}

func (service *InvestmentMutations) recalculateInstrumentAccounts(ctx context.Context, tx *sql.Tx, userID, instrumentID uuid.UUID) error {
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT account_id FROM position_events
WHERE user_id = $1 AND instrument_id = $2`, userID, instrumentID)
	if err != nil {
		return fmt.Errorf("list affected position accounts: %w", err)
	}
	var accountIDs []uuid.UUID
	for rows.Next() {
		var accountID uuid.UUID
		if err := rows.Scan(&accountID); err != nil {
			rows.Close()
			return fmt.Errorf("scan affected position account: %w", err)
		}
		accountIDs = append(accountIDs, accountID)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close affected position accounts: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate affected position accounts: %w", err)
	}
	for _, accountID := range accountIDs {
		if err := service.recalculatePositionAccount(ctx, tx, userID, accountID); err != nil {
			return err
		}
	}
	return nil
}

func (service *InvestmentMutations) recalculatePositionAccount(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) error {
	var accountCurrency string
	var archivedAt sql.NullTime
	if err := tx.QueryRowContext(ctx, `
SELECT currency, archived_at FROM accounts
WHERE user_id = $1 AND id = $2 AND tracking_mode = 'positions'`, userID, accountID).Scan(&accountCurrency, &archivedAt); err != nil {
		return mutationNotFound(err)
	}
	if archivedAt.Valid {
		return nil
	}
	events, err := loadPositionEvents(ctx, tx, userID, &accountID)
	if err != nil {
		return err
	}
	quantities, err := replayPositionEvents(events, true)
	if err != nil {
		return err
	}

	total := new(big.Int)
	transactionRows, err := tx.QueryContext(ctx, `
SELECT type, amount_minor FROM transactions
WHERE user_id = $1 AND account_id = $2`, userID, accountID)
	if err != nil {
		return fmt.Errorf("load position account cash transactions: %w", err)
	}
	for transactionRows.Next() {
		var transactionType string
		var amount int64
		if err := transactionRows.Scan(&transactionType, &amount); err != nil {
			transactionRows.Close()
			return fmt.Errorf("scan position account cash transaction: %w", err)
		}
		total.Add(total, investmentTransactionEffect(transactionType, amount))
	}
	if err := transactionRows.Close(); err != nil {
		return fmt.Errorf("close position account cash transactions: %w", err)
	}
	if err := transactionRows.Err(); err != nil {
		return fmt.Errorf("iterate position account cash transactions: %w", err)
	}
	var tradeCash int64
	if err := tx.QueryRowContext(ctx, `
SELECT COALESCE(SUM(cash_effect_minor), 0) FROM position_events
WHERE user_id = $1 AND account_id = $2`, userID, accountID).Scan(&tradeCash); err != nil {
		return fmt.Errorf("sum position account trade cash: %w", err)
	}
	total.Add(total, big.NewInt(tradeCash))

	for key, quantity := range quantities {
		if key.accountID != accountID || quantity.Sign() == 0 {
			continue
		}
		var instrumentCurrency, price string
		err := tx.QueryRowContext(ctx, `
SELECT instrument.quote_currency, price.price::TEXT
FROM investment_instruments instrument
JOIN LATERAL (
    SELECT price, effective_date
    FROM security_prices
    WHERE user_id = instrument.user_id AND instrument_id = instrument.id
      AND effective_date <= $3
      AND effective_date >= COALESCE((
          SELECT MAX(trade_date) FROM position_events
          WHERE user_id = $1 AND account_id = $2 AND instrument_id = instrument.id AND type = 'split'
      ), effective_date)
    ORDER BY effective_date DESC, created_at DESC, id
    LIMIT 1
) price ON TRUE
WHERE instrument.user_id = $1 AND instrument.id = $4`, userID, accountID, investmentDateOnly(service.now().UTC()), key.instrumentID).
			Scan(&instrumentCurrency, &price)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("load position price: %w", err)
		}
		quoteMinor, err := decimalProductMinor(canonicalRat(quantity), price, instrumentCurrency)
		if err != nil {
			return err
		}
		accountMinor, found, err := investmentConvertMinor(ctx, tx, userID, quoteMinor, instrumentCurrency, accountCurrency, service.now().UTC())
		if err != nil {
			return err
		}
		if found {
			total.Add(total, big.NewInt(accountMinor))
		}
	}
	value, err := checkedInt64(total)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE accounts SET current_value_minor = $3, updated_at = $4
WHERE user_id = $1 AND id = $2`, userID, accountID, value, service.now().UTC())
	if err != nil {
		return fmt.Errorf("store position account value: %w", err)
	}
	return nil
}

func investmentConvertMinor(ctx context.Context, tx *sql.Tx, userID uuid.UUID, amount int64, fromCurrency, toCurrency string, asOf time.Time) (int64, bool, error) {
	if fromCurrency == toCurrency {
		return amount, true, nil
	}
	var baseCurrency, rate string
	err := tx.QueryRowContext(ctx, `
SELECT base_currency, rate::TEXT FROM exchange_rates
WHERE user_id = $1
  AND ((base_currency = $2 AND quote_currency = $3) OR (base_currency = $3 AND quote_currency = $2))
  AND effective_date <= $4
ORDER BY effective_date DESC, created_at DESC, id
LIMIT 1`, userID, fromCurrency, toCurrency, investmentDateOnly(asOf)).Scan(&baseCurrency, &rate)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("load position exchange rate: %w", err)
	}
	converted, err := convertMinorAtRate(amount, fromCurrency, toCurrency, rate, baseCurrency != fromCurrency)
	return converted, true, err
}

func investmentTransactionEffect(transactionType string, amount int64) *big.Int {
	value := big.NewInt(amount)
	if transactionType == "manual_adjustment" || transactionType == "transfer" {
		return value
	}
	value.Abs(value)
	switch transactionType {
	case "opening_balance", "deposit", "interest", "dividend", "capital_gain", "purchase", "liability_increase":
		return value
	case "withdrawal", "capital_loss", "fee", "sale", "liability_payment":
		return value.Neg(value)
	default:
		return new(big.Int)
	}
}

func requireEnabledCurrency(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, userID uuid.UUID, currency string) error {
	if !domain.IsSupportedCurrency(currency) {
		return investmentValidationError("choose a valid currency")
	}
	var baseCurrency, supportedJSON string
	if err := queryer.QueryRowContext(ctx, `
SELECT base_currency, supported_currencies FROM user_settings WHERE user_id = $1`, userID).Scan(&baseCurrency, &supportedJSON); err != nil {
		return mutationNotFound(err)
	}
	var supported []string
	if err := json.Unmarshal([]byte(supportedJSON), &supported); err != nil {
		return fmt.Errorf("decode supported currencies: %w", err)
	}
	if currency == baseCurrency {
		return nil
	}
	for _, candidate := range supported {
		if currency == candidate {
			return nil
		}
	}
	return investmentValidationError("currency is not enabled")
}

func canonicalDecimal(value string, allowNegative, allowZero bool, label string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if len(normalized) > 100 || !investmentDecimalPattern.MatchString(normalized) {
		return "", investmentValidationError("enter a valid " + label)
	}
	decimal, ok := new(big.Rat).SetString(normalized)
	if !ok {
		return "", investmentValidationError("enter a valid " + label)
	}
	if !allowNegative && decimal.Sign() < 0 {
		return "", investmentValidationError(label + " cannot be negative")
	}
	if !allowZero && decimal.Sign() == 0 {
		return "", investmentValidationError(label + " must be greater than zero")
	}
	return canonicalRat(decimal), nil
}

func parseInvestmentMoneyMinor(value, currency string) (int64, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if !investmentDecimalPattern.MatchString(normalized) {
		return 0, investmentValidationError("enter a valid monetary amount")
	}
	digits := investmentCurrencyDigits(currency)
	parts := strings.SplitN(normalized, ".", 2)
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > digits {
		return 0, investmentValidationError(fmt.Sprintf("%s supports at most %d decimal places", currency, digits))
	}
	negative := strings.HasPrefix(parts[0], "-")
	whole := strings.TrimPrefix(parts[0], "-")
	fraction += strings.Repeat("0", digits-len(fraction))
	minor := new(big.Int)
	if _, ok := minor.SetString(whole+fraction, 10); !ok {
		return 0, investmentValidationError("enter a valid monetary amount")
	}
	if negative {
		minor.Neg(minor)
	}
	return checkedInt64(minor)
}

func decimalProductMinor(quantity, price, currency string) (int64, error) {
	quantityRat, _ := new(big.Rat).SetString(quantity)
	priceRat, _ := new(big.Rat).SetString(price)
	value := new(big.Rat).Mul(absRat(quantityRat), priceRat)
	value.Mul(value, new(big.Rat).SetInt(pow10(investmentCurrencyDigits(currency))))
	return roundedRatInt64(value)
}

func convertMinorAtRate(amount int64, fromCurrency, toCurrency, rate string, inverse bool) (int64, error) {
	rateRat, ok := new(big.Rat).SetString(rate)
	if !ok || rateRat.Sign() <= 0 {
		return 0, investmentValidationError("exchange rate must be greater than zero")
	}
	value := new(big.Rat).SetInt64(amount)
	value.Quo(value, new(big.Rat).SetInt(pow10(investmentCurrencyDigits(fromCurrency))))
	if inverse {
		value.Quo(value, rateRat)
	} else {
		value.Mul(value, rateRat)
	}
	value.Mul(value, new(big.Rat).SetInt(pow10(investmentCurrencyDigits(toCurrency))))
	return roundedRatInt64(value)
}

func roundedRatInt64(value *big.Rat) (int64, error) {
	numerator := new(big.Int).Set(value.Num())
	denominator := new(big.Int).Set(value.Denom())
	negative := numerator.Sign() < 0
	numerator.Abs(numerator)
	quotient, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	if new(big.Int).Lsh(remainder, 1).Cmp(denominator) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if negative {
		quotient.Neg(quotient)
	}
	return checkedInt64(quotient)
}

func checkedInt64(value *big.Int) (int64, error) {
	if !value.IsInt64() {
		return 0, investmentValidationError("calculated value is outside the supported range")
	}
	return value.Int64(), nil
}

func positiveRatio(numeratorValue, denominatorValue string) (*big.Rat, *big.Rat, error) {
	numerator, okNumerator := new(big.Rat).SetString(numeratorValue)
	denominator, okDenominator := new(big.Rat).SetString(denominatorValue)
	if !okNumerator || !okDenominator || numerator.Sign() <= 0 || denominator.Sign() <= 0 {
		return nil, nil, investmentConflictError("recorded corporate action requires a positive ratio")
	}
	return numerator, denominator, nil
}

func canonicalRat(value *big.Rat) string {
	if value.IsInt() {
		return value.Num().String()
	}
	text := value.FloatString(100)
	text = strings.TrimRight(text, "0")
	return strings.TrimRight(text, ".")
}

func cloneRat(value *big.Rat) *big.Rat {
	if value == nil {
		return new(big.Rat)
	}
	return new(big.Rat).Set(value)
}

func absRat(value *big.Rat) *big.Rat {
	return new(big.Rat).Abs(value)
}

func pow10(digits int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)
}

func investmentCurrencyDigits(currency string) int {
	switch domain.NormalizeCurrency(currency) {
	case "BHD", "KWD", "OMR":
		return 3
	case "BIF", "JPY", "RWF", "UGX":
		return 0
	default:
		return 2
	}
}

func investmentDateOnly(value time.Time) string {
	return value.Format(time.DateOnly)
}

func optionalDate(value *time.Time) any {
	if value == nil {
		return nil
	}
	return investmentDateOnly(*value)
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func optionalUUID(value uuid.UUID) any {
	if value == uuid.Nil {
		return nil
	}
	return value
}

func valueOrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func investmentValidationError(detail string) error {
	return fmt.Errorf("%w: %s", ErrInvestmentMutationValidation, detail)
}

func investmentConflictError(detail string) error {
	return fmt.Errorf("%w: %s", ErrInvestmentMutationConflict, detail)
}

func mutationNotFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvestmentMutationNotFound
	}
	return err
}

func mutationDatabaseError(err error, operation string) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	if strings.Contains(message, "duplicate key") || strings.Contains(message, "unique constraint") || strings.Contains(message, "violates foreign key") {
		return fmt.Errorf("%w: %s", ErrInvestmentMutationConflict, operation)
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func requireInvestmentAffected(result sql.Result) error {
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrInvestmentMutationNotFound
	}
	return nil
}

func (service *InvestmentMutations) withTx(ctx context.Context, operation func(*sql.Tx) error) error {
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin investment mutation: %w", err)
	}
	defer tx.Rollback()
	if err := operation(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return mutationDatabaseError(err, "commit investment mutation")
	}
	return nil
}
