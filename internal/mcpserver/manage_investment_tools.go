package mcpserver

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/wechuli/wealthboard/internal/domain"
	"github.com/wechuli/wealthboard/internal/service"
)

const instrumentHelp = "Identify instruments by stable identifiers: instrumentId, the broker's contract ID as externalId (for example ibkr:conid:12345), isin, or symbol with exchangeMic. A bare symbol matches only when exactly one instrument has it. "

const priceNotice = "Prices are recorded observations with dates, not live quotes. A stale price is older than the user's threshold for that asset type."

func (tools *toolset) registerInvestmentReads(server *mcp.Server) {
	addTool(server, &mcp.Tool{
		Name:        "list_instruments",
		Description: "Tracked instruments with identifiers, asset type, quote currency, and the latest recorded price and its date.",
		Annotations: readOnly("List instruments"),
	}, handle(tools, tools.listInstruments))
	addTool(server, &mcp.Tool{
		Name:        "get_price_history",
		Description: "Recorded prices for one instrument, newest first, each labelled current, stale, or historical, with its source. " + priceNotice,
		Annotations: readOnly("Price history"),
	}, handle(tools, tools.priceHistory))
}

func (tools *toolset) registerInvestmentWrites(server *mcp.Server) {
	syncAudit := func(out PositionSyncOutput) auditRef {
		if out.ImportID == "" || out.Status != "completed" {
			return auditRef{skip: true}
		}
		return auditRef{recordType: "position_snapshot", ids: mustIDs(out.ImportID), accountID: mustID(out.AccountID), batchID: mustID(out.ImportID)}
	}
	tradeAudit := func(out TradeImportOutput) auditRef {
		if out.ImportID == "" || out.Status != "completed" {
			return auditRef{skip: true}
		}
		ids := []string{}
		for _, row := range out.Rows {
			if row.EventID != "" {
				ids = append(ids, row.EventID)
			}
		}
		return auditRef{recordType: "trade", ids: mustIDs(ids...), accountID: mustID(out.AccountID), batchID: mustID(out.ImportID)}
	}
	priceAudit := func(out PriceUpdateOutput) auditRef {
		ids := []string{}
		for _, row := range out.Rows {
			if row.PriceID != "" {
				ids = append(ids, row.PriceID)
			}
		}
		return auditRef{skip: len(ids) == 0, recordType: "price", ids: mustIDs(ids...)}
	}
	addTool(server, &mcp.Tool{
		Name:        "create_instrument",
		Description: "Create an instrument to track. Give an isin, or a symbol with exchangeMic, or a broker externalId; assetType is stock, etf, or fund; quoteCurrency must be enabled.",
		Annotations: writeAnnotations("Create an instrument"),
	}, handleWrite(tools, "create", tools.createInstrument, func(_ createInstrumentInput, out InstrumentItem) auditRef {
		return auditRef{recordType: "instrument", ids: mustIDs(out.ID)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "update_instrument",
		Description: "Change an instrument's name, symbol, identifiers, exchange, asset type, or broker ID. Omitted fields are unchanged. The quote currency can't change once prices or activity exist.",
		Annotations: writeAnnotations("Update an instrument"),
	}, handleWrite(tools, "update", tools.updateInstrument, func(_ updateInstrumentInput, out InstrumentItem) auditRef {
		return auditRef{recordType: "instrument", ids: mustIDs(out.ID)}
	}))
	addTool(server, &mcp.Tool{
		Name: "bulk_upsert_positions",
		Description: "Synchronize an investment account's holdings and cash from a broker snapshot on asOf, for example an Interactive Brokers statement. Each quantity is recorded as an absolute snapshot: no buy or sell is invented, " +
			"earlier activity is reconciled to it, later activity still applies, and trades imported for the same period are not double counted. An older snapshot doesn't change current holdings. " +
			"Atomic: if any position is rejected nothing is written. unitPrice also records that price on asOf. closeMissing sets held instruments missing from the snapshot to zero. " + instrumentHelp,
		Annotations: writeAnnotations("Sync positions"),
	}, handleWrite(tools, "sync", tools.bulkUpsertPositions, func(_ positionSyncInput, out PositionSyncOutput) auditRef { return syncAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "upsert_position",
		Description: "Set one holding's quantity on asOf as a snapshot, like bulk_upsert_positions with one position. " + instrumentHelp,
		Annotations: writeAnnotations("Set a position"),
	}, handleWrite(tools, "sync", tools.upsertPosition, func(_ upsertPositionInput, out PositionSyncOutput) auditRef { return syncAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "update_cash_balance",
		Description: "Set an investment account's cash on asOf from a broker statement, as an absolute snapshot in the account currency. Later cash activity still applies. For balance-tracked accounts use record_valuation.",
		Annotations: writeAnnotations("Set brokerage cash"),
	}, handleWrite(tools, "sync", tools.updateCashBalance, func(_ cashBalanceInput, out PositionSyncOutput) auditRef { return syncAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "delete_position",
		Description: "Remove an incorrect holding from an investment account: its synced snapshots (only the one on asOf when given) and, with includeTrades, its trades and adjustments. Corporate actions are kept. Confirm with the user first.",
		Annotations: destructive("Delete a position"),
	}, handleWrite(tools, "delete", tools.deletePosition, func(_ deletePositionInput, out DeletePositionOutput) auditRef {
		return auditRef{recordType: "position", ids: mustIDs(out.InstrumentID), accountID: mustID(out.Account.ID)}
	}))
	addTool(server, &mcp.Tool{
		Name:        "record_trade",
		Description: "Record one executed buy or sell, like bulk_import_trades with one trade. " + instrumentHelp,
		Annotations: writeAnnotations("Record a trade"),
	}, handleWrite(tools, "create", tools.recordTrade, func(_ recordTradeInput, out TradeImportOutput) auditRef { return tradeAudit(out) }))
	addTool(server, &mcp.Tool{
		Name: "bulk_import_trades",
		Description: "Import up to 1,000 executed brokerage trades into an investment account. Each needs side (buy or sell), quantity, and execution price in the trade currency; commission and otherFees are added together as the fee. " +
			"Cross-currency trades need netCash (the settled amount in the account currency) or fxRate. Trades are identified by externalId (use the broker's trade ID); importing the same trades again skips them and a changed trade with the same ID is reported, never overwritten. " +
			"Atomic unless allowPartial; dryRun previews. " + instrumentHelp,
		Annotations: writeAnnotations("Import trades"),
	}, handleWrite(tools, "import", tools.bulkImportTrades, func(_ tradeImportInput, out TradeImportOutput) auditRef { return tradeAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "update_price",
		Description: "Record an instrument's price on a date in its quote currency, replacing any price on that date. " + priceNotice,
		Annotations: writeAnnotations("Record a price"),
	}, handleWrite(tools, "upsert", tools.updatePrice, func(_ priceInput, out PriceUpdateOutput) auditRef { return priceAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "bulk_update_prices",
		Description: "Record up to 1,000 prices atomically. Each row reports whether it is historical (older than the latest recorded price). " + instrumentHelp,
		Annotations: writeAnnotations("Record prices"),
	}, handleWrite(tools, "upsert", tools.bulkUpdatePrices, func(_ bulkPriceInput, out PriceUpdateOutput) auditRef { return priceAudit(out) }))
	addTool(server, &mcp.Tool{
		Name:        "delete_price",
		Description: "Delete an incorrect recorded price (priceId from get_price_history). Values are recalculated. Confirm with the user first.",
		Annotations: destructive("Delete a price"),
	}, handleWrite(tools, "delete", tools.deletePrice, func(in priceIDInput, out DeleteResult) auditRef {
		return auditRef{recordType: "price", ids: mustIDs(out.DeletedIDs...)}
	}))
}

type instrumentRefInput struct {
	InstrumentID  string `json:"instrumentId,omitempty"`
	ExternalID    string `json:"externalId,omitempty" jsonschema:"Broker or source ID, such as ibkr:conid:12345."`
	ISIN          string `json:"isin,omitempty"`
	Symbol        string `json:"symbol,omitempty"`
	ExchangeMIC   string `json:"exchangeMic,omitempty" jsonschema:"ISO 10383 market identifier, such as XLON."`
	Name          string `json:"name,omitempty" jsonschema:"Needed only to create a missing instrument."`
	AssetType     string `json:"assetType,omitempty" jsonschema:"stock, etf, or fund; needed only to create a missing instrument."`
	QuoteCurrency string `json:"quoteCurrency,omitempty" jsonschema:"Needed only to create a missing instrument."`
}

func (input instrumentRefInput) ref() (service.InstrumentRef, error) {
	id, err := optionalUUIDArg("instrumentId", input.InstrumentID)
	if err != nil {
		return service.InstrumentRef{}, err
	}
	return service.InstrumentRef{InstrumentID: id, ExternalID: input.ExternalID, ISIN: input.ISIN, Symbol: input.Symbol, ExchangeMIC: input.ExchangeMIC,
		Name: input.Name, AssetType: input.AssetType, QuoteCurrency: input.QuoteCurrency}, nil
}

type PriceItem struct {
	Date     string `json:"date"`
	Price    string `json:"price"`
	Currency string `json:"currency"`
	Source   string `json:"source"`
}

type InstrumentItem struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Symbol         string     `json:"symbol,omitempty"`
	IdentifierType string     `json:"identifierType"`
	Identifier     string     `json:"identifier,omitempty"`
	ExchangeMIC    string     `json:"exchangeMic,omitempty"`
	ExternalID     string     `json:"externalId,omitempty"`
	AssetType      string     `json:"assetType"`
	QuoteCurrency  string     `json:"quoteCurrency"`
	Archived       bool       `json:"archived"`
	LatestPrice    *PriceItem `json:"latestPrice,omitempty" jsonschema:"Latest recorded price; check its date, it may be stale."`
}

func instrumentItem(instrument service.Instrument) InstrumentItem {
	text := func(value *string) string {
		if value == nil {
			return ""
		}
		return *value
	}
	item := InstrumentItem{ID: instrument.ID.String(), Name: instrument.Name, Symbol: text(instrument.Symbol), IdentifierType: instrument.IdentifierType,
		Identifier: text(instrument.Identifier), ExchangeMIC: text(instrument.ExchangeMIC), ExternalID: text(instrument.ExternalID),
		AssetType: instrument.AssetType, QuoteCurrency: instrument.QuoteCurrency, Archived: instrument.ArchivedAt != nil}
	if price := instrument.LatestPrice; price != nil {
		item.LatestPrice = &PriceItem{Date: price.EffectiveDate.Format(time.DateOnly), Price: price.Price, Currency: price.Currency, Source: price.Source}
	}
	return item
}

type listInstrumentsInput struct {
	IncludeArchived bool `json:"includeArchived,omitempty"`
}

type InstrumentsResult struct {
	Instruments []InstrumentItem `json:"instruments"`
}

func (tools *toolset) listInstruments(ctx context.Context, userID uuid.UUID, input listInstrumentsInput) (InstrumentsResult, error) {
	instruments, err := tools.readers.Manage.Features.Instruments(ctx, userID)
	if err != nil {
		return InstrumentsResult{}, err
	}
	result := InstrumentsResult{Instruments: []InstrumentItem{}}
	for _, instrument := range instruments {
		if instrument.ArchivedAt != nil && !input.IncludeArchived {
			continue
		}
		result.Instruments = append(result.Instruments, instrumentItem(instrument))
	}
	return result, nil
}

type createInstrumentInput struct {
	Name          string `json:"name"`
	Symbol        string `json:"symbol,omitempty"`
	ISIN          string `json:"isin,omitempty"`
	ExchangeMIC   string `json:"exchangeMic,omitempty"`
	ExternalID    string `json:"externalId,omitempty" jsonschema:"Broker or source ID, unique per user."`
	AssetType     string `json:"assetType" jsonschema:"stock, etf, or fund."`
	QuoteCurrency string `json:"quoteCurrency"`
}

func (tools *toolset) instrumentResult(ctx context.Context, userID, instrumentID uuid.UUID) (InstrumentItem, error) {
	detail, err := tools.readers.Manage.Features.Instrument(ctx, userID, instrumentID)
	if err != nil {
		return InstrumentItem{}, err
	}
	return instrumentItem(detail.Instrument), nil
}

func instrumentIdentity(isin, symbol, mic, externalID string) (string, string) {
	switch {
	case strings.TrimSpace(isin) != "":
		return "isin", isin
	case strings.TrimSpace(symbol) != "" && strings.TrimSpace(mic) != "":
		return "ticker_exchange", symbol
	case strings.TrimSpace(externalID) != "":
		return "custom", externalID
	}
	return "custom", symbol
}

func (tools *toolset) createInstrument(ctx context.Context, userID uuid.UUID, input createInstrumentInput) (InstrumentItem, error) {
	identifierType, identifier := instrumentIdentity(input.ISIN, input.Symbol, input.ExchangeMIC, input.ExternalID)
	id, err := tools.readers.Manage.Investments.CreateInstrument(ctx, userID, service.InstrumentMutationInput{
		ExternalID: input.ExternalID, Name: input.Name, Symbol: input.Symbol, IdentifierType: identifierType, Identifier: identifier,
		ExchangeMIC: input.ExchangeMIC, AssetType: strings.ToLower(strings.TrimSpace(input.AssetType)), QuoteCurrency: input.QuoteCurrency,
	})
	if err != nil {
		return InstrumentItem{}, err
	}
	return tools.instrumentResult(ctx, userID, id)
}

type updateInstrumentInput struct {
	InstrumentID  string  `json:"instrumentId"`
	Name          *string `json:"name,omitempty"`
	Symbol        *string `json:"symbol,omitempty"`
	ISIN          *string `json:"isin,omitempty" jsonschema:"Sets the identifier to this ISIN."`
	ExchangeMIC   *string `json:"exchangeMic,omitempty"`
	ExternalID    *string `json:"externalId,omitempty"`
	AssetType     *string `json:"assetType,omitempty"`
	QuoteCurrency *string `json:"quoteCurrency,omitempty"`
}

func (tools *toolset) updateInstrument(ctx context.Context, userID uuid.UUID, input updateInstrumentInput) (InstrumentItem, error) {
	instrumentID, err := parseID("instrumentId", input.InstrumentID)
	if err != nil {
		return InstrumentItem{}, err
	}
	current, err := tools.instrumentResult(ctx, userID, instrumentID)
	if err != nil {
		return InstrumentItem{}, err
	}
	mutation := service.InstrumentMutationInput{ExternalID: current.ExternalID, Name: current.Name, Symbol: current.Symbol, IdentifierType: current.IdentifierType,
		Identifier: current.Identifier, ExchangeMIC: current.ExchangeMIC, AssetType: current.AssetType, QuoteCurrency: current.QuoteCurrency}
	set := func(target *string, value *string) {
		if value != nil {
			*target = *value
		}
	}
	set(&mutation.Name, input.Name)
	set(&mutation.Symbol, input.Symbol)
	set(&mutation.ExchangeMIC, input.ExchangeMIC)
	set(&mutation.ExternalID, input.ExternalID)
	set(&mutation.AssetType, input.AssetType)
	set(&mutation.QuoteCurrency, input.QuoteCurrency)
	if input.ISIN != nil {
		mutation.IdentifierType, mutation.Identifier = "isin", *input.ISIN
	} else if mutation.IdentifierType == "ticker_exchange" && input.Symbol != nil {
		mutation.Identifier = *input.Symbol
	}
	if err := tools.readers.Manage.Investments.UpdateInstrument(ctx, userID, instrumentID, mutation); err != nil {
		return InstrumentItem{}, err
	}
	return tools.instrumentResult(ctx, userID, instrumentID)
}

type priceHistoryInput struct {
	InstrumentID string `json:"instrumentId"`
	From         string `json:"from,omitempty"`
	To           string `json:"to,omitempty"`
	Limit        int    `json:"limit,omitempty" jsonschema:"At most 100 prices; defaults to 100."`
}

type PricePointItem struct {
	ID       string `json:"id"`
	Date     string `json:"date"`
	Price    string `json:"price"`
	Currency string `json:"currency"`
	Source   string `json:"source"`
	Category string `json:"category" jsonschema:"current (the latest, within the staleness threshold), stale (the latest, but too old), or historical."`
	AgeDays  int    `json:"ageDays"`
}

type PriceHistoryOutput struct {
	InstrumentID   string           `json:"instrumentId"`
	Name           string           `json:"name"`
	Symbol         string           `json:"symbol,omitempty"`
	QuoteCurrency  string           `json:"quoteCurrency"`
	AsOf           string           `json:"asOf"`
	StaleAfterDays int              `json:"staleAfterDays"`
	Stale          bool             `json:"stale" jsonschema:"True when the latest price is stale."`
	Prices         []PricePointItem `json:"prices"`
	HasMore        bool             `json:"hasMore"`
	Notice         string           `json:"notice"`
}

func (tools *toolset) priceHistory(ctx context.Context, userID uuid.UUID, input priceHistoryInput) (PriceHistoryOutput, error) {
	instrumentID, err := parseID("instrumentId", input.InstrumentID)
	if err != nil {
		return PriceHistoryOutput{}, err
	}
	if input.Limit < 0 || input.Limit > service.MaxReadLimit {
		return PriceHistoryOutput{}, invalid("limit must be between 1 and %d", service.MaxReadLimit)
	}
	from, to, err := dateRange(input.From, input.To)
	if err != nil {
		return PriceHistoryOutput{}, err
	}
	history, err := tools.readers.Manage.Features.PriceHistory(ctx, userID, instrumentID, from, to, input.Limit)
	if err != nil {
		return PriceHistoryOutput{}, err
	}
	result := PriceHistoryOutput{InstrumentID: history.InstrumentID.String(), Name: history.Name, Symbol: history.Symbol, QuoteCurrency: history.QuoteCurrency,
		AsOf: history.AsOf, StaleAfterDays: history.StaleAfter, Stale: history.Stale, HasMore: history.HasMore, Prices: []PricePointItem{}, Notice: priceNotice}
	for _, point := range history.Prices {
		result.Prices = append(result.Prices, PricePointItem{ID: point.ID.String(), Date: point.Date, Price: point.Price, Currency: point.Currency,
			Source: point.Source, Category: point.PriceCategory, AgeDays: point.AgeDays})
	}
	return result, nil
}

type positionInput struct {
	Instrument instrumentRefInput `json:"instrument"`
	Quantity   string             `json:"quantity" jsonschema:"Units held on asOf as a plain decimal, at full precision; 0 closes the position."`
	UnitPrice  string             `json:"unitPrice,omitempty" jsonschema:"Optional price on asOf in the quote currency."`
	Currency   string             `json:"currency,omitempty" jsonschema:"Currency of unitPrice; must equal the instrument's quote currency."`
}

type positionSyncInput struct {
	AccountID                string            `json:"accountId" jsonschema:"An investment (position-tracked) account."`
	AsOf                     string            `json:"asOf" jsonschema:"Snapshot date, YYYY-MM-DD."`
	Source                   string            `json:"source,omitempty" jsonschema:"Such as interactive_brokers."`
	Positions                []positionInput   `json:"positions,omitempty" jsonschema:"Up to 1,000 holdings."`
	Cash                     map[string]string `json:"cash,omitempty" jsonschema:"Cash by currency, such as {\"USD\": \"96.39\"}; only the account currency is accepted."`
	CloseMissing             bool              `json:"closeMissing,omitempty" jsonschema:"Treat held instruments missing from positions as sold out (quantity 0)."`
	CreateMissingInstruments bool              `json:"createMissingInstruments,omitempty" jsonschema:"Create unknown instruments from name, assetType, quoteCurrency, and an isin, symbol with exchangeMic, or externalId."`
	DryRun                   bool              `json:"dryRun,omitempty"`
	IdempotencyKey           string            `json:"idempotencyKey,omitempty" jsonschema:"Optional UUID; a retry with the same key and snapshot returns the original result."`
}

type PositionRowItem struct {
	Index            int    `json:"index" jsonschema:"Position number in the request; 0 for instruments closed by closeMissing."`
	InstrumentID     string `json:"instrumentId,omitempty"`
	Name             string `json:"name,omitempty"`
	Symbol           string `json:"symbol,omitempty"`
	Status           string `json:"status" jsonschema:"updated, confirmed, unchanged, historical, closed, or rejected."`
	Code             string `json:"code"`
	Message          string `json:"message"`
	PreviousQuantity string `json:"previousQuantity,omitempty" jsonschema:"Quantity Wealthboard had on asOf before this sync."`
	Quantity         string `json:"quantity,omitempty"`
	PriceRecorded    bool   `json:"priceRecorded"`
}

type CashRowItem struct {
	Previous Money  `json:"previous"`
	Target   Money  `json:"target"`
	Status   string `json:"status"`
}

type PositionSyncOutput struct {
	ImportID           string            `json:"importId,omitempty"`
	Status             string            `json:"status" jsonschema:"preview, completed, unchanged, rejected, or replayed."`
	AccountID          string            `json:"accountId"`
	AccountName        string            `json:"accountName"`
	AsOf               string            `json:"asOf"`
	Positions          []PositionRowItem `json:"positions"`
	Cash               *CashRowItem      `json:"cash,omitempty"`
	AccountValueBefore Money             `json:"accountValueBefore"`
	AccountValueAfter  Money             `json:"accountValueAfter"`
	InstrumentsCreated int               `json:"instrumentsCreated"`
	PricesRecorded     int               `json:"pricesRecorded"`
	ReplacedSnapshots  int               `json:"replacedSnapshots"`
	Warnings           []string          `json:"warnings"`
}

func (tools *toolset) syncPositions(ctx context.Context, userID uuid.UUID, input positionSyncInput) (PositionSyncOutput, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return PositionSyncOutput{}, err
	}
	asOf, err := requiredDate("asOf", input.AsOf)
	if err != nil {
		return PositionSyncOutput{}, err
	}
	key, err := idempotencyArg(input.IdempotencyKey, false)
	if err != nil {
		return PositionSyncOutput{}, err
	}
	request := service.PositionSyncInput{AccountID: accountID, AsOf: asOf, Source: input.Source, IdempotencyKey: key, DryRun: input.DryRun,
		CloseMissing: input.CloseMissing, CreateMissingInstruments: input.CreateMissingInstruments, Cash: map[string]string{}}
	for currency, amount := range input.Cash {
		request.Cash[domain.NormalizeCurrency(currency)] = amount
	}
	for _, position := range input.Positions {
		ref, err := position.Instrument.ref()
		if err != nil {
			return PositionSyncOutput{}, err
		}
		request.Positions = append(request.Positions, service.PositionSnapshotInput{Instrument: ref, Quantity: position.Quantity, UnitPrice: position.UnitPrice, Currency: position.Currency})
	}
	result, err := tools.readers.Manage.Investments.SyncPositions(ctx, userID, request)
	if err != nil {
		return PositionSyncOutput{}, err
	}
	currency := result.Currency
	output := PositionSyncOutput{Status: result.Status, AccountID: result.AccountID.String(), AccountName: result.AccountName, AsOf: result.AsOf, Positions: []PositionRowItem{},
		AccountValueBefore: moneyMinor(result.AccountValueBeforeMinor, currency), AccountValueAfter: moneyMinor(result.AccountValueAfterMinor, currency),
		InstrumentsCreated: result.InstrumentsCreated, PricesRecorded: result.PricesRecorded, ReplacedSnapshots: result.ReplacedSnapshots, Warnings: nonNil(result.Warnings)}
	if result.ImportID != nil {
		output.ImportID = result.ImportID.String()
	}
	for _, row := range result.Positions {
		output.Positions = append(output.Positions, PositionRowItem{Index: row.Index, InstrumentID: row.InstrumentID, Name: row.Name, Symbol: row.Symbol, Status: row.Status,
			Code: row.Code, Message: row.Message, PreviousQuantity: row.PreviousQuantity, Quantity: row.Quantity, PriceRecorded: row.PriceRecorded})
	}
	if cash := result.Cash; cash != nil {
		output.Cash = &CashRowItem{Previous: moneyMinor(cash.PreviousMinor, cash.Currency), Target: moneyMinor(cash.TargetMinor, cash.Currency), Status: cash.Status}
	}
	return output, nil
}

func (tools *toolset) bulkUpsertPositions(ctx context.Context, userID uuid.UUID, input positionSyncInput) (PositionSyncOutput, error) {
	if len(input.Positions) == 0 && len(input.Cash) == 0 && !input.CloseMissing {
		return PositionSyncOutput{}, invalid("send positions, cash, or closeMissing")
	}
	return tools.syncPositions(ctx, userID, input)
}

type upsertPositionInput struct {
	AccountID                string             `json:"accountId"`
	AsOf                     string             `json:"asOf" jsonschema:"Snapshot date, YYYY-MM-DD."`
	Source                   string             `json:"source,omitempty"`
	Instrument               instrumentRefInput `json:"instrument"`
	Quantity                 string             `json:"quantity"`
	UnitPrice                string             `json:"unitPrice,omitempty"`
	Currency                 string             `json:"currency,omitempty"`
	CreateMissingInstruments bool               `json:"createMissingInstruments,omitempty"`
	DryRun                   bool               `json:"dryRun,omitempty"`
}

func (tools *toolset) upsertPosition(ctx context.Context, userID uuid.UUID, input upsertPositionInput) (PositionSyncOutput, error) {
	return tools.syncPositions(ctx, userID, positionSyncInput{AccountID: input.AccountID, AsOf: input.AsOf, Source: input.Source, DryRun: input.DryRun,
		CreateMissingInstruments: input.CreateMissingInstruments,
		Positions:                []positionInput{{Instrument: input.Instrument, Quantity: input.Quantity, UnitPrice: input.UnitPrice, Currency: input.Currency}}})
}

type cashBalanceInput struct {
	AccountID string `json:"accountId" jsonschema:"An investment (position-tracked) account."`
	AsOf      string `json:"asOf" jsonschema:"Statement date, YYYY-MM-DD."`
	Amount    string `json:"amount" jsonschema:"Cash on that date as a plain decimal in the account currency."`
	Currency  string `json:"currency,omitempty" jsonschema:"Must equal the account currency."`
	Source    string `json:"source,omitempty"`
	DryRun    bool   `json:"dryRun,omitempty"`
}

func (tools *toolset) updateCashBalance(ctx context.Context, userID uuid.UUID, input cashBalanceInput) (PositionSyncOutput, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return PositionSyncOutput{}, err
	}
	currency := domain.NormalizeCurrency(input.Currency)
	if currency == "" {
		account, err := tools.readers.Core.Account(ctx, userID, accountID)
		if err != nil {
			return PositionSyncOutput{}, err
		}
		currency = account.Currency
	}
	return tools.syncPositions(ctx, userID, positionSyncInput{AccountID: input.AccountID, AsOf: input.AsOf, Source: input.Source, DryRun: input.DryRun,
		Cash: map[string]string{currency: input.Amount}})
}

type deletePositionInput struct {
	AccountID     string             `json:"accountId"`
	Instrument    instrumentRefInput `json:"instrument"`
	AsOf          string             `json:"asOf,omitempty" jsonschema:"Only the snapshot (and with includeTrades, the activity) on this date."`
	IncludeTrades bool               `json:"includeTrades,omitempty" jsonschema:"Also delete this instrument's trades and adjustments."`
}

type DeletePositionOutput struct {
	InstrumentID      string         `json:"instrumentId"`
	DeletedSnapshots  int            `json:"deletedSnapshots"`
	DeletedTrades     int            `json:"deletedTrades"`
	RemainingQuantity string         `json:"remainingQuantity"`
	Account           AccountSummary `json:"account"`
	Warnings          []string       `json:"warnings"`
}

func (tools *toolset) deletePosition(ctx context.Context, userID uuid.UUID, input deletePositionInput) (DeletePositionOutput, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return DeletePositionOutput{}, err
	}
	ref, err := input.Instrument.ref()
	if err != nil {
		return DeletePositionOutput{}, err
	}
	asOf, err := parseDate("asOf", strings.TrimSpace(input.AsOf))
	if err != nil {
		return DeletePositionOutput{}, err
	}
	result, err := tools.readers.Manage.Investments.DeletePosition(ctx, userID, accountID, ref, asOf, input.IncludeTrades)
	if err != nil {
		return DeletePositionOutput{}, err
	}
	account, err := tools.accountAfterWrite(ctx, userID, accountID)
	return DeletePositionOutput{InstrumentID: result.InstrumentID.String(), DeletedSnapshots: result.DeletedSnapshots, DeletedTrades: result.DeletedTrades,
		RemainingQuantity: result.RemainingQuantity, Account: account, Warnings: nonNil(result.Warnings)}, err
}

type tradeInput struct {
	Instrument         instrumentRefInput `json:"instrument"`
	ExternalID         string             `json:"externalId,omitempty" jsonschema:"The broker's trade or execution ID."`
	TradeDate          string             `json:"tradeDate" jsonschema:"YYYY-MM-DD."`
	SettlementDate     string             `json:"settlementDate,omitempty"`
	Side               string             `json:"side" jsonschema:"buy or sell."`
	Quantity           string             `json:"quantity" jsonschema:"Units as a positive plain decimal at full precision."`
	Price              string             `json:"price" jsonschema:"Execution price per unit in the trade currency."`
	Currency           string             `json:"currency,omitempty" jsonschema:"Trade currency; defaults to the instrument's quote currency."`
	Commission         string             `json:"commission,omitempty"`
	CommissionCurrency string             `json:"commissionCurrency,omitempty" jsonschema:"Defaults to the trade currency; otherFees use the same currency."`
	OtherFees          string             `json:"otherFees,omitempty"`
	NetCash            string             `json:"netCash,omitempty" jsonschema:"Settled amount in the account currency, including fees; required for cross-currency trades unless fxRate is given."`
	FxRate             string             `json:"fxRate,omitempty" jsonschema:"Trade-to-account currency rate applied by the broker."`
	Description        string             `json:"description,omitempty"`
}

type tradeImportInput struct {
	AccountID                string       `json:"accountId" jsonschema:"An investment (position-tracked) account."`
	Source                   string       `json:"source,omitempty"`
	Trades                   []tradeInput `json:"trades" jsonschema:"Up to 1,000 trades."`
	AllowPartial             bool         `json:"allowPartial,omitempty"`
	CreateMissingInstruments bool         `json:"createMissingInstruments,omitempty"`
	DryRun                   bool         `json:"dryRun,omitempty"`
	IdempotencyKey           string       `json:"idempotencyKey,omitempty"`
}

type recordTradeInput struct {
	AccountID string `json:"accountId"`
	tradeInput
	CreateMissingInstruments bool `json:"createMissingInstruments,omitempty"`
}

type TradeRowItem struct {
	Index          int    `json:"index"`
	ExternalID     string `json:"externalId,omitempty"`
	TradeDate      string `json:"tradeDate"`
	Side           string `json:"side"`
	Quantity       string `json:"quantity"`
	Price          string `json:"price"`
	InstrumentID   string `json:"instrumentId,omitempty"`
	Symbol         string `json:"symbol,omitempty"`
	Status         string `json:"status" jsonschema:"create, created, duplicate, conflict, rejected, or not_imported."`
	Code           string `json:"code"`
	Message        string `json:"message"`
	EventID        string `json:"eventId,omitempty"`
	MatchedEventID string `json:"matchedEventId,omitempty"`
}

type TradeImportOutput struct {
	ImportID           string         `json:"importId,omitempty"`
	Status             string         `json:"status"`
	AccountID          string         `json:"accountId"`
	AccountName        string         `json:"accountName"`
	Created            int            `json:"created"`
	Skipped            int            `json:"skipped"`
	Duplicates         int            `json:"duplicates"`
	Conflicts          int            `json:"conflicts"`
	Rejected           int            `json:"rejected"`
	InstrumentsCreated int            `json:"instrumentsCreated"`
	AccountValueBefore Money          `json:"accountValueBefore"`
	AccountValueAfter  Money          `json:"accountValueAfter"`
	CashBefore         Money          `json:"cashBefore"`
	CashAfter          Money          `json:"cashAfter"`
	Warnings           []string       `json:"warnings"`
	Rows               []TradeRowItem `json:"rows"`
}

func (tools *toolset) importTrades(ctx context.Context, userID uuid.UUID, input tradeImportInput) (TradeImportOutput, error) {
	accountID, err := parseID("accountId", input.AccountID)
	if err != nil {
		return TradeImportOutput{}, err
	}
	key, err := idempotencyArg(input.IdempotencyKey, false)
	if err != nil {
		return TradeImportOutput{}, err
	}
	request := service.TradeImportInput{AccountID: accountID, Source: input.Source, IdempotencyKey: key, DryRun: input.DryRun,
		AllowPartial: input.AllowPartial, CreateMissingInstruments: input.CreateMissingInstruments}
	for _, trade := range input.Trades {
		ref, err := trade.Instrument.ref()
		if err != nil {
			return TradeImportOutput{}, err
		}
		request.Trades = append(request.Trades, service.TradeInput{Instrument: ref, ExternalID: trade.ExternalID, TradeDate: trade.TradeDate, SettlementDate: trade.SettlementDate,
			Side: trade.Side, Quantity: trade.Quantity, Price: trade.Price, Currency: trade.Currency, Commission: trade.Commission, CommissionCurrency: trade.CommissionCurrency,
			OtherFees: trade.OtherFees, NetCash: trade.NetCash, FxRate: trade.FxRate, Description: trade.Description})
	}
	result, err := tools.readers.Manage.Investments.ImportTrades(ctx, userID, request)
	if err != nil {
		return TradeImportOutput{}, err
	}
	currency := result.Currency
	output := TradeImportOutput{Status: result.Status, AccountID: result.AccountID.String(), AccountName: result.AccountName, Created: result.Created, Skipped: result.Skipped,
		Duplicates: result.Duplicates, Conflicts: result.Conflicts, Rejected: result.Rejected, InstrumentsCreated: result.InstrumentsCreated,
		AccountValueBefore: moneyMinor(result.AccountValueBeforeMinor, currency), AccountValueAfter: moneyMinor(result.AccountValueAfterMinor, currency),
		CashBefore: moneyMinor(result.CashBeforeMinor, currency), CashAfter: moneyMinor(result.CashAfterMinor, currency), Warnings: nonNil(result.Warnings), Rows: []TradeRowItem{}}
	if result.ImportID != nil {
		output.ImportID = result.ImportID.String()
	}
	for _, row := range result.Rows {
		output.Rows = append(output.Rows, TradeRowItem{Index: row.Index, ExternalID: row.ExternalID, TradeDate: row.TradeDate, Side: row.Side, Quantity: row.Quantity,
			Price: row.Price, InstrumentID: row.InstrumentID, Symbol: row.Symbol, Status: row.Status, Code: row.Code, Message: row.Message,
			EventID: optionalID(row.EventID), MatchedEventID: optionalID(row.MatchedEventID)})
	}
	return output, nil
}

func (tools *toolset) bulkImportTrades(ctx context.Context, userID uuid.UUID, input tradeImportInput) (TradeImportOutput, error) {
	if len(input.Trades) == 0 || len(input.Trades) > service.MaxPositionSyncRecords {
		return TradeImportOutput{}, invalid("send between 1 and %d trades", service.MaxPositionSyncRecords)
	}
	return tools.importTrades(ctx, userID, input)
}

func (tools *toolset) recordTrade(ctx context.Context, userID uuid.UUID, input recordTradeInput) (TradeImportOutput, error) {
	return tools.importTrades(ctx, userID, tradeImportInput{AccountID: input.AccountID, Trades: []tradeInput{input.tradeInput}, CreateMissingInstruments: input.CreateMissingInstruments})
}

type priceInput struct {
	Instrument instrumentRefInput `json:"instrument"`
	Date       string             `json:"date" jsonschema:"Price date, YYYY-MM-DD."`
	Price      string             `json:"price" jsonschema:"Unit price as a plain decimal in the quote currency."`
	Currency   string             `json:"currency,omitempty" jsonschema:"Must equal the instrument's quote currency."`
	Source     string             `json:"source,omitempty" jsonschema:"Where the price comes from, such as interactive_brokers."`
}

type bulkPriceInput struct {
	Prices []priceInput `json:"prices" jsonschema:"Up to 1,000 prices."`
}

type priceIDInput struct {
	PriceID string `json:"priceId" jsonschema:"Price ID from get_price_history."`
}

type PriceRowItem struct {
	Index        int    `json:"index"`
	InstrumentID string `json:"instrumentId,omitempty"`
	Symbol       string `json:"symbol,omitempty"`
	Date         string `json:"date"`
	Price        string `json:"price"`
	Currency     string `json:"currency,omitempty"`
	Status       string `json:"status" jsonschema:"created, updated, unchanged, or rejected."`
	Code         string `json:"code"`
	Message      string `json:"message"`
	PriceID      string `json:"priceId,omitempty"`
	Historical   bool   `json:"historical" jsonschema:"True when a newer price exists, so current values don't use this one."`
	LatestDate   string `json:"latestDate,omitempty"`
}

type PriceUpdateOutput struct {
	Status    string         `json:"status"`
	Created   int            `json:"created"`
	Updated   int            `json:"updated"`
	Unchanged int            `json:"unchanged"`
	Rejected  int            `json:"rejected"`
	Rows      []PriceRowItem `json:"rows"`
	Warnings  []string       `json:"warnings"`
	Notice    string         `json:"notice"`
}

func (tools *toolset) upsertPrices(ctx context.Context, userID uuid.UUID, prices []priceInput) (PriceUpdateOutput, error) {
	if len(prices) == 0 || len(prices) > service.MaxPositionSyncRecords {
		return PriceUpdateOutput{}, invalid("send between 1 and %d prices", service.MaxPositionSyncRecords)
	}
	request := []service.PriceInput{}
	for _, price := range prices {
		ref, err := price.Instrument.ref()
		if err != nil {
			return PriceUpdateOutput{}, err
		}
		request = append(request, service.PriceInput{Instrument: ref, Date: price.Date, Price: price.Price, Currency: price.Currency, Source: price.Source})
	}
	result, err := tools.readers.Manage.Investments.BulkUpsertPrices(ctx, userID, request)
	if err != nil {
		return PriceUpdateOutput{}, err
	}
	output := PriceUpdateOutput{Status: result.Status, Created: result.Created, Updated: result.Updated, Unchanged: result.Unchanged, Rejected: result.Rejected,
		Rows: []PriceRowItem{}, Warnings: nonNil(result.Warnings), Notice: priceNotice}
	for _, row := range result.Rows {
		output.Rows = append(output.Rows, PriceRowItem{Index: row.Index, InstrumentID: row.InstrumentID, Symbol: row.Symbol, Date: row.Date, Price: row.Price,
			Currency: row.Currency, Status: row.Status, Code: row.Code, Message: row.Message, PriceID: optionalID(row.PriceID), Historical: row.Historical, LatestDate: row.LatestDate})
	}
	return output, nil
}

func (tools *toolset) updatePrice(ctx context.Context, userID uuid.UUID, input priceInput) (PriceUpdateOutput, error) {
	return tools.upsertPrices(ctx, userID, []priceInput{input})
}

func (tools *toolset) bulkUpdatePrices(ctx context.Context, userID uuid.UUID, input bulkPriceInput) (PriceUpdateOutput, error) {
	return tools.upsertPrices(ctx, userID, input.Prices)
}

func (tools *toolset) deletePrice(ctx context.Context, userID uuid.UUID, input priceIDInput) (DeleteResult, error) {
	priceID, err := parseID("priceId", input.PriceID)
	if err != nil {
		return DeleteResult{}, err
	}
	if err := tools.readers.Manage.Investments.DeleteSecurityPrice(ctx, userID, priceID); err != nil {
		return DeleteResult{}, err
	}
	return DeleteResult{DeletedIDs: []string{priceID.String()}, Accounts: []AccountSummary{}}, nil
}
