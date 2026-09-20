package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrAccountConversionNotFound   = errors.New("account conversion resource not found")
	ErrAccountConversionConflict   = errors.New("account conversion conflict")
	ErrAccountConversionValidation = errors.New("account conversion validation failed")
)

type AccountConversionService struct {
	db  *sql.DB
	now func() time.Time
}

func NewAccountConversionService(db *sql.DB) *AccountConversionService {
	return &AccountConversionService{db: db, now: time.Now}
}

type AccountConversionHoldingInput struct {
	InstrumentID     uuid.UUID `json:"instrumentId"`
	Quantity         string    `json:"quantity"`
	Price            string    `json:"price"`
	OpeningCostBasis string    `json:"openingCostBasis"`
	PriceSource      string    `json:"priceSource"`
	PriceProvenance  string    `json:"priceProvenance"`
}

type AccountConversionInput struct {
	SourceAccountID   uuid.UUID                       `json:"sourceAccountId"`
	TargetName        string                          `json:"targetName"`
	ConversionDate    time.Time                       `json:"conversionDate"`
	OpeningCash       string                          `json:"openingCash"`
	Holdings          []AccountConversionHoldingInput `json:"holdings"`
	IdempotencyKey    uuid.UUID                       `json:"idempotencyKey"`
	ConfirmDifference bool                            `json:"confirmDifference"`
}

type AccountConversionHoldingPreview struct {
	InstrumentID  uuid.UUID `json:"instrumentId"`
	Name          string    `json:"name"`
	Symbol        *string   `json:"symbol"`
	Quantity      string    `json:"quantity"`
	Price         string    `json:"price"`
	QuoteCurrency string    `json:"quoteCurrency"`
}

type AccountConversionPreview struct {
	SourceAccountID     uuid.UUID                         `json:"sourceAccountId"`
	SourceAccountName   string                            `json:"sourceAccountName"`
	Currency            string                            `json:"currency"`
	ConversionDate      string                            `json:"conversionDate"`
	SourceBalanceMinor  string                            `json:"sourceBalanceMinor"`
	OpeningCashMinor    string                            `json:"openingCashMinor"`
	PositionsMinor      string                            `json:"positionsMinor"`
	ProjectedTotalMinor string                            `json:"projectedTotalMinor"`
	DifferenceMinor     string                            `json:"differenceMinor"`
	Holdings            []AccountConversionHoldingPreview `json:"holdings"`
}

type AccountConversionResult struct {
	TargetAccountID uuid.UUID `json:"targetAccountId"`
	Replayed        bool      `json:"replayed"`
}

type conversionSource struct {
	ID                   uuid.UUID
	Name                 string
	Description          sql.NullString
	CategoryID           uuid.UUID
	InstitutionID        uuid.NullUUID
	AccountReference     sql.NullString
	Currency             string
	IsIncludedInNetWorth bool
	GoalID               uuid.NullUUID
	Notes                sql.NullString
}

type preparedConversionHolding struct {
	InstrumentID          uuid.UUID
	Name                  string
	Symbol                sql.NullString
	QuoteCurrency         string
	Quantity              string
	Price                 string
	OpeningCostBasisMinor *int64
	PriceSource           string
	PriceProvenance       *string
	PriceExists           bool
}

type preparedAccountConversion struct {
	Source              conversionSource
	TargetName          string
	ConversionDate      time.Time
	OpeningCashMinor    int64
	Holdings            []preparedConversionHolding
	SourceBalanceMinor  int64
	PositionsMinor      int64
	ProjectedTotalMinor int64
	DifferenceMinor     int64
}

func (service *AccountConversionService) Preview(ctx context.Context, userID uuid.UUID, input AccountConversionInput) (AccountConversionPreview, error) {
	prepared, err := service.prepare(ctx, service.db, userID, input)
	if err != nil {
		return AccountConversionPreview{}, err
	}
	return conversionPreview(prepared), nil
}

func (service *AccountConversionService) Execute(ctx context.Context, userID uuid.UUID, input AccountConversionInput) (AccountConversionResult, error) {
	if input.IdempotencyKey == uuid.Nil {
		return AccountConversionResult{}, accountConversionValidation("idempotency key must be a UUID")
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return AccountConversionResult{}, fmt.Errorf("begin account conversion: %w", err)
	}
	defer tx.Rollback()

	lockKey := userID.String() + ":account-conversion:" + input.IdempotencyKey.String()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return AccountConversionResult{}, fmt.Errorf("lock account conversion idempotency key: %w", err)
	}
	result, found, err := service.findReplay(ctx, tx, userID, input)
	if err != nil {
		return AccountConversionResult{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return AccountConversionResult{}, fmt.Errorf("commit account conversion replay: %w", err)
		}
		return result, nil
	}
	if input.SourceAccountID == uuid.Nil {
		return AccountConversionResult{}, ErrAccountConversionNotFound
	}
	var lockedSource uuid.UUID
	if err := tx.QueryRowContext(ctx, `SELECT id FROM accounts WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, input.SourceAccountID).Scan(&lockedSource); errors.Is(err, sql.ErrNoRows) {
		return AccountConversionResult{}, ErrAccountConversionNotFound
	} else if err != nil {
		return AccountConversionResult{}, fmt.Errorf("lock source account: %w", err)
	}
	var existingSourceConversion bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM account_conversions WHERE user_id=$1 AND source_account_id=$2)`, userID, input.SourceAccountID).Scan(&existingSourceConversion); err != nil {
		return AccountConversionResult{}, fmt.Errorf("check source conversion: %w", err)
	}
	if existingSourceConversion {
		return AccountConversionResult{}, accountConversionConflict("this account has already been converted")
	}

	prepared, err := service.prepare(ctx, tx, userID, input)
	if err != nil {
		return AccountConversionResult{}, err
	}
	if prepared.DifferenceMinor != 0 && !input.ConfirmDifference {
		return AccountConversionResult{}, accountConversionValidation("confirm the difference between the source balance and opening position value")
	}

	targetAccountID := uuid.New()
	now := service.now().UTC()
	_, err = tx.ExecContext(ctx, `
INSERT INTO accounts (
    id,user_id,name,description,category_id,institution_id,account_reference,currency,
    tracking_mode,current_value_minor,cost_basis_minor,is_liability,is_included_in_net_worth,
    goal_id,notes,opened_at,created_at,updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'positions',$9,NULL,FALSE,$10,$11,$12,$13,$14,$14)`,
		targetAccountID, userID, prepared.TargetName, nullStringValue(prepared.Source.Description), prepared.Source.CategoryID,
		nullUUIDValue(prepared.Source.InstitutionID), nullStringValue(prepared.Source.AccountReference), prepared.Source.Currency,
		prepared.OpeningCashMinor, prepared.Source.IsIncludedInNetWorth, nullUUIDValue(prepared.Source.GoalID),
		nullStringValue(prepared.Source.Notes), investmentDateOnly(prepared.ConversionDate), now)
	if err != nil {
		return AccountConversionResult{}, fmt.Errorf("create converted account: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO transactions (
    id,user_id,account_id,type,amount_minor,currency,transaction_date,description,created_at,updated_at
) VALUES ($1,$2,$3,'opening_balance',$4,$5,$6,'Opening cash from account conversion',$7,$7)`,
		uuid.New(), userID, targetAccountID, prepared.OpeningCashMinor, prepared.Source.Currency, investmentDateOnly(prepared.ConversionDate), now)
	if err != nil {
		return AccountConversionResult{}, fmt.Errorf("create conversion opening cash: %w", err)
	}
	for index, holding := range prepared.Holdings {
		_, err = tx.ExecContext(ctx, `
INSERT INTO position_events (
    id,user_id,account_id,instrument_id,type,quantity,trade_currency,cash_effect_minor,
    opening_cost_basis_minor,trade_date,event_sequence,description,created_at,updated_at
) VALUES ($1,$2,$3,$4,'opening_position',$5::NUMERIC,$6,0,$7,$8,$9,'Opening position from account conversion',$10,$10)`,
			uuid.New(), userID, targetAccountID, holding.InstrumentID, holding.Quantity, holding.QuoteCurrency,
			holding.OpeningCostBasisMinor, investmentDateOnly(prepared.ConversionDate), index+1, now)
		if err != nil {
			return AccountConversionResult{}, fmt.Errorf("create conversion opening position: %w", err)
		}
		if !holding.PriceExists {
			_, err = tx.ExecContext(ctx, `
INSERT INTO security_prices (
    id,user_id,instrument_id,price,currency,effective_date,source,provenance,created_at,updated_at
) VALUES ($1,$2,$3,$4::NUMERIC,$5,$6,$7,$8,$9,$9)`, uuid.New(), userID, holding.InstrumentID,
				holding.Price, holding.QuoteCurrency, investmentDateOnly(prepared.ConversionDate), holding.PriceSource,
				holding.PriceProvenance, now)
			if err != nil {
				return AccountConversionResult{}, fmt.Errorf("create conversion security price: %w", err)
			}
		}
	}
	investments := &InvestmentMutations{db: service.db, now: service.now}
	if err := investments.recalculatePositionAccount(ctx, tx, userID, targetAccountID); err != nil {
		return AccountConversionResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET goal_id=NULL,archived_at=$3,updated_at=$4 WHERE user_id=$1 AND id=$2`, userID, prepared.Source.ID, conversionArchiveTime(prepared.ConversionDate), now); err != nil {
		return AccountConversionResult{}, fmt.Errorf("archive converted source account: %w", err)
	}
	if prepared.Source.GoalID.Valid {
		if _, err := tx.ExecContext(ctx, `UPDATE goals SET linked_account_id=$3,updated_at=$4 WHERE user_id=$1 AND id=$2`, userID, prepared.Source.GoalID.UUID, targetAccountID, now); err != nil {
			return AccountConversionResult{}, fmt.Errorf("relink converted account goal: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE estate_account_directives SET account_id=$3,updated_at=$4 WHERE user_id=$1 AND account_id=$2`, userID, prepared.Source.ID, targetAccountID, now); err != nil {
		return AccountConversionResult{}, fmt.Errorf("relink converted estate directives: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO account_conversions (id,user_id,source_account_id,target_account_id,conversion_date,source_balance_minor,idempotency_key,created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, uuid.New(), userID, prepared.Source.ID, targetAccountID,
		investmentDateOnly(prepared.ConversionDate), prepared.SourceBalanceMinor, input.IdempotencyKey.String(), now); err != nil {
		return AccountConversionResult{}, fmt.Errorf("record account conversion: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return AccountConversionResult{}, fmt.Errorf("commit account conversion: %w", err)
	}
	return AccountConversionResult{TargetAccountID: targetAccountID}, nil
}

func (service *AccountConversionService) prepare(ctx context.Context, queryer sqlTx, userID uuid.UUID, input AccountConversionInput) (preparedAccountConversion, error) {
	if input.SourceAccountID == uuid.Nil {
		return preparedAccountConversion{}, ErrAccountConversionNotFound
	}
	if input.ConversionDate.IsZero() {
		return preparedAccountConversion{}, accountConversionValidation("conversion date must use YYYY-MM-DD")
	}
	var timezone string
	if err := queryer.QueryRowContext(ctx, `SELECT timezone FROM user_settings WHERE user_id=$1`, userID).Scan(&timezone); errors.Is(err, sql.ErrNoRows) {
		return preparedAccountConversion{}, ErrAccountConversionNotFound
	} else if err != nil {
		return preparedAccountConversion{}, fmt.Errorf("load conversion timezone: %w", err)
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return preparedAccountConversion{}, fmt.Errorf("load conversion timezone: %w", err)
	}
	conversionDate := dateOnlyUTC(input.ConversionDate)
	if investmentDateOnly(conversionDate) > service.now().In(location).Format(time.DateOnly) {
		return preparedAccountConversion{}, accountConversionValidation("the conversion date cannot be in the future")
	}

	var source conversionSource
	var investible, categoryArchived bool
	err = queryer.QueryRowContext(ctx, `
SELECT account.id,account.name,account.description,account.category_id,account.institution_id,
       account.account_reference,account.currency,account.is_included_in_net_worth,account.goal_id,
       account.notes,category.is_investible,category.is_archived
FROM accounts account
JOIN categories category ON category.user_id=account.user_id AND category.id=account.category_id
WHERE account.user_id=$1 AND account.id=$2 AND account.tracking_mode='balance'
	  AND account.is_liability=FALSE AND account.archived_at IS NULL`, userID, input.SourceAccountID).Scan(
		&source.ID, &source.Name, &source.Description, &source.CategoryID, &source.InstitutionID,
		&source.AccountReference, &source.Currency, &source.IsIncludedInNetWorth, &source.GoalID,
		&source.Notes, &investible, &categoryArchived)
	if errors.Is(err, sql.ErrNoRows) {
		return preparedAccountConversion{}, ErrAccountConversionNotFound
	}
	if err != nil {
		return preparedAccountConversion{}, fmt.Errorf("load conversion source account: %w", err)
	}
	if categoryArchived || !investible {
		return preparedAccountConversion{}, accountConversionValidation("only active investment accounts can be converted")
	}
	targetName := strings.TrimSpace(input.TargetName)
	if targetName == "" || len(targetName) > 100 || strings.ContainsAny(targetName, "\x00\n\r\t") {
		return preparedAccountConversion{}, accountConversionValidation("enter a replacement account name")
	}
	if len(input.Holdings) == 0 || len(input.Holdings) > 1000 {
		return preparedAccountConversion{}, accountConversionValidation("add at least one opening holding")
	}
	openingCashMinor, err := parseInvestmentMoneyMinor(input.OpeningCash, source.Currency)
	if err != nil {
		return preparedAccountConversion{}, accountConversionError(err)
	}
	if openingCashMinor < 0 {
		return preparedAccountConversion{}, accountConversionValidation("opening cash cannot be negative")
	}
	var latestActivity sql.NullTime
	if err := queryer.QueryRowContext(ctx, `
SELECT MAX(activity_date) FROM (
    SELECT MAX(transaction_date) AS activity_date FROM transactions WHERE user_id=$1 AND account_id=$2
    UNION ALL
    SELECT MAX(valuation_date) FROM valuation_snapshots WHERE user_id=$1 AND account_id=$2
) activity`, userID, source.ID).Scan(&latestActivity); err != nil {
		return preparedAccountConversion{}, fmt.Errorf("load latest conversion activity: %w", err)
	}
	if latestActivity.Valid && investmentDateOnly(conversionDate) < latestActivity.Time.Format(time.DateOnly) {
		return preparedAccountConversion{}, accountConversionValidation("choose a conversion date on or after " + latestActivity.Time.Format(time.DateOnly) + ", the latest source activity")
	}

	seen := make(map[uuid.UUID]bool, len(input.Holdings))
	preparedHoldings := make([]preparedConversionHolding, 0, len(input.Holdings))
	positions := new(big.Int)
	for _, holding := range input.Holdings {
		if holding.InstrumentID == uuid.Nil || seen[holding.InstrumentID] {
			if seen[holding.InstrumentID] {
				return preparedAccountConversion{}, accountConversionValidation("each opening instrument may appear only once")
			}
			return preparedAccountConversion{}, ErrAccountConversionNotFound
		}
		seen[holding.InstrumentID] = true
		var prepared preparedConversionHolding
		prepared.InstrumentID = holding.InstrumentID
		err := queryer.QueryRowContext(ctx, `
SELECT name,symbol,quote_currency FROM investment_instruments
WHERE user_id=$1 AND id=$2 AND archived_at IS NULL`, userID, holding.InstrumentID).Scan(&prepared.Name, &prepared.Symbol, &prepared.QuoteCurrency)
		if errors.Is(err, sql.ErrNoRows) {
			return preparedAccountConversion{}, ErrAccountConversionNotFound
		}
		if err != nil {
			return preparedAccountConversion{}, fmt.Errorf("load conversion instrument: %w", err)
		}
		prepared.Quantity, err = canonicalDecimal(holding.Quantity, false, false, "quantity")
		if err != nil {
			return preparedAccountConversion{}, accountConversionError(err)
		}
		prepared.Price, err = canonicalDecimal(holding.Price, false, false, "unit price")
		if err != nil {
			return preparedAccountConversion{}, accountConversionError(err)
		}
		quoteMinor, err := decimalProductMinor(prepared.Quantity, prepared.Price, prepared.QuoteCurrency)
		if err != nil {
			return preparedAccountConversion{}, accountConversionError(err)
		}
		accountMinor, found, err := accountConversionConvertMinor(ctx, queryer, userID, quoteMinor, prepared.QuoteCurrency, source.Currency, conversionDate)
		if err != nil {
			return preparedAccountConversion{}, err
		}
		if !found {
			return preparedAccountConversion{}, accountConversionValidation("an exchange rate is unavailable on the conversion date")
		}
		positions.Add(positions, big.NewInt(accountMinor))
		if holding.OpeningCostBasis != "" {
			if len(strings.TrimSpace(holding.OpeningCostBasis)) > 100 {
				return preparedAccountConversion{}, accountConversionValidation("opening cost basis is too long")
			}
			basis, err := parseInvestmentMoneyMinor(holding.OpeningCostBasis, source.Currency)
			if err != nil {
				return preparedAccountConversion{}, accountConversionError(err)
			}
			if basis < 0 {
				return preparedAccountConversion{}, accountConversionValidation("opening cost basis cannot be negative")
			}
			prepared.OpeningCostBasisMinor = &basis
		}
		prepared.PriceSource = strings.TrimSpace(holding.PriceSource)
		if prepared.PriceSource == "" {
			prepared.PriceSource = "conversion"
		}
		if len(prepared.PriceSource) > 100 || len(strings.TrimSpace(holding.PriceProvenance)) > 500 {
			return preparedAccountConversion{}, accountConversionValidation("price source details are too long")
		}
		prepared.PriceProvenance = optionalString(holding.PriceProvenance)
		var existingPrice string
		err = queryer.QueryRowContext(ctx, `SELECT price::TEXT FROM security_prices WHERE user_id=$1 AND instrument_id=$2 AND effective_date=$3`, userID, holding.InstrumentID, investmentDateOnly(conversionDate)).Scan(&existingPrice)
		switch {
		case errors.Is(err, sql.ErrNoRows):
		case err != nil:
			return preparedAccountConversion{}, fmt.Errorf("load conversion security price: %w", err)
		default:
			prepared.PriceExists = true
			existingPrice, err = canonicalDecimal(existingPrice, false, false, "unit price")
			if err != nil {
				return preparedAccountConversion{}, accountConversionError(err)
			}
			if existingPrice != prepared.Price {
				return preparedAccountConversion{}, accountConversionConflict(prepared.Name + " already has a different price on the conversion date")
			}
		}
		preparedHoldings = append(preparedHoldings, prepared)
	}
	positionsMinor, err := checkedInt64(positions)
	if err != nil {
		return preparedAccountConversion{}, accountConversionError(err)
	}
	sourceBalanceMinor, err := accountBalanceAt(ctx, queryer, userID, source.ID, conversionDate)
	if err != nil {
		return preparedAccountConversion{}, err
	}
	projected := new(big.Int).Add(big.NewInt(openingCashMinor), big.NewInt(positionsMinor))
	projectedMinor, err := checkedInt64(projected)
	if err != nil {
		return preparedAccountConversion{}, accountConversionError(err)
	}
	difference := new(big.Int).Sub(big.NewInt(projectedMinor), big.NewInt(sourceBalanceMinor))
	differenceMinor, err := checkedInt64(difference)
	if err != nil {
		return preparedAccountConversion{}, accountConversionError(err)
	}
	return preparedAccountConversion{
		Source: source, TargetName: targetName, ConversionDate: conversionDate, OpeningCashMinor: openingCashMinor,
		Holdings: preparedHoldings, SourceBalanceMinor: sourceBalanceMinor, PositionsMinor: positionsMinor,
		ProjectedTotalMinor: projectedMinor, DifferenceMinor: differenceMinor,
	}, nil
}

func (service *AccountConversionService) findReplay(ctx context.Context, tx *sql.Tx, userID uuid.UUID, input AccountConversionInput) (AccountConversionResult, bool, error) {
	var sourceID, targetID uuid.UUID
	var conversionDate time.Time
	err := tx.QueryRowContext(ctx, `SELECT source_account_id,target_account_id,conversion_date FROM account_conversions WHERE user_id=$1 AND idempotency_key=$2`, userID, input.IdempotencyKey.String()).Scan(&sourceID, &targetID, &conversionDate)
	if errors.Is(err, sql.ErrNoRows) {
		return AccountConversionResult{}, false, nil
	}
	if err != nil {
		return AccountConversionResult{}, false, fmt.Errorf("load account conversion replay: %w", err)
	}
	compatible, err := conversionReplayCompatible(ctx, tx, userID, sourceID, targetID, conversionDate, input)
	if err != nil {
		return AccountConversionResult{}, false, err
	}
	if !compatible {
		return AccountConversionResult{}, false, accountConversionConflict("idempotency key was already used with different account conversion details")
	}
	return AccountConversionResult{TargetAccountID: targetID, Replayed: true}, true, nil
}

func conversionReplayCompatible(ctx context.Context, tx *sql.Tx, userID, sourceID, targetID uuid.UUID, conversionDate time.Time, input AccountConversionInput) (bool, error) {
	if input.SourceAccountID != sourceID || investmentDateOnly(input.ConversionDate) != conversionDate.Format(time.DateOnly) {
		return false, nil
	}
	var targetName string
	if err := tx.QueryRowContext(ctx, `SELECT name FROM accounts WHERE user_id=$1 AND id=$2`, userID, targetID).Scan(&targetName); err != nil {
		return false, fmt.Errorf("load replay target account: %w", err)
	}
	if strings.TrimSpace(input.TargetName) != targetName {
		return false, nil
	}
	var currency string
	if err := tx.QueryRowContext(ctx, `SELECT currency FROM accounts WHERE user_id=$1 AND id=$2`, userID, sourceID).Scan(&currency); err != nil {
		return false, fmt.Errorf("load replay source currency: %w", err)
	}
	openingCash, err := parseInvestmentMoneyMinor(input.OpeningCash, currency)
	if err != nil {
		return false, nil
	}
	var storedCash int64
	if err := tx.QueryRowContext(ctx, `SELECT amount_minor FROM transactions WHERE user_id=$1 AND account_id=$2 AND type='opening_balance'`, userID, targetID).Scan(&storedCash); err != nil {
		return false, fmt.Errorf("load replay opening cash: %w", err)
	}
	if openingCash != storedCash || len(input.Holdings) == 0 {
		return false, nil
	}
	rows, err := tx.QueryContext(ctx, `
SELECT event.instrument_id,event.quantity::TEXT,event.opening_cost_basis_minor,price.price::TEXT
FROM position_events event
JOIN security_prices price ON price.user_id=event.user_id AND price.instrument_id=event.instrument_id AND price.effective_date=$3
WHERE event.user_id=$1 AND event.account_id=$2 AND event.type='opening_position'
ORDER BY event.event_sequence,event.created_at,event.id`, userID, targetID, conversionDate.Format(time.DateOnly))
	if err != nil {
		return false, fmt.Errorf("load replay opening holdings: %w", err)
	}
	defer rows.Close()
	index := 0
	for rows.Next() {
		if index >= len(input.Holdings) {
			return false, nil
		}
		var instrumentID uuid.UUID
		var quantity, price string
		var basis sql.NullInt64
		if err := rows.Scan(&instrumentID, &quantity, &basis, &price); err != nil {
			return false, fmt.Errorf("scan replay opening holding: %w", err)
		}
		candidate := input.Holdings[index]
		candidateQuantity, quantityErr := canonicalDecimal(candidate.Quantity, false, false, "quantity")
		candidatePrice, priceErr := canonicalDecimal(candidate.Price, false, false, "unit price")
		storedQuantity, storedQuantityErr := canonicalDecimal(quantity, false, false, "quantity")
		storedPrice, storedPriceErr := canonicalDecimal(price, false, false, "unit price")
		if quantityErr != nil || priceErr != nil || storedQuantityErr != nil || storedPriceErr != nil || candidate.InstrumentID != instrumentID || candidateQuantity != storedQuantity || candidatePrice != storedPrice {
			return false, nil
		}
		var candidateBasis *int64
		if candidate.OpeningCostBasis != "" {
			value, err := parseInvestmentMoneyMinor(candidate.OpeningCostBasis, currency)
			if err != nil {
				return false, nil
			}
			candidateBasis = &value
		}
		if (candidateBasis == nil) != !basis.Valid || candidateBasis != nil && *candidateBasis != basis.Int64 {
			return false, nil
		}
		index++
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate replay opening holdings: %w", err)
	}
	return index == len(input.Holdings), nil
}

func accountBalanceAt(ctx context.Context, queryer sqlTx, userID, accountID uuid.UUID, throughDate time.Time) (int64, error) {
	rows, err := queryer.QueryContext(ctx, `
SELECT kind,type,amount_minor FROM (
    SELECT 'transaction' AS kind,type,amount_minor,transaction_date AS event_date,created_at,0 AS kind_order
    FROM transactions WHERE user_id=$1 AND account_id=$2 AND transaction_date <= $3
    UNION ALL
    SELECT 'valuation','',value_minor,valuation_date,created_at,1
    FROM valuation_snapshots WHERE user_id=$1 AND account_id=$2 AND valuation_date <= $3
) events ORDER BY event_date,created_at,kind_order`, userID, accountID, investmentDateOnly(throughDate))
	if err != nil {
		return 0, fmt.Errorf("load conversion source events: %w", err)
	}
	defer rows.Close()
	balance := new(big.Int)
	for rows.Next() {
		var kind, transactionType string
		var amount int64
		if err := rows.Scan(&kind, &transactionType, &amount); err != nil {
			return 0, fmt.Errorf("scan conversion source event: %w", err)
		}
		if kind == "valuation" {
			balance.SetInt64(amount)
			continue
		}
		effect, err := transactionEffect(transactionType, amount)
		if err != nil {
			return 0, accountConversionError(err)
		}
		balance.Add(balance, big.NewInt(effect))
		if !balance.IsInt64() {
			return 0, accountConversionValidation("calculated source balance is outside the supported range")
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate conversion source events: %w", err)
	}
	return balance.Int64(), nil
}

func accountConversionConvertMinor(ctx context.Context, queryer sqlTx, userID uuid.UUID, amount int64, fromCurrency, toCurrency string, asOf time.Time) (int64, bool, error) {
	if fromCurrency == toCurrency {
		return amount, true, nil
	}
	var baseCurrency, rate string
	err := queryer.QueryRowContext(ctx, `
SELECT base_currency,rate::TEXT FROM exchange_rates
WHERE user_id=$1 AND ((base_currency=$2 AND quote_currency=$3) OR (base_currency=$3 AND quote_currency=$2))
  AND effective_date <= $4
ORDER BY effective_date DESC,created_at DESC,id LIMIT 1`, userID, fromCurrency, toCurrency, investmentDateOnly(asOf)).Scan(&baseCurrency, &rate)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("load conversion exchange rate: %w", err)
	}
	converted, err := convertMinorAtRate(amount, fromCurrency, toCurrency, rate, baseCurrency != fromCurrency)
	if err != nil {
		return 0, false, accountConversionError(err)
	}
	return converted, true, nil
}

func conversionPreview(prepared preparedAccountConversion) AccountConversionPreview {
	holdings := make([]AccountConversionHoldingPreview, 0, len(prepared.Holdings))
	for _, holding := range prepared.Holdings {
		var symbol *string
		if holding.Symbol.Valid {
			symbol = &holding.Symbol.String
		}
		holdings = append(holdings, AccountConversionHoldingPreview{
			InstrumentID: holding.InstrumentID, Name: holding.Name, Symbol: symbol, Quantity: holding.Quantity,
			Price: holding.Price, QuoteCurrency: holding.QuoteCurrency,
		})
	}
	return AccountConversionPreview{
		SourceAccountID: prepared.Source.ID, SourceAccountName: prepared.Source.Name, Currency: prepared.Source.Currency,
		ConversionDate: investmentDateOnly(prepared.ConversionDate), SourceBalanceMinor: fmt.Sprint(prepared.SourceBalanceMinor),
		OpeningCashMinor: fmt.Sprint(prepared.OpeningCashMinor), PositionsMinor: fmt.Sprint(prepared.PositionsMinor),
		ProjectedTotalMinor: fmt.Sprint(prepared.ProjectedTotalMinor), DifferenceMinor: fmt.Sprint(prepared.DifferenceMinor), Holdings: holdings,
	}
}

func dateOnlyUTC(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func conversionArchiveTime(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 12, 0, 0, 0, time.UTC)
}

func nullStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func nullUUIDValue(value uuid.NullUUID) any {
	if !value.Valid {
		return nil
	}
	return value.UUID
}

func accountConversionValidation(detail string) error {
	return fmt.Errorf("%w: %s", ErrAccountConversionValidation, detail)
}

func accountConversionConflict(detail string) error {
	return fmt.Errorf("%w: %s", ErrAccountConversionConflict, detail)
}

func accountConversionError(err error) error {
	if errors.Is(err, ErrInvestmentMutationValidation) || errors.Is(err, ErrLedgerValidation) {
		return accountConversionValidation(accountConversionDetail(err))
	}
	return err
}

func accountConversionDetail(err error) string {
	detail := err.Error()
	if index := strings.LastIndex(detail, ": "); index >= 0 {
		return detail[index+2:]
	}
	return detail
}
