package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ExchangeRateUpsert struct {
	BaseCurrency  string `json:"baseCurrency"`
	QuoteCurrency string `json:"quoteCurrency"`
	Rate          string `json:"rate"`
	EffectiveDate string `json:"effectiveDate"`
	Source        string `json:"source,omitempty"`
}

type ExchangeRateRow struct {
	Index         int        `json:"index"`
	BaseCurrency  string     `json:"baseCurrency"`
	QuoteCurrency string     `json:"quoteCurrency"`
	Rate          string     `json:"rate"`
	EffectiveDate string     `json:"effectiveDate"`
	Status        string     `json:"status"`
	Message       string     `json:"message"`
	RateID        *uuid.UUID `json:"rateId,omitempty"`
	Historical    bool       `json:"historical"`
}

type ExchangeRateUpsertResult struct {
	Status    string            `json:"status"`
	Created   int               `json:"created"`
	Updated   int               `json:"updated"`
	Unchanged int               `json:"unchanged"`
	Rejected  int               `json:"rejected"`
	Rows      []ExchangeRateRow `json:"rows"`
	Warnings  []string          `json:"warnings"`
}

// UpsertExchangeRates stores effective-dated rates atomically. A rate for a pair and date
// that already exists is replaced. Reports convert at read time with the latest rate
// effective on each date; investment account values cached at write time are recalculated.
func (service *MetadataMutations) UpsertExchangeRates(ctx context.Context, userID uuid.UUID, inputs []ExchangeRateUpsert) (ExchangeRateUpsertResult, error) {
	if len(inputs) == 0 || len(inputs) > MaxPositionSyncRecords {
		return ExchangeRateUpsertResult{}, validation(fmt.Sprintf("send between 1 and %d rates", MaxPositionSyncRecords))
	}
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return ExchangeRateUpsertResult{}, fmt.Errorf("begin exchange rate upsert: %w", err)
	}
	defer tx.Rollback()
	result := ExchangeRateUpsertResult{Rows: make([]ExchangeRateRow, len(inputs)), Warnings: []string{}}
	type ready struct {
		input  ExchangeRateInput
		date   time.Time
		source string
	}
	prepared := make([]*ready, len(inputs))
	seen := map[string]bool{}
	for index, raw := range inputs {
		row := &result.Rows[index]
		input := ExchangeRateInput{BaseCurrency: raw.BaseCurrency, QuoteCurrency: raw.QuoteCurrency, Rate: raw.Rate, EffectiveDate: raw.EffectiveDate}
		date, err := validateExchangeRate(&input)
		row.Index, row.BaseCurrency, row.QuoteCurrency, row.Rate, row.EffectiveDate = index+1, input.BaseCurrency, input.QuoteCurrency, input.Rate, input.EffectiveDate
		reject := func(message string) { row.Status, row.Message = "rejected", message }
		if err != nil {
			reject(metadataDetail(err))
			continue
		}
		if err := (&LedgerService{db: service.db, now: service.now}).validateDate(ctx, userID, date); err != nil {
			reject("Exchange rates can't be dated in the future.")
			continue
		}
		source := strings.TrimSpace(raw.Source)
		if source == "" {
			source = "assistant"
		}
		if len(source) > 100 {
			reject("source must be at most 100 characters.")
			continue
		}
		var enabled bool
		if err := tx.QueryRowContext(ctx, `SELECT (base_currency=$2 OR supported_currencies::jsonb ? $2) AND (base_currency=$3 OR supported_currencies::jsonb ? $3) FROM user_settings WHERE user_id=$1`,
			userID, input.BaseCurrency, input.QuoteCurrency).Scan(&enabled); err != nil {
			return ExchangeRateUpsertResult{}, fmt.Errorf("check enabled currencies: %w", err)
		}
		if !enabled {
			reject("Enable both currencies in Wealthboard settings first.")
			continue
		}
		var reverse bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM exchange_rates WHERE user_id=$1 AND base_currency=$2 AND quote_currency=$3)`, userID, input.QuoteCurrency, input.BaseCurrency).Scan(&reverse); err != nil {
			return ExchangeRateUpsertResult{}, fmt.Errorf("check reverse pair: %w", err)
		}
		if reverse {
			reject(fmt.Sprintf("Use the existing %s/%s pair; its inverse is calculated automatically.", input.QuoteCurrency, input.BaseCurrency))
			continue
		}
		key := input.BaseCurrency + input.QuoteCurrency + input.EffectiveDate
		if seen[key] {
			reject("This pair and date appear more than once.")
			continue
		}
		seen[key] = true
		prepared[index] = &ready{input, date, source}
	}
	for _, row := range result.Rows {
		if row.Status == "rejected" {
			result.Rejected++
		}
	}
	if result.Rejected > 0 {
		result.Status = "rejected"
		result.Warnings = append(result.Warnings, "Nothing was stored because some rates were rejected.")
		return result, nil
	}
	now := service.now().UTC()
	for index, item := range prepared {
		row := &result.Rows[index]
		var existingRate, existingSource string
		err := tx.QueryRowContext(ctx, `SELECT rate::TEXT,source FROM exchange_rates WHERE user_id=$1 AND base_currency=$2 AND quote_currency=$3 AND effective_date=$4`,
			userID, item.input.BaseCurrency, item.input.QuoteCurrency, item.date).Scan(&existingRate, &existingSource)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			row.Status, row.Message = "created", "Rate recorded."
			result.Created++
		case err != nil:
			return ExchangeRateUpsertResult{}, fmt.Errorf("load existing rate: %w", err)
		case equalDecimals(existingRate, item.input.Rate) && existingSource == item.source:
			row.Status, row.Message = "unchanged", "The same rate is already recorded for this date."
			result.Unchanged++
		default:
			row.Status, row.Message = "updated", "Replaced the rate recorded for this date."
			result.Updated++
		}
		if row.Status != "unchanged" {
			id := uuid.New()
			if err := tx.QueryRowContext(ctx, `
INSERT INTO exchange_rates (id,user_id,base_currency,quote_currency,rate,effective_date,source,created_at)
VALUES ($1,$2,$3,$4,$5::NUMERIC,$6,$7,$8)
ON CONFLICT (user_id,base_currency,quote_currency,effective_date) DO UPDATE SET rate=EXCLUDED.rate,source=EXCLUDED.source
RETURNING id`, id, userID, item.input.BaseCurrency, item.input.QuoteCurrency, item.input.Rate, item.date, item.source, now).Scan(&id); err != nil {
				return ExchangeRateUpsertResult{}, fmt.Errorf("upsert exchange rate: %w", err)
			}
			row.RateID = &id
		}
		var latest time.Time
		if err := tx.QueryRowContext(ctx, `SELECT MAX(effective_date) FROM exchange_rates WHERE user_id=$1 AND base_currency=$2 AND quote_currency=$3`,
			userID, item.input.BaseCurrency, item.input.QuoteCurrency).Scan(&latest); err != nil {
			return ExchangeRateUpsertResult{}, fmt.Errorf("load latest rate date: %w", err)
		}
		row.Historical = latest.After(item.date)
	}
	if result.Created+result.Updated > 0 {
		investments := &InvestmentMutations{db: service.db, now: service.now}
		rows, err := tx.QueryContext(ctx, `SELECT id FROM accounts WHERE user_id=$1 AND tracking_mode='positions' AND archived_at IS NULL`, userID)
		if err != nil {
			return ExchangeRateUpsertResult{}, fmt.Errorf("list position accounts: %w", err)
		}
		accounts := []uuid.UUID{}
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return ExchangeRateUpsertResult{}, fmt.Errorf("scan position account: %w", err)
			}
			accounts = append(accounts, id)
		}
		if err := rows.Close(); err != nil {
			return ExchangeRateUpsertResult{}, err
		}
		for _, accountID := range accounts {
			if err := investments.recalculatePositionAccount(ctx, tx, userID, accountID); err != nil {
				return ExchangeRateUpsertResult{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return ExchangeRateUpsertResult{}, fmt.Errorf("commit exchange rates: %w", err)
	}
	result.Status = "completed"
	return result, nil
}

func metadataDetail(err error) string {
	var metadata *MetadataError
	if errors.As(err, &metadata) {
		return metadata.Detail
	}
	return "The rate is invalid."
}

type ExchangeRateFilter struct {
	Currency string
	From, To *time.Time
	Page     ReadPage
}

type ExchangeRateRead struct {
	ExchangeRate
	// Latest is true for the newest rate of its pair, the one used for current values.
	Latest bool `json:"latest"`
}

func (service *FeatureReads) ExchangeRates(ctx context.Context, userID uuid.UUID, filter ExchangeRateFilter) (Page[ExchangeRateRead], error) {
	page, err := filter.Page.normalized()
	if err != nil {
		return Page[ExchangeRateRead]{}, err
	}
	var from, to any
	if filter.From != nil {
		from = ledgerDateOnly(*filter.From)
	}
	if filter.To != nil {
		to = ledgerDateOnly(*filter.To)
	}
	rows, err := service.db.QueryContext(ctx, `
SELECT id,base_currency,quote_currency,rate::TEXT,effective_date,source,created_at,
       effective_date = MAX(effective_date) OVER (PARTITION BY base_currency,quote_currency)
FROM exchange_rates
WHERE user_id=$1 AND ($2='' OR base_currency=$2 OR quote_currency=$2)
  AND ($3::DATE IS NULL OR effective_date>=$3) AND ($4::DATE IS NULL OR effective_date<=$4)
ORDER BY base_currency,quote_currency,effective_date DESC LIMIT $5 OFFSET $6`, userID, strings.ToUpper(strings.TrimSpace(filter.Currency)), from, to, page.Limit+1, page.Offset)
	if err != nil {
		return Page[ExchangeRateRead]{}, fmt.Errorf("list exchange rates: %w", err)
	}
	defer rows.Close()
	items := []ExchangeRateRead{}
	for rows.Next() {
		var item ExchangeRateRead
		if err := rows.Scan(&item.ID, &item.BaseCurrency, &item.QuoteCurrency, &item.Rate, &item.EffectiveDate, &item.Source, &item.CreatedAt, &item.Latest); err != nil {
			return Page[ExchangeRateRead]{}, fmt.Errorf("scan exchange rate: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page[ExchangeRateRead]{}, err
	}
	hasMore := len(items) > page.Limit
	if hasMore {
		items = items[:page.Limit]
	}
	return Page[ExchangeRateRead]{Items: items, Limit: page.Limit, Offset: page.Offset, HasMore: hasMore}, nil
}

type PricePoint struct {
	ID            uuid.UUID `json:"id"`
	Date          string    `json:"date"`
	Price         string    `json:"price"`
	Currency      string    `json:"currency"`
	Source        string    `json:"source"`
	Provenance    string    `json:"provenance,omitempty"`
	Latest        bool      `json:"latest"`
	AgeDays       int       `json:"ageDays"`
	PriceCategory string    `json:"priceCategory" jsonschema:"current, stale, or historical."`
}

type PriceHistoryRead struct {
	InstrumentID  uuid.UUID    `json:"instrumentId"`
	Name          string       `json:"name"`
	Symbol        string       `json:"symbol,omitempty"`
	QuoteCurrency string       `json:"quoteCurrency"`
	AsOf          string       `json:"asOf"`
	StaleAfter    int          `json:"staleAfterDays"`
	Stale         bool         `json:"stale"`
	Prices        []PricePoint `json:"prices"`
	HasMore       bool         `json:"hasMore"`
}

// PriceHistory lists recorded prices, newest first. The latest price is "current" while it
// is within the user's staleness threshold for the asset type and "stale" after that; older
// prices are "historical". No price is a live market quote: each is a recorded observation.
func (service *FeatureReads) PriceHistory(ctx context.Context, userID, instrumentID uuid.UUID, from, to *time.Time, limit int) (PriceHistoryRead, error) {
	if limit <= 0 || limit > MaxReadLimit {
		limit = MaxReadLimit
	}
	var result PriceHistoryRead
	var symbol sql.NullString
	var assetType, timezone string
	var stock, etf, fund int
	err := service.db.QueryRowContext(ctx, `
SELECT i.id,i.name,i.symbol,i.quote_currency,i.asset_type,s.timezone,s.position_stale_days_stock,s.position_stale_days_etf,s.position_stale_days_fund
FROM investment_instruments i JOIN user_settings s ON s.user_id=i.user_id
WHERE i.user_id=$1 AND i.id=$2`, userID, instrumentID).Scan(&result.InstrumentID, &result.Name, &symbol, &result.QuoteCurrency, &assetType, &timezone, &stock, &etf, &fund)
	if errors.Is(err, sql.ErrNoRows) {
		return PriceHistoryRead{}, ErrCoreReadNotFound
	}
	if err != nil {
		return PriceHistoryRead{}, fmt.Errorf("load instrument: %w", err)
	}
	result.Symbol = symbol.String
	result.StaleAfter = stock
	switch assetType {
	case "etf":
		result.StaleAfter = etf
	case "fund":
		result.StaleAfter = fund
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return PriceHistoryRead{}, fmt.Errorf("load user timezone: %w", err)
	}
	today, _ := time.Parse(time.DateOnly, service.now().In(location).Format(time.DateOnly))
	result.AsOf = today.Format(time.DateOnly)
	var fromDate, toDate any
	if from != nil {
		fromDate = ledgerDateOnly(*from)
	}
	if to != nil {
		toDate = ledgerDateOnly(*to)
	}
	rows, err := service.db.QueryContext(ctx, `
SELECT id,effective_date,price::TEXT,currency,source,COALESCE(provenance,''),
       effective_date = (SELECT MAX(effective_date) FROM security_prices latest WHERE latest.user_id=$1 AND latest.instrument_id=$2)
FROM security_prices WHERE user_id=$1 AND instrument_id=$2
  AND ($3::DATE IS NULL OR effective_date>=$3) AND ($4::DATE IS NULL OR effective_date<=$4)
ORDER BY effective_date DESC LIMIT $5`, userID, instrumentID, fromDate, toDate, limit+1)
	if err != nil {
		return PriceHistoryRead{}, fmt.Errorf("list prices: %w", err)
	}
	defer rows.Close()
	result.Prices = []PricePoint{}
	for rows.Next() {
		var point PricePoint
		var date time.Time
		if err := rows.Scan(&point.ID, &date, &point.Price, &point.Currency, &point.Source, &point.Provenance, &point.Latest); err != nil {
			return PriceHistoryRead{}, fmt.Errorf("scan price: %w", err)
		}
		point.Date = date.Format(time.DateOnly)
		point.AgeDays = int(today.Sub(date).Hours() / 24)
		point.PriceCategory = "historical"
		if point.Latest {
			point.PriceCategory = "current"
			if point.AgeDays > result.StaleAfter {
				point.PriceCategory, result.Stale = "stale", true
			}
		}
		result.Prices = append(result.Prices, point)
	}
	if len(result.Prices) > limit {
		result.Prices, result.HasMore = result.Prices[:limit], true
	}
	return result, rows.Err()
}

// AuditEntry records one financial change made through the MCP endpoint. It holds IDs
// only, never amounts, descriptions, or other submitted values.
type AuditEntry struct {
	ID            uuid.UUID   `json:"id"`
	Channel       string      `json:"channel"`
	Client        string      `json:"client,omitempty"`
	Tool          string      `json:"tool"`
	Action        string      `json:"action"`
	RecordType    string      `json:"recordType"`
	RecordIDs     []uuid.UUID `json:"recordIds"`
	AccountID     *uuid.UUID  `json:"accountId,omitempty"`
	ImportBatchID *uuid.UUID  `json:"importBatchId,omitempty"`
	CreatedAt     time.Time   `json:"createdAt"`
}

type AuditFilter struct {
	AccountID *uuid.UUID
	Tool      string
	From, To  *time.Time
	Page      ReadPage
}

type AuditLog struct {
	db  *sql.DB
	now func() time.Time
}

func NewAuditLog(db *sql.DB) *AuditLog { return &AuditLog{db: db, now: time.Now} }

const maxAuditRecordIDs = 1000

func (log *AuditLog) Record(ctx context.Context, userID uuid.UUID, entry AuditEntry) error {
	ids := entry.RecordIDs
	if ids == nil {
		ids = []uuid.UUID{}
	}
	if len(ids) > maxAuditRecordIDs {
		ids = ids[:maxAuditRecordIDs]
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return fmt.Errorf("encode audit record IDs: %w", err)
	}
	var account, batch any
	if entry.AccountID != nil {
		account = *entry.AccountID
	}
	if entry.ImportBatchID != nil {
		batch = *entry.ImportBatchID
	}
	_, err = log.db.ExecContext(ctx, `
INSERT INTO audit_events (id,user_id,channel,client,tool,action,record_type,record_ids,account_id,import_batch_id,created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, uuid.New(), userID, entry.Channel, nullable(entry.Client), entry.Tool, entry.Action,
		entry.RecordType, encoded, account, batch, log.now().UTC())
	if err != nil {
		return fmt.Errorf("record audit event: %w", err)
	}
	return nil
}

func (log *AuditLog) List(ctx context.Context, userID uuid.UUID, filter AuditFilter) (Page[AuditEntry], error) {
	page, err := filter.Page.normalized()
	if err != nil {
		return Page[AuditEntry]{}, err
	}
	var account, from, to any
	if filter.AccountID != nil {
		account = *filter.AccountID
	}
	if filter.From != nil {
		from = ledgerDateOnly(*filter.From)
	}
	if filter.To != nil {
		to = ledgerDateOnly(*filter.To).AddDate(0, 0, 1)
	}
	rows, err := log.db.QueryContext(ctx, `
SELECT id,channel,COALESCE(client,''),tool,action,record_type,record_ids,account_id,import_batch_id,created_at
FROM audit_events
WHERE user_id=$1 AND ($2::UUID IS NULL OR account_id=$2) AND ($3='' OR tool=$3)
  AND ($4::TIMESTAMPTZ IS NULL OR created_at>=$4) AND ($5::TIMESTAMPTZ IS NULL OR created_at<$5)
ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7`, userID, account, strings.TrimSpace(filter.Tool), from, to, page.Limit+1, page.Offset)
	if err != nil {
		return Page[AuditEntry]{}, fmt.Errorf("list audit events: %w", err)
	}
	defer rows.Close()
	items := []AuditEntry{}
	for rows.Next() {
		var item AuditEntry
		var ids []byte
		var accountID, batchID uuid.NullUUID
		if err := rows.Scan(&item.ID, &item.Channel, &item.Client, &item.Tool, &item.Action, &item.RecordType, &ids, &accountID, &batchID, &item.CreatedAt); err != nil {
			return Page[AuditEntry]{}, fmt.Errorf("scan audit event: %w", err)
		}
		if err := json.Unmarshal(ids, &item.RecordIDs); err != nil {
			return Page[AuditEntry]{}, fmt.Errorf("decode audit record IDs: %w", err)
		}
		item.AccountID, item.ImportBatchID = uuidPointer(accountID), uuidPointer(batchID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page[AuditEntry]{}, err
	}
	hasMore := len(items) > page.Limit
	if hasMore {
		items = items[:page.Limit]
	}
	return Page[AuditEntry]{Items: items, Limit: page.Limit, Offset: page.Offset, HasMore: hasMore}, nil
}
