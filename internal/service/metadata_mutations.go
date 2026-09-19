package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/text/unicode/norm"
)

type MetadataErrorKind string

const (
	MetadataValidation MetadataErrorKind = "validation"
	MetadataNotFound   MetadataErrorKind = "not_found"
	MetadataConflict   MetadataErrorKind = "conflict"
)

type MetadataError struct {
	Kind   MetadataErrorKind
	Detail string
}

func (err *MetadataError) Error() string { return err.Detail }

func metadataError(kind MetadataErrorKind, detail string) error {
	return &MetadataError{Kind: kind, Detail: detail}
}

type MetadataMutations struct {
	db  *sql.DB
	now func() time.Time
}

func NewMetadataMutations(db *sql.DB) *MetadataMutations {
	return &MetadataMutations{db: db, now: time.Now}
}

type SettingsInput struct {
	DisplayName            string   `json:"displayName"`
	AppName                string   `json:"appName"`
	BaseCurrency           string   `json:"baseCurrency"`
	SupportedCurrencies    []string `json:"supportedCurrencies"`
	Timezone               string   `json:"timezone"`
	PreferredDateFormat    string   `json:"preferredDateFormat"`
	DefaultDashboardPeriod string   `json:"defaultDashboardPeriod"`
	SessionTimeoutMinutes  int      `json:"sessionTimeoutMinutes"`
	DefaultGoalReturnBPS   int      `json:"defaultGoalReturnBps"`
	PositionStaleDaysStock int      `json:"positionStaleDaysStock"`
	PositionStaleDaysETF   int      `json:"positionStaleDaysEtf"`
	PositionStaleDaysFund  int      `json:"positionStaleDaysFund"`
}

type CategoryInput struct {
	Name             string `json:"name"`
	Icon             string `json:"icon"`
	AssetOrLiability string `json:"assetOrLiability"`
	Description      string `json:"description"`
	IsLiquid         bool   `json:"isLiquid"`
	IsInvestible     bool   `json:"isInvestible"`
}

type InstitutionInput struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	WebsiteURL  string `json:"websiteUrl"`
	CountryCode string `json:"countryCode"`
	Address     string `json:"address"`
	Notes       string `json:"notes"`
}

type ExchangeRateInput struct {
	BaseCurrency  string `json:"baseCurrency"`
	QuoteCurrency string `json:"quoteCurrency"`
	Rate          string `json:"rate"`
	EffectiveDate string `json:"effectiveDate"`
}

var (
	metadataCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
	metadataDecimalPattern  = regexp.MustCompile(`^(?:0*[1-9]\d*)(?:\.\d+)?$|^0*\.\d*[1-9]\d*$`)
	slugSeparator           = regexp.MustCompile(`[^a-z0-9]+`)
)

func (service *MetadataMutations) UpdateSettings(ctx context.Context, userID uuid.UUID, input SettingsInput) error {
	if err := validateSettings(&input); err != nil {
		return err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin settings update: %w", err)
	}
	defer tx.Rollback()

	referenced, err := referencedCurrencies(ctx, tx, userID)
	if err != nil {
		return err
	}
	enabled := make(map[string]bool, len(input.SupportedCurrencies)+1)
	for _, currency := range input.SupportedCurrencies {
		enabled[currency] = true
	}
	enabled[input.BaseCurrency] = true
	for currency := range referenced {
		if !enabled[currency] {
			return metadataError(MetadataConflict, "Cannot disable currencies still in use: "+currency+".")
		}
	}
	currencies := make([]string, 0, len(enabled))
	for currency := range enabled {
		currencies = append(currencies, currency)
	}
	sort.Strings(currencies)
	currencyJSON, err := json.Marshal(currencies)
	if err != nil {
		return fmt.Errorf("encode supported currencies: %w", err)
	}

	result, err := tx.ExecContext(ctx, `
UPDATE user_settings
SET display_name = $2, app_name = $3, base_currency = $4, supported_currencies = $5,
    timezone = $6, preferred_date_format = $7, default_dashboard_period = $8,
    session_timeout_minutes = $9, default_goal_return_bps = $10,
    position_stale_days_stock = $11, position_stale_days_etf = $12,
    position_stale_days_fund = $13, updated_at = $14
WHERE user_id = $1`, userID, input.DisplayName, input.AppName, input.BaseCurrency, string(currencyJSON),
		input.Timezone, input.PreferredDateFormat, input.DefaultDashboardPeriod,
		input.SessionTimeoutMinutes, input.DefaultGoalReturnBPS, input.PositionStaleDaysStock,
		input.PositionStaleDaysETF, input.PositionStaleDaysFund, service.now().UTC())
	if err != nil {
		return fmt.Errorf("update settings: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("count updated settings: %w", err)
	} else if affected != 1 {
		return metadataError(MetadataNotFound, "Settings were not found.")
	}
	return tx.Commit()
}

func (service *MetadataMutations) CreateCategory(ctx context.Context, userID uuid.UUID, input CategoryInput) (Category, error) {
	if err := validateCategoryInput(&input); err != nil {
		return Category{}, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return Category{}, fmt.Errorf("begin category creation: %w", err)
	}
	defer tx.Rollback()

	id := uuid.New()
	slug := slugifyCategory(input.Name)
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM categories WHERE user_id = $1 AND slug = $2)`, userID, slug).Scan(&exists); err != nil {
		return Category{}, fmt.Errorf("check category slug: %w", err)
	}
	if exists {
		slug += "-" + id.String()[:6]
	}
	now := service.now().UTC()
	category := Category{ID: id, Name: input.Name, Slug: slug, Icon: input.Icon, AssetOrLiability: input.AssetOrLiability,
		Description: input.Description, IsLiquid: input.IsLiquid, IsInvestible: input.IsInvestible}
	err = tx.QueryRowContext(ctx, `
INSERT INTO categories (id, user_id, name, slug, icon, display_order, asset_or_liability,
                        description, is_liquid, is_investible, is_archived, is_system, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,COALESCE((SELECT MAX(display_order) + 1 FROM categories WHERE user_id = $2),0),
        $6,NULLIF($7,''),$8,$9,FALSE,FALSE,$10,$10)
RETURNING display_order`, id, userID, input.Name, slug, input.Icon, input.AssetOrLiability,
		input.Description, input.IsLiquid, input.IsInvestible, now).Scan(&category.DisplayOrder)
	if err != nil {
		return Category{}, classifyConstraint(err, "A category with this name already exists.")
	}
	if err := tx.Commit(); err != nil {
		return Category{}, fmt.Errorf("commit category creation: %w", err)
	}
	return category, nil
}

func (service *MetadataMutations) UpdateCategory(ctx context.Context, userID, categoryID uuid.UUID, input CategoryInput) error {
	if err := validateCategoryInput(&input); err != nil {
		return err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin category update: %w", err)
	}
	defer tx.Rollback()
	if err := requireMutableCategory(ctx, tx, userID, categoryID); err != nil {
		return err
	}
	if input.AssetOrLiability == "liability" {
		var linked bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE user_id = $1 AND category_id = $2 AND goal_id IS NOT NULL)`, userID, categoryID).Scan(&linked); err != nil {
			return fmt.Errorf("check linked goals: %w", err)
		}
		if linked {
			return metadataError(MetadataConflict, "Unlink goals from accounts in this category before making it a liability.")
		}
	}
	now := service.now().UTC()
	if _, err := tx.ExecContext(ctx, `
UPDATE categories
SET name=$3, icon=$4, asset_or_liability=$5, description=NULLIF($6,''),
    is_liquid=$7, is_investible=$8, updated_at=$9
WHERE user_id=$1 AND id=$2 AND is_system=FALSE`, userID, categoryID, input.Name, input.Icon,
		input.AssetOrLiability, input.Description, input.IsLiquid, input.IsInvestible, now); err != nil {
		return classifyConstraint(err, "A category with this name already exists.")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET is_liability=$3, updated_at=$4 WHERE user_id=$1 AND category_id=$2`,
		userID, categoryID, input.AssetOrLiability == "liability", now); err != nil {
		return fmt.Errorf("update category accounts: %w", err)
	}
	return tx.Commit()
}

func (service *MetadataMutations) ArchiveCategory(ctx context.Context, userID, categoryID uuid.UUID, archived bool) error {
	result, err := service.db.ExecContext(ctx, `UPDATE categories SET is_archived=$3, updated_at=$4 WHERE user_id=$1 AND id=$2 AND is_system=FALSE`,
		userID, categoryID, archived, service.now().UTC())
	if err != nil {
		return fmt.Errorf("archive category: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return categoryMutationMiss(ctx, service.db, userID, categoryID)
	}
	return nil
}

func (service *MetadataMutations) ReorderCategory(ctx context.Context, userID, categoryID uuid.UUID, direction string) error {
	if direction != "up" && direction != "down" {
		return metadataError(MetadataValidation, "Direction must be up or down.")
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin category reorder: %w", err)
	}
	defer tx.Rollback()
	if err := requireMutableCategory(ctx, tx, userID, categoryID); err != nil {
		return err
	}
	operator, ordering := "<", "DESC"
	if direction == "down" {
		operator, ordering = ">", "ASC"
	}
	var adjacentID uuid.UUID
	var currentOrder, adjacentOrder int
	if err := tx.QueryRowContext(ctx, `SELECT display_order FROM categories WHERE user_id=$1 AND id=$2 FOR UPDATE`, userID, categoryID).Scan(&currentOrder); err != nil {
		return fmt.Errorf("lock category: %w", err)
	}
	query := fmt.Sprintf(`SELECT id, display_order FROM categories WHERE user_id=$1 AND is_system=FALSE AND display_order %s $2 ORDER BY display_order %s, name, id LIMIT 1 FOR UPDATE`, operator, ordering)
	if err := tx.QueryRowContext(ctx, query, userID, currentOrder).Scan(&adjacentID, &adjacentOrder); errors.Is(err, sql.ErrNoRows) {
		return tx.Commit()
	} else if err != nil {
		return fmt.Errorf("find adjacent category: %w", err)
	}
	now := service.now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE categories SET display_order=$3, updated_at=$4 WHERE user_id=$1 AND id=$2`, userID, categoryID, adjacentOrder, now); err != nil {
		return fmt.Errorf("move category: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE categories SET display_order=$3, updated_at=$4 WHERE user_id=$1 AND id=$2`, userID, adjacentID, currentOrder, now); err != nil {
		return fmt.Errorf("move adjacent category: %w", err)
	}
	return tx.Commit()
}

func (service *MetadataMutations) CreateInstitution(ctx context.Context, userID uuid.UUID, input InstitutionInput) (Institution, error) {
	if err := validateInstitutionInput(&input); err != nil {
		return Institution{}, err
	}
	id, now := uuid.New(), service.now().UTC()
	_, err := service.db.ExecContext(ctx, `
INSERT INTO institutions (id,user_id,name,normalized_name,type,website_url,country_code,address,notes,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),$10,$10)`,
		id, userID, input.Name, normalizeInstitutionName(input.Name), input.Type, input.WebsiteURL,
		input.CountryCode, input.Address, input.Notes, now)
	if err != nil {
		return Institution{}, classifyConstraint(err, "An institution with this name already exists.")
	}
	return Institution{ID: id, Name: input.Name, Type: input.Type, WebsiteURL: input.WebsiteURL,
		CountryCode: input.CountryCode, Address: input.Address, Notes: input.Notes}, nil
}

func (service *MetadataMutations) UpdateInstitution(ctx context.Context, userID, institutionID uuid.UUID, input InstitutionInput) error {
	if err := validateInstitutionInput(&input); err != nil {
		return err
	}
	result, err := service.db.ExecContext(ctx, `
UPDATE institutions
SET name=$3, normalized_name=$4, type=$5, website_url=NULLIF($6,''), country_code=NULLIF($7,''),
    address=NULLIF($8,''), notes=NULLIF($9,''), updated_at=$10
WHERE user_id=$1 AND id=$2`, userID, institutionID, input.Name, normalizeInstitutionName(input.Name), input.Type,
		input.WebsiteURL, input.CountryCode, input.Address, input.Notes, service.now().UTC())
	if err != nil {
		return classifyConstraint(err, "An institution with this name already exists.")
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return metadataError(MetadataNotFound, "Institution not found.")
	}
	return nil
}

func (service *MetadataMutations) ArchiveInstitution(ctx context.Context, userID, institutionID uuid.UUID, archived bool) error {
	var archivedAt any
	if archived {
		archivedAt = service.now().UTC()
	}
	result, err := service.db.ExecContext(ctx, `UPDATE institutions SET archived_at=$3, updated_at=$4 WHERE user_id=$1 AND id=$2`,
		userID, institutionID, archivedAt, service.now().UTC())
	if err != nil {
		return fmt.Errorf("archive institution: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return metadataError(MetadataNotFound, "Institution not found.")
	}
	return nil
}

func (service *MetadataMutations) CreateExchangeRate(ctx context.Context, userID uuid.UUID, input ExchangeRateInput) (ExchangeRate, error) {
	effectiveDate, err := validateExchangeRate(&input)
	if err != nil {
		return ExchangeRate{}, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return ExchangeRate{}, fmt.Errorf("begin exchange rate creation: %w", err)
	}
	defer tx.Rollback()
	for _, currency := range []string{input.BaseCurrency, input.QuoteCurrency} {
		var enabled bool
		if err := tx.QueryRowContext(ctx, `
SELECT base_currency=$2 OR supported_currencies::jsonb ? $2
FROM user_settings WHERE user_id=$1`, userID, currency).Scan(&enabled); errors.Is(err, sql.ErrNoRows) {
			return ExchangeRate{}, metadataError(MetadataNotFound, "Settings were not found.")
		} else if err != nil {
			return ExchangeRate{}, fmt.Errorf("check enabled currency: %w", err)
		} else if !enabled {
			return ExchangeRate{}, metadataError(MetadataValidation, currency+" is not enabled in your currency settings.")
		}
	}
	var reverseExists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM exchange_rates WHERE user_id=$1 AND base_currency=$2 AND quote_currency=$3)`,
		userID, input.QuoteCurrency, input.BaseCurrency).Scan(&reverseExists); err != nil {
		return ExchangeRate{}, fmt.Errorf("check reverse exchange-rate pair: %w", err)
	}
	if reverseExists {
		return ExchangeRate{}, metadataError(MetadataConflict, fmt.Sprintf("Use the existing %s/%s pair. Its inverse is calculated automatically.", input.QuoteCurrency, input.BaseCurrency))
	}
	rate := ExchangeRate{ID: uuid.New(), BaseCurrency: input.BaseCurrency, QuoteCurrency: input.QuoteCurrency,
		Rate: input.Rate, EffectiveDate: effectiveDate, Source: "manual", CreatedAt: service.now().UTC()}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO exchange_rates (id,user_id,base_currency,quote_currency,rate,effective_date,source,created_at)
VALUES ($1,$2,$3,$4,$5,$6,'manual',$7)`, rate.ID, userID, rate.BaseCurrency, rate.QuoteCurrency,
		rate.Rate, rate.EffectiveDate, rate.CreatedAt); err != nil {
		return ExchangeRate{}, classifyConstraint(err, "A rate already exists for this date.")
	}
	if err := tx.Commit(); err != nil {
		return ExchangeRate{}, fmt.Errorf("commit exchange rate creation: %w", err)
	}
	return rate, nil
}

func (service *MetadataMutations) DeleteExchangeRate(ctx context.Context, userID, rateID uuid.UUID) error {
	result, err := service.db.ExecContext(ctx, `DELETE FROM exchange_rates WHERE user_id=$1 AND id=$2`, userID, rateID)
	if err != nil {
		return fmt.Errorf("delete exchange rate: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return metadataError(MetadataNotFound, "Exchange rate not found.")
	}
	return nil
}

func validateSettings(input *SettingsInput) error {
	input.DisplayName, input.AppName = strings.TrimSpace(input.DisplayName), strings.TrimSpace(input.AppName)
	input.BaseCurrency = strings.ToUpper(strings.TrimSpace(input.BaseCurrency))
	input.Timezone = strings.TrimSpace(input.Timezone)
	if input.DisplayName == "" || len(input.DisplayName) > 80 || input.AppName == "" || len(input.AppName) > 80 {
		return metadataError(MetadataValidation, "Display name and app name must contain between 1 and 80 characters.")
	}
	if !validCurrency(input.BaseCurrency) {
		return metadataError(MetadataValidation, "Choose a valid base currency.")
	}
	seen := map[string]bool{}
	for index, currency := range input.SupportedCurrencies {
		currency = strings.ToUpper(strings.TrimSpace(currency))
		if !validCurrency(currency) {
			return metadataError(MetadataValidation, "Choose valid supported currencies.")
		}
		seen[currency] = true
		input.SupportedCurrencies[index] = currency
	}
	input.SupportedCurrencies = input.SupportedCurrencies[:0]
	for currency := range seen {
		input.SupportedCurrencies = append(input.SupportedCurrencies, currency)
	}
	if _, err := time.LoadLocation(input.Timezone); err != nil {
		return metadataError(MetadataValidation, "Choose a valid timezone.")
	}
	if !oneOf(input.PreferredDateFormat, "dd MMM yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd") ||
		!oneOf(input.DefaultDashboardPeriod, "1m", "3m", "6m", "1y", "all") {
		return metadataError(MetadataValidation, "Choose valid date and dashboard display settings.")
	}
	if input.SessionTimeoutMinutes < 15 || input.SessionTimeoutMinutes > 525600 || input.DefaultGoalReturnBPS < 0 || input.DefaultGoalReturnBPS > 10000 ||
		input.PositionStaleDaysStock < 1 || input.PositionStaleDaysETF < 1 || input.PositionStaleDaysFund < 1 {
		return metadataError(MetadataValidation, "Numeric settings are outside the supported range.")
	}
	return nil
}

func validateCategoryInput(input *CategoryInput) error {
	input.Name, input.Icon, input.Description = strings.TrimSpace(input.Name), strings.TrimSpace(input.Icon), strings.TrimSpace(input.Description)
	if input.Name == "" || len(input.Name) > 100 || input.Icon == "" || len(input.Icon) > 100 || len(input.Description) > 2000 {
		return metadataError(MetadataValidation, "Provide valid category details.")
	}
	if !oneOf(input.AssetOrLiability, "asset", "liability") {
		return metadataError(MetadataValidation, "Category type must be asset or liability.")
	}
	return nil
}

func validateInstitutionInput(input *InstitutionInput) error {
	input.Name = canonicalizeInstitutionName(input.Name)
	input.WebsiteURL, input.CountryCode = strings.TrimSpace(input.WebsiteURL), strings.ToUpper(strings.TrimSpace(input.CountryCode))
	input.Address, input.Notes = strings.TrimSpace(input.Address), strings.TrimSpace(input.Notes)
	if input.Name == "" || len(input.Name) > 100 || len(input.WebsiteURL) > 500 || len(input.Address) > 500 || len(input.Notes) > 2000 {
		return metadataError(MetadataValidation, "Provide valid institution details.")
	}
	if !oneOf(input.Type, "bank", "credit_union", "brokerage", "asset_manager", "pension_provider", "insurer", "lender", "digital_wallet", "government", "employer", "other") {
		return metadataError(MetadataValidation, "Choose a valid institution type.")
	}
	if input.CountryCode != "" && (len(input.CountryCode) != 2 || input.CountryCode[0] < 'A' || input.CountryCode[0] > 'Z' || input.CountryCode[1] < 'A' || input.CountryCode[1] > 'Z') {
		return metadataError(MetadataValidation, "Use a two-letter country code.")
	}
	if input.WebsiteURL != "" {
		parsed, err := url.ParseRequestURI(input.WebsiteURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return metadataError(MetadataValidation, "Enter a valid HTTP or HTTPS website.")
		}
	}
	return nil
}

func validateExchangeRate(input *ExchangeRateInput) (time.Time, error) {
	input.BaseCurrency, input.QuoteCurrency = strings.ToUpper(strings.TrimSpace(input.BaseCurrency)), strings.ToUpper(strings.TrimSpace(input.QuoteCurrency))
	input.Rate, input.EffectiveDate = strings.TrimSpace(input.Rate), strings.TrimSpace(input.EffectiveDate)
	if !validCurrency(input.BaseCurrency) || !validCurrency(input.QuoteCurrency) {
		return time.Time{}, metadataError(MetadataValidation, "Choose valid currencies.")
	}
	if input.BaseCurrency == input.QuoteCurrency {
		return time.Time{}, metadataError(MetadataValidation, "Choose two different currencies.")
	}
	if len(input.Rate) > 80 || !metadataDecimalPattern.MatchString(input.Rate) {
		return time.Time{}, metadataError(MetadataValidation, "Enter a positive decimal exchange rate.")
	}
	effectiveDate, err := time.Parse("2006-01-02", input.EffectiveDate)
	if err != nil || effectiveDate.Format("2006-01-02") != input.EffectiveDate {
		return time.Time{}, metadataError(MetadataValidation, "Enter a valid effective date.")
	}
	return effectiveDate, nil
}

func referencedCurrencies(ctx context.Context, tx *sql.Tx, userID uuid.UUID) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT currency FROM (
 SELECT currency FROM accounts WHERE user_id=$1
 UNION ALL SELECT currency FROM transactions WHERE user_id=$1
 UNION ALL SELECT currency FROM valuation_snapshots WHERE user_id=$1
 UNION ALL SELECT currency FROM goals WHERE user_id=$1
 UNION ALL SELECT base_currency FROM exchange_rates WHERE user_id=$1
 UNION ALL SELECT quote_currency FROM exchange_rates WHERE user_id=$1
 UNION ALL SELECT quote_currency FROM investment_instruments WHERE user_id=$1
 UNION ALL SELECT trade_currency FROM position_events WHERE user_id=$1
 UNION ALL SELECT fee_currency FROM position_events WHERE user_id=$1 AND fee_currency IS NOT NULL
 UNION ALL SELECT currency FROM security_prices WHERE user_id=$1
) currencies`, userID)
	if err != nil {
		return nil, fmt.Errorf("list referenced currencies: %w", err)
	}
	defer rows.Close()
	result := map[string]bool{}
	for rows.Next() {
		var currency string
		if err := rows.Scan(&currency); err != nil {
			return nil, fmt.Errorf("scan referenced currency: %w", err)
		}
		result[currency] = true
	}
	return result, rows.Err()
}

type queryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func requireMutableCategory(ctx context.Context, query queryRower, userID, categoryID uuid.UUID) error {
	var system bool
	err := query.QueryRowContext(ctx, `SELECT is_system FROM categories WHERE user_id=$1 AND id=$2`, userID, categoryID).Scan(&system)
	if errors.Is(err, sql.ErrNoRows) {
		return metadataError(MetadataNotFound, "Category not found.")
	}
	if err != nil {
		return fmt.Errorf("load category: %w", err)
	}
	if system {
		return metadataError(MetadataConflict, "System categories cannot be modified.")
	}
	return nil
}

func categoryMutationMiss(ctx context.Context, query queryRower, userID, categoryID uuid.UUID) error {
	return requireMutableCategory(ctx, query, userID, categoryID)
}

func classifyConstraint(err error, duplicateDetail string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return metadataError(MetadataConflict, duplicateDetail)
	}
	return err
}

func validCurrency(value string) bool { return metadataCurrencyPattern.MatchString(value) }

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func canonicalizeInstitutionName(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func normalizeInstitutionName(value string) string {
	return strings.ToLower(canonicalizeInstitutionName(value))
}

func slugifyCategory(value string) string {
	decomposed := norm.NFKD.String(strings.ToLower(value))
	var plain strings.Builder
	for _, character := range decomposed {
		if !unicode.Is(unicode.Mn, character) {
			plain.WriteRune(character)
		}
	}
	slug := strings.Trim(slugSeparator.ReplaceAllString(plain.String(), "-"), "-")
	if slug == "" {
		return "category-" + uuid.NewString()[:8]
	}
	return slug
}
