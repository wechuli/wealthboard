package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
)

var ErrGoalsReportsNotFound = errors.New("goals and reports resource not found")

type GoalsReportsDB interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type GoalsReportsRepository interface {
	GetSettings(context.Context, uuid.UUID) (GoalsReportsSettings, error)
	ListGoals(context.Context, uuid.UUID) ([]GoalRecord, error)
	GetGoal(context.Context, uuid.UUID, uuid.UUID) (GoalRecord, error)
	ListMilestones(context.Context, uuid.UUID, uuid.UUID) ([]MilestoneRecord, error)
	ListDismissedGoalIDs(context.Context, uuid.UUID, string) ([]uuid.UUID, error)
	ListAccounts(context.Context, uuid.UUID) ([]CurrentAccountRecord, error)
	CountGoals(context.Context, uuid.UUID) (int64, error)
}

type SQLGoalsReportsRepository struct {
	db GoalsReportsDB
}

type GoalsReportsSettings struct {
	BaseCurrency string
	Timezone     string
}

type GoalRecord struct {
	ID                       uuid.UUID
	Name                     string
	Description              *string
	TargetAmountMinor        int64
	StoredCurrentAmountMinor int64
	Currency                 string
	TargetDate               time.Time
	LinkedAccountID          *uuid.UUID
	Icon                     string
	Status                   string
	Priority                 int32
	AssumedAnnualReturnBPS   int32
	CreatedAt                time.Time
	LinkedAccountName        *string
	LinkedAccountCurrency    *string
	LinkedAccountValueMinor  *int64
	PlannedContributionMinor *int64
	Frequency                *string
	PlanStartDate            *time.Time
	PlanEndDate              *time.Time
}

type MilestoneRecord struct {
	ID                uuid.UUID
	GoalID            uuid.UUID
	Name              string
	TargetAmountMinor int64
	TargetDate        *time.Time
}

type CurrentAccountRecord struct {
	ID                   uuid.UUID
	Currency             string
	CurrentValueMinor    int64
	IsLiability          bool
	IsIncludedInNetWorth bool
	CategoryName         string
	IsLiquid             bool
	IsInvestible         bool
	InstitutionName      string
}

type GoalsReportsService struct {
	repository GoalsReportsRepository
	now        func() time.Time
}

type GoalRead struct {
	ID                     uuid.UUID          `json:"id"`
	Name                   string             `json:"name"`
	Description            *string            `json:"description"`
	TargetAmountMinor      string             `json:"targetAmountMinor"`
	CurrentAmountMinor     string             `json:"currentAmountMinor"`
	CurrentAmountCurrency  string             `json:"currentAmountCurrency"`
	Currency               string             `json:"currency"`
	TargetDate             string             `json:"targetDate"`
	LinkedAccount          *GoalLinkedAccount `json:"linkedAccount"`
	Icon                   string             `json:"icon"`
	Status                 string             `json:"status"`
	Priority               int32              `json:"priority"`
	AssumedAnnualReturnBPS int32              `json:"assumedAnnualReturnBps"`
	ProgressPercent        string             `json:"progressPercent"`
	ValueIncomplete        bool               `json:"valueIncomplete"`
	MissingCurrencies      []string           `json:"missingCurrencies"`
	Plan                   *GoalPlanRead      `json:"plan"`
	createdAt              time.Time
	timezone               string
}

type GoalLinkedAccount struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Currency string    `json:"currency"`
}

type GoalPlanRead struct {
	PlannedContributionMinor string  `json:"plannedContributionMinor"`
	Frequency                string  `json:"frequency"`
	StartDate                string  `json:"startDate"`
	EndDate                  *string `json:"endDate"`
}

type GoalMilestoneRead struct {
	ID                uuid.UUID `json:"id"`
	GoalID            uuid.UUID `json:"goalId"`
	Name              string    `json:"name"`
	TargetAmountMinor string    `json:"targetAmountMinor"`
	TargetDate        *string   `json:"targetDate"`
	Status            string    `json:"status"`
	ProgressPercent   string    `json:"progressPercent"`
	RemainingMinor    *string   `json:"remainingMinor"`
}

type GoalAlertRead struct {
	GoalID                 uuid.UUID `json:"goalId"`
	GoalName               string    `json:"goalName"`
	Currency               string    `json:"currency"`
	TargetAmountMinor      string    `json:"targetAmountMinor"`
	CurrentAmountMinor     string    `json:"currentAmountMinor"`
	ProgressPercent        string    `json:"progressPercent"`
	TargetDate             string    `json:"targetDate"`
	AlertKey               string    `json:"alertKey"`
	AssumedAnnualReturnBPS int32     `json:"assumedAnnualReturnBps"`
}

type CurrentTotals struct {
	Assets      string `json:"assets"`
	Liabilities string `json:"liabilities"`
	NetWorth    string `json:"netWorth"`
	Liquid      string `json:"liquid"`
	Investible  string `json:"investible"`
}

type DashboardRead struct {
	AsOf                string        `json:"asOf"`
	BaseCurrency        string        `json:"baseCurrency"`
	Totals              CurrentTotals `json:"totals"`
	AccountCount        int           `json:"accountCount"`
	GoalCount           int64         `json:"goalCount"`
	CurrentComplete     bool          `json:"currentComplete"`
	MissingCurrencies   []string      `json:"missingCurrencies"`
	HistoricalAvailable bool          `json:"historicalAvailable"`
	HistoricalComplete  bool          `json:"historicalComplete"`
	ValueBasis          string        `json:"valueBasis"`
}

type ReportSummaryRead struct {
	AsOf              string        `json:"asOf"`
	BaseCurrency      string        `json:"baseCurrency"`
	Totals            CurrentTotals `json:"totals"`
	AccountCount      int           `json:"accountCount"`
	GoalCount         int64         `json:"goalCount"`
	CurrentComplete   bool          `json:"currentComplete"`
	MissingCurrencies []string      `json:"missingCurrencies"`
	ValueBasis        string        `json:"valueBasis"`
}

type AllocationItemRead struct {
	Name         string `json:"name"`
	ValueMinor   string `json:"valueMinor"`
	SharePercent string `json:"sharePercent"`
}

type ReportAllocationRead struct {
	AsOf              string               `json:"asOf"`
	BaseCurrency      string               `json:"baseCurrency"`
	CurrentComplete   bool                 `json:"currentComplete"`
	MissingCurrencies []string             `json:"missingCurrencies"`
	ValueBasis        string               `json:"valueBasis"`
	Categories        []AllocationItemRead `json:"categories"`
	Institutions      []AllocationItemRead `json:"institutions"`
	Currencies        []AllocationItemRead `json:"currencies"`
}

type currentSnapshot struct {
	settings          GoalsReportsSettings
	totals            CurrentTotals
	accounts          []CurrentAccountRecord
	goalCount         int64
	currentComplete   bool
	missingCurrencies []string
	assetTotal        int64
}

func NewSQLGoalsReportsRepository(db GoalsReportsDB) *SQLGoalsReportsRepository {
	return &SQLGoalsReportsRepository{db: db}
}

func NewGoalsReportsService(repository GoalsReportsRepository) *GoalsReportsService {
	return &GoalsReportsService{repository: repository, now: time.Now}
}

func (service *GoalsReportsService) ListGoals(ctx context.Context, userID uuid.UUID) ([]GoalRead, error) {
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("load goal settings: %w", err)
	}
	records, err := service.repository.ListGoals(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list goals: %w", err)
	}
	return service.mapGoals(records, settings), nil
}

func (service *GoalsReportsService) GetGoal(ctx context.Context, userID, goalID uuid.UUID) (GoalRead, error) {
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return GoalRead{}, fmt.Errorf("load goal settings: %w", err)
	}
	record, err := service.repository.GetGoal(ctx, userID, goalID)
	if errors.Is(err, sql.ErrNoRows) {
		return GoalRead{}, ErrGoalsReportsNotFound
	}
	if err != nil {
		return GoalRead{}, fmt.Errorf("get goal: %w", err)
	}
	return service.mapGoal(record, settings), nil
}

func (service *GoalsReportsService) ListMilestones(ctx context.Context, userID, goalID uuid.UUID) ([]GoalMilestoneRead, error) {
	goal, err := service.GetGoal(ctx, userID, goalID)
	if err != nil {
		return nil, err
	}
	records, err := service.repository.ListMilestones(ctx, userID, goalID)
	if err != nil {
		return nil, fmt.Errorf("list goal milestones: %w", err)
	}
	today := dateInTimezone(service.now(), goal.timezone).Format(time.DateOnly)
	current, _ := strconv.ParseInt(goal.CurrentAmountMinor, 10, 64)
	result := make([]GoalMilestoneRead, 0, len(records))
	for _, record := range records {
		status := "upcoming"
		remaining := record.TargetAmountMinor - current
		if goal.ValueIncomplete {
			status = "rate_needed"
			remaining = 0
		} else if current >= record.TargetAmountMinor {
			status = "reached"
			remaining = 0
		} else if record.TargetDate != nil && record.TargetDate.Format(time.DateOnly) < today {
			status = "overdue"
		}
		var remainingValue *string
		if !goal.ValueIncomplete {
			value := strconv.FormatInt(remaining, 10)
			remainingValue = &value
		}
		result = append(result, GoalMilestoneRead{
			ID: record.ID, GoalID: record.GoalID, Name: record.Name,
			TargetAmountMinor: strconv.FormatInt(record.TargetAmountMinor, 10),
			TargetDate:        formatGoalsReportsDate(record.TargetDate), Status: status,
			ProgressPercent: progressPercent(current, record.TargetAmountMinor, goal.ValueIncomplete),
			RemainingMinor:  remainingValue,
		})
	}
	return result, nil
}

func (service *GoalsReportsService) ListAlerts(ctx context.Context, userID uuid.UUID) ([]GoalAlertRead, error) {
	goals, err := service.ListGoals(ctx, userID)
	if err != nil {
		return nil, err
	}
	timezone := "UTC"
	if len(goals) > 0 {
		timezone = goals[0].timezone
	}
	alertKey := "behind:" + dateInTimezone(service.now(), timezone).Format("2006-01")
	dismissedIDs, err := service.repository.ListDismissedGoalIDs(ctx, userID, alertKey)
	if err != nil {
		return nil, fmt.Errorf("list goal alert dismissals: %w", err)
	}
	dismissed := make(map[uuid.UUID]bool, len(dismissedIDs))
	for _, goalID := range dismissedIDs {
		dismissed[goalID] = true
	}
	result := make([]GoalAlertRead, 0)
	for _, goal := range goals {
		if goal.Status != "active" || goal.ValueIncomplete || dismissed[goal.ID] || !goalBehind(goal, service.now()) {
			continue
		}
		result = append(result, GoalAlertRead{
			GoalID: goal.ID, GoalName: goal.Name, Currency: goal.Currency,
			TargetAmountMinor: goal.TargetAmountMinor, CurrentAmountMinor: goal.CurrentAmountMinor,
			ProgressPercent: goal.ProgressPercent, TargetDate: goal.TargetDate,
			AlertKey: alertKey, AssumedAnnualReturnBPS: goal.AssumedAnnualReturnBPS,
		})
	}
	return result, nil
}

func (service *GoalsReportsService) Dashboard(ctx context.Context, userID uuid.UUID) (DashboardRead, error) {
	snapshot, err := service.loadCurrentSnapshot(ctx, userID)
	if err != nil {
		return DashboardRead{}, err
	}
	return DashboardRead{
		AsOf: service.now().UTC().Format(time.RFC3339), BaseCurrency: snapshot.settings.BaseCurrency,
		Totals: snapshot.totals, AccountCount: len(snapshot.accounts), GoalCount: snapshot.goalCount,
		CurrentComplete: snapshot.currentComplete, MissingCurrencies: snapshot.missingCurrencies,
		HistoricalAvailable: false, HistoricalComplete: false, ValueBasis: "current_cached_account_values",
	}, nil
}

func (service *GoalsReportsService) ReportSummary(ctx context.Context, userID uuid.UUID) (ReportSummaryRead, error) {
	snapshot, err := service.loadCurrentSnapshot(ctx, userID)
	if err != nil {
		return ReportSummaryRead{}, err
	}
	return ReportSummaryRead{
		AsOf: service.now().UTC().Format(time.RFC3339), BaseCurrency: snapshot.settings.BaseCurrency,
		Totals: snapshot.totals, AccountCount: len(snapshot.accounts), GoalCount: snapshot.goalCount,
		CurrentComplete: snapshot.currentComplete, MissingCurrencies: snapshot.missingCurrencies,
		ValueBasis: "current_cached_account_values",
	}, nil
}

func (service *GoalsReportsService) ReportAllocation(ctx context.Context, userID uuid.UUID) (ReportAllocationRead, error) {
	snapshot, err := service.loadCurrentSnapshot(ctx, userID)
	if err != nil {
		return ReportAllocationRead{}, err
	}
	categories := map[string]int64{}
	institutions := map[string]int64{}
	currencies := map[string]int64{}
	for _, account := range snapshot.accounts {
		if !account.IsIncludedInNetWorth || account.IsLiability || account.Currency != snapshot.settings.BaseCurrency {
			continue
		}
		categories[account.CategoryName] += account.CurrentValueMinor
		institutions[account.InstitutionName] += account.CurrentValueMinor
		currencies[account.Currency] += account.CurrentValueMinor
	}
	return ReportAllocationRead{
		AsOf: service.now().UTC().Format(time.RFC3339), BaseCurrency: snapshot.settings.BaseCurrency,
		CurrentComplete: snapshot.currentComplete, MissingCurrencies: snapshot.missingCurrencies,
		ValueBasis:   "current_cached_account_values",
		Categories:   allocationItems(categories, snapshot.assetTotal),
		Institutions: allocationItems(institutions, snapshot.assetTotal),
		Currencies:   allocationItems(currencies, snapshot.assetTotal),
	}, nil
}

func (service *GoalsReportsService) mapGoals(records []GoalRecord, settings GoalsReportsSettings) []GoalRead {
	result := make([]GoalRead, 0, len(records))
	for _, record := range records {
		result = append(result, service.mapGoal(record, settings))
	}
	return result
}

func (service *GoalsReportsService) mapGoal(record GoalRecord, settings GoalsReportsSettings) GoalRead {
	current := record.StoredCurrentAmountMinor
	currentCurrency := record.Currency
	incomplete := false
	missing := []string{}
	var linkedAccount *GoalLinkedAccount
	if record.LinkedAccountID != nil {
		current = 0
		if record.LinkedAccountName == nil || record.LinkedAccountCurrency == nil || record.LinkedAccountValueMinor == nil {
			incomplete = true
		} else {
			current = *record.LinkedAccountValueMinor
			currentCurrency = *record.LinkedAccountCurrency
			linkedAccount = &GoalLinkedAccount{ID: *record.LinkedAccountID, Name: *record.LinkedAccountName, Currency: currentCurrency}
			if currentCurrency != record.Currency {
				incomplete = true
				missing = append(missing, currentCurrency)
			}
		}
	}
	var plan *GoalPlanRead
	if record.PlannedContributionMinor != nil && record.Frequency != nil && record.PlanStartDate != nil {
		plan = &GoalPlanRead{
			PlannedContributionMinor: strconv.FormatInt(*record.PlannedContributionMinor, 10),
			Frequency:                *record.Frequency, StartDate: record.PlanStartDate.Format(time.DateOnly),
			EndDate: formatGoalsReportsDate(record.PlanEndDate),
		}
	}
	return GoalRead{
		ID: record.ID, Name: record.Name, Description: record.Description,
		TargetAmountMinor:  strconv.FormatInt(record.TargetAmountMinor, 10),
		CurrentAmountMinor: strconv.FormatInt(current, 10), CurrentAmountCurrency: currentCurrency,
		Currency: record.Currency, TargetDate: record.TargetDate.Format(time.DateOnly),
		LinkedAccount: linkedAccount, Icon: record.Icon, Status: record.Status, Priority: record.Priority,
		AssumedAnnualReturnBPS: record.AssumedAnnualReturnBPS,
		ProgressPercent:        progressPercent(current, record.TargetAmountMinor, incomplete),
		ValueIncomplete: incomplete, MissingCurrencies: missing, Plan: plan,
		createdAt: record.CreatedAt, timezone: settings.Timezone,
	}
}

func (service *GoalsReportsService) loadCurrentSnapshot(ctx context.Context, userID uuid.UUID) (currentSnapshot, error) {
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return currentSnapshot{}, fmt.Errorf("load report settings: %w", err)
	}
	accounts, err := service.repository.ListAccounts(ctx, userID)
	if err != nil {
		return currentSnapshot{}, fmt.Errorf("list report accounts: %w", err)
	}
	goalCount, err := service.repository.CountGoals(ctx, userID)
	if err != nil {
		return currentSnapshot{}, fmt.Errorf("count report goals: %w", err)
	}
	missing := map[string]bool{}
	var assets, liabilities, liquid, investible int64
	for _, account := range accounts {
		if !account.IsIncludedInNetWorth {
			continue
		}
		if account.Currency != settings.BaseCurrency {
			missing[account.Currency] = true
			continue
		}
		if account.IsLiability {
			liabilities, err = checkedAdd(liabilities, account.CurrentValueMinor)
		} else {
			assets, err = checkedAdd(assets, account.CurrentValueMinor)
			if err == nil && account.IsLiquid {
				liquid, err = checkedAdd(liquid, account.CurrentValueMinor)
			}
			if err == nil && account.IsInvestible {
				investible, err = checkedAdd(investible, account.CurrentValueMinor)
			}
		}
		if err != nil {
			return currentSnapshot{}, err
		}
	}
	netWorth, err := checkedAdd(assets, -liabilities)
	if err != nil {
		return currentSnapshot{}, err
	}
	missingCurrencies := make([]string, 0, len(missing))
	for currency := range missing {
		missingCurrencies = append(missingCurrencies, currency)
	}
	sort.Strings(missingCurrencies)
	return currentSnapshot{
		settings: settings, accounts: accounts, goalCount: goalCount,
		currentComplete: len(missingCurrencies) == 0, missingCurrencies: missingCurrencies,
		assetTotal: assets,
		totals: CurrentTotals{
			Assets: strconv.FormatInt(assets, 10), Liabilities: strconv.FormatInt(liabilities, 10),
			NetWorth: strconv.FormatInt(netWorth, 10), Liquid: strconv.FormatInt(liquid, 10),
			Investible: strconv.FormatInt(investible, 10),
		},
	}, nil
}

func goalBehind(goal GoalRead, now time.Time) bool {
	current, _ := strconv.ParseInt(goal.CurrentAmountMinor, 10, 64)
	target, _ := strconv.ParseInt(goal.TargetAmountMinor, 10, 64)
	if target <= 0 {
		return false
	}
	location := timezoneLocation(goal.timezone)
	targetDate, err := time.ParseInLocation(time.DateOnly, goal.TargetDate, location)
	if err != nil {
		return false
	}
	now = now.In(location)
	if !now.Before(targetDate) {
		return goal.ProgressPercent != "100"
	}
	if !now.After(goal.createdAt) || !targetDate.After(goal.createdAt) {
		return false
	}
	actual := new(big.Rat).SetFrac(big.NewInt(current), big.NewInt(target))
	expected := new(big.Rat).SetFrac(big.NewInt(now.Sub(goal.createdAt).Nanoseconds()), big.NewInt(targetDate.Sub(goal.createdAt).Nanoseconds()))
	return actual.Cmp(expected) < 0
}

func dateInTimezone(value time.Time, timezone string) time.Time {
	return value.In(timezoneLocation(timezone))
}

func timezoneLocation(timezone string) *time.Location {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.UTC
	}
	return location
}

func progressPercent(current, target int64, incomplete bool) string {
	if incomplete || target <= 0 || current <= 0 {
		return "0"
	}
	if current >= target {
		return "100"
	}
	numerator := new(big.Int).Mul(big.NewInt(current), big.NewInt(10000))
	hundredths := new(big.Int).Quo(numerator, big.NewInt(target)).Int64()
	return formatHundredths(hundredths)
}

func allocationItems(values map[string]int64, total int64) []AllocationItemRead {
	items := make([]AllocationItemRead, 0, len(values))
	for name, value := range values {
		items = append(items, AllocationItemRead{
			Name: name, ValueMinor: strconv.FormatInt(value, 10),
			SharePercent: progressPercent(value, total, false),
		})
	}
	sort.Slice(items, func(left, right int) bool {
		leftValue, _ := strconv.ParseInt(items[left].ValueMinor, 10, 64)
		rightValue, _ := strconv.ParseInt(items[right].ValueMinor, 10, 64)
		if leftValue == rightValue {
			return items[left].Name < items[right].Name
		}
		return leftValue > rightValue
	})
	return items
}

func formatHundredths(value int64) string {
	whole, fraction := value/100, value%100
	if fraction == 0 {
		return strconv.FormatInt(whole, 10)
	}
	if fraction%10 == 0 {
		return fmt.Sprintf("%d.%d", whole, fraction/10)
	}
	return fmt.Sprintf("%d.%02d", whole, fraction)
}

func formatGoalsReportsDate(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format(time.DateOnly)
	return &formatted
}

const goalsReportsSettingsSQL = `SELECT base_currency, timezone FROM user_settings WHERE user_id = $1`

const goalsReportsGoalSelectSQL = `SELECT
g.id, g.name, g.description, g.target_amount_minor, g.current_amount_minor,
g.currency, g.target_date, g.linked_account_id, g.icon, g.status, g.priority,
g.assumed_annual_return_bps, g.created_at, a.name, a.currency, a.current_value_minor,
p.planned_contribution_minor, p.frequency, p.start_date, p.end_date
FROM goals g
LEFT JOIN accounts a ON a.user_id = g.user_id AND a.id = g.linked_account_id AND a.archived_at IS NULL
LEFT JOIN LATERAL (
  SELECT planned_contribution_minor, frequency, start_date, end_date
  FROM goal_contribution_plans
  WHERE user_id = g.user_id AND goal_id = g.id
  ORDER BY created_at, id LIMIT 1
) p ON TRUE`

func (repository *SQLGoalsReportsRepository) GetSettings(ctx context.Context, userID uuid.UUID) (GoalsReportsSettings, error) {
	var settings GoalsReportsSettings
	err := repository.db.QueryRowContext(ctx, goalsReportsSettingsSQL, userID).Scan(&settings.BaseCurrency, &settings.Timezone)
	return settings, err
}

func (repository *SQLGoalsReportsRepository) ListGoals(ctx context.Context, userID uuid.UUID) ([]GoalRecord, error) {
	rows, err := repository.db.QueryContext(ctx, goalsReportsGoalSelectSQL+` WHERE g.user_id = $1 ORDER BY g.priority, g.target_date, g.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []GoalRecord{}
	for rows.Next() {
		record, err := scanGoal(rows.Scan)
		if err != nil {
			return nil, err
		}
		result = append(result, record)
	}
	return result, rows.Err()
}

func (repository *SQLGoalsReportsRepository) GetGoal(ctx context.Context, userID, goalID uuid.UUID) (GoalRecord, error) {
	return scanGoal(repository.db.QueryRowContext(ctx, goalsReportsGoalSelectSQL+` WHERE g.user_id = $1 AND g.id = $2`, userID, goalID).Scan)
}

type goalsReportsScanner func(...any) error

func scanGoal(scan goalsReportsScanner) (GoalRecord, error) {
	var record GoalRecord
	var description, linkedID, accountName, accountCurrency, frequency sql.NullString
	var accountValue, plannedValue sql.NullInt64
	var planStart, planEnd sql.NullTime
	err := scan(
		&record.ID, &record.Name, &description, &record.TargetAmountMinor, &record.StoredCurrentAmountMinor,
		&record.Currency, &record.TargetDate, &linkedID, &record.Icon, &record.Status, &record.Priority,
		&record.AssumedAnnualReturnBPS, &record.CreatedAt, &accountName, &accountCurrency, &accountValue,
		&plannedValue, &frequency, &planStart, &planEnd,
	)
	if err != nil {
		return GoalRecord{}, err
	}
	record.Description = nullString(description)
	if linkedID.Valid {
		id, err := uuid.Parse(linkedID.String)
		if err != nil {
			return GoalRecord{}, err
		}
		record.LinkedAccountID = &id
	}
	record.LinkedAccountName = nullString(accountName)
	record.LinkedAccountCurrency = nullString(accountCurrency)
	record.LinkedAccountValueMinor = nullInt64(accountValue)
	record.PlannedContributionMinor = nullInt64(plannedValue)
	record.Frequency = nullString(frequency)
	record.PlanStartDate = nullTime(planStart)
	record.PlanEndDate = nullTime(planEnd)
	return record, nil
}

func (repository *SQLGoalsReportsRepository) ListMilestones(ctx context.Context, userID, goalID uuid.UUID) ([]MilestoneRecord, error) {
	rows, err := repository.db.QueryContext(ctx, `SELECT id, goal_id, name, target_amount_minor, target_date FROM goal_milestones WHERE user_id = $1 AND goal_id = $2 ORDER BY target_amount_minor, target_date, id`, userID, goalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MilestoneRecord{}
	for rows.Next() {
		var record MilestoneRecord
		var targetDate sql.NullTime
		if err := rows.Scan(&record.ID, &record.GoalID, &record.Name, &record.TargetAmountMinor, &targetDate); err != nil {
			return nil, err
		}
		record.TargetDate = nullTime(targetDate)
		result = append(result, record)
	}
	return result, rows.Err()
}

func (repository *SQLGoalsReportsRepository) ListDismissedGoalIDs(ctx context.Context, userID uuid.UUID, alertKey string) ([]uuid.UUID, error) {
	rows, err := repository.db.QueryContext(ctx, `SELECT goal_id FROM goal_alert_dismissals WHERE user_id = $1 AND alert_key = $2`, userID, alertKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []uuid.UUID{}
	for rows.Next() {
		var goalID uuid.UUID
		if err := rows.Scan(&goalID); err != nil {
			return nil, err
		}
		result = append(result, goalID)
	}
	return result, rows.Err()
}

func (repository *SQLGoalsReportsRepository) ListAccounts(ctx context.Context, userID uuid.UUID) ([]CurrentAccountRecord, error) {
	rows, err := repository.db.QueryContext(ctx, `SELECT a.id, a.currency, a.current_value_minor, a.is_liability, a.is_included_in_net_worth, c.name, c.is_liquid, c.is_investible, COALESCE(i.name, 'Unspecified') FROM accounts a JOIN categories c ON c.user_id = a.user_id AND c.id = a.category_id LEFT JOIN institutions i ON i.user_id = a.user_id AND i.id = a.institution_id WHERE a.user_id = $1 AND a.archived_at IS NULL ORDER BY a.name, a.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []CurrentAccountRecord{}
	for rows.Next() {
		var record CurrentAccountRecord
		if err := rows.Scan(&record.ID, &record.Currency, &record.CurrentValueMinor, &record.IsLiability, &record.IsIncludedInNetWorth, &record.CategoryName, &record.IsLiquid, &record.IsInvestible, &record.InstitutionName); err != nil {
			return nil, err
		}
		result = append(result, record)
	}
	return result, rows.Err()
}

func (repository *SQLGoalsReportsRepository) CountGoals(ctx context.Context, userID uuid.UUID) (int64, error) {
	var count int64
	err := repository.db.QueryRowContext(ctx, `SELECT count(*) FROM goals WHERE user_id = $1`, userID).Scan(&count)
	return count, err
}

func nullString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func nullTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
