package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	CurrentUserArchiveVersion = 8
	MaxUserArchiveBytes       = 25 * 1024 * 1024
)

var (
	ErrPortabilityNotFound   = errors.New("portability resource not found")
	ErrPortabilityValidation = errors.New("portability validation failed")
	ErrPortabilityTooLarge   = errors.New("portability archive exceeds 25 MB")
)

type PortabilityService struct {
	db  *sql.DB
	now func() time.Time
}

func NewPortabilityService(db *sql.DB) *PortabilityService {
	return &PortabilityService{db: db, now: time.Now}
}

type UserArchive struct {
	Format                     string           `json:"format"`
	Version                    int              `json:"version"`
	ExportedAt                 string           `json:"exportedAt"`
	Settings                   map[string]any   `json:"settings"`
	Categories                 []map[string]any `json:"categories"`
	Institutions               []map[string]any `json:"institutions"`
	Accounts                   []map[string]any `json:"accounts"`
	Transactions               []map[string]any `json:"transactions"`
	Valuations                 []map[string]any `json:"valuations"`
	ExchangeRates              []map[string]any `json:"exchangeRates"`
	Goals                      []map[string]any `json:"goals"`
	GoalContributionPlans      []map[string]any `json:"goalContributionPlans"`
	GoalMilestones             []map[string]any `json:"goalMilestones"`
	GoalAlertDismissals        []map[string]any `json:"goalAlertDismissals"`
	Beneficiaries              []map[string]any `json:"beneficiaries"`
	EstatePlans                []map[string]any `json:"estatePlans"`
	EstateAccountDirectives    []map[string]any `json:"estateAccountDirectives"`
	EstateAllocations          []map[string]any `json:"estateAllocations"`
	EstateResiduaryAllocations []map[string]any `json:"estateResiduaryAllocations"`
	EstatePlanSnapshots        []map[string]any `json:"estatePlanSnapshots"`
	InvestmentInstruments      []map[string]any `json:"investmentInstruments"`
	PositionEvents             []map[string]any `json:"positionEvents"`
	SecurityPrices             []map[string]any `json:"securityPrices"`
	PositionReconciliations    []map[string]any `json:"positionReconciliations"`
	AccountConversions         []map[string]any `json:"accountConversions"`
}

type RestoreSummary struct {
	Institutions            int `json:"institutions"`
	Accounts                int `json:"accounts"`
	Transactions            int `json:"transactions"`
	Goals                   int `json:"goals"`
	Milestones              int `json:"milestones"`
	Beneficiaries           int `json:"beneficiaries"`
	EstatePlans             int `json:"estatePlans"`
	EstateSnapshots         int `json:"estateSnapshots"`
	InvestmentInstruments   int `json:"investmentInstruments"`
	PositionEvents          int `json:"positionEvents"`
	SecurityPrices          int `json:"securityPrices"`
	PositionReconciliations int `json:"positionReconciliations"`
}

type portabilityTable struct {
	name    string
	archive func(*UserArchive) *[]map[string]any
	selects []string
	keys    []string
	columns []string
}

var portabilityTables = []portabilityTable{
	portableTable("categories", func(a *UserArchive) *[]map[string]any { return &a.Categories },
		[]string{"id", "name", "slug", "icon", "display_order", "asset_or_liability", "description", "is_liquid", "is_investible", "is_archived", "is_system", "created_at", "updated_at"}),
	portableTable("institutions", func(a *UserArchive) *[]map[string]any { return &a.Institutions },
		[]string{"id", "name", "type", "website_url", "country_code", "address", "notes", "archived_at", "created_at", "updated_at"}),
	portableTable("accounts", func(a *UserArchive) *[]map[string]any { return &a.Accounts },
		[]string{"id", "name", "description", "category_id", "institution_id", "account_reference", "currency", "tracking_mode", "current_value_minor", "cost_basis_minor", "is_liability", "is_included_in_net_worth", "goal_id", "notes", "opened_at", "archived_at", "created_at", "updated_at"}),
	portableTable("account_conversions", func(a *UserArchive) *[]map[string]any { return &a.AccountConversions },
		[]string{"id", "source_account_id", "target_account_id", "conversion_date", "source_balance_minor", "idempotency_key", "created_at"}),
	portableTable("investment_instruments", func(a *UserArchive) *[]map[string]any { return &a.InvestmentInstruments },
		[]string{"id", "external_id", "name", "symbol", "identifier_type", "identifier", "exchange_mic", "asset_type", "quote_currency", "archived_at", "created_at", "updated_at"}),
	portableTable("goals", func(a *UserArchive) *[]map[string]any { return &a.Goals },
		[]string{"id", "name", "description", "target_amount_minor", "current_amount_minor", "currency", "target_date", "linked_account_id", "icon", "status", "priority", "assumed_annual_return_bps", "created_at", "updated_at"}),
	portableTable("transactions", func(a *UserArchive) *[]map[string]any { return &a.Transactions },
		[]string{"id", "account_id", "type", "amount_minor", "currency", "transaction_date", "description", "notes", "external_id", "transfer_group_id", "event_group_id", "idempotency_key", "created_at", "updated_at"}),
	portableTable("valuation_snapshots", func(a *UserArchive) *[]map[string]any { return &a.Valuations },
		[]string{"id", "account_id", "value_minor", "currency", "valuation_date", "notes", "created_at"}),
	portableTableWithText("position_events", func(a *UserArchive) *[]map[string]any { return &a.PositionEvents },
		[]string{"quantity", "unit_price", "applied_exchange_rate", "action_ratio_numerator", "action_ratio_denominator"},
		[]string{"id", "account_id", "instrument_id", "related_instrument_id", "type", "quantity", "unit_price", "trade_currency", "gross_amount_minor", "fee_amount_minor", "fee_currency", "cash_effect_minor", "applied_exchange_rate", "opening_cost_basis_minor", "action_ratio_numerator", "action_ratio_denominator", "trade_date", "event_sequence", "settlement_date", "external_id", "event_group_id", "idempotency_key", "description", "notes", "created_at", "updated_at"}),
	portableTableWithText("security_prices", func(a *UserArchive) *[]map[string]any { return &a.SecurityPrices }, []string{"price"},
		[]string{"id", "instrument_id", "external_id", "price", "currency", "effective_date", "source", "provenance", "created_at", "updated_at"}),
	portableTable("position_reconciliations", func(a *UserArchive) *[]map[string]any { return &a.PositionReconciliations },
		[]string{"id", "account_id", "observation_date", "reported_cash_minor", "reported_total_minor", "notes", "created_at", "updated_at"}),
	portableTableWithText("exchange_rates", func(a *UserArchive) *[]map[string]any { return &a.ExchangeRates }, []string{"rate"},
		[]string{"id", "base_currency", "quote_currency", "rate", "effective_date", "source", "created_at"}),
	portableTable("goal_contribution_plans", func(a *UserArchive) *[]map[string]any { return &a.GoalContributionPlans },
		[]string{"id", "goal_id", "planned_contribution_minor", "frequency", "start_date", "end_date", "created_at", "updated_at"}),
	portableTable("goal_milestones", func(a *UserArchive) *[]map[string]any { return &a.GoalMilestones },
		[]string{"id", "goal_id", "name", "target_amount_minor", "target_date", "created_at", "updated_at"}),
	portableTable("goal_alert_dismissals", func(a *UserArchive) *[]map[string]any { return &a.GoalAlertDismissals },
		[]string{"goal_id", "alert_key", "dismissed_at"}),
	portableTable("beneficiaries", func(a *UserArchive) *[]map[string]any { return &a.Beneficiaries },
		[]string{"id", "kind", "name", "relationship", "contact_summary", "notes", "archived_at", "created_at", "updated_at"}),
	portableTable("estate_plans", func(a *UserArchive) *[]map[string]any { return &a.EstatePlans },
		[]string{"id", "title", "jurisdiction", "last_reviewed_date", "review_reminder_date", "created_at", "updated_at"}),
	portableTable("estate_account_directives", func(a *UserArchive) *[]map[string]any { return &a.EstateAccountDirectives },
		[]string{"id", "estate_plan_id", "account_id", "is_included", "ownership_share_bps", "transfer_context", "distribution_method", "document_reference", "notes", "reviewed_at", "created_at", "updated_at"}),
	portableTable("estate_allocations", func(a *UserArchive) *[]map[string]any { return &a.EstateAllocations },
		[]string{"id", "estate_plan_id", "directive_id", "beneficiary_id", "tier", "allocation_bps", "notes", "created_at", "updated_at"}),
	portableTable("estate_residuary_allocations", func(a *UserArchive) *[]map[string]any { return &a.EstateResiduaryAllocations },
		[]string{"id", "estate_plan_id", "beneficiary_id", "tier", "allocation_bps", "notes", "created_at", "updated_at"}),
	portableTable("estate_plan_snapshots", func(a *UserArchive) *[]map[string]any { return &a.EstatePlanSnapshots },
		[]string{"id", "estate_plan_id", "version", "title", "value_as_of_date", "base_currency", "content", "content_hash", "generated_at"}),
}

func portableTable(name string, archive func(*UserArchive) *[]map[string]any, columns []string) portabilityTable {
	return portableTableWithText(name, archive, nil, columns)
}

func portableTableWithText(name string, archive func(*UserArchive) *[]map[string]any, textColumns, columns []string) portabilityTable {
	text := make(map[string]bool, len(textColumns))
	for _, column := range textColumns {
		text[column] = true
	}
	selects, keys := make([]string, len(columns)), make([]string, len(columns))
	for index, column := range columns {
		key := snakeToCamel(column)
		expression := column
		if text[column] {
			expression += "::text"
		}
		selects[index], keys[index] = expression+` AS "`+key+`"`, key
	}
	return portabilityTable{name: name, archive: archive, selects: selects, keys: keys, columns: columns}
}

func (service *PortabilityService) Export(ctx context.Context, userID uuid.UUID) (UserArchive, error) {
	archive := UserArchive{Format: "wealthboard-user-json", Version: CurrentUserArchiveVersion, ExportedAt: service.now().UTC().Format(time.RFC3339Nano)}
	var supported string
	var displayName, baseCurrency, timezone, preferredDateFormat, appName, dashboardPeriod string
	var timeout, goalReturn, stockDays, etfDays, fundDays int32
	err := service.db.QueryRowContext(ctx, `SELECT display_name,base_currency,supported_currencies,timezone,
preferred_date_format,app_name,default_dashboard_period,session_timeout_minutes,default_goal_return_bps,
position_stale_days_stock,position_stale_days_etf,position_stale_days_fund FROM user_settings WHERE user_id=$1`, userID).Scan(
		&displayName, &baseCurrency, &supported, &timezone, &preferredDateFormat, &appName, &dashboardPeriod,
		&timeout, &goalReturn, &stockDays, &etfDays, &fundDays)
	if errors.Is(err, sql.ErrNoRows) {
		return UserArchive{}, ErrPortabilityNotFound
	}
	if err != nil {
		return UserArchive{}, fmt.Errorf("load export settings: %w", err)
	}
	archive.Settings = map[string]any{"displayName": displayName, "baseCurrency": baseCurrency, "supportedCurrencies": supported,
		"timezone": timezone, "preferredDateFormat": preferredDateFormat, "appName": appName, "defaultDashboardPeriod": dashboardPeriod,
		"sessionTimeoutMinutes": timeout, "defaultGoalReturnBps": goalReturn, "positionStaleDaysStock": stockDays,
		"positionStaleDaysEtf": etfDays, "positionStaleDaysFund": fundDays}
	for _, table := range portabilityTables {
		rows, err := service.exportTable(ctx, userID, table)
		if err != nil {
			return UserArchive{}, err
		}
		*table.archive(&archive) = rows
	}
	return archive, nil
}

func (service *PortabilityService) ExportJSON(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	archive, err := service.Export(ctx, userID)
	if err != nil {
		return nil, err
	}
	data, err := json.Marshal(archive)
	if err != nil {
		return nil, fmt.Errorf("encode user archive: %w", err)
	}
	if len(data) > MaxUserArchiveBytes {
		return nil, ErrPortabilityTooLarge
	}
	return data, nil
}

func (service *PortabilityService) exportTable(ctx context.Context, userID uuid.UUID, table portabilityTable) ([]map[string]any, error) {
	query := fmt.Sprintf(`SELECT row_to_json(export_row) FROM (SELECT %s FROM %s WHERE user_id=$1 ORDER BY %s) export_row`, strings.Join(table.selects, ","), table.name, portabilityOrder(table))
	rows, err := service.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("export %s: %w", table.name, err)
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan export %s: %w", table.name, err)
		}
		row, err := decodeJSONObject(raw)
		if err != nil {
			return nil, fmt.Errorf("decode export %s: %w", table.name, err)
		}
		normalizePortableExportDates(table.name, row)
		result = append(result, row)
	}
	return result, rows.Err()
}

var portableTimestampDateKeys = map[string][]string{
	"accounts":                 {"openedAt"},
	"account_conversions":      {"conversionDate"},
	"position_events":          {"tradeDate", "settlementDate"},
	"security_prices":          {"effectiveDate"},
	"position_reconciliations": {"observationDate"},
	"transactions":             {"transactionDate"},
	"valuation_snapshots":      {"valuationDate"},
	"exchange_rates":           {"effectiveDate"},
	"goals":                    {"targetDate"},
	"goal_contribution_plans":  {"startDate", "endDate"},
	"goal_milestones":          {"targetDate"},
	"estate_plans":             {"lastReviewedDate", "reviewReminderDate"},
}

func normalizePortableExportDates(table string, row map[string]any) {
	for _, key := range portableTimestampDateKeys[table] {
		value := stringValue(row[key])
		if len(value) == len(time.DateOnly) {
			row[key] = value + "T12:00:00.000Z"
		}
	}
}

func portabilityOrder(table portabilityTable) string {
	for _, column := range table.columns {
		if column == "id" {
			return "id"
		}
	}
	return strings.Join(table.columns, ",")
}

func (service *PortabilityService) RestoreJSON(ctx context.Context, userID uuid.UUID, data []byte) (RestoreSummary, error) {
	if len(data) > MaxUserArchiveBytes {
		return RestoreSummary{}, ErrPortabilityTooLarge
	}
	archive, err := decodeAndUpgradeArchive(data)
	if err != nil {
		return RestoreSummary{}, err
	}
	_, err = validateAndRemapArchive(&archive)
	if err != nil {
		return RestoreSummary{}, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return RestoreSummary{}, fmt.Errorf("begin user restore: %w", err)
	}
	defer tx.Rollback()
	var settingsID uuid.UUID
	if err := tx.QueryRowContext(ctx, `SELECT id FROM user_settings WHERE user_id=$1 FOR UPDATE`, userID).Scan(&settingsID); errors.Is(err, sql.ErrNoRows) {
		return RestoreSummary{}, ErrPortabilityNotFound
	} else if err != nil {
		return RestoreSummary{}, fmt.Errorf("lock restore owner: %w", err)
	}
	if err := deletePortableData(ctx, tx, userID); err != nil {
		return RestoreSummary{}, err
	}
	if err := updatePortableSettings(ctx, tx, userID, archive.Settings, service.now().UTC()); err != nil {
		return RestoreSummary{}, err
	}
	for _, table := range portabilityTables {
		for _, row := range *table.archive(&archive) {
			if err := insertPortableRow(ctx, tx, userID, table, row); err != nil {
				return RestoreSummary{}, fmt.Errorf("restore %s: %w", table.name, err)
			}
		}
	}
	ledger := &LedgerService{db: service.db, now: service.now}
	investments := &InvestmentMutations{db: service.db, now: service.now}
	for _, account := range archive.Accounts {
		accountID, _ := uuid.Parse(requiredString(account, "id"))
		if stringValue(account["trackingMode"]) == "positions" {
			if err := investments.recalculatePositionAccount(ctx, tx, userID, accountID); err != nil {
				return RestoreSummary{}, fmt.Errorf("replay restored positions: %w", err)
			}
		} else if _, err := ledger.replayBalance(ctx, tx, userID, accountID); err != nil {
			return RestoreSummary{}, fmt.Errorf("replay restored balance: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return RestoreSummary{}, fmt.Errorf("commit user restore: %w", err)
	}
	return RestoreSummary{Institutions: len(archive.Institutions), Accounts: len(archive.Accounts), Transactions: len(archive.Transactions),
		Goals: len(archive.Goals), Milestones: len(archive.GoalMilestones), Beneficiaries: len(archive.Beneficiaries),
		EstatePlans: len(archive.EstatePlans), EstateSnapshots: len(archive.EstatePlanSnapshots), InvestmentInstruments: len(archive.InvestmentInstruments),
		PositionEvents: len(archive.PositionEvents), SecurityPrices: len(archive.SecurityPrices), PositionReconciliations: len(archive.PositionReconciliations)}, nil
}

func decodeAndUpgradeArchive(data []byte) (UserArchive, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var raw map[string]any
	if err := decoder.Decode(&raw); err != nil {
		return UserArchive{}, portabilityValidation("the archive is not valid JSON")
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return UserArchive{}, portabilityValidation("the archive contains trailing JSON")
	}
	if stringValue(raw["format"]) != "wealthboard-user-json" {
		return UserArchive{}, portabilityValidation("the archive format is invalid")
	}
	version, ok := integerValue(raw["version"])
	if !ok || version < 2 || version > CurrentUserArchiveVersion {
		return UserArchive{}, portabilityValidation("the archive version is unsupported")
	}
	if err := rejectSensitiveArchiveKeys(raw); err != nil {
		return UserArchive{}, err
	}
	for version < CurrentUserArchiveVersion {
		switch version {
		case 2:
			raw["goalMilestones"], raw["goalAlertDismissals"] = []any{}, []any{}
			version = 3
		case 3:
			upgradeLegacyInstitutions(raw)
			version = 4
		case 4:
			for _, row := range objectRows(raw["transactions"]) {
				row["externalId"] = nil
			}
			version = 5
		case 5:
			for _, key := range []string{"beneficiaries", "estatePlans", "estateAccountDirectives", "estateAllocations", "estateResiduaryAllocations", "estatePlanSnapshots"} {
				raw[key] = []any{}
			}
			version = 6
		case 6:
			for _, row := range objectRows(raw["accounts"]) {
				row["trackingMode"] = "balance"
			}
			for _, key := range []string{"investmentInstruments", "positionEvents", "securityPrices", "positionReconciliations"} {
				raw[key] = []any{}
			}
			version = 7
		case 7:
			upgradeV7PortableArchive(raw)
			version = 8
		}
		raw["version"] = json.Number(fmt.Sprint(version))
	}
	normalized, err := json.Marshal(raw)
	if err != nil {
		return UserArchive{}, portabilityValidation("the archive could not be normalized")
	}
	decoder = json.NewDecoder(bytes.NewReader(normalized))
	decoder.UseNumber()
	var archive UserArchive
	if err := decoder.Decode(&archive); err != nil {
		return UserArchive{}, portabilityValidation("the archive shape is invalid")
	}
	if archive.Settings == nil || len(archive.Categories) == 0 {
		return UserArchive{}, portabilityValidation("the archive is missing required settings or categories")
	}
	return archive, nil
}

func upgradeLegacyInstitutions(raw map[string]any) {
	accounts := objectRows(raw["accounts"])
	type legacyInstitution struct{ name, createdAt, updatedAt string }
	byName := map[string]legacyInstitution{}
	sort.Slice(accounts, func(i, j int) bool { return stringValue(accounts[i]["id"]) < stringValue(accounts[j]["id"]) })
	for _, account := range accounts {
		name := canonicalInstitution(stringValue(account["institution"]))
		if name == "" {
			continue
		}
		key, current := strings.ToLower(name), byName[strings.ToLower(name)]
		if current.name == "" || name < current.name {
			current.name = name
		}
		created, updated := stringValue(account["createdAt"]), stringValue(account["updatedAt"])
		if current.createdAt == "" || created < current.createdAt {
			current.createdAt = created
		}
		if updated > current.updatedAt {
			current.updatedAt = updated
		}
		byName[key] = current
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	institutions, ids := make([]any, 0, len(names)), map[string]string{}
	for index, normalized := range names {
		value, id := byName[normalized], fmt.Sprintf("legacy-institution-%d", index+1)
		ids[normalized] = id
		institutions = append(institutions, map[string]any{"id": id, "name": value.name, "type": "other", "websiteUrl": nil,
			"countryCode": nil, "address": nil, "notes": nil, "archivedAt": nil, "createdAt": value.createdAt, "updatedAt": value.updatedAt})
	}
	for _, account := range accounts {
		name := canonicalInstitution(stringValue(account["institution"]))
		delete(account, "institution")
		if name == "" {
			account["institutionId"] = nil
		} else {
			account["institutionId"] = ids[strings.ToLower(name)]
		}
	}
	raw["institutions"] = institutions
}

func upgradeV7PortableArchive(raw map[string]any) {
	settings, _ := raw["settings"].(map[string]any)
	settings["positionStaleDaysStock"], settings["positionStaleDaysEtf"], settings["positionStaleDaysFund"] = json.Number("7"), json.Number("7"), json.Number("31")
	for _, row := range objectRows(raw["transactions"]) {
		row["eventGroupId"] = nil
	}
	events := objectRows(raw["positionEvents"])
	sort.SliceStable(events, func(i, j int) bool {
		for _, key := range []string{"tradeDate", "createdAt", "id"} {
			left, right := stringValue(events[i][key]), stringValue(events[j][key])
			if left != right {
				return left < right
			}
		}
		return false
	})
	sequence := map[string]int{}
	for _, row := range events {
		key := stringValue(row["accountId"]) + ":" + stringValue(row["tradeDate"])
		sequence[key]++
		row["relatedInstrumentId"], row["actionRatioNumerator"], row["actionRatioDenominator"], row["eventGroupId"] = nil, nil, nil, nil
		row["eventSequence"] = json.Number(fmt.Sprint(sequence[key]))
	}
	raw["accountConversions"] = []any{}
}

type archiveIDMaps map[string]map[string]string

func validateAndRemapArchive(archive *UserArchive) (archiveIDMaps, error) {
	maps := archiveIDMaps{}
	for _, table := range portabilityTables {
		if !containsString(table.keys, "id") {
			continue
		}
		mapping := map[string]string{}
		for _, row := range *table.archive(archive) {
			old := requiredString(row, "id")
			if old == "" || mapping[old] != "" {
				return nil, portabilityValidation("the archive contains duplicate or missing " + table.name + " IDs")
			}
			mapping[old] = uuid.NewString()
		}
		maps[table.name] = mapping
	}
	relationships := []struct {
		rows               []map[string]any
		key, target, label string
		optional           bool
	}{
		{archive.Accounts, "categoryId", "categories", "account category", false}, {archive.Accounts, "institutionId", "institutions", "account institution", true},
		{archive.Accounts, "goalId", "goals", "account goal", true}, {archive.AccountConversions, "sourceAccountId", "accounts", "conversion source", false},
		{archive.AccountConversions, "targetAccountId", "accounts", "conversion target", false}, {archive.Transactions, "accountId", "accounts", "transaction account", false},
		{archive.Valuations, "accountId", "accounts", "valuation account", false}, {archive.Goals, "linkedAccountId", "accounts", "goal account", true},
		{archive.GoalContributionPlans, "goalId", "goals", "contribution plan goal", false}, {archive.GoalMilestones, "goalId", "goals", "milestone goal", false},
		{archive.GoalAlertDismissals, "goalId", "goals", "alert goal", false}, {archive.PositionEvents, "accountId", "accounts", "position account", false},
		{archive.PositionEvents, "instrumentId", "investment_instruments", "position instrument", false}, {archive.PositionEvents, "relatedInstrumentId", "investment_instruments", "related instrument", true},
		{archive.SecurityPrices, "instrumentId", "investment_instruments", "price instrument", false}, {archive.PositionReconciliations, "accountId", "accounts", "reconciliation account", false},
		{archive.EstateAccountDirectives, "estatePlanId", "estate_plans", "directive plan", false}, {archive.EstateAccountDirectives, "accountId", "accounts", "directive account", false},
		{archive.EstateAllocations, "estatePlanId", "estate_plans", "allocation plan", false}, {archive.EstateAllocations, "directiveId", "estate_account_directives", "allocation directive", false},
		{archive.EstateAllocations, "beneficiaryId", "beneficiaries", "allocation beneficiary", false}, {archive.EstateResiduaryAllocations, "estatePlanId", "estate_plans", "residuary plan", false},
		{archive.EstateResiduaryAllocations, "beneficiaryId", "beneficiaries", "residuary beneficiary", false}, {archive.EstatePlanSnapshots, "estatePlanId", "estate_plans", "snapshot plan", false},
	}
	accountByID := rowsByID(archive.Accounts)
	instrumentByID := rowsByID(archive.InvestmentInstruments)
	directiveByID := rowsByID(archive.EstateAccountDirectives)
	for _, relationship := range relationships {
		for _, row := range relationship.rows {
			old := stringValue(row[relationship.key])
			if old == "" && relationship.optional {
				row[relationship.key] = nil
				continue
			}
			mapped := maps[relationship.target][old]
			if mapped == "" {
				return nil, portabilityValidation("the archive contains an invalid " + relationship.label + " relationship")
			}
			row[relationship.key] = mapped
		}
	}
	for _, table := range portabilityTables {
		mapping := maps[table.name]
		for _, row := range *table.archive(archive) {
			if mapping != nil {
				row["id"] = mapping[requiredString(row, "id")]
			}
		}
	}
	if err := validatePortableDomain(archive, accountByID, instrumentByID, directiveByID); err != nil {
		return nil, err
	}
	remapGroupIDs(archive)
	return maps, nil
}

func validatePortableDomain(archive *UserArchive, _, _, _ map[string]map[string]any) error {
	normalizedInstitutions := map[string]bool{}
	for _, institution := range archive.Institutions {
		name := strings.ToLower(canonicalInstitution(stringValue(institution["name"])))
		if name == "" || normalizedInstitutions[name] {
			return portabilityValidation("the archive contains duplicate institution names")
		}
		normalizedInstitutions[name] = true
	}
	linked := map[string]bool{}
	for _, goal := range archive.Goals {
		id := stringValue(goal["linkedAccountId"])
		if id != "" && linked[id] {
			return portabilityValidation("the archive links multiple goals to one account")
		}
		linked[id] = id != ""
	}
	for _, valuation := range archive.Valuations {
		for _, account := range archive.Accounts {
			if stringValue(account["id"]) == stringValue(valuation["accountId"]) && stringValue(account["trackingMode"]) == "positions" {
				return portabilityValidation("the archive contains an absolute valuation for a position account")
			}
		}
	}
	totals := map[string]int64{}
	for _, allocation := range append(append([]map[string]any{}, archive.EstateAllocations...), archive.EstateResiduaryAllocations...) {
		bps, ok := integerValue(allocation["allocationBps"])
		if !ok || bps <= 0 || bps > fullEstateAllocationBPS {
			return portabilityValidation("the archive contains an invalid estate allocation")
		}
		key := stringValue(allocation["directiveId"]) + ":" + stringValue(allocation["estatePlanId"]) + ":" + stringValue(allocation["tier"])
		totals[key] += int64(bps)
		if totals[key] > fullEstateAllocationBPS {
			return portabilityValidation("the archive contains estate allocations over 100%")
		}
	}
	for _, snapshot := range archive.EstatePlanSnapshots {
		content, hash := stringValue(snapshot["content"]), stringValue(snapshot["contentHash"])
		actual := sha256.Sum256([]byte(content))
		var parsed map[string]any
		if hex.EncodeToString(actual[:]) != hash || json.Unmarshal([]byte(content), &parsed) != nil || stringValue(parsed["format"]) != "wealthboard-estate-summary" ||
			!isJSONArray(parsed["assets"]) || !isJSONArray(parsed["beneficiaries"]) || !isJSONArray(parsed["reviewItems"]) {
			return portabilityValidation("the estate snapshot integrity hash is invalid")
		}
		if strings.Contains(content, `"userId"`) {
			return portabilityValidation("estate snapshot content contains an owner identifier")
		}
	}
	accountMode := map[string]string{}
	accountArchived := map[string]bool{}
	accountLiability := map[string]bool{}
	for _, account := range archive.Accounts {
		accountMode[stringValue(account["id"])] = stringValue(account["trackingMode"])
		accountArchived[stringValue(account["id"])] = account["archivedAt"] != nil
		accountLiability[stringValue(account["id"])] = account["isLiability"] == true
	}
	directivePlan := map[string]string{}
	for _, directive := range archive.EstateAccountDirectives {
		if directive["isIncluded"] == true && accountLiability[stringValue(directive["accountId"])] {
			return portabilityValidation("the archive assigns a liability to estate beneficiaries")
		}
		directivePlan[stringValue(directive["id"])] = stringValue(directive["estatePlanId"])
	}
	for _, allocation := range archive.EstateAllocations {
		if directivePlan[stringValue(allocation["directiveId"])] != stringValue(allocation["estatePlanId"]) {
			return portabilityValidation("the archive contains an invalid estate allocation plan relationship")
		}
	}
	for _, conversion := range archive.AccountConversions {
		source, target := stringValue(conversion["sourceAccountId"]), stringValue(conversion["targetAccountId"])
		if source == target || accountMode[source] != "balance" || accountMode[target] != "positions" || !accountArchived[source] {
			return portabilityValidation("the archive contains an invalid account conversion")
		}
	}
	priceCurrency := map[string]string{}
	for _, instrument := range archive.InvestmentInstruments {
		priceCurrency[stringValue(instrument["id"])] = stringValue(instrument["quoteCurrency"])
	}
	sequences := map[string]bool{}
	for _, event := range archive.PositionEvents {
		if accountMode[stringValue(event["accountId"])] != "positions" {
			return portabilityValidation("the archive links a position event to a balance account")
		}
		eventType := stringValue(event["type"])
		quantity, quantityOK := new(big.Rat).SetString(stringValue(event["quantity"]))
		if !quantityOK || (eventType == "quantity_adjustment" && quantity.Sign() == 0) || (eventType == "split" && quantity.Sign() != 0) || (eventType != "quantity_adjustment" && eventType != "split" && quantity.Sign() <= 0) {
			return portabilityValidation("the archive contains an invalid position quantity")
		}
		if eventType == "spinoff" || eventType == "merger_in" || eventType == "merger_out" {
			related := stringValue(event["relatedInstrumentId"])
			numerator, numeratorOK := new(big.Rat).SetString(stringValue(event["actionRatioNumerator"]))
			denominator, denominatorOK := new(big.Rat).SetString(stringValue(event["actionRatioDenominator"]))
			if related == "" || related == stringValue(event["instrumentId"]) || !numeratorOK || !denominatorOK || numerator.Sign() <= 0 || denominator.Sign() <= 0 {
				return portabilityValidation("the archive contains an invalid related-instrument action")
			}
		}
		if (eventType == "transfer_in" || eventType == "transfer_out" || eventType == "merger_in" || eventType == "merger_out") && stringValue(event["eventGroupId"]) == "" {
			return portabilityValidation("the archive contains an ungrouped paired position event")
		}
		sequence, ok := integerValue(event["eventSequence"])
		key := stringValue(event["accountId"]) + ":" + stringValue(event["tradeDate"]) + ":" + fmt.Sprint(sequence)
		if !ok || sequence < 1 || sequences[key] {
			return portabilityValidation("the archive contains duplicate same-date position-event sequences")
		}
		sequences[key] = true
	}
	for _, price := range archive.SecurityPrices {
		if priceCurrency[stringValue(price["instrumentId"])] != stringValue(price["currency"]) {
			return portabilityValidation("the archive contains a price in the wrong instrument currency")
		}
	}
	for _, reconciliation := range archive.PositionReconciliations {
		if accountMode[stringValue(reconciliation["accountId"])] != "positions" {
			return portabilityValidation("the archive links a reconciliation to a balance account")
		}
	}
	if err := validatePortableEventGroups(archive.Transactions, archive.PositionEvents); err != nil {
		return err
	}
	if err := validatePortablePositionReplay(archive.PositionEvents); err != nil {
		return err
	}
	return nil
}

func validatePortableEventGroups(transactions, events []map[string]any) error {
	eventsByGroup := map[string][]map[string]any{}
	cashByGroup := map[string][]map[string]any{}
	for _, event := range events {
		if group := stringValue(event["eventGroupId"]); group != "" {
			eventsByGroup[group] = append(eventsByGroup[group], event)
		}
	}
	for _, transaction := range transactions {
		if group := stringValue(transaction["eventGroupId"]); group != "" {
			cashByGroup[group] = append(cashByGroup[group], transaction)
		}
	}
	groups := map[string]bool{}
	for group := range eventsByGroup {
		groups[group] = true
	}
	for group := range cashByGroup {
		groups[group] = true
	}
	for group := range groups {
		groupEvents, groupCash := eventsByGroup[group], cashByGroup[group]
		dates := map[string]bool{}
		for _, event := range groupEvents {
			dates[stringValue(event["tradeDate"])] = true
		}
		for _, transaction := range groupCash {
			dates[stringValue(transaction["transactionDate"])] = true
		}
		if len(dates) != 1 {
			return portabilityValidation("the archive contains a group spanning multiple dates")
		}
		transferOut, transferIn := filterPortableEvents(groupEvents, "transfer_out"), filterPortableEvents(groupEvents, "transfer_in")
		if len(transferOut)+len(transferIn) > 0 {
			if len(groupEvents) != 2 || len(transferOut) != 1 || len(transferIn) != 1 ||
				stringValue(transferOut[0]["accountId"]) == stringValue(transferIn[0]["accountId"]) ||
				stringValue(transferOut[0]["instrumentId"]) != stringValue(transferIn[0]["instrumentId"]) ||
				stringValue(transferOut[0]["quantity"]) != stringValue(transferIn[0]["quantity"]) ||
				!portableCashTypesOnly(groupCash, "fee") {
				return portabilityValidation("the archive contains an invalid in-kind transfer group")
			}
			continue
		}
		mergerOut, mergerIn := filterPortableEvents(groupEvents, "merger_out"), filterPortableEvents(groupEvents, "merger_in")
		if len(mergerOut)+len(mergerIn) > 0 {
			if len(groupEvents) != 2 || len(mergerOut) != 1 || len(mergerIn) != 1 || len(groupCash) != 0 ||
				stringValue(mergerOut[0]["accountId"]) != stringValue(mergerIn[0]["accountId"]) ||
				stringValue(mergerOut[0]["relatedInstrumentId"]) != stringValue(mergerIn[0]["instrumentId"]) ||
				stringValue(mergerIn[0]["relatedInstrumentId"]) != stringValue(mergerOut[0]["instrumentId"]) ||
				stringValue(mergerOut[0]["actionRatioNumerator"]) != stringValue(mergerIn[0]["actionRatioNumerator"]) ||
				stringValue(mergerOut[0]["actionRatioDenominator"]) != stringValue(mergerIn[0]["actionRatioDenominator"]) {
				return portabilityValidation("the archive contains an invalid merger group")
			}
			continue
		}
		if len(groupCash) > 0 {
			if len(groupCash) != 1 || stringValue(groupCash[0]["type"]) != "dividend" || len(groupEvents) == 0 {
				return portabilityValidation("the archive contains an invalid reinvestment group")
			}
			for _, event := range groupEvents {
				if stringValue(event["type"]) != "buy" || stringValue(event["accountId"]) != stringValue(groupCash[0]["accountId"]) {
					return portabilityValidation("the archive contains an invalid reinvestment group")
				}
			}
			continue
		}
		if len(groupEvents) != 1 || (stringValue(groupEvents[0]["type"]) != "split" && stringValue(groupEvents[0]["type"]) != "spinoff") {
			return portabilityValidation("the archive contains an incomplete position group")
		}
	}
	return nil
}

func filterPortableEvents(events []map[string]any, eventType string) []map[string]any {
	result := []map[string]any{}
	for _, event := range events {
		if stringValue(event["type"]) == eventType {
			result = append(result, event)
		}
	}
	return result
}

func portableCashTypesOnly(rows []map[string]any, allowed string) bool {
	for _, row := range rows {
		if stringValue(row["type"]) != allowed {
			return false
		}
	}
	return true
}

func isJSONArray(value any) bool {
	_, ok := value.([]any)
	return ok
}

func validatePortablePositionReplay(events []map[string]any) error {
	sort.SliceStable(events, func(i, j int) bool {
		left, right := stringValue(events[i]["tradeDate"]), stringValue(events[j]["tradeDate"])
		if left != right {
			return left < right
		}
		li, _ := integerValue(events[i]["eventSequence"])
		ri, _ := integerValue(events[j]["eventSequence"])
		return li < ri
	})
	quantities := map[string]*big.Rat{}
	for _, event := range events {
		key := stringValue(event["accountId"]) + ":" + stringValue(event["instrumentId"])
		current := new(big.Rat)
		if quantities[key] != nil {
			current.Set(quantities[key])
		}
		quantity, ok := new(big.Rat).SetString(stringValue(event["quantity"]))
		if !ok {
			return portabilityValidation("the archive contains an invalid position quantity")
		}
		switch stringValue(event["type"]) {
		case "opening_position", "buy", "transfer_in", "spinoff", "merger_in":
			current.Add(current, quantity)
		case "sell", "transfer_out", "merger_out":
			current.Sub(current, quantity)
		case "quantity_adjustment":
			current.Add(current, quantity)
		case "split":
			numerator, numeratorOK := new(big.Rat).SetString(stringValue(event["actionRatioNumerator"]))
			denominator, denominatorOK := new(big.Rat).SetString(stringValue(event["actionRatioDenominator"]))
			if !numeratorOK || !denominatorOK || numerator.Sign() <= 0 || denominator.Sign() <= 0 || quantity.Sign() != 0 {
				return portabilityValidation("the archive contains a split without a valid ratio")
			}
			current.Mul(current, numerator).Quo(current, denominator)
		default:
			return portabilityValidation("the archive contains an unsupported position event")
		}
		if current.Sign() < 0 {
			return portabilityValidation("the archive contains a negative position quantity")
		}
		quantities[key] = current
	}
	return nil
}

func remapGroupIDs(archive *UserArchive) {
	groups := map[string]string{}
	for _, rows := range [][]map[string]any{archive.Transactions, archive.PositionEvents} {
		for _, row := range rows {
			old := stringValue(row["eventGroupId"])
			if old == "" {
				row["eventGroupId"] = nil
				continue
			}
			if groups[old] == "" {
				groups[old] = uuid.NewString()
			}
			row["eventGroupId"] = groups[old]
		}
	}
	transferGroups := map[string]string{}
	for _, row := range archive.Transactions {
		old := stringValue(row["transferGroupId"])
		if old == "" {
			row["transferGroupId"] = nil
			continue
		}
		if transferGroups[old] == "" {
			transferGroups[old] = uuid.NewString()
		}
		row["transferGroupId"] = transferGroups[old]
	}
}

func deletePortableData(ctx context.Context, tx *sql.Tx, userID uuid.UUID) error {
	for _, table := range []string{"account_conversions", "estate_plan_snapshots", "estate_allocations", "estate_residuary_allocations", "estate_account_directives", "estate_plans", "beneficiaries", "position_reconciliations", "security_prices", "position_events", "investment_instruments", "goal_alert_dismissals", "goal_milestones", "goal_contribution_plans", "goals", "transactions", "valuation_snapshots", "accounts", "institutions", "categories", "exchange_rates", "idempotency_keys"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE user_id=$1`, userID); err != nil {
			return fmt.Errorf("clear %s: %w", table, err)
		}
	}
	return nil
}

func updatePortableSettings(ctx context.Context, tx *sql.Tx, userID uuid.UUID, settings map[string]any, now time.Time) error {
	required := []string{"displayName", "baseCurrency", "supportedCurrencies", "timezone", "preferredDateFormat", "appName", "defaultDashboardPeriod", "sessionTimeoutMinutes", "defaultGoalReturnBps", "positionStaleDaysStock", "positionStaleDaysEtf", "positionStaleDaysFund"}
	values := make([]any, 0, len(required)+2)
	values = append(values, userID)
	for _, key := range required {
		value, exists := settings[key]
		if !exists {
			return portabilityValidation("the archive settings are incomplete")
		}
		values = append(values, databaseValue(value))
	}
	values = append(values, now)
	_, err := tx.ExecContext(ctx, `UPDATE user_settings SET display_name=$2,base_currency=$3,supported_currencies=$4,
timezone=$5,preferred_date_format=$6,app_name=$7,default_dashboard_period=$8,session_timeout_minutes=$9,
default_goal_return_bps=$10,position_stale_days_stock=$11,position_stale_days_etf=$12,position_stale_days_fund=$13,
updated_at=$14 WHERE user_id=$1`, values...)
	if err != nil {
		return fmt.Errorf("restore settings: %w", err)
	}
	return nil
}

func insertPortableRow(ctx context.Context, tx *sql.Tx, userID uuid.UUID, table portabilityTable, row map[string]any) error {
	columns := append([]string{"user_id"}, table.columns...)
	values := make([]any, 0, len(columns))
	values = append(values, userID)
	placeholders := make([]string, len(columns))
	placeholders[0] = "$1"
	for index, key := range table.keys {
		value, exists := row[key]
		if !exists {
			return portabilityValidation("the archive is missing " + table.name + "." + key)
		}
		values = append(values, portableColumnValue(table.columns[index], value))
		placeholders[index+1] = fmt.Sprintf("$%d", index+2)
	}
	if table.name == "institutions" {
		columns = append(columns, "normalized_name")
		values = append(values, normalizeInstitutionName(stringValue(row["name"])))
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(values)))
	}
	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table.name, strings.Join(columns, ","), strings.Join(placeholders, ","))
	_, err := tx.ExecContext(ctx, query, values...)
	return err
}

func portableColumnValue(column string, value any) any {
	if value == nil {
		return nil
	}
	if strings.HasSuffix(column, "_date") || column == "opened_at" || column == "start_date" || column == "end_date" || column == "target_date" || column == "settlement_date" {
		text := stringValue(value)
		if len(text) >= 10 {
			return text[:10]
		}
	}
	return databaseValue(value)
}

func databaseValue(value any) any {
	switch typed := value.(type) {
	case json.Number:
		if integer, err := typed.Int64(); err == nil {
			return integer
		}
		return typed.String()
	default:
		return value
	}
}

func (service *PortabilityService) TransactionsCSV(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	rows, err := service.db.QueryContext(ctx, `SELECT transaction.id,transaction.external_id,transaction.account_id,account.name,
transaction.type,transaction.amount_minor,transaction.currency,transaction.transaction_date,transaction.description,
transaction.notes,transaction.transfer_group_id FROM transactions transaction JOIN accounts account
ON account.user_id=transaction.user_id AND account.id=transaction.account_id WHERE transaction.user_id=$1
ORDER BY transaction.transaction_date DESC,transaction.created_at DESC,transaction.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("export transaction CSV: %w", err)
	}
	defer rows.Close()
	return writePortableCSV(rows, []string{"id", "external_id", "account_id", "account_name", "type", "amount_minor", "currency", "date", "description", "notes", "transfer_group_id"})
}

func (service *PortabilityService) AccountsCSV(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	rows, err := service.db.QueryContext(ctx, `SELECT account.id,account.name,category.name,institution.name,institution.archived_at,
account.currency,account.current_value_minor,account.cost_basis_minor,account.is_liability,account.is_included_in_net_worth,account.archived_at
FROM accounts account JOIN categories category ON category.user_id=account.user_id AND category.id=account.category_id
LEFT JOIN institutions institution ON institution.user_id=account.user_id AND institution.id=account.institution_id
WHERE account.user_id=$1 AND account.archived_at IS NULL ORDER BY account.name,account.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("export account CSV: %w", err)
	}
	defer rows.Close()
	return writePortableCSV(rows, []string{"id", "name", "category", "institution", "institution_archived_at", "currency", "current_value_minor", "cost_basis_minor", "is_liability", "included_in_net_worth", "archived_at"})
}

func writePortableCSV(rows *sql.Rows, headers []string) ([]byte, error) {
	var output bytes.Buffer
	writer := csv.NewWriter(&output)
	if err := writer.Write(headers); err != nil {
		return nil, err
	}
	for rows.Next() {
		values := make([]any, len(headers))
		pointers := make([]any, len(headers))
		for index := range values {
			pointers[index] = &values[index]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		record := make([]string, len(values))
		for index, value := range values {
			switch typed := value.(type) {
			case nil:
				record[index] = ""
			case []byte:
				record[index] = string(typed)
			case time.Time:
				record[index] = typed.Format(time.RFC3339Nano)
			default:
				record[index] = fmt.Sprint(typed)
			}
		}
		if err := writer.Write(record); err != nil {
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func decodeJSONObject(data []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var result map[string]any
	err := decoder.Decode(&result)
	return result, err
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); errors.Is(err, io.EOF) {
		return nil
	} else {
		return err
	}
}

func rejectSensitiveArchiveKeys(value any) error {
	forbidden := map[string]bool{"userId": true, "password": true, "passwordHash": true, "session": true, "oidcIdentities": true, "apiKeys": true, "aiCredentials": true, "encryptedApiKey": true}
	var walk func(any) bool
	walk = func(current any) bool {
		switch typed := current.(type) {
		case map[string]any:
			for key, child := range typed {
				if forbidden[key] || walk(child) {
					return true
				}
			}
		case []any:
			for _, child := range typed {
				if walk(child) {
					return true
				}
			}
		}
		return false
	}
	if walk(value) {
		return portabilityValidation("the archive contains forbidden identity or credential fields")
	}
	return nil
}

func objectRows(value any) []map[string]any {
	array, _ := value.([]any)
	result := make([]map[string]any, 0, len(array))
	for _, value := range array {
		if row, ok := value.(map[string]any); ok {
			result = append(result, row)
		}
	}
	return result
}

func rowsByID(rows []map[string]any) map[string]map[string]any {
	result := make(map[string]map[string]any, len(rows))
	for _, row := range rows {
		result[stringValue(row["id"])] = row
	}
	return result
}

func requiredString(row map[string]any, key string) string { return stringValue(row[key]) }

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func integerValue(value any) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	case float64:
		return int(typed), typed == float64(int(typed))
	case int:
		return typed, true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	default:
		return 0, false
	}
}

func canonicalInstitution(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func snakeToCamel(value string) string {
	parts := strings.Split(value, "_")
	for index := 1; index < len(parts); index++ {
		if parts[index] != "" {
			parts[index] = strings.ToUpper(parts[index][:1]) + parts[index][1:]
		}
	}
	return strings.Join(parts, "")
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func portabilityValidation(detail string) error {
	return fmt.Errorf("%w: %s", ErrPortabilityValidation, detail)
}
