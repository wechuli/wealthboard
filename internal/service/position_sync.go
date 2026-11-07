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

// Position snapshots are quantity_adjustment events with snapshot_quantity set, and cash
// snapshots are manual_adjustment transactions with cash_snapshot_minor set. Both are
// absolute observations, like valuations of balance accounts: their stored delta is
// recalculated whenever earlier activity changes, so a broker snapshot and the trades
// behind it are never counted twice.

// farFuture is a date after any recorded activity, for "as of now including everything".
var farFuture = time.Date(9999, time.December, 31, 0, 0, 0, 0, time.UTC)

// MaxPositionSyncRecords bounds one position, trade, or price synchronization.
const MaxPositionSyncRecords = 1000

func rebasePositionSnapshots(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) error {
	var holdings, cash bool
	if err := tx.QueryRowContext(ctx, `
SELECT EXISTS(SELECT 1 FROM position_events WHERE user_id=$1 AND account_id=$2 AND snapshot_quantity IS NOT NULL),
       EXISTS(SELECT 1 FROM transactions WHERE user_id=$1 AND account_id=$2 AND cash_snapshot_minor IS NOT NULL)`, userID, accountID).Scan(&holdings, &cash); err != nil {
		return fmt.Errorf("check position snapshots: %w", err)
	}
	if holdings {
		if err := rebaseHoldingSnapshots(ctx, tx, userID, accountID); err != nil {
			return err
		}
	}
	if cash {
		return rebaseCashSnapshots(ctx, tx, userID, accountID)
	}
	return nil
}

func rebaseHoldingSnapshots(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) error {
	// A snapshot describes the end of its day, so it follows every other event on that date.
	if _, err := tx.ExecContext(ctx, `
WITH ordered AS (
    SELECT s.id, (COALESCE((
        SELECT MAX(e.event_sequence) FROM position_events e
        WHERE e.user_id=s.user_id AND e.account_id=s.account_id AND e.trade_date=s.trade_date AND e.snapshot_quantity IS NULL
    ), 0) + ROW_NUMBER() OVER (PARTITION BY s.trade_date ORDER BY s.event_sequence, s.created_at, s.id))::INTEGER AS sequence
    FROM position_events s
    WHERE s.user_id=$1 AND s.account_id=$2 AND s.snapshot_quantity IS NOT NULL
)
UPDATE position_events p SET event_sequence=ordered.sequence
FROM ordered WHERE p.user_id=$1 AND p.id=ordered.id AND p.event_sequence<>ordered.sequence`, userID, accountID); err != nil {
		return fmt.Errorf("order position snapshots: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `
SELECT id,instrument_id,type,quantity::TEXT,COALESCE(snapshot_quantity::TEXT,''),
       COALESCE(action_ratio_numerator::TEXT,''),COALESCE(action_ratio_denominator::TEXT,'')
FROM position_events WHERE user_id=$1 AND account_id=$2
ORDER BY trade_date,event_sequence,created_at,id`, userID, accountID)
	if err != nil {
		return fmt.Errorf("load position snapshots: %w", err)
	}
	type change struct {
		id       uuid.UUID
		quantity string
	}
	changes := []change{}
	running := map[uuid.UUID]*big.Rat{}
	for rows.Next() {
		var event positionEventRow
		var snapshot string
		if err := rows.Scan(&event.id, &event.instrumentID, &event.eventType, &event.quantity, &snapshot, &event.actionRatioNumerator, &event.actionRatioDenominator); err != nil {
			rows.Close()
			return fmt.Errorf("scan position snapshot: %w", err)
		}
		quantity, ok := new(big.Rat).SetString(event.quantity)
		if !ok {
			rows.Close()
			return fmt.Errorf("parse stored position quantity")
		}
		current := cloneRat(running[event.instrumentID])
		if snapshot == "" {
			next, err := applyPositionEvent(current, event, quantity)
			if err != nil {
				rows.Close()
				return err
			}
			running[event.instrumentID] = next
			continue
		}
		target, ok := new(big.Rat).SetString(snapshot)
		if !ok {
			rows.Close()
			return fmt.Errorf("parse stored snapshot quantity")
		}
		delta := new(big.Rat).Sub(target, current)
		if delta.Cmp(quantity) != 0 {
			changes = append(changes, change{event.id, canonicalRat(delta)})
		}
		running[event.instrumentID] = target
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, change := range changes {
		// updated_at is left alone: the user didn't edit the snapshot, so rollback still treats it as imported.
		if _, err := tx.ExecContext(ctx, `UPDATE position_events SET quantity=$3::NUMERIC WHERE user_id=$1 AND id=$2`, userID, change.id, change.quantity); err != nil {
			return fmt.Errorf("rebase position snapshot: %w", err)
		}
	}
	return nil
}

func rebaseCashSnapshots(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) error {
	rows, err := tx.QueryContext(ctx, `
SELECT 'transaction',type,amount_minor,transaction_date,created_at,cash_snapshot_minor,id::TEXT FROM transactions WHERE user_id=$1 AND account_id=$2
UNION ALL
SELECT 'trade','',cash_effect_minor,trade_date,created_at,NULL,id::TEXT FROM position_events WHERE user_id=$1 AND account_id=$2 AND cash_effect_minor<>0`, userID, accountID)
	if err != nil {
		return fmt.Errorf("load cash snapshots: %w", err)
	}
	events := []balanceEvent{}
	for rows.Next() {
		var event balanceEvent
		if err := rows.Scan(&event.kind, &event.eventType, &event.amount, &event.date, &event.createdAt, &event.snapshot, &event.id); err != nil {
			rows.Close()
			return fmt.Errorf("scan cash snapshot: %w", err)
		}
		events = append(events, event)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	sortBalanceEvents(events, true)
	running := new(big.Int)
	for _, event := range events {
		switch {
		case event.snapshot.Valid:
			delta, err := checkedInt64(new(big.Int).Sub(big.NewInt(event.snapshot.Int64), running))
			if err != nil {
				return err
			}
			if delta != event.amount {
				if _, err := tx.ExecContext(ctx, `UPDATE transactions SET amount_minor=$3 WHERE user_id=$1 AND id=$2::UUID`, userID, event.id, delta); err != nil {
					return fmt.Errorf("rebase cash snapshot: %w", err)
				}
			}
			running.SetInt64(event.snapshot.Int64)
		case event.kind == "trade":
			running.Add(running, big.NewInt(event.amount))
		default:
			running.Add(running, investmentTransactionEffect(event.eventType, event.amount))
		}
	}
	return nil
}

// holdingsOnDate replays an account's position events up to and including date.
func holdingsOnDate(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID, date time.Time) (map[uuid.UUID]*big.Rat, error) {
	events, err := loadPositionEvents(ctx, tx, userID, &accountID)
	if err != nil {
		return nil, err
	}
	holdings := map[uuid.UUID]*big.Rat{}
	for _, event := range events {
		if investmentDateOnly(event.tradeDate) > investmentDateOnly(date) {
			continue
		}
		quantity, ok := new(big.Rat).SetString(event.quantity)
		if !ok {
			return nil, fmt.Errorf("parse stored position quantity")
		}
		next, err := applyPositionEvent(holdings[event.instrumentID], event, quantity)
		if err != nil {
			return nil, err
		}
		holdings[event.instrumentID] = next
	}
	return holdings, nil
}

// InstrumentRef identifies an instrument by stable identifiers. Resolution tries the
// Wealthboard ID, then the broker or source ID (externalId), then the ISIN, then the
// symbol on an exchange (MIC); a bare symbol matches only when exactly one instrument has it.
type InstrumentRef struct {
	InstrumentID  *uuid.UUID `json:"instrumentId,omitempty"`
	ExternalID    string     `json:"externalId,omitempty"`
	ISIN          string     `json:"isin,omitempty"`
	Symbol        string     `json:"symbol,omitempty"`
	ExchangeMIC   string     `json:"exchangeMic,omitempty"`
	Name          string     `json:"name,omitempty"`
	AssetType     string     `json:"assetType,omitempty"`
	QuoteCurrency string     `json:"quoteCurrency,omitempty"`
}

type resolvedInstrument struct {
	ID            uuid.UUID
	Name, Symbol  string
	QuoteCurrency string
	AssetType     string
	Created       bool
}

// rowError is a per-record problem reported in a result row rather than failing the call.
type rowError struct{ code, message string }

func (err rowError) Error() string { return err.message }

func rowProblem(err error) (rowError, bool) {
	var problem rowError
	if errors.As(err, &problem) {
		return problem, true
	}
	if detail, ok := PublicDetail(err); ok {
		return rowError{"invalid", detail}, true
	}
	for _, sentinel := range []error{ErrLedgerValidation, ErrLedgerConflict} {
		if errors.Is(err, sentinel) {
			return rowError{"invalid", strings.TrimPrefix(err.Error(), sentinel.Error()+": ")}, true
		}
	}
	switch {
	case errors.Is(err, ErrInvestmentMutationNotFound), errors.Is(err, ErrLedgerNotFound):
		return rowError{"not_found", "A referenced account or instrument was not found or is archived."}, true
	case errors.Is(err, ErrInvestmentMutationConflict):
		return rowError{"conflict", "This record conflicts with an existing one."}, true
	case errors.Is(err, ErrInvestmentMutationValidation):
		return rowError{"invalid", "The record is invalid."}, true
	}
	return rowError{}, false
}

const instrumentColumns = `SELECT id,name,COALESCE(symbol,''),quote_currency,asset_type,archived_at IS NOT NULL,identifier_type,COALESCE(identifier,'') FROM investment_instruments`

func (service *InvestmentMutations) resolveInstrument(ctx context.Context, tx *sql.Tx, userID uuid.UUID, ref InstrumentRef, create bool) (resolvedInstrument, error) {
	isin := strings.ToUpper(strings.TrimSpace(ref.ISIN))
	symbol := strings.ToUpper(strings.TrimSpace(ref.Symbol))
	mic := strings.ToUpper(strings.TrimSpace(ref.ExchangeMIC))
	externalID := strings.TrimSpace(ref.ExternalID)
	lookups := []struct {
		where string
		args  []any
	}{}
	if ref.InstrumentID != nil {
		lookups = append(lookups, struct {
			where string
			args  []any
		}{`id=$2`, []any{*ref.InstrumentID}})
	}
	if externalID != "" {
		lookups = append(lookups, struct {
			where string
			args  []any
		}{`external_id=$2`, []any{externalID}})
	}
	if isin != "" {
		lookups = append(lookups, struct {
			where string
			args  []any
		}{`identifier_type='isin' AND identifier=$2`, []any{isin}})
	}
	if symbol != "" && mic != "" {
		lookups = append(lookups, struct {
			where string
			args  []any
		}{`exchange_mic=$3 AND (symbol=$2 OR (identifier_type='ticker_exchange' AND identifier=$2))`, []any{symbol, mic}})
	}
	if symbol != "" && mic == "" {
		lookups = append(lookups, struct {
			where string
			args  []any
		}{`(symbol=$2 OR (identifier_type IN ('ticker_exchange','custom') AND identifier=$2))`, []any{symbol}})
	}
	if len(lookups) == 0 {
		return resolvedInstrument{}, rowError{"instrument_required", "Identify the instrument with instrumentId, externalId, isin, or symbol."}
	}
	for _, lookup := range lookups {
		rows, err := tx.QueryContext(ctx, instrumentColumns+` WHERE user_id=$1 AND `+lookup.where+` ORDER BY archived_at NULLS FIRST,created_at,id LIMIT 3`, append([]any{userID}, lookup.args...)...)
		if err != nil {
			return resolvedInstrument{}, fmt.Errorf("resolve instrument: %w", err)
		}
		matches := []resolvedInstrument{}
		archived := 0
		for rows.Next() {
			var match resolvedInstrument
			var isArchived bool
			var identifierType, identifier string
			if err := rows.Scan(&match.ID, &match.Name, &match.Symbol, &match.QuoteCurrency, &match.AssetType, &isArchived, &identifierType, &identifier); err != nil {
				rows.Close()
				return resolvedInstrument{}, fmt.Errorf("scan instrument: %w", err)
			}
			// A symbol shared by listings must not stand in for a different ISIN.
			if isin != "" && identifierType == "isin" && identifier != isin {
				continue
			}
			if isArchived {
				archived++
				continue
			}
			matches = append(matches, match)
		}
		if err := rows.Close(); err != nil {
			return resolvedInstrument{}, err
		}
		switch {
		case len(matches) == 1:
			return matches[0], nil
		case len(matches) > 1:
			return resolvedInstrument{}, rowError{"instrument_ambiguous", "More than one instrument matches; add isin, exchangeMic, or instrumentId."}
		case archived > 0:
			return resolvedInstrument{}, rowError{"instrument_archived", "The matching instrument is archived; restore it in Wealthboard first."}
		}
	}
	if !create {
		return resolvedInstrument{}, rowError{"instrument_not_found", "No instrument matches. Create it with create_instrument, or pass createMissingInstruments with name, assetType, and quoteCurrency."}
	}
	input := InstrumentMutationInput{ExternalID: externalID, Name: ref.Name, Symbol: symbol, AssetType: strings.ToLower(strings.TrimSpace(ref.AssetType)), QuoteCurrency: ref.QuoteCurrency}
	switch {
	case isin != "":
		input.IdentifierType, input.Identifier, input.ExchangeMIC = "isin", isin, mic
	case symbol != "" && mic != "":
		input.IdentifierType, input.Identifier, input.ExchangeMIC = "ticker_exchange", symbol, mic
	case externalID != "":
		input.IdentifierType, input.Identifier = "custom", externalID
	default:
		return resolvedInstrument{}, rowError{"instrument_identifier_required", "To create an instrument, give an isin, a symbol with exchangeMic, or a broker externalId; a bare ticker is ambiguous."}
	}
	id, err := service.createInstrumentTx(ctx, tx, userID, input)
	if err != nil {
		return resolvedInstrument{}, err
	}
	created := resolvedInstrument{ID: id, Name: strings.TrimSpace(input.Name), Symbol: symbol, QuoteCurrency: domain.NormalizeCurrency(input.QuoteCurrency), AssetType: input.AssetType, Created: true}
	return created, nil
}

type PositionSnapshotInput struct {
	Instrument InstrumentRef `json:"instrument"`
	Quantity   string        `json:"quantity"`
	UnitPrice  string        `json:"unitPrice,omitempty"`
	Currency   string        `json:"currency,omitempty"`
}

type PositionSyncInput struct {
	AccountID                uuid.UUID               `json:"accountId"`
	AsOf                     time.Time               `json:"asOf"`
	Source                   string                  `json:"source"`
	IdempotencyKey           *uuid.UUID              `json:"-"`
	DryRun                   bool                    `json:"-"`
	Positions                []PositionSnapshotInput `json:"positions"`
	Cash                     map[string]string       `json:"cash"`
	CloseMissing             bool                    `json:"closeMissing"`
	CreateMissingInstruments bool                    `json:"createMissingInstruments"`
}

type PositionSyncRow struct {
	Index            int    `json:"index"`
	InstrumentID     string `json:"instrumentId,omitempty"`
	Name             string `json:"name,omitempty"`
	Symbol           string `json:"symbol,omitempty"`
	Status           string `json:"status"`
	Code             string `json:"code"`
	Message          string `json:"message"`
	PreviousQuantity string `json:"previousQuantity,omitempty"`
	Quantity         string `json:"quantity,omitempty"`
	PriceRecorded    bool   `json:"priceRecorded"`
	quantity         *big.Rat
	price            string
	instrument       resolvedInstrument
}

type CashSyncRow struct {
	Currency      string `json:"currency"`
	PreviousMinor int64  `json:"previousMinor"`
	TargetMinor   int64  `json:"targetMinor"`
	Status        string `json:"status"`
}

type PositionSyncResult struct {
	ImportID                *uuid.UUID        `json:"importId,omitempty"`
	Status                  string            `json:"status"`
	Hash                    string            `json:"hash"`
	AccountID               uuid.UUID         `json:"accountId"`
	AccountName             string            `json:"accountName"`
	Currency                string            `json:"currency"`
	AsOf                    string            `json:"asOf"`
	Positions               []PositionSyncRow `json:"positions"`
	Cash                    *CashSyncRow      `json:"cash,omitempty"`
	AccountValueBeforeMinor int64             `json:"accountValueBeforeMinor"`
	AccountValueAfterMinor  int64             `json:"accountValueAfterMinor"`
	InstrumentsCreated      int               `json:"instrumentsCreated"`
	PricesRecorded          int               `json:"pricesRecorded"`
	ReplacedSnapshots       int               `json:"replacedSnapshots"`
	Warnings                []string          `json:"warnings"`
}

type positionAccount struct {
	Name, Currency string
	Value          int64
}

func lockPositionAccount(ctx context.Context, tx *sql.Tx, userID, accountID uuid.UUID) (positionAccount, error) {
	var account positionAccount
	var trackingMode string
	var archived bool
	err := tx.QueryRowContext(ctx, `SELECT name,currency,tracking_mode,current_value_minor,archived_at IS NOT NULL FROM accounts WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, accountID).
		Scan(&account.Name, &account.Currency, &trackingMode, &account.Value, &archived)
	if errors.Is(err, sql.ErrNoRows) {
		return positionAccount{}, ErrLedgerNotFound
	}
	if err != nil {
		return positionAccount{}, fmt.Errorf("load position account: %w", err)
	}
	if trackingMode != "positions" {
		return positionAccount{}, validation("this account tracks a balance, not positions; record a valuation instead")
	}
	if archived {
		return positionAccount{}, validation("this account is archived; restore it before syncing")
	}
	return account, nil
}

// SyncPositions records a broker's holdings and cash on asOf as absolute snapshots. It
// creates no trades: earlier activity is reconciled to the reported quantities, and later
// activity still applies on top. A snapshot older than an existing one for the same
// instrument is kept as history and doesn't change current holdings.
func (service *InvestmentMutations) SyncPositions(ctx context.Context, userID uuid.UUID, input PositionSyncInput) (PositionSyncResult, error) {
	if len(input.Positions) > MaxPositionSyncRecords {
		return PositionSyncResult{}, validation(fmt.Sprintf("send at most %d positions", MaxPositionSyncRecords))
	}
	if len(input.Positions) == 0 && len(input.Cash) == 0 && !input.CloseMissing {
		return PositionSyncResult{}, validation("send positions, cash, or closeMissing")
	}
	source, err := validImportSource(input.Source)
	if err != nil {
		return PositionSyncResult{}, err
	}
	input.Source = source
	hash, err := requestHash(input)
	if err != nil {
		return PositionSyncResult{}, err
	}
	if err := service.validateDate(ctx, service.db, userID, input.AsOf); err != nil {
		return PositionSyncResult{}, err
	}
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return PositionSyncResult{}, fmt.Errorf("begin position sync: %w", err)
	}
	defer tx.Rollback()
	if !input.DryRun {
		if id, summary, err := replayedImport(ctx, tx, userID, input.IdempotencyKey, hash); err != nil {
			return PositionSyncResult{}, err
		} else if id != nil {
			var result PositionSyncResult
			if err := decodeStoredSummary(summary, &result); err != nil {
				return PositionSyncResult{}, err
			}
			result.ImportID, result.Status = id, "replayed"
			result.Warnings = append(result.Warnings, "This idempotency key was already used for the same sync; nothing new was written.")
			return result, nil
		}
	}
	account, err := lockPositionAccount(ctx, tx, userID, input.AccountID)
	if err != nil {
		return PositionSyncResult{}, err
	}
	asOf := ledgerDateOnly(input.AsOf)
	result := PositionSyncResult{Hash: hash, AccountID: input.AccountID, AccountName: account.Name, Currency: account.Currency,
		AsOf: asOf.Format(time.DateOnly), AccountValueBeforeMinor: account.Value, Positions: []PositionSyncRow{}, Warnings: []string{}}
	before, err := holdingsOnDate(ctx, tx, userID, input.AccountID, asOf)
	if err != nil {
		return PositionSyncResult{}, err
	}
	rejected := false
	seen := map[uuid.UUID]bool{}
	for index, position := range input.Positions {
		row := PositionSyncRow{Index: index + 1, Status: "pending"}
		fail := func(problem rowError) {
			row.Status, row.Code, row.Message = "rejected", problem.code, problem.message
			rejected = true
		}
		quantity, quantityErr := canonicalDecimal(position.Quantity, false, true, "quantity")
		instrument, resolveErr := service.resolveInstrument(ctx, tx, userID, position.Instrument, input.CreateMissingInstruments)
		switch {
		case quantityErr != nil:
			fail(rowError{"invalid_quantity", "quantity must be a plain decimal that is zero or more."})
		case resolveErr != nil:
			problem, ok := rowProblem(resolveErr)
			if !ok {
				return PositionSyncResult{}, resolveErr
			}
			fail(problem)
		case seen[instrument.ID]:
			fail(rowError{"duplicate_in_request", "This instrument appears more than once."})
		default:
			seen[instrument.ID] = true
			row.instrument, row.InstrumentID, row.Name, row.Symbol = instrument, instrument.ID.String(), instrument.Name, instrument.Symbol
			row.quantity, _ = new(big.Rat).SetString(quantity)
			row.Quantity = quantity
			if instrument.Created {
				result.InstrumentsCreated++
			}
			if strings.TrimSpace(position.UnitPrice) != "" {
				price, err := canonicalDecimal(position.UnitPrice, false, false, "unit price")
				currency := domain.NormalizeCurrency(position.Currency)
				switch {
				case err != nil:
					fail(rowError{"invalid_price", "unitPrice must be a plain decimal greater than zero."})
				case currency != "" && currency != instrument.QuoteCurrency:
					fail(rowError{"currency_mismatch", "The price currency differs from the instrument's quote currency " + instrument.QuoteCurrency + "."})
				default:
					row.price = price
				}
			}
		}
		result.Positions = append(result.Positions, row)
	}
	for currency := range input.Cash {
		if domain.NormalizeCurrency(currency) != account.Currency {
			result.Status = "rejected"
			result.Warnings = append(result.Warnings, "Cash can only be synced in the account currency "+account.Currency+"; this account doesn't hold separate currency balances.")
			return result, nil
		}
	}
	if rejected {
		result.Status = "rejected"
		result.Warnings = append(result.Warnings, "Nothing was synced because some positions were rejected.")
		return result, nil
	}
	batchID, err := insertImportBatch(ctx, tx, userID, input.AccountID, "positions", source, committedKey(input.IdempotencyKey, input.DryRun), hash, service.now().UTC())
	if err != nil {
		return PositionSyncResult{}, err
	}
	priced := orderedIDs{}
	for index := range result.Positions {
		row := &result.Positions[index]
		previous := cloneRat(before[row.instrument.ID])
		row.PreviousQuantity = canonicalRat(previous)
		if err := service.writeHoldingSnapshot(ctx, tx, userID, input.AccountID, batchID, row, asOf, source, previous, &result); err != nil {
			return PositionSyncResult{}, err
		}
		if row.price != "" {
			priceSource := source
			if priceSource == "" {
				priceSource = "position_sync"
			}
			if _, err := service.upsertSecurityPriceTx(ctx, tx, userID, SecurityPriceMutationInput{InstrumentID: row.instrument.ID, Price: row.price, EffectiveDate: asOf, Source: priceSource}, row.price); err != nil {
				return PositionSyncResult{}, err
			}
			row.PriceRecorded = true
			result.PricesRecorded++
			priced.add(row.instrument.ID)
		}
	}
	if input.CloseMissing {
		missing := make([]uuid.UUID, 0)
		for instrumentID, quantity := range before {
			if !seen[instrumentID] && quantity.Sign() != 0 {
				missing = append(missing, instrumentID)
			}
		}
		sort.Slice(missing, func(left, right int) bool { return missing[left].String() < missing[right].String() })
		for _, instrumentID := range missing {
			var instrument resolvedInstrument
			if err := tx.QueryRowContext(ctx, `SELECT id,name,COALESCE(symbol,''),quote_currency FROM investment_instruments WHERE user_id=$1 AND id=$2`, userID, instrumentID).
				Scan(&instrument.ID, &instrument.Name, &instrument.Symbol, &instrument.QuoteCurrency); err != nil {
				return PositionSyncResult{}, fmt.Errorf("load closed instrument: %w", err)
			}
			row := PositionSyncRow{Index: 0, InstrumentID: instrumentID.String(), Name: instrument.Name, Symbol: instrument.Symbol,
				PreviousQuantity: canonicalRat(before[instrumentID]), Quantity: "0", quantity: new(big.Rat), instrument: instrument}
			if err := service.writeHoldingSnapshot(ctx, tx, userID, input.AccountID, batchID, &row, asOf, source, before[instrumentID], &result); err != nil {
				return PositionSyncResult{}, err
			}
			if row.Status == "updated" {
				row.Status, row.Code, row.Message = "closed", "closed", "Not in the snapshot, so recorded as no longer held."
			}
			result.Positions = append(result.Positions, row)
		}
	}
	for _, amountText := range input.Cash {
		target, err := parseInvestmentMoneyMinor(amountText, account.Currency)
		if err != nil {
			return PositionSyncResult{}, validation("cash amounts must be plain decimals in the account currency")
		}
		previous, err := balanceOnDate(ctx, tx, userID, input.AccountID, "positions", asOf, nil)
		if err != nil {
			return PositionSyncResult{}, err
		}
		cash := &CashSyncRow{Currency: account.Currency, PreviousMinor: previous, TargetMinor: target, Status: "updated"}
		var existingID uuid.UUID
		var existingTarget int64
		err = tx.QueryRowContext(ctx, `SELECT id,cash_snapshot_minor FROM transactions WHERE user_id=$1 AND account_id=$2 AND transaction_date=$3 AND cash_snapshot_minor IS NOT NULL`,
			userID, input.AccountID, asOf).Scan(&existingID, &existingTarget)
		switch {
		case err == nil && existingTarget == target:
			cash.Status = "unchanged"
		case err == nil:
			if _, err := tx.ExecContext(ctx, `DELETE FROM transactions WHERE user_id=$1 AND id=$2`, userID, existingID); err != nil {
				return PositionSyncResult{}, fmt.Errorf("replace cash snapshot: %w", err)
			}
			result.ReplacedSnapshots++
		case !errors.Is(err, sql.ErrNoRows):
			return PositionSyncResult{}, fmt.Errorf("load cash snapshot: %w", err)
		}
		if cash.Status != "unchanged" {
			description := "Cash balance snapshot"
			if source != "" {
				description += " from " + source
			}
			now := service.now().UTC()
			if _, err := tx.ExecContext(ctx, `
INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,description,cash_snapshot_minor,import_batch_id,created_at,updated_at)
VALUES ($1,$2,$3,'manual_adjustment',0,$4,$5,$6,$7,$8,$9,$9)`, uuid.New(), userID, input.AccountID, account.Currency, asOf, description, target, batchID, now); err != nil {
				return PositionSyncResult{}, fmt.Errorf("insert cash snapshot: %w", err)
			}
			if previous == target {
				cash.Status = "confirmed"
			}
		}
		var later bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM transactions WHERE user_id=$1 AND account_id=$2 AND transaction_date>$3 AND cash_snapshot_minor IS NOT NULL)`, userID, input.AccountID, asOf).Scan(&later); err != nil {
			return PositionSyncResult{}, fmt.Errorf("check later cash snapshots: %w", err)
		}
		if later {
			cash.Status = "historical"
			result.Warnings = append(result.Warnings, "A newer cash snapshot exists, so current cash is unchanged; this one is kept as history.")
		}
		result.Cash = cash
	}
	if err := validateAccountPositionReplay(ctx, tx, userID, input.AccountID); err != nil {
		return PositionSyncResult{}, err
	}
	if err := service.recalculatePositionAccount(ctx, tx, userID, input.AccountID); err != nil {
		return PositionSyncResult{}, err
	}
	for _, instrumentID := range priced {
		if err := service.recalculateInstrumentAccounts(ctx, tx, userID, instrumentID); err != nil {
			return PositionSyncResult{}, err
		}
	}
	if err := tx.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, userID, input.AccountID).Scan(&result.AccountValueAfterMinor); err != nil {
		return PositionSyncResult{}, fmt.Errorf("load synced account value: %w", err)
	}
	if result.ReplacedSnapshots > 0 {
		result.Warnings = append(result.Warnings, fmt.Sprintf("%d earlier snapshots for the same date were replaced.", result.ReplacedSnapshots))
	}
	if input.DryRun {
		result.Status = "preview"
		return result, nil
	}
	result.Status = "completed"
	kept, err := finishImportBatch(ctx, tx, userID, batchID, result, nil, nil)
	if err != nil {
		return PositionSyncResult{}, err
	}
	if kept {
		result.ImportID = &batchID
	} else {
		result.Status = "unchanged"
	}
	if err := tx.Commit(); err != nil {
		return PositionSyncResult{}, mutationDatabaseError(err, "commit position sync")
	}
	return result, nil
}

// committedKey keeps a dry run's rolled-back batch from claiming, or colliding with, the
// idempotency key of a real import.
func committedKey(key *uuid.UUID, dryRun bool) *uuid.UUID {
	if dryRun {
		return nil
	}
	return key
}

func (service *InvestmentMutations) writeHoldingSnapshot(ctx context.Context, tx *sql.Tx, userID, accountID, batchID uuid.UUID, row *PositionSyncRow, asOf time.Time, source string, previous *big.Rat, result *PositionSyncResult) error {
	var existingID uuid.UUID
	var existingTarget string
	err := tx.QueryRowContext(ctx, `
SELECT id,snapshot_quantity::TEXT FROM position_events
WHERE user_id=$1 AND account_id=$2 AND instrument_id=$3 AND trade_date=$4 AND snapshot_quantity IS NOT NULL`,
		userID, accountID, row.instrument.ID, asOf).Scan(&existingID, &existingTarget)
	unchanged := false
	switch {
	case err == nil:
		stored, _ := new(big.Rat).SetString(existingTarget)
		if stored != nil && stored.Cmp(row.quantity) == 0 {
			unchanged = true
		} else {
			if _, err := tx.ExecContext(ctx, `DELETE FROM position_events WHERE user_id=$1 AND id=$2`, userID, existingID); err != nil {
				return fmt.Errorf("replace position snapshot: %w", err)
			}
			result.ReplacedSnapshots++
		}
	case !errors.Is(err, sql.ErrNoRows):
		return fmt.Errorf("load position snapshot: %w", err)
	}
	row.Status, row.Code, row.Message = "updated", "updated", "Holding set from the snapshot without recording a trade."
	if cloneRat(previous).Cmp(row.quantity) == 0 {
		row.Status, row.Code, row.Message = "confirmed", "confirmed", "Wealthboard already had this quantity; the snapshot confirms it."
	}
	if unchanged {
		row.Status, row.Code, row.Message = "unchanged", "unchanged", "The same snapshot is already recorded for this date."
	} else {
		description := "Position snapshot"
		if source != "" {
			description += " from " + source
		}
		now := service.now().UTC()
		if _, err := tx.ExecContext(ctx, `
INSERT INTO position_events (
    id,user_id,account_id,instrument_id,type,quantity,trade_currency,cash_effect_minor,trade_date,
    event_sequence,description,snapshot_quantity,import_batch_id,created_at,updated_at
) VALUES (
    $1,$2,$3,$4,'quantity_adjustment',0,$5,0,$6,
    (SELECT COALESCE(MAX(event_sequence),0)+1 FROM position_events WHERE user_id=$2 AND account_id=$3 AND trade_date=$6),
    $7,$8::NUMERIC,$9,$10,$10
)`, uuid.New(), userID, accountID, row.instrument.ID, row.instrument.QuoteCurrency, asOf, description, canonicalRat(row.quantity), batchID, now); err != nil {
			return mutationDatabaseError(err, "insert position snapshot")
		}
	}
	var later sql.NullTime
	if err := tx.QueryRowContext(ctx, `
SELECT MAX(trade_date) FROM position_events
WHERE user_id=$1 AND account_id=$2 AND instrument_id=$3 AND trade_date>$4 AND snapshot_quantity IS NOT NULL`,
		userID, accountID, row.instrument.ID, asOf).Scan(&later); err != nil {
		return fmt.Errorf("check later snapshots: %w", err)
	}
	if later.Valid {
		row.Status, row.Code = "historical", "historical"
		row.Message = "A newer snapshot from " + later.Time.Format(time.DateOnly) + " sets the current holding; this one is kept as history."
		result.Warnings = append(result.Warnings, "Some positions have newer snapshots, so their current holdings didn't change.")
	}
	return nil
}

type TradeInput struct {
	Instrument         InstrumentRef `json:"instrument"`
	ExternalID         string        `json:"externalId,omitempty"`
	TradeDate          string        `json:"tradeDate"`
	SettlementDate     string        `json:"settlementDate,omitempty"`
	Side               string        `json:"side"`
	Quantity           string        `json:"quantity"`
	Price              string        `json:"price"`
	Currency           string        `json:"currency,omitempty"`
	Commission         string        `json:"commission,omitempty"`
	CommissionCurrency string        `json:"commissionCurrency,omitempty"`
	OtherFees          string        `json:"otherFees,omitempty"`
	NetCash            string        `json:"netCash,omitempty"`
	FxRate             string        `json:"fxRate,omitempty"`
	Description        string        `json:"description,omitempty"`
}

type TradeImportInput struct {
	AccountID                uuid.UUID    `json:"accountId"`
	Source                   string       `json:"source"`
	IdempotencyKey           *uuid.UUID   `json:"-"`
	DryRun                   bool         `json:"-"`
	AllowPartial             bool         `json:"allowPartial"`
	CreateMissingInstruments bool         `json:"createMissingInstruments"`
	Trades                   []TradeInput `json:"trades"`
}

type TradeImportRow struct {
	Index          int        `json:"index"`
	ExternalID     string     `json:"externalId,omitempty"`
	TradeDate      string     `json:"tradeDate"`
	Side           string     `json:"side"`
	Quantity       string     `json:"quantity"`
	Price          string     `json:"price"`
	InstrumentID   string     `json:"instrumentId,omitempty"`
	Symbol         string     `json:"symbol,omitempty"`
	Status         string     `json:"status"`
	Code           string     `json:"code"`
	Message        string     `json:"message"`
	EventID        *uuid.UUID `json:"eventId,omitempty"`
	MatchedEventID *uuid.UUID `json:"matchedEventId,omitempty"`
	event          *PositionEventMutationInput
}

type TradeImportResult struct {
	ImportID                *uuid.UUID       `json:"importId,omitempty"`
	Status                  string           `json:"status"`
	Hash                    string           `json:"hash"`
	AccountID               uuid.UUID        `json:"accountId"`
	AccountName             string           `json:"accountName"`
	Currency                string           `json:"currency"`
	Created                 int              `json:"created"`
	Skipped                 int              `json:"skipped"`
	Duplicates              int              `json:"duplicates"`
	Conflicts               int              `json:"conflicts"`
	Rejected                int              `json:"rejected"`
	InstrumentsCreated      int              `json:"instrumentsCreated"`
	AccountValueBeforeMinor int64            `json:"accountValueBeforeMinor"`
	AccountValueAfterMinor  int64            `json:"accountValueAfterMinor"`
	CashBeforeMinor         int64            `json:"cashBeforeMinor"`
	CashAfterMinor          int64            `json:"cashAfterMinor"`
	Warnings                []string         `json:"warnings"`
	Rows                    []TradeImportRow `json:"rows"`
}

// ImportTrades records executed buys and sells. Each trade is identified by its broker ID
// (or a derived ID from date, side, instrument, quantity, and price), so importing the same
// trades again skips them and a changed trade with the same ID is reported, never overwritten.
func (service *InvestmentMutations) ImportTrades(ctx context.Context, userID uuid.UUID, input TradeImportInput) (TradeImportResult, error) {
	if len(input.Trades) == 0 || len(input.Trades) > MaxPositionSyncRecords {
		return TradeImportResult{}, validation(fmt.Sprintf("send between 1 and %d trades", MaxPositionSyncRecords))
	}
	source, err := validImportSource(input.Source)
	if err != nil {
		return TradeImportResult{}, err
	}
	input.Source = source
	hash, err := requestHash(input)
	if err != nil {
		return TradeImportResult{}, err
	}
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return TradeImportResult{}, fmt.Errorf("begin trade import: %w", err)
	}
	defer tx.Rollback()
	if !input.DryRun {
		if id, summary, err := replayedImport(ctx, tx, userID, input.IdempotencyKey, hash); err != nil {
			return TradeImportResult{}, err
		} else if id != nil {
			var result TradeImportResult
			if err := decodeStoredSummary(summary, &result); err != nil {
				return TradeImportResult{}, err
			}
			result.ImportID, result.Status, result.Rows = id, "replayed", []TradeImportRow{}
			result.Warnings = append(result.Warnings, "This idempotency key was already used for the same import; nothing new was written.")
			return result, nil
		}
	}
	account, err := lockPositionAccount(ctx, tx, userID, input.AccountID)
	if err != nil {
		return TradeImportResult{}, err
	}
	result := TradeImportResult{Hash: hash, AccountID: input.AccountID, AccountName: account.Name, Currency: account.Currency,
		AccountValueBeforeMinor: account.Value, Rows: make([]TradeImportRow, len(input.Trades)), Warnings: []string{}}
	today := farFuture
	if result.CashBeforeMinor, err = balanceOnDate(ctx, tx, userID, input.AccountID, "positions", today, nil); err != nil {
		return TradeImportResult{}, err
	}
	batchID, err := insertImportBatch(ctx, tx, userID, input.AccountID, "trades", source, committedKey(input.IdempotencyKey, input.DryRun), hash, service.now().UTC())
	if err != nil {
		return TradeImportResult{}, err
	}
	derived := map[string]int{}
	ids := map[string]int{}
	for index, trade := range input.Trades {
		row := &result.Rows[index]
		row.Index, row.Side, row.TradeDate = index+1, strings.ToLower(strings.TrimSpace(trade.Side)), strings.TrimSpace(trade.TradeDate)
		row.ExternalID, row.Quantity, row.Price = strings.TrimSpace(trade.ExternalID), strings.TrimSpace(trade.Quantity), strings.TrimSpace(trade.Price)
		event, problem, err := service.prepareTrade(ctx, tx, userID, input, trade, row)
		if err != nil {
			return TradeImportResult{}, err
		}
		if problem != nil {
			row.Status, row.Code, row.Message = "rejected", problem.code, problem.message
			continue
		}
		if row.ExternalID == "" {
			base := fmt.Sprintf("derived-trade-%s-%s-%s-%s-%s", row.TradeDate, row.Side, event.InstrumentID, row.Quantity, row.Price)
			derived[base]++
			row.ExternalID = base
			if derived[base] > 1 {
				row.ExternalID = fmt.Sprintf("%s-%d", base, derived[base])
			}
		}
		event.ExternalID = row.ExternalID
		ids[row.ExternalID]++
		row.event = event
		row.Status, row.Code, row.Message = "create", "ready", "Ready to record."
	}
	for index := range result.Rows {
		row := &result.Rows[index]
		if row.event == nil {
			continue
		}
		if ids[row.ExternalID] > 1 {
			row.Status, row.Code, row.Message, row.event = "rejected", "duplicate_in_request", "This externalId appears more than once in the request.", nil
			continue
		}
		var id, instrumentID uuid.UUID
		var eventType, quantity, price string
		var date time.Time
		err := tx.QueryRowContext(ctx, `
SELECT id,instrument_id,type,quantity::TEXT,COALESCE(unit_price::TEXT,''),trade_date FROM position_events
WHERE user_id=$1 AND account_id=$2 AND external_id=$3`, userID, input.AccountID, row.ExternalID).Scan(&id, &instrumentID, &eventType, &quantity, &price, &date)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return TradeImportResult{}, fmt.Errorf("match trade external ID: %w", err)
		}
		row.MatchedEventID = &id
		if instrumentID == row.event.InstrumentID && eventType == row.event.Type && equalDecimals(quantity, row.event.Quantity) && equalDecimals(price, row.event.UnitPrice) && investmentDateOnly(date) == investmentDateOnly(row.event.TradeDate) {
			row.Status, row.Code, row.Message = "duplicate", "duplicate", "Already recorded with this ID."
		} else {
			row.Status, row.Code, row.Message = "conflict", "conflicting_external_id", "This ID belongs to a trade with different details. Existing trades are never overwritten."
		}
		row.event = nil
	}
	// Record in date order so a sale never precedes the purchase it closes.
	order := []int{}
	for index, row := range result.Rows {
		if row.event != nil {
			order = append(order, index)
		}
	}
	sort.SliceStable(order, func(left, right int) bool {
		return investmentDateOnly(result.Rows[order[left]].event.TradeDate) < investmentDateOnly(result.Rows[order[right]].event.TradeDate)
	})
	for _, index := range order {
		row := &result.Rows[index]
		row.event.ImportBatchID = batchID
		if _, err := tx.ExecContext(ctx, `SAVEPOINT trade_row`); err != nil {
			return TradeImportResult{}, fmt.Errorf("savepoint trade: %w", err)
		}
		id, err := service.savePositionEventTx(ctx, tx, userID, uuid.Nil, *row.event)
		if err != nil {
			problem, ok := rowProblem(err)
			if !ok {
				return TradeImportResult{}, err
			}
			if _, rollbackErr := tx.ExecContext(ctx, `ROLLBACK TO SAVEPOINT trade_row`); rollbackErr != nil {
				return TradeImportResult{}, fmt.Errorf("roll back trade: %w", rollbackErr)
			}
			row.Status, row.Code, row.Message, row.event = "rejected", problem.code, problem.message, nil
			continue
		}
		if _, err := tx.ExecContext(ctx, `RELEASE SAVEPOINT trade_row`); err != nil {
			return TradeImportResult{}, fmt.Errorf("release trade savepoint: %w", err)
		}
		row.Status, row.Code, row.Message, row.EventID = "created", "created", "Trade recorded.", &id
	}
	for _, row := range result.Rows {
		switch row.Status {
		case "created":
			result.Created++
		case "duplicate":
			result.Duplicates++
		case "conflict":
			result.Conflicts++
		case "rejected":
			result.Rejected++
		}
	}
	result.Skipped = result.Duplicates
	if (result.Rejected > 0 || result.Conflicts > 0) && !input.AllowPartial {
		for index := range result.Rows {
			if result.Rows[index].Status == "created" {
				result.Rows[index].Status, result.Rows[index].Code, result.Rows[index].Message, result.Rows[index].EventID = "not_imported", "not_imported", "Not imported because other trades failed.", nil
			}
		}
		result.Created, result.Status = 0, "rejected"
		result.AccountValueAfterMinor, result.CashAfterMinor = result.AccountValueBeforeMinor, result.CashBeforeMinor
		result.Warnings = append(result.Warnings, "Nothing was imported because some trades were rejected or conflict with existing records. Fix them, or resend with allowPartial.")
		return result, nil
	}
	if err := service.recalculatePositionAccount(ctx, tx, userID, input.AccountID); err != nil {
		return TradeImportResult{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, userID, input.AccountID).Scan(&result.AccountValueAfterMinor); err != nil {
		return TradeImportResult{}, fmt.Errorf("load account value: %w", err)
	}
	if result.CashAfterMinor, err = balanceOnDate(ctx, tx, userID, input.AccountID, "positions", today, nil); err != nil {
		return TradeImportResult{}, err
	}
	if input.DryRun {
		for index := range result.Rows {
			if result.Rows[index].Status == "created" {
				result.Rows[index].Status, result.Rows[index].Code, result.Rows[index].EventID = "create", "ready", nil
				result.Rows[index].Message = "Ready to record."
			}
		}
		result.Status = "preview"
		return result, nil
	}
	result.Status = "completed"
	summary := result
	summary.Rows = nil
	kept, err := finishImportBatch(ctx, tx, userID, batchID, summary, nil, nil)
	if err != nil {
		return TradeImportResult{}, err
	}
	if kept {
		result.ImportID = &batchID
	} else {
		result.Status = "unchanged"
	}
	if err := tx.Commit(); err != nil {
		return TradeImportResult{}, mutationDatabaseError(err, "commit trade import")
	}
	return result, nil
}

func (service *InvestmentMutations) prepareTrade(ctx context.Context, tx *sql.Tx, userID uuid.UUID, input TradeImportInput, trade TradeInput, row *TradeImportRow) (*PositionEventMutationInput, *rowError, error) {
	if row.Side != "buy" && row.Side != "sell" {
		return nil, &rowError{"invalid_side", "side must be buy or sell."}, nil
	}
	date, err := time.Parse(time.DateOnly, row.TradeDate)
	if err != nil {
		return nil, &rowError{"invalid_date", "tradeDate must be a YYYY-MM-DD date."}, nil
	}
	if err := service.validateDate(ctx, tx, userID, date); err != nil {
		problem, _ := rowProblem(err)
		return nil, &problem, nil
	}
	var settlement *time.Time
	if text := strings.TrimSpace(trade.SettlementDate); text != "" {
		parsed, err := time.Parse(time.DateOnly, text)
		if err != nil || parsed.Before(date) {
			return nil, &rowError{"invalid_settlement_date", "settlementDate must be a YYYY-MM-DD date on or after tradeDate."}, nil
		}
		settlement = &parsed
	}
	quantity, err := canonicalDecimal(row.Quantity, false, false, "quantity")
	if err != nil {
		return nil, &rowError{"invalid_quantity", "quantity must be a plain decimal greater than zero."}, nil
	}
	price, err := canonicalDecimal(row.Price, false, false, "price")
	if err != nil {
		return nil, &rowError{"invalid_price", "price must be a plain decimal greater than zero."}, nil
	}
	row.Quantity, row.Price = quantity, price
	instrument, err := service.resolveInstrument(ctx, tx, userID, trade.Instrument, input.CreateMissingInstruments)
	if err != nil {
		problem, ok := rowProblem(err)
		if !ok {
			return nil, nil, err
		}
		return nil, &problem, nil
	}
	row.InstrumentID, row.Symbol = instrument.ID.String(), instrument.Symbol
	currency := domain.NormalizeCurrency(trade.Currency)
	if currency == "" {
		currency = instrument.QuoteCurrency
	}
	feeCurrency := domain.NormalizeCurrency(trade.CommissionCurrency)
	if feeCurrency == "" {
		feeCurrency = currency
	}
	fee := new(big.Rat)
	hasFee := false
	for _, part := range []string{trade.Commission, trade.OtherFees} {
		if strings.TrimSpace(part) == "" {
			continue
		}
		value, err := canonicalDecimal(part, false, true, "fee")
		if err != nil {
			return nil, &rowError{"invalid_fee", "commission and otherFees must be plain decimals that are zero or more."}, nil
		}
		parsed, _ := new(big.Rat).SetString(value)
		fee.Add(fee, parsed)
		hasFee = true
	}
	event := &PositionEventMutationInput{
		AccountID: input.AccountID, InstrumentID: instrument.ID, Type: row.Side, Quantity: quantity, UnitPrice: price,
		TradeCurrency: currency, CashEffect: strings.TrimSpace(trade.NetCash), AppliedExchangeRate: strings.TrimSpace(trade.FxRate),
		TradeDate: date, SettlementDate: settlement, IdempotencyKey: uuid.New(), Description: strings.TrimSpace(trade.Description),
	}
	if strings.HasPrefix(event.CashEffect, "-") {
		event.CashEffect = event.CashEffect[1:]
	}
	if hasFee {
		event.FeeAmount, event.FeeCurrency = fee.FloatString(investmentCurrencyDigits(feeCurrency)), feeCurrency
		if canonical, _ := canonicalDecimal(event.FeeAmount, false, true, "fee"); !equalDecimals(canonical, canonicalRat(fee)) {
			return nil, &rowError{"invalid_fee", "Fees have more decimal places than " + feeCurrency + " supports."}, nil
		}
	}
	return event, nil, nil
}

func equalDecimals(left, right string) bool {
	if left == "" || right == "" {
		return left == right
	}
	a, okA := new(big.Rat).SetString(left)
	b, okB := new(big.Rat).SetString(right)
	return okA && okB && a.Cmp(b) == 0
}

type PriceInput struct {
	Instrument InstrumentRef `json:"instrument"`
	Date       string        `json:"date"`
	Price      string        `json:"price"`
	Currency   string        `json:"currency,omitempty"`
	Source     string        `json:"source,omitempty"`
	ExternalID string        `json:"externalId,omitempty"`
}

type PriceRow struct {
	Index        int        `json:"index"`
	InstrumentID string     `json:"instrumentId,omitempty"`
	Symbol       string     `json:"symbol,omitempty"`
	Date         string     `json:"date"`
	Price        string     `json:"price"`
	Currency     string     `json:"currency,omitempty"`
	Status       string     `json:"status"`
	Code         string     `json:"code"`
	Message      string     `json:"message"`
	PriceID      *uuid.UUID `json:"priceId,omitempty"`
	// Historical is true when a newer price exists, so this one doesn't change current values.
	Historical bool   `json:"historical"`
	LatestDate string `json:"latestDate,omitempty"`
}

type PriceUpsertResult struct {
	Status    string     `json:"status"`
	Created   int        `json:"created"`
	Updated   int        `json:"updated"`
	Unchanged int        `json:"unchanged"`
	Rejected  int        `json:"rejected"`
	Rows      []PriceRow `json:"rows"`
	Warnings  []string   `json:"warnings"`
}

// BulkUpsertPrices records effective-dated prices for one or more instruments; every row is
// stored or none is. A price on a date that already has one replaces it.
func (service *InvestmentMutations) BulkUpsertPrices(ctx context.Context, userID uuid.UUID, prices []PriceInput) (PriceUpsertResult, error) {
	if len(prices) == 0 || len(prices) > MaxPositionSyncRecords {
		return PriceUpsertResult{}, validation(fmt.Sprintf("send between 1 and %d prices", MaxPositionSyncRecords))
	}
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return PriceUpsertResult{}, fmt.Errorf("begin price update: %w", err)
	}
	defer tx.Rollback()
	result := PriceUpsertResult{Rows: make([]PriceRow, len(prices)), Warnings: []string{}}
	type prepared struct {
		input SecurityPriceMutationInput
		price string
	}
	ready := make([]*prepared, len(prices))
	seen := map[string]bool{}
	for index, input := range prices {
		row := &result.Rows[index]
		row.Index, row.Date, row.Price = index+1, strings.TrimSpace(input.Date), strings.TrimSpace(input.Price)
		reject := func(code, message string) { row.Status, row.Code, row.Message = "rejected", code, message }
		date, err := time.Parse(time.DateOnly, row.Date)
		if err != nil {
			reject("invalid_date", "date must be a YYYY-MM-DD date.")
			continue
		}
		if err := service.validateDate(ctx, tx, userID, date); err != nil {
			problem, _ := rowProblem(err)
			reject(problem.code, problem.message)
			continue
		}
		price, err := canonicalDecimal(row.Price, false, false, "price")
		if err != nil {
			reject("invalid_price", "price must be a plain decimal greater than zero.")
			continue
		}
		instrument, err := service.resolveInstrument(ctx, tx, userID, input.Instrument, false)
		if err != nil {
			problem, ok := rowProblem(err)
			if !ok {
				return PriceUpsertResult{}, err
			}
			reject(problem.code, problem.message)
			continue
		}
		row.InstrumentID, row.Symbol, row.Price, row.Currency = instrument.ID.String(), instrument.Symbol, price, instrument.QuoteCurrency
		if currency := domain.NormalizeCurrency(input.Currency); currency != "" && currency != instrument.QuoteCurrency {
			reject("currency_mismatch", "Prices are stored in the instrument's quote currency "+instrument.QuoteCurrency+".")
			continue
		}
		key := instrument.ID.String() + "|" + row.Date
		if seen[key] {
			reject("duplicate_in_request", "This instrument and date appear more than once.")
			continue
		}
		seen[key] = true
		source := strings.TrimSpace(input.Source)
		if source == "" {
			source = "assistant"
		}
		ready[index] = &prepared{SecurityPriceMutationInput{InstrumentID: instrument.ID, ExternalID: input.ExternalID, Price: price, EffectiveDate: date, Source: source}, price}
	}
	for _, row := range result.Rows {
		if row.Status == "rejected" {
			result.Rejected++
		}
	}
	if result.Rejected > 0 {
		result.Status = "rejected"
		result.Warnings = append(result.Warnings, "Nothing was stored because some prices were rejected.")
		return result, nil
	}
	instruments := orderedIDs{}
	for index, item := range ready {
		row := &result.Rows[index]
		var existing, existingSource string
		err := tx.QueryRowContext(ctx, `SELECT price::TEXT,source FROM security_prices WHERE user_id=$1 AND instrument_id=$2 AND effective_date=$3`,
			userID, item.input.InstrumentID, investmentDateOnly(item.input.EffectiveDate)).Scan(&existing, &existingSource)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			row.Status, row.Code, row.Message = "created", "created", "Price recorded."
		case err != nil:
			return PriceUpsertResult{}, fmt.Errorf("load existing price: %w", err)
		case equalDecimals(existing, item.price) && existingSource == item.input.Source:
			row.Status, row.Code, row.Message = "unchanged", "unchanged", "The same price is already recorded for this date."
		default:
			row.Status, row.Code, row.Message = "updated", "updated", "Replaced the price recorded for this date."
		}
		if row.Status != "unchanged" {
			id, err := service.upsertSecurityPriceTx(ctx, tx, userID, item.input, item.price)
			if err != nil {
				return PriceUpsertResult{}, err
			}
			row.PriceID = &id
			instruments.add(item.input.InstrumentID)
		}
		var latest sql.NullTime
		if err := tx.QueryRowContext(ctx, `SELECT MAX(effective_date) FROM security_prices WHERE user_id=$1 AND instrument_id=$2`, userID, item.input.InstrumentID).Scan(&latest); err != nil {
			return PriceUpsertResult{}, fmt.Errorf("load latest price date: %w", err)
		}
		if latest.Valid {
			row.LatestDate = latest.Time.Format(time.DateOnly)
			row.Historical = row.LatestDate > row.Date
		}
		switch row.Status {
		case "created":
			result.Created++
		case "updated":
			result.Updated++
		default:
			result.Unchanged++
		}
	}
	for _, instrumentID := range instruments {
		if err := service.recalculateInstrumentAccounts(ctx, tx, userID, instrumentID); err != nil {
			return PriceUpsertResult{}, err
		}
	}
	for _, row := range result.Rows {
		if row.Historical {
			result.Warnings = append(result.Warnings, "Some prices are older than the latest recorded price, so current values use the newer price.")
			break
		}
	}
	if err := tx.Commit(); err != nil {
		return PriceUpsertResult{}, mutationDatabaseError(err, "commit price update")
	}
	result.Status = "completed"
	return result, nil
}

type DeletePositionResult struct {
	InstrumentID           uuid.UUID `json:"instrumentId"`
	DeletedSnapshots       int       `json:"deletedSnapshots"`
	DeletedTrades          int       `json:"deletedTrades"`
	RemainingQuantity      string    `json:"remainingQuantity"`
	AccountValueAfterMinor int64     `json:"accountValueAfterMinor"`
	Warnings               []string  `json:"warnings"`
}

// DeletePosition removes an incorrect holding: its synced snapshots (only the one on asOf
// when given) and, with includeTrades, its ordinary trades and adjustments. Corporate
// actions are kept because they belong to grouped workflows.
func (service *InvestmentMutations) DeletePosition(ctx context.Context, userID, accountID uuid.UUID, ref InstrumentRef, asOf *time.Time, includeTrades bool) (DeletePositionResult, error) {
	var result DeletePositionResult
	err := service.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := lockPositionAccount(ctx, tx, userID, accountID); err != nil {
			return err
		}
		instrument, err := service.resolveInstrument(ctx, tx, userID, ref, false)
		if err != nil {
			if problem, ok := rowProblem(err); ok {
				return validation(problem.message)
			}
			return err
		}
		result = DeletePositionResult{InstrumentID: instrument.ID, Warnings: []string{}}
		var date any
		if asOf != nil {
			date = ledgerDateOnly(*asOf)
		}
		deleted, err := tx.ExecContext(ctx, `DELETE FROM position_events WHERE user_id=$1 AND account_id=$2 AND instrument_id=$3 AND snapshot_quantity IS NOT NULL AND ($4::DATE IS NULL OR trade_date=$4)`,
			userID, accountID, instrument.ID, date)
		if err != nil {
			return fmt.Errorf("delete position snapshots: %w", err)
		}
		count, _ := deleted.RowsAffected()
		result.DeletedSnapshots = int(count)
		if includeTrades {
			deleted, err := tx.ExecContext(ctx, `
DELETE FROM position_events WHERE user_id=$1 AND account_id=$2 AND instrument_id=$3 AND snapshot_quantity IS NULL
  AND event_group_id IS NULL AND type IN ('opening_position','buy','sell','quantity_adjustment') AND ($4::DATE IS NULL OR trade_date=$4)`,
				userID, accountID, instrument.ID, date)
			if err != nil {
				return fmt.Errorf("delete position trades: %w", err)
			}
			count, _ := deleted.RowsAffected()
			result.DeletedTrades = int(count)
		}
		if result.DeletedSnapshots+result.DeletedTrades == 0 {
			return ErrLedgerNotFound
		}
		if err := validateAccountPositionReplay(ctx, tx, userID, accountID); err != nil {
			return err
		}
		if err := service.recalculatePositionAccount(ctx, tx, userID, accountID); err != nil {
			return err
		}
		holdings, err := holdingsOnDate(ctx, tx, userID, accountID, farFuture)
		if err != nil {
			return err
		}
		result.RemainingQuantity = canonicalRat(cloneRat(holdings[instrument.ID]))
		if holdings[instrument.ID] != nil && holdings[instrument.ID].Sign() != 0 {
			result.Warnings = append(result.Warnings, "Other activity still holds this instrument; pass includeTrades to remove its trades too.")
		}
		return tx.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, userID, accountID).Scan(&result.AccountValueAfterMinor)
	})
	return result, err
}
