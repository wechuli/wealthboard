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

var investmentHoldingsHeaders = []string{
	"instrument_external_id", "event_external_id", "price_external_id", "instrument_name", "symbol",
	"identifier_type", "identifier", "exchange_mic", "asset_type", "quote_currency", "quantity",
	"unit_price", "price_date", "opening_cost_basis", "notes",
}
var investmentTradeHeaders = []string{
	"external_id", "instrument_external_id", "type", "quantity", "unit_price", "trade_currency",
	"fee_amount", "fee_currency", "cash_effect", "applied_exchange_rate", "trade_date", "settlement_date",
	"description", "notes",
}
var investmentCashHeaders = []string{"external_id", "type", "amount", "date", "description", "notes"}
var investmentPriceHeaders = []string{"external_id", "instrument_external_id", "price", "effective_date", "source", "provenance"}

type InvestmentHistoryImportService struct {
	db  *sql.DB
	now func() time.Time
}

func NewInvestmentHistoryImportService(db *sql.DB) *InvestmentHistoryImportService {
	return &InvestmentHistoryImportService{db: db, now: time.Now}
}

type investmentSourceInstrument struct {
	ExternalID     string  `json:"external_id"`
	Name           string  `json:"name"`
	Symbol         *string `json:"symbol"`
	IdentifierType string  `json:"identifier_type"`
	Identifier     *string `json:"identifier"`
	ExchangeMIC    *string `json:"exchange_mic"`
	AssetType      string  `json:"asset_type"`
	QuoteCurrency  string  `json:"quote_currency"`
}

type investmentSourceEvent struct {
	ExternalID           string  `json:"external_id"`
	InstrumentExternalID string  `json:"instrument_external_id"`
	Type                 string  `json:"type"`
	Quantity             string  `json:"quantity"`
	UnitPrice            *string `json:"unit_price"`
	TradeCurrency        string  `json:"trade_currency"`
	FeeAmount            *string `json:"fee_amount"`
	FeeCurrency          *string `json:"fee_currency"`
	CashEffect           *string `json:"cash_effect"`
	AppliedExchangeRate  *string `json:"applied_exchange_rate"`
	OpeningCostBasis     *string `json:"opening_cost_basis"`
	EventGroupID         *string `json:"event_group_id"`
	TradeDate            string  `json:"trade_date"`
	SettlementDate       *string `json:"settlement_date"`
	Description          *string `json:"description"`
	Notes                *string `json:"notes"`
}

type investmentSourceCash struct {
	ExternalID   *string `json:"external_id"`
	Type         string  `json:"type"`
	Amount       string  `json:"amount"`
	Date         string  `json:"date"`
	EventGroupID *string `json:"event_group_id"`
	Description  *string `json:"description"`
	Notes        *string `json:"notes"`
}

type investmentSourcePrice struct {
	ExternalID           string  `json:"external_id"`
	InstrumentExternalID string  `json:"instrument_external_id"`
	Price                string  `json:"price"`
	EffectiveDate        string  `json:"effective_date"`
	Source               string  `json:"source"`
	Provenance           *string `json:"provenance"`
}

type investmentHistoryEnvelope struct {
	Format           string                       `json:"format"`
	Version          int                          `json:"version"`
	Instruments      []investmentSourceInstrument `json:"instruments"`
	PositionEvents   []investmentSourceEvent      `json:"position_events"`
	CashTransactions []investmentSourceCash       `json:"cash_transactions"`
	Prices           []investmentSourcePrice      `json:"prices"`
}

type InvestmentImportRow struct {
	Collection string  `json:"collection"`
	Row        int     `json:"row"`
	ExternalID *string `json:"externalId"`
	Status     string  `json:"status"`
	Code       string  `json:"code"`
	Message    string  `json:"message"`
}

type InvestmentInstrumentChange struct {
	InstrumentID      uuid.UUID `json:"instrumentId"`
	ExternalID        string    `json:"externalId"`
	Name              string    `json:"name"`
	Symbol            *string   `json:"symbol"`
	Resolution        string    `json:"resolution"`
	CurrentQuantity   string    `json:"currentQuantity"`
	ProjectedQuantity string    `json:"projectedQuantity"`
	QuantityChange    string    `json:"quantityChange"`
}

type InvestmentEventChange struct {
	ExternalID     string    `json:"externalId"`
	InstrumentID   uuid.UUID `json:"instrumentId"`
	Type           string    `json:"type"`
	TradeDate      string    `json:"tradeDate"`
	EventSequence  int       `json:"eventSequence"`
	BeforeQuantity string    `json:"beforeQuantity"`
	AfterQuantity  string    `json:"afterQuantity"`
}

type InvestmentPriceChange struct {
	ExternalID   string    `json:"externalId"`
	InstrumentID uuid.UUID `json:"instrumentId"`
	Price        string    `json:"price"`
	Currency     string    `json:"currency"`
	Source       string    `json:"source"`
	AffectedFrom string    `json:"affectedFrom"`
}

type InvestmentImportValue struct {
	CashMinor         int64    `json:"cashMinor"`
	PositionsMinor    int64    `json:"positionsMinor"`
	TotalMinor        int64    `json:"totalMinor"`
	Complete          bool     `json:"complete"`
	MissingPrices     []string `json:"missingPrices"`
	MissingCurrencies []string `json:"missingCurrencies"`
}

type InvestmentImportSummary struct {
	Records           int `json:"records"`
	Ready             int `json:"ready,omitempty"`
	Imported          int `json:"imported,omitempty"`
	SkippedDuplicates int `json:"skippedDuplicates"`
	Failed            int `json:"failed"`
}

type InvestmentHistoryImportResult struct {
	Hash              string                       `json:"hash,omitempty"`
	Account           ImportAccount                `json:"account"`
	Current           InvestmentImportValue        `json:"current"`
	Projected         InvestmentImportValue        `json:"projected"`
	FinalBalanceMinor int64                        `json:"finalBalanceMinor,omitempty"`
	NetChangeMinor    int64                        `json:"netChangeMinor"`
	DateRange         *ImportDateRange             `json:"dateRange"`
	InstrumentChanges []InvestmentInstrumentChange `json:"instrumentChanges"`
	EventChanges      []InvestmentEventChange      `json:"eventChanges"`
	PriceChanges      []InvestmentPriceChange      `json:"priceChanges"`
	Summary           InvestmentImportSummary      `json:"summary"`
	CanCommit         bool                         `json:"canCommit"`
	Rows              []InvestmentImportRow        `json:"rows"`
}

type preparedInstrument struct {
	id        uuid.UUID
	source    investmentSourceInstrument
	createdAt time.Time
}

type preparedEvent struct {
	id, instrumentID                   uuid.UUID
	source                             investmentSourceEvent
	quantity, unitPrice, tradeCurrency string
	grossAmount, feeAmount             *int64
	feeCurrency                        string
	cashEffect                         int64
	appliedRate                        string
	openingCostBasis                   *int64
	tradeDate                          time.Time
	settlementDate                     *time.Time
	eventSequence                      int
	eventGroupID                       *uuid.UUID
	createdAt                          time.Time
}

type preparedCash struct {
	id           uuid.UUID
	source       investmentSourceCash
	externalID   string
	amountMinor  int64
	date         time.Time
	eventGroupID *uuid.UUID
	createdAt    time.Time
}

type preparedPrice struct {
	id, instrumentID uuid.UUID
	source           investmentSourcePrice
	price, currency  string
	effectiveDate    time.Time
	createdAt        time.Time
}

type preparedInvestmentImport struct {
	account                  ImportAccount
	currentBalance           int64
	instruments              []preparedInstrument
	events                   []preparedEvent
	cash                     []preparedCash
	prices                   []preparedPrice
	rows                     []InvestmentImportRow
	dateRange                *ImportDateRange
	current, projected       InvestmentImportValue
	instrumentChanges        []InvestmentInstrumentChange
	eventChanges             []InvestmentEventChange
	priceChanges             []InvestmentPriceChange
	records, skipped, failed int
}

func (service *InvestmentHistoryImportService) Preview(ctx context.Context, userID, accountID uuid.UUID, content []byte, format ImportFormat) (InvestmentHistoryImportResult, error) {
	if err := validateImportContent(content, format); err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	envelope, err := parseInvestmentHistory(content, format)
	if err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	prepared, err := service.prepare(ctx, service.db, userID, accountID, envelope)
	if err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	return prepared.investmentResult(importHash(content), false), nil
}

func (service *InvestmentHistoryImportService) Commit(ctx context.Context, userID, accountID uuid.UUID, content []byte, format ImportFormat, expectedHash string) (InvestmentHistoryImportResult, error) {
	if err := validateImportContent(content, format); err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	if err := verifyImportHash(content, expectedHash); err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	envelope, err := parseInvestmentHistory(content, format)
	if err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return InvestmentHistoryImportResult{}, fmt.Errorf("begin investment-history import: %w", err)
	}
	defer tx.Rollback()
	prepared, err := service.prepare(ctx, tx, userID, accountID, envelope)
	if err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	if prepared.failed > 0 {
		return InvestmentHistoryImportResult{}, importValidation("resolve every investment-history error before importing")
	}
	for _, row := range prepared.rows {
		if row.Status == "conflicting_existing" || row.Status == "duplicate_in_file" {
			return InvestmentHistoryImportResult{}, importConflict("an external ID conflicts with existing or repeated content")
		}
	}
	for _, instrument := range prepared.instruments {
		_, err = tx.ExecContext(ctx, `
INSERT INTO investment_instruments (id,user_id,external_id,name,symbol,identifier_type,identifier,exchange_mic,asset_type,quote_currency,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`, instrument.id, userID, instrument.source.ExternalID, instrument.source.Name,
			normalizedOptionalText(instrument.source.Symbol), instrument.source.IdentifierType, normalizedOptionalText(instrument.source.Identifier),
			normalizedOptionalText(instrument.source.ExchangeMIC), instrument.source.AssetType, instrument.source.QuoteCurrency, instrument.createdAt)
		if err != nil {
			return InvestmentHistoryImportResult{}, fmt.Errorf("insert imported instrument: %w", err)
		}
	}
	for _, event := range prepared.events {
		_, err = tx.ExecContext(ctx, `
INSERT INTO position_events (id,user_id,account_id,instrument_id,type,quantity,unit_price,trade_currency,gross_amount_minor,fee_amount_minor,fee_currency,cash_effect_minor,applied_exchange_rate,opening_cost_basis_minor,trade_date,event_sequence,settlement_date,external_id,event_group_id,description,notes,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6::numeric,NULLIF($7,'')::numeric,$8,$9,$10,$11,$12,NULLIF($13,'')::numeric,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)`,
			event.id, userID, accountID, event.instrumentID, event.source.Type, event.quantity, event.unitPrice, event.tradeCurrency,
			event.grossAmount, event.feeAmount, optionalString(event.feeCurrency), event.cashEffect, event.appliedRate, event.openingCostBasis,
			event.tradeDate, event.eventSequence, event.settlementDate, event.source.ExternalID, event.eventGroupID,
			normalizedOptionalText(event.source.Description), normalizedOptionalText(event.source.Notes), event.createdAt)
		if err != nil {
			return InvestmentHistoryImportResult{}, fmt.Errorf("insert imported position event: %w", err)
		}
	}
	for _, cash := range prepared.cash {
		_, err = tx.ExecContext(ctx, `
INSERT INTO transactions (id,user_id,account_id,type,amount_minor,currency,transaction_date,external_id,event_group_id,description,notes,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`, cash.id, userID, accountID, cash.source.Type, cash.amountMinor,
			prepared.account.Currency, cash.date, cash.externalID, cash.eventGroupID, normalizedOptionalText(cash.source.Description), normalizedOptionalText(cash.source.Notes), cash.createdAt)
		if err != nil {
			return InvestmentHistoryImportResult{}, fmt.Errorf("insert imported cash transaction: %w", err)
		}
	}
	for _, price := range prepared.prices {
		_, err = tx.ExecContext(ctx, `
INSERT INTO security_prices (id,user_id,instrument_id,external_id,price,currency,effective_date,source,provenance,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$10)`, price.id, userID, price.instrumentID, price.source.ExternalID,
			price.price, price.currency, price.effectiveDate, price.source.Source, normalizedOptionalText(price.source.Provenance), price.createdAt)
		if err != nil {
			return InvestmentHistoryImportResult{}, fmt.Errorf("insert imported security price: %w", err)
		}
	}
	if err := validateAccountPositionReplay(ctx, tx, userID, accountID); err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	mutations := &InvestmentMutations{db: service.db, now: service.now}
	if err := mutations.recalculatePositionAccount(ctx, tx, userID, accountID); err != nil {
		return InvestmentHistoryImportResult{}, err
	}
	seenInstruments := map[uuid.UUID]bool{}
	for _, price := range prepared.prices {
		if seenInstruments[price.instrumentID] {
			continue
		}
		seenInstruments[price.instrumentID] = true
		if err := mutations.recalculateInstrumentAccounts(ctx, tx, userID, price.instrumentID); err != nil {
			return InvestmentHistoryImportResult{}, err
		}
	}
	var finalBalance int64
	if err := tx.QueryRowContext(ctx, `SELECT current_value_minor FROM accounts WHERE user_id=$1 AND id=$2`, userID, accountID).Scan(&finalBalance); err != nil {
		return InvestmentHistoryImportResult{}, fmt.Errorf("load imported account balance: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return InvestmentHistoryImportResult{}, fmt.Errorf("commit investment-history import: %w", err)
	}
	result := prepared.investmentResult("", true)
	result.FinalBalanceMinor = finalBalance
	result.Summary.Imported = len(prepared.instruments) + len(prepared.events) + len(prepared.cash) + len(prepared.prices)
	result.Summary.Ready = 0
	return result, nil
}

func parseInvestmentHistory(content []byte, format ImportFormat) (investmentHistoryEnvelope, error) {
	if format == ImportFormatJSON {
		var envelope investmentHistoryEnvelope
		if err := decodeStrictJSON(content, &envelope); err != nil || envelope.Format != "wealthboard-investment-history" || envelope.Version != 1 {
			return investmentHistoryEnvelope{}, importValidation("JSON must use wealthboard-investment-history format version 1")
		}
		if err := validateInvestmentRecordCount(envelope); err != nil {
			return investmentHistoryEnvelope{}, err
		}
		return envelope, nil
	}
	for _, template := range []struct {
		headers []string
		kind    string
	}{{investmentHoldingsHeaders, "holdings"}, {investmentTradeHeaders, "trades"}, {investmentCashHeaders, "cash"}, {investmentPriceHeaders, "prices"}} {
		records, err := parseExactCSV(content, template.headers)
		if err != nil {
			continue
		}
		envelope := investmentHistoryEnvelope{Format: "wealthboard-investment-history", Version: 1}
		for _, values := range records[1:] {
			row := csvRecord(records[0], values)
			switch template.kind {
			case "holdings":
				envelope.Instruments = append(envelope.Instruments, investmentSourceInstrument{ExternalID: row["instrument_external_id"], Name: row["instrument_name"], Symbol: optionalImportText(row["symbol"]), IdentifierType: row["identifier_type"], Identifier: optionalImportText(row["identifier"]), ExchangeMIC: optionalImportText(row["exchange_mic"]), AssetType: row["asset_type"], QuoteCurrency: row["quote_currency"]})
				envelope.PositionEvents = append(envelope.PositionEvents, investmentSourceEvent{ExternalID: row["event_external_id"], InstrumentExternalID: row["instrument_external_id"], Type: "opening_position", Quantity: row["quantity"], TradeCurrency: row["quote_currency"], OpeningCostBasis: optionalImportText(row["opening_cost_basis"]), TradeDate: row["price_date"], Description: importStringPointer("Imported opening position"), Notes: optionalImportText(row["notes"])})
				envelope.Prices = append(envelope.Prices, investmentSourcePrice{ExternalID: row["price_external_id"], InstrumentExternalID: row["instrument_external_id"], Price: row["unit_price"], EffectiveDate: row["price_date"], Source: "import", Provenance: importStringPointer("Investment History v1 opening holdings")})
			case "trades":
				envelope.PositionEvents = append(envelope.PositionEvents, investmentSourceEvent{ExternalID: row["external_id"], InstrumentExternalID: row["instrument_external_id"], Type: row["type"], Quantity: row["quantity"], UnitPrice: optionalImportText(row["unit_price"]), TradeCurrency: row["trade_currency"], FeeAmount: optionalImportText(row["fee_amount"]), FeeCurrency: optionalImportText(row["fee_currency"]), CashEffect: optionalImportText(row["cash_effect"]), AppliedExchangeRate: optionalImportText(row["applied_exchange_rate"]), TradeDate: row["trade_date"], SettlementDate: optionalImportText(row["settlement_date"]), Description: optionalImportText(row["description"]), Notes: optionalImportText(row["notes"])})
			case "cash":
				envelope.CashTransactions = append(envelope.CashTransactions, investmentSourceCash{ExternalID: optionalImportText(row["external_id"]), Type: row["type"], Amount: row["amount"], Date: row["date"], Description: optionalImportText(row["description"]), Notes: optionalImportText(row["notes"])})
			case "prices":
				envelope.Prices = append(envelope.Prices, investmentSourcePrice{ExternalID: row["external_id"], InstrumentExternalID: row["instrument_external_id"], Price: row["price"], EffectiveDate: row["effective_date"], Source: row["source"], Provenance: optionalImportText(row["provenance"])})
			}
		}
		return envelope, validateInvestmentRecordCount(envelope)
	}
	return investmentHistoryEnvelope{}, importValidation("the CSV headers do not match an Investment History v1 template")
}

func validateInvestmentRecordCount(envelope investmentHistoryEnvelope) error {
	total := len(envelope.Instruments) + len(envelope.PositionEvents) + len(envelope.CashTransactions) + len(envelope.Prices)
	if total == 0 {
		return importValidation("the investment-history file contains no records")
	}
	if total > ImportMaxRecords {
		return importValidation("the import is limited to 10,000 records")
	}
	return nil
}

type investmentAccountContext struct {
	ImportAccount
	currentBalance int64
	timezone       string
}
type existingImportInstrument struct {
	id                                  uuid.UUID
	externalID, name                    string
	symbol, identifier, exchangeMIC     sql.NullString
	identifierType, assetType, currency string
	archived                            sql.NullTime
}

func (service *InvestmentHistoryImportService) prepare(ctx context.Context, queryer importQueryer, userID, accountID uuid.UUID, envelope investmentHistoryEnvelope) (preparedInvestmentImport, error) {
	account, err := loadInvestmentImportAccount(ctx, queryer, userID, accountID)
	if err != nil {
		return preparedInvestmentImport{}, err
	}
	location, err := time.LoadLocation(account.timezone)
	if err != nil {
		return preparedInvestmentImport{}, fmt.Errorf("load user timezone: %w", err)
	}
	today := service.now().In(location).Format(time.DateOnly)
	prepared := preparedInvestmentImport{account: account.ImportAccount, currentBalance: account.currentBalance, records: len(envelope.Instruments) + len(envelope.PositionEvents) + len(envelope.CashTransactions) + len(envelope.Prices)}
	timestamp := service.now().UTC()
	instrumentsByExternal, existingInstruments, err := loadImportInstruments(ctx, queryer, userID)
	if err != nil {
		return preparedInvestmentImport{}, err
	}
	newInstrumentIDs := map[uuid.UUID]bool{}
	duplicateInstruments := duplicateImportStrings(instrumentExternalIDs(envelope.Instruments))
	for index, source := range envelope.Instruments {
		row := newInvestmentRow("instruments", index+1, source.ExternalID)
		source = normalizeSourceInstrument(source)
		if duplicateInstruments[source.ExternalID] {
			row.fail("duplicate_in_file", "Instrument external ID occurs more than once in this file.")
		} else if validationMessage := validateSourceInstrument(source); validationMessage != "" {
			row.fail("invalid_instrument", validationMessage)
		} else if err := requireEnabledCurrency(ctx, queryer, userID, source.QuoteCurrency); err != nil {
			row.fail("invalid_currency", err.Error())
		} else if existing, found := instrumentsByExternal[source.ExternalID]; found {
			if instrumentMatches(existing, source) {
				row.duplicate()
			} else {
				row.conflict("Instrument external ID conflicts with an existing instrument.")
			}
		} else {
			instrument := preparedInstrument{id: uuid.New(), source: source, createdAt: timestamp.Add(time.Duration(index) * time.Nanosecond)}
			prepared.instruments = append(prepared.instruments, instrument)
			newInstrumentIDs[instrument.id] = true
			instrumentsByExternal[source.ExternalID] = existingImportInstrument{id: instrument.id, externalID: source.ExternalID, name: source.Name, symbol: toNullString(source.Symbol), identifier: toNullString(source.Identifier), exchangeMIC: toNullString(source.ExchangeMIC), identifierType: source.IdentifierType, assetType: source.AssetType, currency: source.QuoteCurrency}
		}
		prepared.addRow(row)
	}

	existingEvents, eventByExternal, sequenceByDate, err := loadImportPositionEvents(ctx, queryer, userID, accountID)
	if err != nil {
		return preparedInvestmentImport{}, err
	}
	duplicateEvents := duplicateImportStrings(eventExternalIDs(envelope.PositionEvents))
	groupIDs := buildInvestmentGroupIDs(envelope)
	for index, source := range envelope.PositionEvents {
		row := newInvestmentRow("position_events", index+1, source.ExternalID)
		event, validationMessage := service.prepareEvent(ctx, queryer, userID, account, instrumentsByExternal, source, today, sequenceByDate, groupIDs, timestamp.Add(time.Duration(len(envelope.Instruments)+index)*time.Nanosecond))
		if duplicateEvents[source.ExternalID] {
			row.fail("duplicate_in_file", "Position-event external ID occurs more than once in this file.")
		} else if validationMessage != "" {
			row.fail("invalid_event", validationMessage)
		} else if existing, found := eventByExternal[source.ExternalID]; found {
			if importedEventMatches(existing, event) {
				row.duplicate()
			} else {
				row.conflict("Position-event external ID conflicts with an existing event.")
			}
		} else {
			prepared.events = append(prepared.events, event)
		}
		prepared.addRow(row)
	}

	allReplay := append([]positionEventRow{}, existingEvents...)
	for _, event := range prepared.events {
		allReplay = append(allReplay, event.replayRow(accountID))
	}
	currentQuantities, err := replayPositionEvents(existingEvents, true)
	if err != nil {
		return preparedInvestmentImport{}, err
	}
	projectedQuantities, replayErr := replayPositionEvents(allReplay, true)
	if replayErr != nil {
		prepared.addGlobalFailure("position_events", "invalid_replay", replayErr.Error())
		projectedQuantities = currentQuantities
	}
	prepared.buildQuantityChanges(accountID, instrumentsByExternal, existingInstruments, newInstrumentIDs, currentQuantities, projectedQuantities, allReplay)

	existingCash, err := loadImportCash(ctx, queryer, userID, accountID)
	if err != nil {
		return preparedInvestmentImport{}, err
	}
	duplicateCash := duplicateImportStrings(cashExternalIDs(envelope.CashTransactions, account.Currency))
	for index, source := range envelope.CashTransactions {
		rowNumber := index + 1
		externalID := sourceCashExternalID(source, account.Currency)
		row := newInvestmentRow("cash_transactions", rowNumber, externalID)
		cash, validationMessage := prepareImportCash(source, externalID, account.Currency, today, groupIDs, timestamp.Add(time.Duration(len(envelope.Instruments)+len(envelope.PositionEvents)+index)*time.Nanosecond))
		if duplicateCash[externalID] {
			row.fail("duplicate_in_file", "Cash external ID occurs more than once in this file.")
		} else if validationMessage != "" {
			row.fail("invalid_cash", validationMessage)
		} else if existing, found := existingCash[externalID]; found {
			if importedCashMatches(existing, cash) {
				row.duplicate()
			} else {
				row.conflict("Cash external ID conflicts with an existing transaction.")
			}
		} else {
			prepared.cash = append(prepared.cash, cash)
		}
		prepared.addRow(row)
	}

	existingPrices, err := loadImportPrices(ctx, queryer, userID)
	if err != nil {
		return preparedInvestmentImport{}, err
	}
	duplicatePrices := duplicateImportStrings(priceExternalIDs(envelope.Prices))
	for index, source := range envelope.Prices {
		key := source.InstrumentExternalID + ":" + source.ExternalID
		row := newInvestmentRow("prices", index+1, source.ExternalID)
		price, validationMessage := prepareImportPrice(source, instrumentsByExternal, today, timestamp.Add(time.Duration(len(envelope.Instruments)+len(envelope.PositionEvents)+len(envelope.CashTransactions)+index)*time.Nanosecond))
		if duplicatePrices[key] {
			row.fail("duplicate_in_file", "Price external ID occurs more than once for this instrument.")
		} else if validationMessage != "" {
			row.fail("invalid_price", validationMessage)
		} else if existing, found := findExistingImportPrice(existingPrices, price); found {
			if importedPriceMatches(existing, price) {
				row.duplicate()
			} else {
				row.conflict("Price conflicts with an existing observation.")
			}
		} else {
			prepared.prices = append(prepared.prices, price)
			prepared.priceChanges = append(prepared.priceChanges, InvestmentPriceChange{ExternalID: source.ExternalID, InstrumentID: price.instrumentID, Price: price.price, Currency: price.currency, Source: source.Source, AffectedFrom: source.EffectiveDate})
		}
		prepared.addRow(row)
	}
	if message := validateInvestmentGroups(envelope); message != "" {
		prepared.addGlobalFailure("event_groups", "invalid_event_group", message)
	}
	prepared.dateRange = investmentDateRange(envelope)
	prepared.current, prepared.projected, err = service.projectInvestment(ctx, queryer, userID, account, currentQuantities, projectedQuantities, prepared.events, prepared.cash, prepared.prices)
	if err != nil {
		return preparedInvestmentImport{}, err
	}
	return prepared, nil
}

func (service *InvestmentHistoryImportService) prepareEvent(ctx context.Context, queryer importQueryer, userID uuid.UUID, account investmentAccountContext, instruments map[string]existingImportInstrument, source investmentSourceEvent, today string, sequences map[string]int, groups map[string]uuid.UUID, createdAt time.Time) (preparedEvent, string) {
	event := preparedEvent{id: uuid.New(), source: source, createdAt: createdAt}
	if source.ExternalID == "" || len(source.ExternalID) > 200 || !ordinaryPositionEventTypes[source.Type] {
		return event, "Position event identity or type is invalid."
	}
	instrument, found := instruments[source.InstrumentExternalID]
	if !found || instrument.archived.Valid {
		return event, "Referenced instrument was not found."
	}
	event.instrumentID = instrument.id
	quantity, err := canonicalDecimal(source.Quantity, source.Type == "quantity_adjustment", false, "quantity")
	if err != nil {
		return event, err.Error()
	}
	event.quantity = quantity
	tradeDate, message := validImportDate(source.TradeDate, today)
	if message != "" {
		return event, message
	}
	event.tradeDate = tradeDate
	if source.SettlementDate != nil {
		settlement, message := validImportDate(*source.SettlementDate, today)
		if message != "" {
			return event, message
		}
		event.settlementDate = &settlement
	}
	tradeCurrency := domain.NormalizeCurrency(source.TradeCurrency)
	if tradeCurrency == "" {
		tradeCurrency = instrument.currency
	}
	if err := requireEnabledCurrency(ctx, queryer, userID, tradeCurrency); err != nil {
		return event, err.Error()
	}
	event.tradeCurrency = tradeCurrency
	if source.UnitPrice != nil {
		event.unitPrice, err = canonicalDecimal(*source.UnitPrice, false, false, "unit price")
		if err != nil {
			return event, err.Error()
		}
	}
	if (source.Type == "buy" || source.Type == "sell") && event.unitPrice == "" {
		return event, "Buy and sell events require a unit price."
	}
	if event.unitPrice != "" {
		value, calcErr := decimalProductMinor(event.quantity, event.unitPrice, event.tradeCurrency)
		if calcErr != nil {
			return event, calcErr.Error()
		}
		event.grossAmount = &value
	}
	if source.FeeAmount != nil {
		event.feeCurrency = tradeCurrency
		if source.FeeCurrency != nil {
			event.feeCurrency = domain.NormalizeCurrency(*source.FeeCurrency)
		}
		if err := requireEnabledCurrency(ctx, queryer, userID, event.feeCurrency); err != nil {
			return event, err.Error()
		}
		value, parseErr := parseInvestmentMoneyMinor(*source.FeeAmount, event.feeCurrency)
		if parseErr != nil || value < 0 {
			return event, "Fee cannot be negative or invalid."
		}
		event.feeAmount = &value
	}
	if (source.FeeAmount != nil || source.CashEffect != nil) && source.Type != "buy" && source.Type != "sell" {
		return event, "Fees and settlement amounts apply only to buys and sells."
	}
	if source.AppliedExchangeRate != nil {
		event.appliedRate, err = canonicalDecimal(*source.AppliedExchangeRate, false, false, "applied exchange rate")
		if err != nil {
			return event, err.Error()
		}
		if source.Type != "buy" && source.Type != "sell" || tradeCurrency == account.Currency {
			return event, "Applied settlement rate is only valid for cross-currency trades."
		}
	}
	if (source.Type == "buy" || source.Type == "sell") && tradeCurrency != account.Currency && source.CashEffect == nil && event.appliedRate == "" {
		return event, "Cross-currency trades require cash_effect or applied_exchange_rate."
	}
	event.cashEffect, err = service.importCashEffect(ctx, queryer, userID, account.Currency, event)
	if err != nil {
		return event, err.Error()
	}
	if source.OpeningCostBasis != nil {
		if source.Type != "opening_position" {
			return event, "Opening cost basis applies only to an opening position."
		}
		value, parseErr := parseInvestmentMoneyMinor(*source.OpeningCostBasis, account.Currency)
		if parseErr != nil || value < 0 {
			return event, "Opening cost basis cannot be negative or invalid."
		}
		event.openingCostBasis = &value
	}
	dateKey := event.tradeDate.Format(time.DateOnly)
	sequences[dateKey]++
	event.eventSequence = sequences[dateKey]
	if source.EventGroupID != nil {
		id := groups[*source.EventGroupID]
		event.eventGroupID = &id
	}
	return event, ""
}

func (service *InvestmentHistoryImportService) importCashEffect(ctx context.Context, queryer importQueryer, userID uuid.UUID, accountCurrency string, event preparedEvent) (int64, error) {
	if event.source.Type != "buy" && event.source.Type != "sell" {
		return 0, nil
	}
	if event.source.CashEffect != nil {
		value, err := parseInvestmentMoneyMinor(*event.source.CashEffect, accountCurrency)
		if err != nil || value <= 0 {
			return 0, investmentValidationError("cash effect must be greater than zero")
		}
		if event.source.Type == "buy" {
			return -value, nil
		}
		return value, nil
	}
	convert := func(amount int64, from string) (int64, error) {
		if from == accountCurrency {
			return amount, nil
		}
		if event.appliedRate != "" && from == event.tradeCurrency {
			return convertMinorAtRate(amount, from, accountCurrency, event.appliedRate, false)
		}
		var base, rate string
		err := queryer.QueryRowContext(ctx, `SELECT base_currency,rate::text FROM exchange_rates WHERE user_id=$1 AND ((base_currency=$2 AND quote_currency=$3) OR (base_currency=$3 AND quote_currency=$2)) AND effective_date<=$4 ORDER BY effective_date DESC,created_at DESC,id LIMIT 1`, userID, from, accountCurrency, event.tradeDate).Scan(&base, &rate)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, investmentValidationError("no exchange rate is configured for this trade")
		}
		if err != nil {
			return 0, err
		}
		return convertMinorAtRate(amount, from, accountCurrency, rate, base != from)
	}
	gross, err := convert(valueOrZero(event.grossAmount), event.tradeCurrency)
	if err != nil {
		return 0, err
	}
	fee := int64(0)
	if event.feeAmount != nil {
		fee, err = convert(*event.feeAmount, event.feeCurrency)
		if err != nil {
			return 0, err
		}
	}
	if event.source.Type == "buy" {
		return checkedInt64(new(big.Int).Neg(new(big.Int).Add(big.NewInt(gross), big.NewInt(fee))))
	}
	return checkedInt64(new(big.Int).Sub(big.NewInt(gross), big.NewInt(fee)))
}

func (service *InvestmentHistoryImportService) projectInvestment(ctx context.Context, queryer importQueryer, userID uuid.UUID, account investmentAccountContext, current, projected map[positionKey]*big.Rat, events []preparedEvent, cash []preparedCash, prices []preparedPrice) (InvestmentImportValue, InvestmentImportValue, error) {
	currentCash, err := loadPositionCash(ctx, queryer, userID, account.ID)
	if err != nil {
		return InvestmentImportValue{}, InvestmentImportValue{}, err
	}
	projectedCash := big.NewInt(currentCash)
	for _, event := range events {
		projectedCash.Add(projectedCash, big.NewInt(event.cashEffect))
	}
	for _, row := range cash {
		projectedCash.Add(projectedCash, investmentTransactionEffect(row.source.Type, row.amountMinor))
	}
	currentPositions, currentMissing, currentCurrencies, err := service.positionValue(ctx, queryer, userID, account.Currency, current, nil)
	if err != nil {
		return InvestmentImportValue{}, InvestmentImportValue{}, err
	}
	projectedPositions, projectedMissing, projectedCurrencies, err := service.positionValue(ctx, queryer, userID, account.Currency, projected, prices)
	if err != nil {
		return InvestmentImportValue{}, InvestmentImportValue{}, err
	}
	currentTotal, err := checkedInt64(new(big.Int).Add(big.NewInt(currentCash), big.NewInt(currentPositions)))
	if err != nil {
		return InvestmentImportValue{}, InvestmentImportValue{}, err
	}
	projectedCashInt, err := checkedInt64(projectedCash)
	if err != nil {
		return InvestmentImportValue{}, InvestmentImportValue{}, err
	}
	projectedTotal, err := checkedInt64(new(big.Int).Add(big.NewInt(projectedCashInt), big.NewInt(projectedPositions)))
	if err != nil {
		return InvestmentImportValue{}, InvestmentImportValue{}, err
	}
	return InvestmentImportValue{CashMinor: currentCash, PositionsMinor: currentPositions, TotalMinor: currentTotal, Complete: len(currentMissing) == 0 && len(currentCurrencies) == 0, MissingPrices: currentMissing, MissingCurrencies: currentCurrencies}, InvestmentImportValue{CashMinor: projectedCashInt, PositionsMinor: projectedPositions, TotalMinor: projectedTotal, Complete: len(projectedMissing) == 0 && len(projectedCurrencies) == 0, MissingPrices: projectedMissing, MissingCurrencies: projectedCurrencies}, nil
}

func (service *InvestmentHistoryImportService) positionValue(ctx context.Context, queryer importQueryer, userID uuid.UUID, accountCurrency string, quantities map[positionKey]*big.Rat, imported []preparedPrice) (int64, []string, []string, error) {
	total := new(big.Int)
	missing := []string{}
	missingCurrencySet := map[string]bool{}
	now := service.now().UTC()
	for key, quantity := range quantities {
		if quantity.Sign() == 0 {
			continue
		}
		var instrumentCurrency string
		var price string
		var priceDate time.Time
		for _, candidate := range imported {
			if candidate.instrumentID == key.instrumentID && (price == "" || candidate.effectiveDate.After(priceDate)) {
				price, priceDate, instrumentCurrency = candidate.price, candidate.effectiveDate, candidate.currency
			}
		}
		if instrumentCurrency == "" {
			if err := queryer.QueryRowContext(ctx, `SELECT quote_currency FROM investment_instruments WHERE user_id=$1 AND id=$2`, userID, key.instrumentID).Scan(&instrumentCurrency); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					missing = append(missing, key.instrumentID.String())
					continue
				}
				return 0, nil, nil, err
			}
		}
		var storedPrice string
		var storedDate time.Time
		err := queryer.QueryRowContext(ctx, `SELECT price::text,effective_date FROM security_prices WHERE user_id=$1 AND instrument_id=$2 AND effective_date<=$3 ORDER BY effective_date DESC,created_at DESC,id LIMIT 1`, userID, key.instrumentID, now).Scan(&storedPrice, &storedDate)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return 0, nil, nil, err
		}
		if err == nil && (price == "" || storedDate.After(priceDate)) {
			price, priceDate = storedPrice, storedDate
		}
		if price == "" {
			missing = append(missing, key.instrumentID.String())
			continue
		}
		quote, err := decimalProductMinor(canonicalRat(quantity), price, instrumentCurrency)
		if err != nil {
			return 0, nil, nil, err
		}
		converted, found, err := convertImportMinor(ctx, queryer, userID, quote, instrumentCurrency, accountCurrency, now)
		if err != nil {
			return 0, nil, nil, err
		}
		if !found {
			missingCurrencySet[instrumentCurrency] = true
			continue
		}
		total.Add(total, big.NewInt(converted))
	}
	value, err := checkedInt64(total)
	currencies := make([]string, 0, len(missingCurrencySet))
	for currency := range missingCurrencySet {
		currencies = append(currencies, currency)
	}
	sort.Strings(missing)
	sort.Strings(currencies)
	return value, missing, currencies, err
}

func convertImportMinor(ctx context.Context, queryer importQueryer, userID uuid.UUID, amount int64, from, to string, asOf time.Time) (int64, bool, error) {
	if from == to {
		return amount, true, nil
	}
	var base, rate string
	err := queryer.QueryRowContext(ctx, `SELECT base_currency,rate::text FROM exchange_rates WHERE user_id=$1 AND ((base_currency=$2 AND quote_currency=$3) OR (base_currency=$3 AND quote_currency=$2)) AND effective_date<=$4 ORDER BY effective_date DESC,created_at DESC,id LIMIT 1`, userID, from, to, asOf).Scan(&base, &rate)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	value, err := convertMinorAtRate(amount, from, to, rate, base != from)
	return value, true, err
}

func loadPositionCash(ctx context.Context, queryer importQueryer, userID, accountID uuid.UUID) (int64, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT type,amount_minor FROM transactions WHERE user_id=$1 AND account_id=$2`, userID, accountID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	total := new(big.Int)
	for rows.Next() {
		var eventType string
		var amount int64
		if err := rows.Scan(&eventType, &amount); err != nil {
			return 0, err
		}
		total.Add(total, investmentTransactionEffect(eventType, amount))
	}
	var tradeCash int64
	if err := queryer.QueryRowContext(ctx, `SELECT COALESCE(SUM(cash_effect_minor),0) FROM position_events WHERE user_id=$1 AND account_id=$2`, userID, accountID).Scan(&tradeCash); err != nil {
		return 0, err
	}
	total.Add(total, big.NewInt(tradeCash))
	return checkedInt64(total)
}

func loadInvestmentImportAccount(ctx context.Context, q importQueryer, userID, accountID uuid.UUID) (investmentAccountContext, error) {
	var account investmentAccountContext
	err := q.QueryRowContext(ctx, `SELECT account.id,account.name,account.currency,account.current_value_minor,settings.timezone FROM accounts account JOIN user_settings settings ON settings.user_id=account.user_id WHERE account.user_id=$1 AND account.id=$2 AND account.tracking_mode='positions' AND account.archived_at IS NULL FOR UPDATE OF account`, userID, accountID).Scan(&account.ID, &account.Name, &account.Currency, &account.currentBalance, &account.timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return investmentAccountContext{}, ErrImportNotFound
	}
	if err != nil {
		return investmentAccountContext{}, fmt.Errorf("load investment import account: %w", err)
	}
	return account, nil
}

func loadImportInstruments(ctx context.Context, q importQueryer, userID uuid.UUID) (map[string]existingImportInstrument, map[uuid.UUID]existingImportInstrument, error) {
	rows, err := q.QueryContext(ctx, `SELECT id,COALESCE(external_id,''),name,symbol,identifier_type,identifier,exchange_mic,asset_type,quote_currency,archived_at FROM investment_instruments WHERE user_id=$1`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	byExternal := map[string]existingImportInstrument{}
	byID := map[uuid.UUID]existingImportInstrument{}
	for rows.Next() {
		var item existingImportInstrument
		if err := rows.Scan(&item.id, &item.externalID, &item.name, &item.symbol, &item.identifierType, &item.identifier, &item.exchangeMIC, &item.assetType, &item.currency, &item.archived); err != nil {
			return nil, nil, err
		}
		if item.externalID != "" {
			byExternal[item.externalID] = item
		}
		byID[item.id] = item
	}
	return byExternal, byID, rows.Err()
}

type existingImportedEvent struct {
	instrumentID                                  uuid.UUID
	eventType, quantity, unitPrice, tradeCurrency string
	cashEffect                                    int64
	tradeDate                                     time.Time
}

func loadImportPositionEvents(ctx context.Context, q importQueryer, userID, accountID uuid.UUID) ([]positionEventRow, map[string]existingImportedEvent, map[string]int, error) {
	rows, err := q.QueryContext(ctx, `SELECT id,instrument_id,type,quantity::text,COALESCE(unit_price::text,''),trade_currency,cash_effect_minor,trade_date,event_sequence,COALESCE(external_id,''),created_at,related_instrument_id,COALESCE(action_ratio_numerator::text,''),COALESCE(action_ratio_denominator::text,'') FROM position_events WHERE user_id=$1 AND account_id=$2 ORDER BY trade_date,event_sequence,created_at,id`, userID, accountID)
	if err != nil {
		return nil, nil, nil, err
	}
	defer rows.Close()
	events := []positionEventRow{}
	byExternal := map[string]existingImportedEvent{}
	sequences := map[string]int{}
	for rows.Next() {
		var replay positionEventRow
		var existing existingImportedEvent
		var externalID string
		var related uuid.NullUUID
		if err := rows.Scan(&replay.id, &existing.instrumentID, &existing.eventType, &existing.quantity, &existing.unitPrice, &existing.tradeCurrency, &existing.cashEffect, &existing.tradeDate, &replay.eventSequence, &externalID, &replay.createdAt, &related, &replay.actionRatioNumerator, &replay.actionRatioDenominator); err != nil {
			return nil, nil, nil, err
		}
		replay.accountID = accountID
		replay.instrumentID = existing.instrumentID
		replay.eventType = existing.eventType
		replay.quantity = existing.quantity
		replay.tradeDate = existing.tradeDate
		if related.Valid {
			id := related.UUID
			replay.relatedInstrumentID = &id
		}
		events = append(events, replay)
		if externalID != "" {
			byExternal[externalID] = existing
		}
		key := existing.tradeDate.Format(time.DateOnly)
		if replay.eventSequence > sequences[key] {
			sequences[key] = replay.eventSequence
		}
	}
	return events, byExternal, sequences, rows.Err()
}

type existingImportedCash struct {
	transactionType    string
	amount             int64
	date               time.Time
	description, notes sql.NullString
}

func loadImportCash(ctx context.Context, q importQueryer, userID, accountID uuid.UUID) (map[string]existingImportedCash, error) {
	rows, err := q.QueryContext(ctx, `SELECT external_id,type,amount_minor,transaction_date,description,notes FROM transactions WHERE user_id=$1 AND account_id=$2 AND external_id IS NOT NULL`, userID, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]existingImportedCash{}
	for rows.Next() {
		var key string
		var row existingImportedCash
		if err := rows.Scan(&key, &row.transactionType, &row.amount, &row.date, &row.description, &row.notes); err != nil {
			return nil, err
		}
		result[key] = row
	}
	return result, rows.Err()
}

type existingImportedPrice struct {
	instrumentID              uuid.UUID
	externalID, price, source string
	effectiveDate             time.Time
}

func loadImportPrices(ctx context.Context, q importQueryer, userID uuid.UUID) ([]existingImportedPrice, error) {
	rows, err := q.QueryContext(ctx, `SELECT instrument_id,COALESCE(external_id,''),price::text,effective_date,source FROM security_prices WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []existingImportedPrice{}
	for rows.Next() {
		var row existingImportedPrice
		if err := rows.Scan(&row.instrumentID, &row.externalID, &row.price, &row.effectiveDate, &row.source); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func prepareImportCash(source investmentSourceCash, externalID, currency, today string, groups map[string]uuid.UUID, createdAt time.Time) (preparedCash, string) {
	row := preparedCash{id: uuid.New(), source: source, externalID: externalID, createdAt: createdAt}
	if !positionCashTypes[source.Type] {
		return row, "Cash transaction type is not supported."
	}
	amount, err := parseInvestmentMoneyMinor(source.Amount, currency)
	if err != nil || source.Type == "manual_adjustment" && amount == 0 || source.Type != "manual_adjustment" && amount <= 0 {
		return row, "Cash amount has an invalid sign, precision, or value."
	}
	row.amountMinor = amount
	row.date, _ = time.Parse(time.DateOnly, source.Date)
	if _, message := validImportDate(source.Date, today); message != "" {
		return row, message
	}
	if !validOptionalImportText(source.Description, 200) || !validOptionalImportText(source.Notes, 2000) {
		return row, "Cash description or notes are too long."
	}
	if source.EventGroupID != nil {
		id := groups[*source.EventGroupID]
		row.eventGroupID = &id
	}
	return row, ""
}

func prepareImportPrice(source investmentSourcePrice, instruments map[string]existingImportInstrument, today string, createdAt time.Time) (preparedPrice, string) {
	row := preparedPrice{id: uuid.New(), source: source, createdAt: createdAt}
	instrument, found := instruments[source.InstrumentExternalID]
	if !found || instrument.archived.Valid {
		return row, "Referenced instrument was not found."
	}
	row.instrumentID = instrument.id
	row.currency = instrument.currency
	if source.ExternalID == "" || len(source.ExternalID) > 200 || source.Source == "" || len(source.Source) > 100 || !validOptionalImportText(source.Provenance, 500) {
		return row, "Price identity or metadata is invalid."
	}
	price, err := canonicalDecimal(source.Price, false, false, "unit price")
	if err != nil {
		return row, err.Error()
	}
	row.price = price
	date, message := validImportDate(source.EffectiveDate, today)
	if message != "" {
		return row, message
	}
	row.effectiveDate = date
	return row, ""
}

func (event preparedEvent) replayRow(accountID uuid.UUID) positionEventRow {
	return positionEventRow{id: event.id, accountID: accountID, instrumentID: event.instrumentID, eventType: event.source.Type, quantity: event.quantity, tradeDate: event.tradeDate, eventSequence: event.eventSequence, createdAt: event.createdAt}
}
func importedEventMatches(existing existingImportedEvent, event preparedEvent) bool {
	return existing.instrumentID == event.instrumentID && existing.eventType == event.source.Type && existing.quantity == event.quantity && existing.unitPrice == event.unitPrice && existing.tradeCurrency == event.tradeCurrency && existing.cashEffect == event.cashEffect && sameDate(existing.tradeDate, event.tradeDate)
}
func importedCashMatches(existing existingImportedCash, row preparedCash) bool {
	return existing.transactionType == row.source.Type && existing.amount == row.amountMinor && sameDate(existing.date, row.date) && nullStringEquals(existing.description, row.source.Description) && nullStringEquals(existing.notes, row.source.Notes)
}
func findExistingImportPrice(existing []existingImportedPrice, row preparedPrice) (existingImportedPrice, bool) {
	for _, candidate := range existing {
		if candidate.instrumentID == row.instrumentID && (candidate.externalID == row.source.ExternalID || sameDate(candidate.effectiveDate, row.effectiveDate)) {
			return candidate, true
		}
	}
	return existingImportedPrice{}, false
}
func importedPriceMatches(existing existingImportedPrice, row preparedPrice) bool {
	return existing.price == row.price && sameDate(existing.effectiveDate, row.effectiveDate) && existing.source == row.source.Source
}

func normalizeSourceInstrument(source investmentSourceInstrument) investmentSourceInstrument {
	source.ExternalID = strings.TrimSpace(source.ExternalID)
	source.Name = strings.TrimSpace(source.Name)
	source.Symbol = upperOptional(source.Symbol)
	source.Identifier = upperOptional(source.Identifier)
	source.ExchangeMIC = upperOptional(source.ExchangeMIC)
	source.QuoteCurrency = domain.NormalizeCurrency(source.QuoteCurrency)
	return source
}
func validateSourceInstrument(source investmentSourceInstrument) string {
	if source.ExternalID == "" || len(source.ExternalID) > 200 || source.Name == "" || len(source.Name) > 100 || source.Symbol != nil && len(*source.Symbol) > 30 || source.Identifier != nil && len(*source.Identifier) > 100 || source.ExchangeMIC != nil && len(*source.ExchangeMIC) > 20 {
		return "Instrument fields are invalid."
	}
	if source.IdentifierType != "isin" && source.IdentifierType != "ticker_exchange" && source.IdentifierType != "custom" {
		return "Instrument identifier type is invalid."
	}
	if source.AssetType != "stock" && source.AssetType != "etf" && source.AssetType != "fund" {
		return "Instrument asset type is invalid."
	}
	return ""
}
func instrumentMatches(existing existingImportInstrument, source investmentSourceInstrument) bool {
	return !existing.archived.Valid && existing.name == source.Name && nullStringEquals(existing.symbol, source.Symbol) && existing.identifierType == source.IdentifierType && nullStringEquals(existing.identifier, source.Identifier) && nullStringEquals(existing.exchangeMIC, source.ExchangeMIC) && existing.assetType == source.AssetType && existing.currency == source.QuoteCurrency
}

func (prepared *preparedInvestmentImport) addRow(row investmentRowBuilder) {
	prepared.rows = append(prepared.rows, row.InvestmentImportRow)
	switch row.Status {
	case "ready":
	case "duplicate_existing":
		prepared.skipped++
	default:
		prepared.failed++
	}
}
func (prepared *preparedInvestmentImport) addGlobalFailure(collection, code, message string) {
	prepared.rows = append(prepared.rows, InvestmentImportRow{Collection: collection, Row: 0, Status: "failed", Code: code, Message: message})
	prepared.failed++
}

type investmentRowBuilder struct{ InvestmentImportRow }

func newInvestmentRow(collection string, row int, externalID string) investmentRowBuilder {
	result := investmentRowBuilder{InvestmentImportRow: InvestmentImportRow{Collection: collection, Row: row, Status: "ready", Code: "ready", Message: "Ready to import."}}
	if externalID != "" {
		result.ExternalID = &externalID
	}
	return result
}
func (row *investmentRowBuilder) fail(code, message string) {
	row.Status = "failed"
	row.Code = code
	row.Message = message
}
func (row *investmentRowBuilder) conflict(message string) {
	row.Status = "conflicting_existing"
	row.Code = "conflicting_existing"
	row.Message = message
}
func (row *investmentRowBuilder) duplicate() {
	row.Status = "duplicate_existing"
	row.Code = "duplicate_existing"
	row.Message = "This record is already imported."
}

func (prepared *preparedInvestmentImport) buildQuantityChanges(accountID uuid.UUID, instruments map[string]existingImportInstrument, existing map[uuid.UUID]existingImportInstrument, newIDs map[uuid.UUID]bool, current, projected map[positionKey]*big.Rat, events []positionEventRow) {
	all := map[uuid.UUID]existingImportInstrument{}
	for id, row := range existing {
		all[id] = row
	}
	for _, row := range instruments {
		all[row.id] = row
	}
	ids := map[uuid.UUID]bool{}
	for key := range current {
		if key.accountID == accountID {
			ids[key.instrumentID] = true
		}
	}
	for key := range projected {
		if key.accountID == accountID {
			ids[key.instrumentID] = true
		}
	}
	for id := range ids {
		instrument := all[id]
		before := cloneRat(current[positionKey{accountID: accountID, instrumentID: id}])
		after := cloneRat(projected[positionKey{accountID: accountID, instrumentID: id}])
		prepared.instrumentChanges = append(prepared.instrumentChanges, InvestmentInstrumentChange{InstrumentID: id, ExternalID: instrument.externalID, Name: instrument.name, Symbol: nullStringPointer(instrument.symbol), Resolution: map[bool]string{true: "new", false: "existing"}[newIDs[id]], CurrentQuantity: canonicalRat(before), ProjectedQuantity: canonicalRat(after), QuantityChange: canonicalRat(new(big.Rat).Sub(after, before))})
	}
	sort.Slice(prepared.instrumentChanges, func(i, j int) bool { return prepared.instrumentChanges[i].Name < prepared.instrumentChanges[j].Name })
	imported := map[uuid.UUID]bool{}
	for _, event := range prepared.events {
		imported[event.id] = true
	}
	state := map[positionKey]*big.Rat{}
	for _, event := range events {
		key := positionKey{accountID: event.accountID, instrumentID: event.instrumentID}
		before := cloneRat(state[key])
		next := cloneRat(before)
		quantity, _ := new(big.Rat).SetString(event.quantity)
		switch event.eventType {
		case "sell":
			next.Sub(next, absRat(quantity))
		case "quantity_adjustment":
			next.Add(next, quantity)
		default:
			next.Add(next, absRat(quantity))
		}
		state[key] = next
		if imported[event.id] {
			prepared.eventChanges = append(prepared.eventChanges, InvestmentEventChange{ExternalID: findPreparedEventExternal(prepared.events, event.id), InstrumentID: event.instrumentID, Type: event.eventType, TradeDate: event.tradeDate.Format(time.DateOnly), EventSequence: event.eventSequence, BeforeQuantity: canonicalRat(before), AfterQuantity: canonicalRat(next)})
		}
	}
}

func (prepared preparedInvestmentImport) investmentResult(hash string, committed bool) InvestmentHistoryImportResult {
	result := InvestmentHistoryImportResult{Hash: hash, Account: prepared.account, Current: prepared.current, Projected: prepared.projected, NetChangeMinor: prepared.projected.TotalMinor - prepared.current.TotalMinor, DateRange: prepared.dateRange, InstrumentChanges: prepared.instrumentChanges, EventChanges: prepared.eventChanges, PriceChanges: prepared.priceChanges, Rows: prepared.rows, CanCommit: prepared.failed == 0, Summary: InvestmentImportSummary{Records: prepared.records, Ready: len(prepared.instruments) + len(prepared.events) + len(prepared.cash) + len(prepared.prices), SkippedDuplicates: prepared.skipped, Failed: prepared.failed}}
	if committed {
		result.CanCommit = false
	}
	return result
}

func validImportDate(value, today string) (time.Time, string) {
	date, err := time.Parse(time.DateOnly, value)
	if err != nil || date.Format(time.DateOnly) != value {
		return time.Time{}, "Date must use YYYY-MM-DD."
	}
	if value > today {
		return time.Time{}, "Financial activity cannot be dated in the future."
	}
	return date, ""
}
func validateInvestmentGroups(envelope investmentHistoryEnvelope) string {
	events := map[string][]investmentSourceEvent{}
	cash := map[string][]investmentSourceCash{}
	for _, row := range envelope.PositionEvents {
		if row.EventGroupID != nil {
			events[*row.EventGroupID] = append(events[*row.EventGroupID], row)
		}
	}
	for _, row := range envelope.CashTransactions {
		if row.EventGroupID != nil {
			cash[*row.EventGroupID] = append(cash[*row.EventGroupID], row)
		}
	}
	ids := map[string]bool{}
	for id := range events {
		ids[id] = true
	}
	for id := range cash {
		ids[id] = true
	}
	for id := range ids {
		eventRows, cashRows := events[id], cash[id]
		if len(eventRows) < 1 || len(cashRows) != 1 || cashRows[0].Type != "dividend" {
			return "A reinvestment group requires one dividend and one or more buys on the same date."
		}
		date := cashRows[0].Date
		for _, row := range eventRows {
			if row.Type != "buy" || row.TradeDate != date {
				return "A reinvestment group requires one dividend and one or more buys on the same date."
			}
		}
	}
	return ""
}
func buildInvestmentGroupIDs(envelope investmentHistoryEnvelope) map[string]uuid.UUID {
	result := map[string]uuid.UUID{}
	for _, row := range envelope.PositionEvents {
		if row.EventGroupID != nil {
			if _, ok := result[*row.EventGroupID]; !ok {
				result[*row.EventGroupID] = uuid.New()
			}
		}
	}
	for _, row := range envelope.CashTransactions {
		if row.EventGroupID != nil {
			if _, ok := result[*row.EventGroupID]; !ok {
				result[*row.EventGroupID] = uuid.New()
			}
		}
	}
	return result
}
func investmentDateRange(envelope investmentHistoryEnvelope) *ImportDateRange {
	dates := []string{}
	for _, row := range envelope.PositionEvents {
		dates = append(dates, row.TradeDate)
	}
	for _, row := range envelope.CashTransactions {
		dates = append(dates, row.Date)
	}
	for _, row := range envelope.Prices {
		dates = append(dates, row.EffectiveDate)
	}
	if len(dates) == 0 {
		return nil
	}
	sort.Strings(dates)
	return &ImportDateRange{From: dates[0], To: dates[len(dates)-1]}
}

func duplicateImportStrings(values []string) map[string]bool {
	seen := map[string]bool{}
	duplicates := map[string]bool{}
	for _, value := range values {
		if seen[value] {
			duplicates[value] = true
		}
		seen[value] = true
	}
	return duplicates
}
func instrumentExternalIDs(rows []investmentSourceInstrument) []string {
	result := make([]string, len(rows))
	for i, row := range rows {
		result[i] = strings.TrimSpace(row.ExternalID)
	}
	return result
}
func eventExternalIDs(rows []investmentSourceEvent) []string {
	result := make([]string, len(rows))
	for i, row := range rows {
		result[i] = row.ExternalID
	}
	return result
}
func cashExternalIDs(rows []investmentSourceCash, currency string) []string {
	result := make([]string, len(rows))
	for i, row := range rows {
		result[i] = sourceCashExternalID(row, currency)
	}
	return result
}
func priceExternalIDs(rows []investmentSourcePrice) []string {
	result := make([]string, len(rows))
	for i, row := range rows {
		result[i] = row.InstrumentExternalID + ":" + row.ExternalID
	}
	return result
}
func sourceCashExternalID(row investmentSourceCash, currency string) string {
	if row.ExternalID != nil && strings.TrimSpace(*row.ExternalID) != "" {
		return strings.TrimSpace(*row.ExternalID)
	}
	amount, _ := parseInvestmentMoneyMinor(row.Amount, currency)
	return fmt.Sprintf("derived-%s-%s-%d", row.Date, row.Type, amount)
}
func findPreparedEventExternal(events []preparedEvent, id uuid.UUID) string {
	for _, event := range events {
		if event.id == id {
			return event.source.ExternalID
		}
	}
	return ""
}
func upperOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.ToUpper(strings.TrimSpace(*value))
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
func toNullString(value *string) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *value, Valid: true}
}
func nullStringPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	copy := value.String
	return &copy
}
func importStringPointer(value string) *string { return &value }
