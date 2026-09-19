package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
)

const estateCurrentValueWarning = "Account values are cached current values, not a complete effective-dated estate valuation. Position prices and exchange-rate conversion are not replayed by this endpoint."

// FeatureReads provides owner-scoped read models for the Phase 3 settings,
// investment, estate, and AI screens.
type FeatureReads struct {
	db  *sql.DB
	now func() time.Time
}

func NewFeatureReads(db *sql.DB) *FeatureReads {
	return &FeatureReads{db: db, now: time.Now}
}

type SettingsRead struct {
	Settings              UserSettings          `json:"settings"`
	CurrencyConfiguration CurrencyConfiguration `json:"currencyConfiguration"`
	ExchangeRates         []ExchangeRate        `json:"exchangeRates"`
	AuthMethods           AuthMethodState       `json:"authMethods"`
}

type UserSettings struct {
	DisplayName            string    `json:"displayName"`
	AppName                string    `json:"appName"`
	BaseCurrency           string    `json:"baseCurrency"`
	SupportedCurrencies    []string  `json:"supportedCurrencies"`
	Timezone               string    `json:"timezone"`
	PreferredDateFormat    string    `json:"preferredDateFormat"`
	DefaultDashboardPeriod string    `json:"defaultDashboardPeriod"`
	SessionTimeoutMinutes  int32     `json:"sessionTimeoutMinutes"`
	DefaultGoalReturnBps   int32     `json:"defaultGoalReturnBps"`
	PositionStaleDaysStock int32     `json:"positionStaleDaysStock"`
	PositionStaleDaysETF   int32     `json:"positionStaleDaysEtf"`
	PositionStaleDaysFund  int32     `json:"positionStaleDaysFund"`
	CreatedAt              time.Time `json:"createdAt"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

type CurrencyConfiguration struct {
	BaseCurrency         string   `json:"baseCurrency"`
	EnabledCurrencies    []string `json:"enabledCurrencies"`
	ReferencedCurrencies []string `json:"referencedCurrencies"`
}

type ExchangeRate struct {
	ID            uuid.UUID `json:"id"`
	BaseCurrency  string    `json:"baseCurrency"`
	QuoteCurrency string    `json:"quoteCurrency"`
	Rate          string    `json:"rate"`
	EffectiveDate time.Time `json:"effectiveDate"`
	Source        string    `json:"source"`
	CreatedAt     time.Time `json:"createdAt"`
}

type AuthMethodState struct {
	Status         string         `json:"status"`
	HasPassword    bool           `json:"hasPassword"`
	OIDCIdentities []OIDCIdentity `json:"oidcIdentities"`
}

type OIDCIdentity struct {
	ID          uuid.UUID `json:"id"`
	Issuer      string    `json:"issuer"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	LastLoginAt time.Time `json:"lastLoginAt"`
}

func (service *FeatureReads) Settings(ctx context.Context, userID uuid.UUID) (SettingsRead, error) {
	var result SettingsRead
	var supported string
	err := service.db.QueryRowContext(ctx, `
SELECT display_name, app_name, base_currency, supported_currencies, timezone,
       preferred_date_format, default_dashboard_period, session_timeout_minutes,
       default_goal_return_bps, position_stale_days_stock, position_stale_days_etf,
       position_stale_days_fund, created_at, updated_at
FROM user_settings
WHERE user_id = $1`, userID).Scan(
		&result.Settings.DisplayName, &result.Settings.AppName, &result.Settings.BaseCurrency,
		&supported, &result.Settings.Timezone, &result.Settings.PreferredDateFormat,
		&result.Settings.DefaultDashboardPeriod, &result.Settings.SessionTimeoutMinutes,
		&result.Settings.DefaultGoalReturnBps, &result.Settings.PositionStaleDaysStock,
		&result.Settings.PositionStaleDaysETF, &result.Settings.PositionStaleDaysFund,
		&result.Settings.CreatedAt, &result.Settings.UpdatedAt,
	)
	if err != nil {
		return SettingsRead{}, fmt.Errorf("load settings: %w", err)
	}
	if err := json.Unmarshal([]byte(supported), &result.Settings.SupportedCurrencies); err != nil {
		return SettingsRead{}, fmt.Errorf("decode supported currencies: %w", err)
	}
	result.CurrencyConfiguration.BaseCurrency = result.Settings.BaseCurrency
	result.CurrencyConfiguration.ReferencedCurrencies = []string{}
	result.CurrencyConfiguration.EnabledCurrencies = append([]string(nil), result.Settings.SupportedCurrencies...)
	if !contains(result.CurrencyConfiguration.EnabledCurrencies, result.Settings.BaseCurrency) {
		result.CurrencyConfiguration.EnabledCurrencies = append(result.CurrencyConfiguration.EnabledCurrencies, result.Settings.BaseCurrency)
	}
	sort.Strings(result.CurrencyConfiguration.EnabledCurrencies)

	rows, err := service.db.QueryContext(ctx, `
SELECT DISTINCT currency
FROM (
    SELECT currency FROM accounts WHERE user_id = $1
    UNION ALL SELECT currency FROM transactions WHERE user_id = $1
    UNION ALL SELECT currency FROM valuation_snapshots WHERE user_id = $1
    UNION ALL SELECT currency FROM goals WHERE user_id = $1
    UNION ALL SELECT base_currency FROM exchange_rates WHERE user_id = $1
    UNION ALL SELECT quote_currency FROM exchange_rates WHERE user_id = $1
    UNION ALL SELECT quote_currency FROM investment_instruments WHERE user_id = $1
    UNION ALL SELECT trade_currency FROM position_events WHERE user_id = $1
    UNION ALL SELECT fee_currency FROM position_events WHERE user_id = $1 AND fee_currency IS NOT NULL
    UNION ALL SELECT currency FROM security_prices WHERE user_id = $1
) referenced(currency)
ORDER BY currency`, userID)
	if err != nil {
		return SettingsRead{}, fmt.Errorf("list referenced currencies: %w", err)
	}
	for rows.Next() {
		var currency string
		if err := rows.Scan(&currency); err != nil {
			rows.Close()
			return SettingsRead{}, fmt.Errorf("scan referenced currency: %w", err)
		}
		result.CurrencyConfiguration.ReferencedCurrencies = append(result.CurrencyConfiguration.ReferencedCurrencies, currency)
		if !contains(result.CurrencyConfiguration.EnabledCurrencies, currency) {
			result.CurrencyConfiguration.EnabledCurrencies = append(result.CurrencyConfiguration.EnabledCurrencies, currency)
		}
	}
	if err := rows.Close(); err != nil {
		return SettingsRead{}, fmt.Errorf("close referenced currencies: %w", err)
	}
	if err := rows.Err(); err != nil {
		return SettingsRead{}, fmt.Errorf("iterate referenced currencies: %w", err)
	}
	sort.Strings(result.CurrencyConfiguration.EnabledCurrencies)
	result.ExchangeRates, err = service.listExchangeRates(ctx, userID)
	if err != nil {
		return SettingsRead{}, err
	}
	result.AuthMethods, err = service.authMethodState(ctx, userID)
	if err != nil {
		return SettingsRead{}, err
	}
	return result, nil
}

func (service *FeatureReads) listExchangeRates(ctx context.Context, userID uuid.UUID) ([]ExchangeRate, error) {
	rows, err := service.db.QueryContext(ctx, `
SELECT id, base_currency, quote_currency, rate::TEXT, effective_date, source, created_at
FROM exchange_rates
WHERE user_id = $1
ORDER BY base_currency, quote_currency, effective_date DESC, created_at DESC, id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list exchange rates: %w", err)
	}
	defer rows.Close()
	result := []ExchangeRate{}
	for rows.Next() {
		var rate ExchangeRate
		if err := rows.Scan(&rate.ID, &rate.BaseCurrency, &rate.QuoteCurrency, &rate.Rate, &rate.EffectiveDate, &rate.Source, &rate.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan exchange rate: %w", err)
		}
		result = append(result, rate)
	}
	return result, rows.Err()
}

func (service *FeatureReads) authMethodState(ctx context.Context, userID uuid.UUID) (AuthMethodState, error) {
	var state AuthMethodState
	if err := service.db.QueryRowContext(ctx, `SELECT status, password_hash IS NOT NULL FROM users WHERE id = $1`, userID).Scan(&state.Status, &state.HasPassword); err != nil {
		return AuthMethodState{}, fmt.Errorf("load auth method state: %w", err)
	}
	rows, err := service.db.QueryContext(ctx, `
SELECT id, issuer, created_at, updated_at, last_login_at
FROM oidc_identities
WHERE user_id = $1
ORDER BY issuer, id`, userID)
	if err != nil {
		return AuthMethodState{}, fmt.Errorf("list OIDC identities: %w", err)
	}
	defer rows.Close()
	state.OIDCIdentities = []OIDCIdentity{}
	for rows.Next() {
		var identity OIDCIdentity
		if err := rows.Scan(&identity.ID, &identity.Issuer, &identity.CreatedAt, &identity.UpdatedAt, &identity.LastLoginAt); err != nil {
			return AuthMethodState{}, fmt.Errorf("scan OIDC identity: %w", err)
		}
		state.OIDCIdentities = append(state.OIDCIdentities, identity)
	}
	return state, rows.Err()
}

type Instrument struct {
	ID             uuid.UUID      `json:"id"`
	ExternalID     *string        `json:"externalId"`
	Name           string         `json:"name"`
	Symbol         *string        `json:"symbol"`
	IdentifierType string         `json:"identifierType"`
	Identifier     *string        `json:"identifier"`
	ExchangeMIC    *string        `json:"exchangeMic"`
	AssetType      string         `json:"assetType"`
	QuoteCurrency  string         `json:"quoteCurrency"`
	ArchivedAt     *time.Time     `json:"archivedAt"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	LatestPrice    *SecurityPrice `json:"latestPrice"`
}

type InstrumentDetail struct {
	Instrument Instrument      `json:"instrument"`
	Prices     []SecurityPrice `json:"prices"`
}

type SecurityPrice struct {
	ID            uuid.UUID `json:"id"`
	ExternalID    *string   `json:"externalId"`
	Price         string    `json:"price"`
	Currency      string    `json:"currency"`
	EffectiveDate time.Time `json:"effectiveDate"`
	Source        string    `json:"source"`
	Provenance    *string   `json:"provenance"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func (service *FeatureReads) Instruments(ctx context.Context, userID uuid.UUID) ([]Instrument, error) {
	rows, err := service.db.QueryContext(ctx, `
SELECT instrument.id, instrument.external_id, instrument.name, instrument.symbol,
       instrument.identifier_type, instrument.identifier, instrument.exchange_mic,
       instrument.asset_type, instrument.quote_currency, instrument.archived_at,
       instrument.created_at, instrument.updated_at, price.id, price.external_id,
       price.price::TEXT, price.currency, price.effective_date, price.source,
       price.provenance, price.created_at, price.updated_at
FROM investment_instruments instrument
LEFT JOIN LATERAL (
    SELECT security_prices.* FROM security_prices
    WHERE security_prices.user_id = instrument.user_id
      AND security_prices.instrument_id = instrument.id
    ORDER BY security_prices.effective_date DESC, security_prices.created_at DESC, security_prices.id
    LIMIT 1
) price ON TRUE
WHERE instrument.user_id = $1
ORDER BY instrument.archived_at NULLS FIRST, instrument.name, instrument.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list instruments: %w", err)
	}
	defer rows.Close()
	result := []Instrument{}
	for rows.Next() {
		var instrument Instrument
		var externalID, symbol, identifier, exchangeMIC, priceID, priceExternalID, price, currency, source, provenance sql.NullString
		var archivedAt, priceDate, priceCreatedAt, priceUpdatedAt sql.NullTime
		if err := rows.Scan(
			&instrument.ID, &externalID, &instrument.Name, &symbol, &instrument.IdentifierType,
			&identifier, &exchangeMIC, &instrument.AssetType, &instrument.QuoteCurrency,
			&archivedAt, &instrument.CreatedAt, &instrument.UpdatedAt, &priceID,
			&priceExternalID, &price, &currency, &priceDate, &source, &provenance,
			&priceCreatedAt, &priceUpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan instrument: %w", err)
		}
		instrument.ExternalID, instrument.Symbol = stringPointer(externalID), stringPointer(symbol)
		instrument.Identifier, instrument.ExchangeMIC = stringPointer(identifier), stringPointer(exchangeMIC)
		instrument.ArchivedAt = timePointer(archivedAt)
		if priceID.Valid {
			id, parseErr := uuid.Parse(priceID.String)
			if parseErr != nil {
				return nil, fmt.Errorf("parse latest price id: %w", parseErr)
			}
			instrument.LatestPrice = &SecurityPrice{
				ID: id, ExternalID: stringPointer(priceExternalID), Price: price.String,
				Currency: currency.String, EffectiveDate: priceDate.Time, Source: source.String,
				Provenance: stringPointer(provenance), CreatedAt: priceCreatedAt.Time, UpdatedAt: priceUpdatedAt.Time,
			}
		}
		result = append(result, instrument)
	}
	return result, rows.Err()
}

func (service *FeatureReads) Instrument(ctx context.Context, userID, instrumentID uuid.UUID) (InstrumentDetail, error) {
	var result InstrumentDetail
	var externalID, symbol, identifier, exchangeMIC sql.NullString
	var archivedAt sql.NullTime
	err := service.db.QueryRowContext(ctx, `
SELECT id, external_id, name, symbol, identifier_type, identifier, exchange_mic,
       asset_type, quote_currency, archived_at, created_at, updated_at
FROM investment_instruments
WHERE user_id = $1 AND id = $2`, userID, instrumentID).Scan(
		&result.Instrument.ID, &externalID, &result.Instrument.Name, &symbol,
		&result.Instrument.IdentifierType, &identifier, &exchangeMIC, &result.Instrument.AssetType,
		&result.Instrument.QuoteCurrency, &archivedAt, &result.Instrument.CreatedAt, &result.Instrument.UpdatedAt,
	)
	if err != nil {
		return InstrumentDetail{}, fmt.Errorf("load instrument: %w", err)
	}
	result.Instrument.ExternalID, result.Instrument.Symbol = stringPointer(externalID), stringPointer(symbol)
	result.Instrument.Identifier, result.Instrument.ExchangeMIC = stringPointer(identifier), stringPointer(exchangeMIC)
	result.Instrument.ArchivedAt = timePointer(archivedAt)
	rows, err := service.db.QueryContext(ctx, `
SELECT id, external_id, price::TEXT, currency, effective_date, source, provenance, created_at, updated_at
FROM security_prices
WHERE user_id = $1 AND instrument_id = $2
ORDER BY effective_date DESC, created_at DESC, id`, userID, instrumentID)
	if err != nil {
		return InstrumentDetail{}, fmt.Errorf("list instrument prices: %w", err)
	}
	defer rows.Close()
	result.Prices = []SecurityPrice{}
	for rows.Next() {
		var item SecurityPrice
		var external, provenance sql.NullString
		if err := rows.Scan(&item.ID, &external, &item.Price, &item.Currency, &item.EffectiveDate, &item.Source, &provenance, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return InstrumentDetail{}, fmt.Errorf("scan instrument price: %w", err)
		}
		item.ExternalID, item.Provenance = stringPointer(external), stringPointer(provenance)
		result.Prices = append(result.Prices, item)
	}
	return result, rows.Err()
}

type EstateWorkspaceRead struct {
	Plan                  *EstatePlan           `json:"plan"`
	Beneficiaries         []Beneficiary         `json:"beneficiaries"`
	Directives            []EstateDirective     `json:"directives"`
	Allocations           []EstateAllocation    `json:"allocations"`
	ResiduaryAllocations  []ResiduaryAllocation `json:"residuaryAllocations"`
	Snapshots             []EstateSnapshotMeta  `json:"snapshots"`
	CurrentValuesComplete bool                  `json:"currentValuesComplete"`
	CurrentValuesWarning  string                `json:"currentValuesWarning"`
}

type EstatePlan struct {
	ID                 uuid.UUID  `json:"id"`
	Title              string     `json:"title"`
	Jurisdiction       *string    `json:"jurisdiction"`
	LastReviewedDate   *time.Time `json:"lastReviewedDate"`
	ReviewReminderDate *time.Time `json:"reviewReminderDate"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

type Beneficiary struct {
	ID             uuid.UUID  `json:"id"`
	Kind           string     `json:"kind"`
	Name           string     `json:"name"`
	Relationship   *string    `json:"relationship"`
	ContactSummary *string    `json:"contactSummary"`
	Notes          *string    `json:"notes"`
	ArchivedAt     *time.Time `json:"archivedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type EstateDirective struct {
	ID                 uuid.UUID  `json:"id"`
	EstatePlanID       uuid.UUID  `json:"estatePlanId"`
	AccountID          uuid.UUID  `json:"accountId"`
	AccountName        string     `json:"accountName"`
	Currency           string     `json:"currency"`
	CurrentValueMinor  string     `json:"currentValueMinor"`
	IsLiability        bool       `json:"isLiability"`
	AccountArchivedAt  *time.Time `json:"accountArchivedAt"`
	IsIncluded         bool       `json:"isIncluded"`
	OwnershipShareBps  int32      `json:"ownershipShareBps"`
	TransferContext    string     `json:"transferContext"`
	DistributionMethod string     `json:"distributionMethod"`
	DocumentReference  *string    `json:"documentReference"`
	Notes              *string    `json:"notes"`
	ReviewedAt         *time.Time `json:"reviewedAt"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

type EstateAllocation struct {
	ID            uuid.UUID `json:"id"`
	EstatePlanID  uuid.UUID `json:"estatePlanId"`
	DirectiveID   uuid.UUID `json:"directiveId"`
	BeneficiaryID uuid.UUID `json:"beneficiaryId"`
	Tier          string    `json:"tier"`
	AllocationBps int32     `json:"allocationBps"`
	Notes         *string   `json:"notes"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type ResiduaryAllocation struct {
	ID            uuid.UUID `json:"id"`
	EstatePlanID  uuid.UUID `json:"estatePlanId"`
	BeneficiaryID uuid.UUID `json:"beneficiaryId"`
	Tier          string    `json:"tier"`
	AllocationBps int32     `json:"allocationBps"`
	Notes         *string   `json:"notes"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type EstateSnapshotMeta struct {
	ID            uuid.UUID `json:"id"`
	EstatePlanID  uuid.UUID `json:"estatePlanId"`
	Version       int32     `json:"version"`
	Title         string    `json:"title"`
	ValueAsOfDate time.Time `json:"valueAsOfDate"`
	BaseCurrency  string    `json:"baseCurrency"`
	ContentHash   string    `json:"contentHash"`
	GeneratedAt   time.Time `json:"generatedAt"`
}

type EstateSnapshot struct {
	EstateSnapshotMeta
	Content json.RawMessage `json:"content"`
}

func (service *FeatureReads) EstateWorkspace(ctx context.Context, userID uuid.UUID) (EstateWorkspaceRead, error) {
	result := EstateWorkspaceRead{
		Beneficiaries: []Beneficiary{}, Directives: []EstateDirective{}, Allocations: []EstateAllocation{},
		ResiduaryAllocations: []ResiduaryAllocation{}, Snapshots: []EstateSnapshotMeta{},
		CurrentValuesComplete: false, CurrentValuesWarning: estateCurrentValueWarning,
	}
	var plan EstatePlan
	var jurisdiction sql.NullString
	var reviewed, reminder sql.NullTime
	err := service.db.QueryRowContext(ctx, `
SELECT id, title, jurisdiction, last_reviewed_date, review_reminder_date, created_at, updated_at
FROM estate_plans WHERE user_id = $1`, userID).Scan(
		&plan.ID, &plan.Title, &jurisdiction, &reviewed, &reminder, &plan.CreatedAt, &plan.UpdatedAt,
	)
	if err != nil && err != sql.ErrNoRows {
		return EstateWorkspaceRead{}, fmt.Errorf("load estate plan: %w", err)
	}
	if err == nil {
		plan.Jurisdiction, plan.LastReviewedDate, plan.ReviewReminderDate = stringPointer(jurisdiction), timePointer(reviewed), timePointer(reminder)
		result.Plan = &plan
	}

	rows, err := service.db.QueryContext(ctx, `
SELECT id, kind, name, relationship, contact_summary, notes, archived_at, created_at, updated_at
FROM beneficiaries WHERE user_id = $1
ORDER BY archived_at NULLS FIRST, name, id`, userID)
	if err != nil {
		return EstateWorkspaceRead{}, fmt.Errorf("list beneficiaries: %w", err)
	}
	for rows.Next() {
		var item Beneficiary
		var relationship, contact, notes sql.NullString
		var archived sql.NullTime
		if err := rows.Scan(&item.ID, &item.Kind, &item.Name, &relationship, &contact, &notes, &archived, &item.CreatedAt, &item.UpdatedAt); err != nil {
			rows.Close()
			return EstateWorkspaceRead{}, fmt.Errorf("scan beneficiary: %w", err)
		}
		item.Relationship, item.ContactSummary, item.Notes, item.ArchivedAt = stringPointer(relationship), stringPointer(contact), stringPointer(notes), timePointer(archived)
		result.Beneficiaries = append(result.Beneficiaries, item)
	}
	if err := closeRows(rows); err != nil {
		return EstateWorkspaceRead{}, err
	}

	rows, err = service.db.QueryContext(ctx, `
SELECT directive.id, directive.estate_plan_id, directive.account_id, directive.is_included,
       directive.ownership_share_bps, directive.transfer_context, directive.distribution_method,
       directive.document_reference, directive.notes, directive.reviewed_at,
       directive.created_at, directive.updated_at, account.name, account.currency,
       account.current_value_minor::TEXT, account.is_liability, account.archived_at
FROM estate_account_directives directive
JOIN accounts account ON account.user_id = directive.user_id AND account.id = directive.account_id
WHERE directive.user_id = $1
ORDER BY account.name, directive.id`, userID)
	if err != nil {
		return EstateWorkspaceRead{}, fmt.Errorf("list estate directives: %w", err)
	}
	for rows.Next() {
		var item EstateDirective
		var document, notes sql.NullString
		var reviewedAt, archivedAt sql.NullTime
		if err := rows.Scan(
			&item.ID, &item.EstatePlanID, &item.AccountID, &item.IsIncluded, &item.OwnershipShareBps,
			&item.TransferContext, &item.DistributionMethod, &document, &notes, &reviewedAt,
			&item.CreatedAt, &item.UpdatedAt, &item.AccountName, &item.Currency,
			&item.CurrentValueMinor, &item.IsLiability, &archivedAt,
		); err != nil {
			rows.Close()
			return EstateWorkspaceRead{}, fmt.Errorf("scan estate directive: %w", err)
		}
		item.DocumentReference, item.Notes, item.ReviewedAt, item.AccountArchivedAt = stringPointer(document), stringPointer(notes), timePointer(reviewedAt), timePointer(archivedAt)
		result.Directives = append(result.Directives, item)
	}
	if err := closeRows(rows); err != nil {
		return EstateWorkspaceRead{}, err
	}

	rows, err = service.db.QueryContext(ctx, `
SELECT id, estate_plan_id, directive_id, beneficiary_id, tier, allocation_bps, notes, created_at, updated_at
FROM estate_allocations WHERE user_id = $1
ORDER BY directive_id, tier, beneficiary_id, id`, userID)
	if err != nil {
		return EstateWorkspaceRead{}, fmt.Errorf("list estate allocations: %w", err)
	}
	for rows.Next() {
		var item EstateAllocation
		var notes sql.NullString
		if err := rows.Scan(&item.ID, &item.EstatePlanID, &item.DirectiveID, &item.BeneficiaryID, &item.Tier, &item.AllocationBps, &notes, &item.CreatedAt, &item.UpdatedAt); err != nil {
			rows.Close()
			return EstateWorkspaceRead{}, fmt.Errorf("scan estate allocation: %w", err)
		}
		item.Notes = stringPointer(notes)
		result.Allocations = append(result.Allocations, item)
	}
	if err := closeRows(rows); err != nil {
		return EstateWorkspaceRead{}, err
	}

	rows, err = service.db.QueryContext(ctx, `
SELECT id, estate_plan_id, beneficiary_id, tier, allocation_bps, notes, created_at, updated_at
FROM estate_residuary_allocations WHERE user_id = $1
ORDER BY tier, beneficiary_id, id`, userID)
	if err != nil {
		return EstateWorkspaceRead{}, fmt.Errorf("list residuary allocations: %w", err)
	}
	for rows.Next() {
		var item ResiduaryAllocation
		var notes sql.NullString
		if err := rows.Scan(&item.ID, &item.EstatePlanID, &item.BeneficiaryID, &item.Tier, &item.AllocationBps, &notes, &item.CreatedAt, &item.UpdatedAt); err != nil {
			rows.Close()
			return EstateWorkspaceRead{}, fmt.Errorf("scan residuary allocation: %w", err)
		}
		item.Notes = stringPointer(notes)
		result.ResiduaryAllocations = append(result.ResiduaryAllocations, item)
	}
	if err := closeRows(rows); err != nil {
		return EstateWorkspaceRead{}, err
	}

	rows, err = service.db.QueryContext(ctx, `
SELECT id, estate_plan_id, version, title, value_as_of_date, base_currency, content_hash, generated_at
FROM estate_plan_snapshots WHERE user_id = $1
ORDER BY generated_at DESC, id`, userID)
	if err != nil {
		return EstateWorkspaceRead{}, fmt.Errorf("list estate snapshots: %w", err)
	}
	for rows.Next() {
		var item EstateSnapshotMeta
		if err := rows.Scan(&item.ID, &item.EstatePlanID, &item.Version, &item.Title, &item.ValueAsOfDate, &item.BaseCurrency, &item.ContentHash, &item.GeneratedAt); err != nil {
			rows.Close()
			return EstateWorkspaceRead{}, fmt.Errorf("scan estate snapshot: %w", err)
		}
		result.Snapshots = append(result.Snapshots, item)
	}
	if err := closeRows(rows); err != nil {
		return EstateWorkspaceRead{}, err
	}
	return result, nil
}

func (service *FeatureReads) EstateSnapshot(ctx context.Context, userID, snapshotID uuid.UUID) (EstateSnapshot, error) {
	var result EstateSnapshot
	var content string
	err := service.db.QueryRowContext(ctx, `
SELECT id, estate_plan_id, version, title, value_as_of_date, base_currency, content, content_hash, generated_at
FROM estate_plan_snapshots
WHERE user_id = $1 AND id = $2`, userID, snapshotID).Scan(
		&result.ID, &result.EstatePlanID, &result.Version, &result.Title, &result.ValueAsOfDate,
		&result.BaseCurrency, &content, &result.ContentHash, &result.GeneratedAt,
	)
	if err != nil {
		return EstateSnapshot{}, fmt.Errorf("load estate snapshot: %w", err)
	}
	if !json.Valid([]byte(content)) {
		return EstateSnapshot{}, fmt.Errorf("load estate snapshot: stored content is not valid JSON")
	}
	result.Content = json.RawMessage(content)
	return result, nil
}

type AIRead struct {
	Settings           *AIProviderSettings `json:"settings"`
	Usage              AIUsageSummary      `json:"usage"`
	Events             []AIUsageEvent      `json:"events"`
	ReviewAvailability ReviewAvailability  `json:"reviewAvailability"`
}

type AIProviderSettings struct {
	Provider            string    `json:"provider"`
	BaseURL             string    `json:"baseUrl"`
	Model               string    `json:"model"`
	HasStoredAPIKey     bool      `json:"hasStoredApiKey"`
	APIKeyHint          *string   `json:"apiKeyHint"`
	IncludeExactAmounts bool      `json:"includeExactAmounts"`
	IncludeAccountNames bool      `json:"includeAccountNames"`
	MonthlyTokenLimit   int32     `json:"monthlyTokenLimit"`
	MaxOutputTokens     int32     `json:"maxOutputTokens"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type AIUsageEvent struct {
	ID            uuid.UUID `json:"id"`
	Provider      string    `json:"provider"`
	EndpointHost  string    `json:"endpointHost"`
	Model         string    `json:"model"`
	RequestType   string    `json:"requestType"`
	Status        string    `json:"status"`
	BillingMonth  string    `json:"billingMonth"`
	ChargedTokens int32     `json:"chargedTokens"`
	InputTokens   *int32    `json:"inputTokens"`
	OutputTokens  *int32    `json:"outputTokens"`
	LatencyMS     *int32    `json:"latencyMs"`
	ErrorCode     *string   `json:"errorCode"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type AIUsageSummary struct {
	BillingMonth      string     `json:"billingMonth"`
	ChargedTokens     int64      `json:"chargedTokens"`
	RemainingTokens   int64      `json:"remainingTokens"`
	MonthlyTokenLimit int32      `json:"monthlyTokenLimit"`
	SuccessfulReviews int        `json:"successfulReviews"`
	LastUsedAt        *time.Time `json:"lastUsedAt"`
}

type ReviewAvailability struct {
	Available                 bool       `json:"available"`
	Reason                    string     `json:"reason"`
	ProviderConfigured        bool       `json:"providerConfigured"`
	StoredCredentialAvailable bool       `json:"storedCredentialAvailable"`
	SessionCredentialAccepted bool       `json:"sessionCredentialAccepted"`
	CooldownUntil             *time.Time `json:"cooldownUntil"`
	BudgetRemainingTokens     int64      `json:"budgetRemainingTokens"`
}

func (service *FeatureReads) AI(ctx context.Context, userID uuid.UUID) (AIRead, error) {
	now := service.now().UTC()
	result := AIRead{Events: []AIUsageEvent{}}
	var settings AIProviderSettings
	var hint sql.NullString
	err := service.db.QueryRowContext(ctx, `
SELECT provider, base_url, model, encrypted_api_key IS NOT NULL, api_key_hint,
       include_exact_amounts, include_account_names, monthly_token_limit,
       max_output_tokens, created_at, updated_at
FROM ai_provider_settings
WHERE user_id = $1`, userID).Scan(
		&settings.Provider, &settings.BaseURL, &settings.Model, &settings.HasStoredAPIKey,
		&hint, &settings.IncludeExactAmounts, &settings.IncludeAccountNames,
		&settings.MonthlyTokenLimit, &settings.MaxOutputTokens, &settings.CreatedAt, &settings.UpdatedAt,
	)
	if err != nil && err != sql.ErrNoRows {
		return AIRead{}, fmt.Errorf("load AI settings: %w", err)
	}
	if err == nil {
		settings.APIKeyHint = stringPointer(hint)
		result.Settings = &settings
	}

	rows, err := service.db.QueryContext(ctx, `
SELECT id, provider, endpoint_host, model, request_type, status, billing_month,
       charged_tokens, input_tokens, output_tokens, latency_ms, error_code, created_at, updated_at
FROM ai_usage_events
WHERE user_id = $1
ORDER BY created_at DESC, id`, userID)
	if err != nil {
		return AIRead{}, fmt.Errorf("list AI usage: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item AIUsageEvent
		var input, output, latency sql.NullInt32
		var code sql.NullString
		if err := rows.Scan(
			&item.ID, &item.Provider, &item.EndpointHost, &item.Model, &item.RequestType,
			&item.Status, &item.BillingMonth, &item.ChargedTokens, &input, &output,
			&latency, &code, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return AIRead{}, fmt.Errorf("scan AI usage: %w", err)
		}
		item.InputTokens, item.OutputTokens, item.LatencyMS = int32Pointer(input), int32Pointer(output), int32Pointer(latency)
		item.ErrorCode = stringPointer(code)
		result.Events = append(result.Events, item)
	}
	if err := rows.Err(); err != nil {
		return AIRead{}, fmt.Errorf("iterate AI usage: %w", err)
	}

	month := now.Format("2006-01")
	result.Usage.BillingMonth = month
	if result.Settings != nil {
		result.Usage.MonthlyTokenLimit = result.Settings.MonthlyTokenLimit
	}
	var latestSuccess *time.Time
	recentAttempts := 0
	cooldownStart := now.Add(-time.Minute)
	for index := range result.Events {
		event := result.Events[index]
		if event.BillingMonth == month {
			result.Usage.ChargedTokens += int64(event.ChargedTokens)
			if event.Status == "success" {
				result.Usage.SuccessfulReviews++
				if latestSuccess == nil {
					value := event.CreatedAt
					latestSuccess = &value
				}
			}
		}
		if event.CreatedAt.After(cooldownStart) && (event.Status == "started" || event.Status == "success" || event.Status == "error") {
			recentAttempts++
		}
	}
	result.Usage.LastUsedAt = latestSuccess
	result.Usage.RemainingTokens = int64(result.Usage.MonthlyTokenLimit) - result.Usage.ChargedTokens
	if result.Usage.RemainingTokens < 0 {
		result.Usage.RemainingTokens = 0
	}
	result.ReviewAvailability = ReviewAvailability{
		ProviderConfigured: result.Settings != nil, SessionCredentialAccepted: true,
		BudgetRemainingTokens: result.Usage.RemainingTokens,
	}
	if result.Settings != nil {
		result.ReviewAvailability.StoredCredentialAvailable = result.Settings.HasStoredAPIKey
	}
	switch {
	case result.Settings == nil:
		result.ReviewAvailability.Reason = "provider_not_configured"
	case result.Usage.RemainingTokens == 0:
		result.ReviewAvailability.Reason = "monthly_token_limit_reached"
	case recentAttempts >= 10:
		result.ReviewAvailability.Reason = "cooldown"
		if len(result.Events) > 0 {
			until := result.Events[0].CreatedAt.Add(time.Minute)
			result.ReviewAvailability.CooldownUntil = &until
		}
	case !result.Settings.HasStoredAPIKey:
		result.ReviewAvailability.Available = true
		result.ReviewAvailability.Reason = "session_credential_required"
	default:
		result.ReviewAvailability.Available = true
		result.ReviewAvailability.Reason = "available"
	}
	return result, nil
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func stringPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func timePointer(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func int32Pointer(value sql.NullInt32) *int32 {
	if !value.Valid {
		return nil
	}
	return &value.Int32
}

func closeRows(rows *sql.Rows) error {
	iterationErr := rows.Err()
	closeErr := rows.Close()
	if iterationErr != nil {
		return iterationErr
	}
	return closeErr
}
