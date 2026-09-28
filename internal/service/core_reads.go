package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

const (
	DefaultReadLimit = 50
	MaxReadLimit     = 100
	MaxReadOffset    = 10_000
)

var ErrCoreReadNotFound = errors.New("core read resource not found")

type ReadPage struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

func (page ReadPage) normalized() (ReadPage, error) {
	if page.Limit == 0 {
		page.Limit = DefaultReadLimit
	}
	if page.Limit < 1 || page.Limit > MaxReadLimit || page.Offset < 0 || page.Offset > MaxReadOffset {
		return ReadPage{}, errors.New("pagination is outside the supported range")
	}
	return page, nil
}

type ActivityFilter struct {
	Page      ReadPage
	AccountID *uuid.UUID
	Type      string
	From      *time.Time
	To        *time.Time
}

type SettingsRow struct {
	DisplayName, BaseCurrency, SupportedCurrenciesJSON, Timezone string
	PreferredDateFormat, AppName, DefaultDashboardPeriod         string
	SessionTimeoutMinutes, DefaultGoalReturnBPS                  int
	PositionStaleDaysStock, PositionStaleDaysETF                 int
	PositionStaleDaysFund                                        int
}

type CategoryRow struct {
	ID                     uuid.UUID
	Name, Slug, Icon       string
	DisplayOrder           int
	AssetOrLiability       string
	Description            sql.NullString
	IsLiquid, IsInvestible bool
	IsArchived, IsSystem   bool
}

type InstitutionRow struct {
	ID                                      uuid.UUID
	Name, Type                              string
	WebsiteURL, CountryCode, Address, Notes sql.NullString
	ArchivedAt                              sql.NullTime
}

type AccountRow struct {
	ID, CategoryID                                        uuid.UUID
	InstitutionID                                         uuid.NullUUID
	Name, Currency, TrackingMode, CategoryName            string
	Description, InstitutionName, AccountReference, Notes sql.NullString
	CurrentValueMinor                                     int64
	CostBasisMinor                                        sql.NullInt64
	IsLiability, IsIncludedInNetWorth                     bool
	OpenedAt, ArchivedAt                                  sql.NullTime
}

type TransactionRow struct {
	ID, AccountID                  uuid.UUID
	AccountName, Type, Currency    string
	AmountMinor                    int64
	TransactionDate                time.Time
	Description, Notes, ExternalID sql.NullString
	TransferGroupID, EventGroupID  uuid.NullUUID
}

type ValuationRow struct {
	ID, AccountID         uuid.UUID
	AccountName, Currency string
	ValueMinor            int64
	ValuationDate         time.Time
	Notes                 sql.NullString
}

type ActivityRow struct {
	Kind, AccountName, Type, Currency              string
	ID, AccountID                                  uuid.UUID
	AmountMinor                                    int64
	ActivityDate                                   time.Time
	Description, Notes                             sql.NullString
	InstrumentID, InstrumentName, InstrumentSymbol string
	Quantity, UnitPrice, EventGroupID              string
}

type CoreReadRepository interface {
	GetSettings(context.Context, uuid.UUID) (SettingsRow, error)
	ListCategories(context.Context, uuid.UUID) ([]CategoryRow, error)
	ListInstitutions(context.Context, uuid.UUID) ([]InstitutionRow, error)
	ListAccounts(context.Context, uuid.UUID, string) ([]AccountRow, error)
	GetAccount(context.Context, uuid.UUID, uuid.UUID) (AccountRow, error)
	ListTransactions(context.Context, uuid.UUID, ActivityFilter) ([]TransactionRow, error)
	ListValuations(context.Context, uuid.UUID, ActivityFilter) ([]ValuationRow, error)
	ListActivity(context.Context, uuid.UUID, ActivityFilter) ([]ActivityRow, error)
}

type CoreReadService struct {
	repository CoreReadRepository
	now        func() time.Time
}

func NewCoreReadService(repository CoreReadRepository) *CoreReadService {
	return &CoreReadService{repository: repository, now: time.Now}
}

type Settings struct {
	DisplayName            string   `json:"displayName"`
	BaseCurrency           string   `json:"baseCurrency"`
	SupportedCurrencies    []string `json:"supportedCurrencies"`
	Timezone               string   `json:"timezone"`
	PreferredDateFormat    string   `json:"preferredDateFormat"`
	AppName                string   `json:"appName"`
	DefaultDashboardPeriod string   `json:"defaultDashboardPeriod"`
	SessionTimeoutMinutes  int      `json:"sessionTimeoutMinutes"`
	DefaultGoalReturnBPS   int      `json:"defaultGoalReturnBps"`
	PositionStaleDaysStock int      `json:"positionStaleDaysStock"`
	PositionStaleDaysETF   int      `json:"positionStaleDaysEtf"`
	PositionStaleDaysFund  int      `json:"positionStaleDaysFund"`
}

type Category struct {
	ID               uuid.UUID `json:"id"`
	Name             string    `json:"name"`
	Slug             string    `json:"slug"`
	Icon             string    `json:"icon"`
	DisplayOrder     int       `json:"displayOrder"`
	AssetOrLiability string    `json:"assetOrLiability"`
	Description      string    `json:"description,omitempty"`
	IsLiquid         bool      `json:"isLiquid"`
	IsInvestible     bool      `json:"isInvestible"`
	IsArchived       bool      `json:"isArchived"`
	IsSystem         bool      `json:"isSystem"`
}

type Institution struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	WebsiteURL  string    `json:"websiteUrl,omitempty"`
	CountryCode string    `json:"countryCode,omitempty"`
	Address     string    `json:"address,omitempty"`
	Notes       string    `json:"notes,omitempty"`
	ArchivedAt  string    `json:"archivedAt,omitempty"`
}

type Account struct {
	ID                   uuid.UUID  `json:"id"`
	CategoryID           uuid.UUID  `json:"categoryId"`
	InstitutionID        *uuid.UUID `json:"institutionId,omitempty"`
	Name                 string     `json:"name"`
	Description          string     `json:"description,omitempty"`
	Currency             string     `json:"currency"`
	TrackingMode         string     `json:"trackingMode"`
	CurrentValueMinor    string     `json:"currentValueMinor"`
	ConvertedValueMinor  *string    `json:"convertedValueMinor"`
	MonthlyChangeMinor   *string    `json:"monthlyChangeMinor"`
	CostBasisMinor       *string    `json:"costBasisMinor,omitempty"`
	IsLiability          bool       `json:"isLiability"`
	IsIncludedInNetWorth bool       `json:"isIncludedInNetWorth"`
	CategoryName         string     `json:"categoryName"`
	InstitutionName      string     `json:"institutionName,omitempty"`
	AccountReference     string     `json:"accountReference,omitempty"`
	Notes                string     `json:"notes,omitempty"`
	OpenedAt             string     `json:"openedAt,omitempty"`
	ArchivedAt           string     `json:"archivedAt,omitempty"`
}

type Transaction struct {
	ID              uuid.UUID  `json:"id"`
	AccountID       uuid.UUID  `json:"accountId"`
	AccountName     string     `json:"accountName"`
	Type            string     `json:"type"`
	AmountMinor     string     `json:"amountMinor"`
	Currency        string     `json:"currency"`
	TransactionDate string     `json:"transactionDate"`
	Description     string     `json:"description,omitempty"`
	Notes           string     `json:"notes,omitempty"`
	ExternalID      string     `json:"externalId,omitempty"`
	TransferGroupID *uuid.UUID `json:"transferGroupId,omitempty"`
	EventGroupID    *uuid.UUID `json:"eventGroupId,omitempty"`
}

type Valuation struct {
	ID            uuid.UUID `json:"id"`
	AccountID     uuid.UUID `json:"accountId"`
	AccountName   string    `json:"accountName"`
	ValueMinor    string    `json:"valueMinor"`
	Currency      string    `json:"currency"`
	ValuationDate string    `json:"valuationDate"`
	Notes         string    `json:"notes,omitempty"`
}

type ActivityItem struct {
	Kind             string    `json:"kind"`
	ID               uuid.UUID `json:"id"`
	AccountID        uuid.UUID `json:"accountId"`
	AccountName      string    `json:"accountName"`
	Type             string    `json:"type"`
	AmountMinor      string    `json:"amountMinor"`
	Currency         string    `json:"currency"`
	Date             string    `json:"date"`
	Description      string    `json:"description,omitempty"`
	Notes            string    `json:"notes,omitempty"`
	InstrumentID     string    `json:"instrumentId,omitempty"`
	InstrumentName   string    `json:"instrumentName,omitempty"`
	InstrumentSymbol string    `json:"instrumentSymbol,omitempty"`
	Quantity         string    `json:"quantity,omitempty"`
	UnitPrice        string    `json:"unitPrice,omitempty"`
	EventGroupID     string    `json:"eventGroupId,omitempty"`
}

type Page[T any] struct {
	Items   []T  `json:"items"`
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"hasMore"`
}

func (service *CoreReadService) Settings(ctx context.Context, userID uuid.UUID) (Settings, error) {
	row, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return Settings{}, mapReadError("load settings", err)
	}
	var currencies []string
	if err := json.Unmarshal([]byte(row.SupportedCurrenciesJSON), &currencies); err != nil {
		return Settings{}, fmt.Errorf("decode supported currencies: %w", err)
	}
	return Settings{DisplayName: row.DisplayName, BaseCurrency: row.BaseCurrency,
		SupportedCurrencies: currencies, Timezone: row.Timezone, PreferredDateFormat: row.PreferredDateFormat,
		AppName: row.AppName, DefaultDashboardPeriod: row.DefaultDashboardPeriod,
		SessionTimeoutMinutes: row.SessionTimeoutMinutes, DefaultGoalReturnBPS: row.DefaultGoalReturnBPS,
		PositionStaleDaysStock: row.PositionStaleDaysStock, PositionStaleDaysETF: row.PositionStaleDaysETF,
		PositionStaleDaysFund: row.PositionStaleDaysFund}, nil
}

func (service *CoreReadService) Categories(ctx context.Context, userID uuid.UUID) ([]Category, error) {
	rows, err := service.repository.ListCategories(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	items := make([]Category, 0, len(rows))
	for _, row := range rows {
		items = append(items, Category{ID: row.ID, Name: row.Name, Slug: row.Slug, Icon: row.Icon,
			DisplayOrder: row.DisplayOrder, AssetOrLiability: row.AssetOrLiability, Description: row.Description.String,
			IsLiquid: row.IsLiquid, IsInvestible: row.IsInvestible, IsArchived: row.IsArchived, IsSystem: row.IsSystem})
	}
	return items, nil
}

func (service *CoreReadService) Institutions(ctx context.Context, userID uuid.UUID) ([]Institution, error) {
	rows, err := service.repository.ListInstitutions(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list institutions: %w", err)
	}
	items := make([]Institution, 0, len(rows))
	for _, row := range rows {
		items = append(items, Institution{ID: row.ID, Name: row.Name, Type: row.Type, WebsiteURL: row.WebsiteURL.String,
			CountryCode: row.CountryCode.String, Address: row.Address.String, Notes: row.Notes.String,
			ArchivedAt: formatCoreOptionalTime(row.ArchivedAt)})
	}
	return items, nil
}

func (service *CoreReadService) Accounts(ctx context.Context, userID uuid.UUID, archived string) ([]Account, error) {
	if archived == "" {
		archived = "active"
	}
	if archived != "active" && archived != "archived" && archived != "all" {
		return nil, errors.New("archived must be active, archived, or all")
	}
	rows, err := service.repository.ListAccounts(ctx, userID, archived)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	items := make([]Account, 0, len(rows))
	for _, row := range rows {
		items = append(items, accountFromRow(row))
	}
	if err := service.addAccountAnalytics(ctx, userID, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (service *CoreReadService) addAccountAnalytics(ctx context.Context, userID uuid.UUID, items []Account) error {
	chartRepository, ok := service.repository.(chartAnalyticsRepository)
	if !ok {
		return nil
	}
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return fmt.Errorf("load account analytics settings: %w", err)
	}
	data, err := chartRepository.LoadChartData(ctx, userID)
	if err != nil {
		return fmt.Errorf("load account analytics: %w", err)
	}
	chartAccounts := make(map[uuid.UUID]chartAccount, len(data.Accounts))
	for _, account := range data.Accounts {
		chartAccounts[account.ID] = account
	}
	for index := range items {
		account, found := chartAccounts[items[index].ID]
		if !found {
			continue
		}
		converted, change, valueErr := chartAccountListValues(data, account, settings.BaseCurrency, service.now())
		if valueErr != nil {
			return valueErr
		}
		items[index].ConvertedValueMinor = converted
		items[index].MonthlyChangeMinor = change
	}
	return nil
}

func (service *CoreReadService) Account(ctx context.Context, userID, accountID uuid.UUID) (Account, error) {
	row, err := service.repository.GetAccount(ctx, userID, accountID)
	if err != nil {
		return Account{}, mapReadError("load account", err)
	}
	items := []Account{accountFromRow(row)}
	if err := service.addAccountAnalytics(ctx, userID, items); err != nil {
		return Account{}, err
	}
	return items[0], nil
}

func (service *CoreReadService) requireAccount(ctx context.Context, userID, accountID uuid.UUID) error {
	_, err := service.repository.GetAccount(ctx, userID, accountID)
	if err != nil {
		return mapReadError("load account", err)
	}
	return nil
}

func (service *CoreReadService) Transactions(ctx context.Context, userID uuid.UUID, filter ActivityFilter) (Page[Transaction], error) {
	filter, err := normalizeFilter(filter)
	if err != nil {
		return Page[Transaction]{}, err
	}
	if filter.AccountID != nil {
		if err := service.requireAccount(ctx, userID, *filter.AccountID); err != nil {
			return Page[Transaction]{}, err
		}
	}
	rows, err := service.repository.ListTransactions(ctx, userID, filter)
	if err != nil {
		return Page[Transaction]{}, fmt.Errorf("list transactions: %w", err)
	}
	hasMore := len(rows) > filter.Page.Limit
	if hasMore {
		rows = rows[:filter.Page.Limit]
	}
	items := make([]Transaction, 0, len(rows))
	for _, row := range rows {
		items = append(items, Transaction{ID: row.ID, AccountID: row.AccountID, AccountName: row.AccountName,
			Type: row.Type, AmountMinor: strconv.FormatInt(row.AmountMinor, 10), Currency: row.Currency,
			TransactionDate: row.TransactionDate.Format(time.DateOnly), Description: row.Description.String,
			Notes: row.Notes.String, ExternalID: row.ExternalID.String,
			TransferGroupID: uuidPointer(row.TransferGroupID), EventGroupID: uuidPointer(row.EventGroupID)})
	}
	return Page[Transaction]{Items: items, Limit: filter.Page.Limit, Offset: filter.Page.Offset, HasMore: hasMore}, nil
}

func (service *CoreReadService) Valuations(ctx context.Context, userID uuid.UUID, filter ActivityFilter) (Page[Valuation], error) {
	filter, err := normalizeFilter(filter)
	if err != nil {
		return Page[Valuation]{}, err
	}
	if filter.AccountID == nil {
		return Page[Valuation]{}, errors.New("account is required for valuations")
	}
	if err := service.requireAccount(ctx, userID, *filter.AccountID); err != nil {
		return Page[Valuation]{}, err
	}
	rows, err := service.repository.ListValuations(ctx, userID, filter)
	if err != nil {
		return Page[Valuation]{}, fmt.Errorf("list valuations: %w", err)
	}
	hasMore := len(rows) > filter.Page.Limit
	if hasMore {
		rows = rows[:filter.Page.Limit]
	}
	items := make([]Valuation, 0, len(rows))
	for _, row := range rows {
		items = append(items, Valuation{ID: row.ID, AccountID: row.AccountID, AccountName: row.AccountName,
			ValueMinor: strconv.FormatInt(row.ValueMinor, 10), Currency: row.Currency,
			ValuationDate: row.ValuationDate.Format(time.DateOnly), Notes: row.Notes.String})
	}
	return Page[Valuation]{Items: items, Limit: filter.Page.Limit, Offset: filter.Page.Offset, HasMore: hasMore}, nil
}

func (service *CoreReadService) Activity(ctx context.Context, userID uuid.UUID, filter ActivityFilter) (Page[ActivityItem], error) {
	filter, err := normalizeFilter(filter)
	if err != nil {
		return Page[ActivityItem]{}, err
	}
	if filter.AccountID == nil {
		return Page[ActivityItem]{}, errors.New("account is required for activity")
	}
	if err := service.requireAccount(ctx, userID, *filter.AccountID); err != nil {
		return Page[ActivityItem]{}, err
	}
	rows, err := service.repository.ListActivity(ctx, userID, filter)
	if err != nil {
		return Page[ActivityItem]{}, fmt.Errorf("list activity: %w", err)
	}
	hasMore := len(rows) > filter.Page.Limit
	if hasMore {
		rows = rows[:filter.Page.Limit]
	}
	items := make([]ActivityItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, ActivityItem{Kind: row.Kind, ID: row.ID, AccountID: row.AccountID,
			AccountName: row.AccountName, Type: row.Type, AmountMinor: strconv.FormatInt(row.AmountMinor, 10),
			Currency: row.Currency, Date: row.ActivityDate.Format(time.DateOnly),
			Description: row.Description.String, Notes: row.Notes.String,
			InstrumentID: row.InstrumentID, InstrumentName: row.InstrumentName, InstrumentSymbol: row.InstrumentSymbol,
			Quantity: row.Quantity, UnitPrice: row.UnitPrice, EventGroupID: row.EventGroupID})
	}
	return Page[ActivityItem]{Items: items, Limit: filter.Page.Limit, Offset: filter.Page.Offset, HasMore: hasMore}, nil
}

func normalizeFilter(filter ActivityFilter) (ActivityFilter, error) {
	page, err := filter.Page.normalized()
	if err != nil {
		return ActivityFilter{}, err
	}
	filter.Page = page
	if filter.From != nil && filter.To != nil && filter.From.After(*filter.To) {
		return ActivityFilter{}, errors.New("from must not be after to")
	}
	return filter, nil
}

func accountFromRow(row AccountRow) Account {
	account := Account{ID: row.ID, CategoryID: row.CategoryID, Name: row.Name, Description: row.Description.String,
		Currency: row.Currency, TrackingMode: row.TrackingMode, CurrentValueMinor: strconv.FormatInt(row.CurrentValueMinor, 10),
		IsLiability: row.IsLiability, IsIncludedInNetWorth: row.IsIncludedInNetWorth, CategoryName: row.CategoryName,
		InstitutionName: row.InstitutionName.String, AccountReference: row.AccountReference.String, Notes: row.Notes.String,
		OpenedAt: formatCoreOptionalDate(row.OpenedAt), ArchivedAt: formatCoreOptionalTime(row.ArchivedAt)}
	if row.InstitutionID.Valid {
		value := row.InstitutionID.UUID
		account.InstitutionID = &value
	}
	if row.CostBasisMinor.Valid {
		value := strconv.FormatInt(row.CostBasisMinor.Int64, 10)
		account.CostBasisMinor = &value
	}
	return account
}

func mapReadError(operation string, err error) error {
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, ErrCoreReadNotFound) {
		return ErrCoreReadNotFound
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func formatCoreOptionalDate(value sql.NullTime) string {
	if !value.Valid {
		return ""
	}
	return value.Time.Format(time.DateOnly)
}

func formatCoreOptionalTime(value sql.NullTime) string {
	if !value.Valid {
		return ""
	}
	return value.Time.UTC().Format(time.RFC3339)
}

func uuidPointer(value uuid.NullUUID) *uuid.UUID {
	if !value.Valid {
		return nil
	}
	result := value.UUID
	return &result
}

type coreReadDB = generated.DBTX

type SQLCoreReadRepository struct{ db coreReadDB }

func NewSQLCoreReadRepository(db *sql.DB) *SQLCoreReadRepository {
	return &SQLCoreReadRepository{db: db}
}

func (repository *SQLCoreReadRepository) LoadChartData(ctx context.Context, userID uuid.UUID) (chartData, error) {
	return (&SQLGoalsReportsRepository{db: repository.db}).LoadChartData(ctx, userID)
}

func (repository *SQLCoreReadRepository) GetSettings(ctx context.Context, userID uuid.UUID) (SettingsRow, error) {
	var row SettingsRow
	err := repository.db.QueryRowContext(ctx, coreSettingsSQL, userID).Scan(&row.DisplayName, &row.BaseCurrency,
		&row.SupportedCurrenciesJSON, &row.Timezone, &row.PreferredDateFormat, &row.AppName,
		&row.DefaultDashboardPeriod, &row.SessionTimeoutMinutes, &row.DefaultGoalReturnBPS,
		&row.PositionStaleDaysStock, &row.PositionStaleDaysETF, &row.PositionStaleDaysFund)
	return row, err
}

func (repository *SQLCoreReadRepository) ListCategories(ctx context.Context, userID uuid.UUID) ([]CategoryRow, error) {
	rows, err := repository.db.QueryContext(ctx, coreCategoriesSQL, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []CategoryRow{}
	for rows.Next() {
		var row CategoryRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Slug, &row.Icon, &row.DisplayOrder, &row.AssetOrLiability, &row.Description, &row.IsLiquid, &row.IsInvestible, &row.IsArchived, &row.IsSystem); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (repository *SQLCoreReadRepository) ListInstitutions(ctx context.Context, userID uuid.UUID) ([]InstitutionRow, error) {
	rows, err := repository.db.QueryContext(ctx, coreInstitutionsSQL, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []InstitutionRow{}
	for rows.Next() {
		var row InstitutionRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Type, &row.WebsiteURL, &row.CountryCode, &row.Address, &row.Notes, &row.ArchivedAt); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (repository *SQLCoreReadRepository) ListAccounts(ctx context.Context, userID uuid.UUID, archived string) ([]AccountRow, error) {
	rows, err := repository.db.QueryContext(ctx, coreAccountsSQL, userID, archived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []AccountRow{}
	for rows.Next() {
		row, err := scanAccount(rows.Scan)
		if err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (repository *SQLCoreReadRepository) GetAccount(ctx context.Context, userID, accountID uuid.UUID) (AccountRow, error) {
	return scanAccount(repository.db.QueryRowContext(ctx, coreAccountSQL, userID, accountID).Scan)
}

type coreReadScanner func(...any) error

func scanAccount(scan coreReadScanner) (AccountRow, error) {
	var row AccountRow
	err := scan(&row.ID, &row.CategoryID, &row.InstitutionID, &row.Name, &row.Description, &row.AccountReference,
		&row.Currency, &row.TrackingMode, &row.CurrentValueMinor, &row.CostBasisMinor, &row.IsLiability,
		&row.IsIncludedInNetWorth, &row.Notes, &row.OpenedAt, &row.ArchivedAt, &row.CategoryName, &row.InstitutionName)
	return row, err
}

func (repository *SQLCoreReadRepository) ListTransactions(ctx context.Context, userID uuid.UUID, filter ActivityFilter) ([]TransactionRow, error) {
	rows, err := repository.db.QueryContext(ctx, coreTransactionsSQL, userID, nullableUUID(filter.AccountID), nullableString(filter.Type), filter.From, filter.To, filter.Page.Limit+1, filter.Page.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []TransactionRow{}
	for rows.Next() {
		var row TransactionRow
		if err := rows.Scan(&row.ID, &row.AccountID, &row.AccountName, &row.Type, &row.AmountMinor, &row.Currency, &row.TransactionDate, &row.Description, &row.Notes, &row.ExternalID, &row.TransferGroupID, &row.EventGroupID); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (repository *SQLCoreReadRepository) ListValuations(ctx context.Context, userID uuid.UUID, filter ActivityFilter) ([]ValuationRow, error) {
	rows, err := repository.db.QueryContext(ctx, coreValuationsSQL, userID, nullableUUID(filter.AccountID), filter.From, filter.To, filter.Page.Limit+1, filter.Page.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ValuationRow{}
	for rows.Next() {
		var row ValuationRow
		if err := rows.Scan(&row.ID, &row.AccountID, &row.AccountName, &row.ValueMinor, &row.Currency, &row.ValuationDate, &row.Notes); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (repository *SQLCoreReadRepository) ListActivity(ctx context.Context, userID uuid.UUID, filter ActivityFilter) ([]ActivityRow, error) {
	if filter.AccountID == nil {
		return nil, errors.New("account is required for activity")
	}
	params := generated.ListCoreAccountActivityParams{
		UserID: userID, AccountID: *filter.AccountID,
		PageLimit: int32(filter.Page.Limit + 1), PageOffset: int32(filter.Page.Offset),
	}
	if filter.From != nil {
		params.FromDate = sql.NullTime{Time: *filter.From, Valid: true}
	}
	if filter.To != nil {
		params.ToDate = sql.NullTime{Time: *filter.To, Valid: true}
	}
	rows, err := generated.New(repository.db).ListCoreAccountActivity(ctx, params)
	if err != nil {
		return nil, err
	}
	result := make([]ActivityRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, ActivityRow{
			Kind: row.Kind, ID: row.ID, AccountID: row.AccountID, AccountName: row.AccountName,
			Type: row.Type, AmountMinor: row.AmountMinor, Currency: row.Currency, ActivityDate: row.ActivityDate,
			Description: row.Description, Notes: row.Notes,
			InstrumentID: row.InstrumentID, InstrumentName: row.InstrumentName, InstrumentSymbol: row.InstrumentSymbol,
			Quantity: row.Quantity, UnitPrice: row.UnitPrice, EventGroupID: row.EventGroupID,
		})
	}
	return result, nil
}

func nullableUUID(value *uuid.UUID) any {
	if value == nil {
		return nil
	}
	return *value
}
func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

const coreSettingsSQL = `SELECT display_name, base_currency, supported_currencies, timezone, preferred_date_format, app_name, default_dashboard_period, session_timeout_minutes, default_goal_return_bps, position_stale_days_stock, position_stale_days_etf, position_stale_days_fund FROM user_settings WHERE user_id = $1`
const coreCategoriesSQL = `SELECT id, name, slug, icon, display_order, asset_or_liability, description, is_liquid, is_investible, is_archived, is_system FROM categories WHERE user_id = $1 ORDER BY display_order, name, id`
const coreInstitutionsSQL = `SELECT id, name, type, website_url, country_code, address, notes, archived_at FROM institutions WHERE user_id = $1 ORDER BY name, id`
const coreAccountColumns = `accounts.id, accounts.category_id, accounts.institution_id, accounts.name, accounts.description, accounts.account_reference, accounts.currency, accounts.tracking_mode, accounts.current_value_minor, accounts.cost_basis_minor, accounts.is_liability, accounts.is_included_in_net_worth, accounts.notes, accounts.opened_at, accounts.archived_at, categories.name, institutions.name`
const coreAccountJoins = ` FROM accounts JOIN categories ON categories.user_id = accounts.user_id AND categories.id = accounts.category_id LEFT JOIN institutions ON institutions.user_id = accounts.user_id AND institutions.id = accounts.institution_id`
const coreAccountsSQL = `SELECT ` + coreAccountColumns + coreAccountJoins + ` WHERE accounts.user_id = $1 AND ($2 = 'all' OR ($2 = 'active' AND accounts.archived_at IS NULL) OR ($2 = 'archived' AND accounts.archived_at IS NOT NULL)) ORDER BY accounts.name, accounts.id`
const coreAccountSQL = `SELECT ` + coreAccountColumns + coreAccountJoins + ` WHERE accounts.user_id = $1 AND accounts.id = $2`
const coreTransactionsSQL = `SELECT transactions.id, transactions.account_id, accounts.name, transactions.type, transactions.amount_minor, transactions.currency, transactions.transaction_date, transactions.description, transactions.notes, transactions.external_id, transactions.transfer_group_id, transactions.event_group_id FROM transactions JOIN accounts ON accounts.user_id = transactions.user_id AND accounts.id = transactions.account_id WHERE transactions.user_id = $1 AND ($2::uuid IS NULL OR transactions.account_id = $2) AND ($3::text IS NULL OR transactions.type = $3) AND ($4::date IS NULL OR transactions.transaction_date >= $4) AND ($5::date IS NULL OR transactions.transaction_date <= $5) ORDER BY transactions.transaction_date DESC, transactions.created_at DESC, transactions.id DESC LIMIT $6 OFFSET $7`
const coreValuationsSQL = `SELECT valuation_snapshots.id, valuation_snapshots.account_id, accounts.name, valuation_snapshots.value_minor, valuation_snapshots.currency, valuation_snapshots.valuation_date, valuation_snapshots.notes FROM valuation_snapshots JOIN accounts ON accounts.user_id = valuation_snapshots.user_id AND accounts.id = valuation_snapshots.account_id WHERE valuation_snapshots.user_id = $1 AND valuation_snapshots.account_id = $2 AND ($3::date IS NULL OR valuation_snapshots.valuation_date >= $3) AND ($4::date IS NULL OR valuation_snapshots.valuation_date <= $4) ORDER BY valuation_snapshots.valuation_date DESC, valuation_snapshots.created_at DESC, valuation_snapshots.id DESC LIMIT $5 OFFSET $6`
