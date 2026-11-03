package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrInsightsInvalidRange reports a range outside 1m, 3m, 6m, 1y, and all.
var ErrInsightsInvalidRange = errors.New("invalid insights range")

const (
	insightsDefaultRange       = "1y"
	insightsStaleRateDays      = 31
	insightsStaleValuationDays = 365
	insightsSparklineMonths    = 12
	insightsOneDecimalDigits   = 1
	insightsDaysPerYear        = 365
	insightsBasisPointsPerUnit = 10000
	insightsReturnShortPeriod  = 90
)

// InsightsRepository supplies the owner-scoped sources for the redesign read models. Every method takes the
// authenticated user ID and must include it as the owner predicate.
type InsightsRepository interface {
	GoalsReportsRepository
	LoadChartData(context.Context, uuid.UUID) (chartData, error)
	LoadChartDataIncludingArchived(context.Context, uuid.UUID) (chartData, error)
	ListEnabledCurrencies(context.Context, uuid.UUID) ([]string, error)
}

// InsightsService serves read models derived server-side from the chart replay engine so clients never compute
// authoritative financial results.
type InsightsService struct {
	repository InsightsRepository
	now        func() time.Time
}

func NewInsightsService(repository InsightsRepository) *InsightsService {
	return &InsightsService{repository: repository, now: time.Now}
}

type InstrumentRefRead struct {
	InstrumentID uuid.UUID `json:"instrumentId"`
	Name         string    `json:"name"`
}

type GoalRefRead struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type AccountSummaryRead struct {
	AccountID         uuid.UUID                 `json:"accountId"`
	Sparkline         []AccountHistoryPointRead `json:"sparkline"`
	PositionCount     *int                      `json:"positionCount"`
	LastUpdatedAt     string                    `json:"lastUpdatedAt"`
	AsOfDate          string                    `json:"asOfDate"`
	Freshness         string                    `json:"freshness"`
	ValueComplete     bool                      `json:"valueComplete"`
	MissingPrices     []InstrumentRefRead       `json:"missingPrices"`
	MissingCurrencies []string                  `json:"missingCurrencies"`
	LinkedGoals       []GoalRefRead             `json:"linkedGoals"`
}

type CurrencyPairRead struct {
	Base  string `json:"base"`
	Quote string `json:"quote"`
}

type AttentionFixRead struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

type AttentionItemRead struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Severity     string            `json:"severity"`
	Title        string            `json:"title"`
	Detail       string            `json:"detail"`
	Pair         *CurrencyPairRead `json:"pair,omitempty"`
	InstrumentID *uuid.UUID        `json:"instrumentId,omitempty"`
	GoalID       *uuid.UUID        `json:"goalId,omitempty"`
	AccountIDs   []uuid.UUID       `json:"accountIds"`
	Since        string            `json:"since,omitempty"`
	Until        string            `json:"until,omitempty"`
	Fix          AttentionFixRead  `json:"fix"`
}

type AttentionSummaryRead struct {
	TotalsComplete bool                `json:"totalsComplete"`
	Items          []AttentionItemRead `json:"items"`
}

type MonthlyFlowPointRead struct {
	Month              string `json:"month"`
	ContributionsMinor string `json:"contributionsMinor"`
	WithdrawalsMinor   string `json:"withdrawalsMinor"`
	IncomeMinor        string `json:"incomeMinor"`
	FeesMinor          string `json:"feesMinor"`
	GrowthMinor        string `json:"growthMinor"`
	NetChangeMinor     string `json:"netChangeMinor"`
	Complete           bool   `json:"complete"`
}

type FlowsReportRead struct {
	BaseCurrency       string                 `json:"baseCurrency"`
	Range              string                 `json:"range"`
	From               string                 `json:"from"`
	To                 string                 `json:"to"`
	StartValueMinor    string                 `json:"startValueMinor"`
	EndValueMinor      string                 `json:"endValueMinor"`
	ContributionsMinor string                 `json:"contributionsMinor"`
	IncomeMinor        string                 `json:"incomeMinor"`
	GrowthMinor        string                 `json:"growthMinor"`
	WithdrawalsMinor   string                 `json:"withdrawalsMinor"`
	FeesMinor          string                 `json:"feesMinor"`
	Complete           bool                   `json:"complete"`
	Months             []MonthlyFlowPointRead `json:"months"`
}

type IncomeTotalsRead struct {
	InterestMinor      string `json:"interestMinor"`
	DividendsMinor     string `json:"dividendsMinor"`
	CapitalGrowthMinor string `json:"capitalGrowthMinor"`
	FeesMinor          string `json:"feesMinor"`
	ContributionsMinor string `json:"contributionsMinor"`
}

type IncomeAccountLineRead struct {
	AccountID   uuid.UUID `json:"accountId"`
	Name        string    `json:"name"`
	Currency    string    `json:"currency"`
	NativeMinor string    `json:"nativeMinor"`
	BaseMinor   *string   `json:"baseMinor"`
}

type IncomeDividendLineRead struct {
	AccountID    uuid.UUID  `json:"accountId"`
	AccountName  string     `json:"accountName"`
	InstrumentID *uuid.UUID `json:"instrumentId"`
	Name         string     `json:"name"`
	Currency     string     `json:"currency"`
	NativeMinor  string     `json:"nativeMinor"`
	BaseMinor    *string    `json:"baseMinor"`
}

type IncomeReportRead struct {
	BaseCurrency      string                   `json:"baseCurrency"`
	From              string                   `json:"from"`
	To                string                   `json:"to"`
	Complete          bool                     `json:"complete"`
	Totals            IncomeTotalsRead         `json:"totals"`
	InterestByAccount []IncomeAccountLineRead  `json:"interestByAccount"`
	Dividends         []IncomeDividendLineRead `json:"dividends"`
	FeesByAccount     []IncomeAccountLineRead  `json:"feesByAccount"`
	Months            []MonthlyFlowPointRead   `json:"months"`
}

type NetWorthMonthRead struct {
	Month            string  `json:"month"`
	NetWorthMinor    string  `json:"netWorthMinor"`
	AssetsMinor      string  `json:"assetsMinor"`
	LiabilitiesMinor string  `json:"liabilitiesMinor"`
	ChangeMinor      *string `json:"changeMinor"`
	Complete         bool    `json:"complete"`
}

type NetWorthYearOverYearRead struct {
	FromDate      string  `json:"fromDate"`
	ToDate        string  `json:"toDate"`
	ChangeMinor   *string `json:"changeMinor"`
	ChangePercent *string `json:"changePercent"`
}

type NetWorthHighestRead struct {
	Date          string `json:"date"`
	NetWorthMinor string `json:"netWorthMinor"`
}

type NetWorthSinceStartRead struct {
	StartDate     string  `json:"startDate"`
	StartMinor    string  `json:"startMinor"`
	ChangeMinor   string  `json:"changeMinor"`
	ChangePercent *string `json:"changePercent"`
}

type NetWorthStatsRead struct {
	BaseCurrency string                   `json:"baseCurrency"`
	Complete     bool                     `json:"complete"`
	Months       []NetWorthMonthRead      `json:"months"`
	YearOverYear NetWorthYearOverYearRead `json:"yearOverYear"`
	Highest      NetWorthHighestRead      `json:"highest"`
	SinceStart   NetWorthSinceStartRead   `json:"sinceStart"`
}

type AccountComparisonRowRead struct {
	AccountID           uuid.UUID `json:"accountId"`
	Name                string    `json:"name"`
	Currency            string    `json:"currency"`
	TrackingMode        string    `json:"trackingMode"`
	IsLiability         bool      `json:"isLiability"`
	PeriodDays          int       `json:"periodDays"`
	StartMinor          *string   `json:"startMinor"`
	EndMinor            *string   `json:"endMinor"`
	DepositsMinor       string    `json:"depositsMinor"`
	WithdrawalsMinor    string    `json:"withdrawalsMinor"`
	NetIncomeMinor      string    `json:"netIncomeMinor"`
	AnnualizedReturnBPS *int64    `json:"annualizedReturnBps"`
	ReturnStatus        string    `json:"returnStatus"`
}

type AccountComparisonRead struct {
	From string                     `json:"from"`
	To   string                     `json:"to"`
	Rows []AccountComparisonRowRead `json:"rows"`
}

type DateRangeRead struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type PricePointRead struct {
	Date  string `json:"date"`
	Price string `json:"price"`
}

type AccountWeightRead struct {
	InstrumentID  uuid.UUID `json:"instrumentId"`
	Name          string    `json:"name"`
	Symbol        string    `json:"symbol"`
	WeightPercent *string   `json:"weightPercent"`
}

type InstrumentPriceHistoryRead struct {
	InstrumentID       uuid.UUID        `json:"instrumentId"`
	Name               string           `json:"name"`
	Symbol             string           `json:"symbol"`
	Currency           string           `json:"currency"`
	StaleThresholdDays int              `json:"staleThresholdDays"`
	Points             []PricePointRead `json:"points"`
	StaleRanges        []DateRangeRead  `json:"staleRanges"`
}

type AccountExtrasRead struct {
	AccountID         uuid.UUID                    `json:"accountId"`
	Weights           []AccountWeightRead          `json:"weights"`
	CashWeightPercent *string                      `json:"cashWeightPercent"`
	PriceHistory      []InstrumentPriceHistoryRead `json:"priceHistory"`
	LinkedGoals       []GoalRefRead                `json:"linkedGoals"`
}

type InstrumentHoldingRead struct {
	AccountID   uuid.UUID `json:"accountId"`
	AccountName string    `json:"accountName"`
	Quantity    string    `json:"quantity"`
	ValueMinor  *string   `json:"valueMinor"`
	Currency    string    `json:"currency"`
}

type InstrumentHoldingsRead struct {
	InstrumentID       uuid.UUID               `json:"instrumentId"`
	StaleThresholdDays int                     `json:"staleThresholdDays"`
	StaleRanges        []DateRangeRead         `json:"staleRanges"`
	Holdings           []InstrumentHoldingRead `json:"holdings"`
}

// ---- service methods ----------------------------------------------------------------------------------------

func normalizeInsightsRange(value string) (string, error) {
	if value == "" {
		return insightsDefaultRange, nil
	}
	if !validChartRange(value) {
		return "", ErrInsightsInvalidRange
	}
	return value, nil
}

func (service *InsightsService) settings(ctx context.Context, userID uuid.UUID) (GoalsReportsSettings, error) {
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return GoalsReportsSettings{}, fmt.Errorf("load insights settings: %w", err)
	}
	return settings, nil
}

func (service *InsightsService) AccountSummaries(ctx context.Context, userID uuid.UUID) ([]AccountSummaryRead, error) {
	settings, err := service.settings(ctx, userID)
	if err != nil {
		return nil, err
	}
	data, err := service.repository.LoadChartDataIncludingArchived(ctx, userID)
	if err != nil {
		return nil, err
	}
	goals, err := service.repository.ListGoals(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list summary goals: %w", err)
	}
	return buildAccountSummaries(data, goals, settings, service.now())
}

func (service *InsightsService) Attention(ctx context.Context, userID uuid.UUID) (AttentionSummaryRead, error) {
	settings, err := service.settings(ctx, userID)
	if err != nil {
		return AttentionSummaryRead{}, err
	}
	data, err := service.repository.LoadChartData(ctx, userID)
	if err != nil {
		return AttentionSummaryRead{}, err
	}
	enabled, err := service.repository.ListEnabledCurrencies(ctx, userID)
	if err != nil {
		return AttentionSummaryRead{}, fmt.Errorf("list enabled currencies: %w", err)
	}
	goals, err := service.repository.ListGoals(ctx, userID)
	if err != nil {
		return AttentionSummaryRead{}, fmt.Errorf("list attention goals: %w", err)
	}
	alerts, err := (&GoalsReportsService{repository: service.repository, now: service.now}).ListAlerts(ctx, userID)
	if err != nil {
		return AttentionSummaryRead{}, err
	}
	return buildAttention(data, settings, enabled, goals, alerts, service.now())
}

func (service *InsightsService) FlowsReport(ctx context.Context, userID uuid.UUID, rangeName string) (FlowsReportRead, error) {
	rangeName, err := normalizeInsightsRange(rangeName)
	if err != nil {
		return FlowsReportRead{}, err
	}
	settings, err := service.settings(ctx, userID)
	if err != nil {
		return FlowsReportRead{}, err
	}
	data, err := service.repository.LoadChartData(ctx, userID)
	if err != nil {
		return FlowsReportRead{}, err
	}
	return buildFlowsReport(data, settings.BaseCurrency, service.now(), rangeName)
}

func (service *InsightsService) IncomeReport(ctx context.Context, userID uuid.UUID, rangeName string) (IncomeReportRead, error) {
	rangeName, err := normalizeInsightsRange(rangeName)
	if err != nil {
		return IncomeReportRead{}, err
	}
	settings, err := service.settings(ctx, userID)
	if err != nil {
		return IncomeReportRead{}, err
	}
	data, err := service.repository.LoadChartData(ctx, userID)
	if err != nil {
		return IncomeReportRead{}, err
	}
	return buildIncomeReport(data, settings.BaseCurrency, service.now(), rangeName)
}

func (service *InsightsService) NetWorthStats(ctx context.Context, userID uuid.UUID) (NetWorthStatsRead, error) {
	settings, err := service.settings(ctx, userID)
	if err != nil {
		return NetWorthStatsRead{}, err
	}
	data, err := service.repository.LoadChartData(ctx, userID)
	if err != nil {
		return NetWorthStatsRead{}, err
	}
	return buildNetWorthStats(data, settings.BaseCurrency, service.now())
}

func (service *InsightsService) AccountComparison(ctx context.Context, userID uuid.UUID, rangeName string) (AccountComparisonRead, error) {
	rangeName, err := normalizeInsightsRange(rangeName)
	if err != nil {
		return AccountComparisonRead{}, err
	}
	data, err := service.repository.LoadChartData(ctx, userID)
	if err != nil {
		return AccountComparisonRead{}, err
	}
	return buildAccountComparison(data, service.now(), rangeName)
}

func (service *InsightsService) AccountExtras(ctx context.Context, userID, accountID uuid.UUID) (AccountExtrasRead, error) {
	settings, err := service.settings(ctx, userID)
	if err != nil {
		return AccountExtrasRead{}, err
	}
	data, err := service.repository.LoadChartDataIncludingArchived(ctx, userID)
	if err != nil {
		return AccountExtrasRead{}, err
	}
	goals, err := service.repository.ListGoals(ctx, userID)
	if err != nil {
		return AccountExtrasRead{}, fmt.Errorf("list extras goals: %w", err)
	}
	return buildAccountExtras(data, goals, settings, accountID, service.now())
}

func (service *InsightsService) InstrumentHoldings(ctx context.Context, userID, instrumentID uuid.UUID) (InstrumentHoldingsRead, error) {
	settings, err := service.settings(ctx, userID)
	if err != nil {
		return InstrumentHoldingsRead{}, err
	}
	data, err := service.repository.LoadChartData(ctx, userID)
	if err != nil {
		return InstrumentHoldingsRead{}, err
	}
	return buildInstrumentHoldings(data, settings, instrumentID, service.now())
}

func (repository *SQLGoalsReportsRepository) ListEnabledCurrencies(ctx context.Context, userID uuid.UUID) ([]string, error) {
	var encoded string
	if err := repository.db.QueryRowContext(ctx, `SELECT supported_currencies FROM user_settings WHERE user_id = $1`, userID).Scan(&encoded); err != nil {
		return nil, err
	}
	var currencies []string
	if err := json.Unmarshal([]byte(encoded), &currencies); err != nil {
		return nil, fmt.Errorf("decode supported currencies: %w", err)
	}
	return currencies, nil
}

// ---- shared helpers -----------------------------------------------------------------------------------------

type insightsPoint struct {
	Assets, Liabilities, NetWorth int64
	Complete                      bool
}

// insightsPointCache memoises chartPointAt by calendar date so month boundaries are replayed once.
type insightsPointCache struct {
	data   chartData
	base   string
	points map[string]insightsPoint
}

func newInsightsPointCache(data chartData, base string) *insightsPointCache {
	return &insightsPointCache{data: data, base: base, points: map[string]insightsPoint{}}
}

// at returns the base-currency totals at the end of the given calendar day.
func (cache *insightsPointCache) at(date time.Time) (insightsPoint, error) {
	key := dateOnlyUTC(date).Format(time.DateOnly)
	if point, ok := cache.points[key]; ok {
		return point, nil
	}
	read, err := chartPointAt(cache.data, cache.base, endOfChartDay(date))
	if err != nil {
		return insightsPoint{}, err
	}
	point := insightsPoint{Complete: read.Complete}
	for _, field := range []struct {
		target *int64
		value  string
	}{{&point.Assets, read.AssetsMinor}, {&point.Liabilities, read.LiabilitiesMinor}, {&point.NetWorth, read.NetWorthMinor}} {
		*field.target, err = strconv.ParseInt(field.value, 10, 64)
		if err != nil {
			return insightsPoint{}, fmt.Errorf("parse chart point: %w", err)
		}
	}
	cache.points[key] = point
	return point, nil
}

// insightsRangeStart mirrors chartHistory: 30/90/183/365 days back, or the earliest source date for "all",
// never earlier than the earliest source date and never after today.
func insightsRangeStart(data chartData, today time.Time, rangeName string) time.Time {
	start := today
	switch rangeName {
	case "1m":
		start = today.AddDate(0, 0, -30)
	case "3m":
		start = today.AddDate(0, 0, -90)
	case "6m":
		start = today.AddDate(0, 0, -183)
	case "1y":
		start = today.AddDate(0, 0, -365)
	}
	if dates := chartSourceDates(data); len(dates) > 0 {
		earliest := dateOnlyUTC(dates[0])
		if rangeName == "all" || start.Before(earliest) {
			start = earliest
		}
	}
	if start.After(today) {
		start = today
	}
	return start
}

func inDateWindow(value, from, to time.Time) bool {
	date := dateOnlyUTC(value)
	return !date.Before(from) && !date.After(to)
}

func daysBetween(from, to time.Time) int {
	return int(dateOnlyUTC(to).Sub(dateOnlyUTC(from)).Hours() / 24)
}

func absInt64(value int64) (int64, error) {
	if value == math.MinInt64 {
		return 0, errors.New("amount is outside the supported range")
	}
	if value < 0 {
		return -value, nil
	}
	return value, nil
}

func formatMinor(value int64) string { return strconv.FormatInt(value, 10) }

func minorPointer(value int64) *string {
	formatted := formatMinor(value)
	return &formatted
}

// percentOfFixed returns numerator/denominator×100 rounded half away from zero to a fixed number of
// fraction digits, or nil when the denominator is zero.
func percentOfFixed(numerator, denominator *big.Int, digits int) *string {
	if denominator.Sign() == 0 {
		return nil
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)
	ratio := new(big.Rat).SetFrac(new(big.Int).Mul(new(big.Int).Mul(numerator, big.NewInt(100)), scale), denominator)
	scaled := roundedRatBigInt(ratio)
	negative := scaled.Sign() < 0
	text := new(big.Int).Abs(scaled).String()
	if len(text) <= digits {
		text = strings.Repeat("0", digits-len(text)+1) + text
	}
	if digits > 0 {
		text = text[:len(text)-digits] + "." + text[len(text)-digits:]
	}
	if negative {
		text = "-" + text
	}
	return &text
}

func staleThresholdDays(settings GoalsReportsSettings, assetType string) int {
	switch assetType {
	case "etf":
		return settings.PositionStaleDaysETF
	case "fund":
		return settings.PositionStaleDaysFund
	default:
		return settings.PositionStaleDaysStock
	}
}

// priceIsStale uses the same rule as chartPositionSummary: stale once today is more than threshold days after
// the price's effective date.
func priceIsStale(priceDate, today time.Time, threshold int) bool {
	return dateOnlyUTC(today).After(dateOnlyUTC(priceDate).AddDate(0, 0, threshold))
}

// priceStaleRanges returns the periods in which the latest price was older than the threshold: from
// threshold+1 days after each price until the next price date, or until today for the latest price.
func priceStaleRanges(prices []chartPrice, instrumentID uuid.UUID, threshold int, today time.Time) []DateRangeRead {
	dates := []time.Time{}
	for _, price := range prices {
		if price.InstrumentID == instrumentID && !dateOnlyUTC(price.EffectiveDate).After(today) {
			dates = append(dates, price.EffectiveDate)
		}
	}
	dates = uniqueChartDates(dates)
	ranges := []DateRangeRead{}
	for index, date := range dates {
		staleFrom := date.AddDate(0, 0, threshold+1)
		if index+1 < len(dates) {
			if staleFrom.Before(dates[index+1]) {
				ranges = append(ranges, DateRangeRead{From: staleFrom.Format(time.DateOnly), To: dates[index+1].Format(time.DateOnly)})
			}
			continue
		}
		if !staleFrom.After(today) {
			ranges = append(ranges, DateRangeRead{From: staleFrom.Format(time.DateOnly), To: today.Format(time.DateOnly)})
		}
	}
	return ranges
}

func instrumentIndex(data chartData) map[uuid.UUID]chartInstrument {
	instruments := make(map[uuid.UUID]chartInstrument, len(data.Instruments))
	for _, instrument := range data.Instruments {
		instruments[instrument.ID] = instrument
	}
	return instruments
}

func linkedGoalRefs(goals []GoalRecord, accountID uuid.UUID) []GoalRefRead {
	refs := []GoalRefRead{}
	for _, goal := range goals {
		if goal.LinkedAccountID != nil && *goal.LinkedAccountID == accountID {
			refs = append(refs, GoalRefRead{ID: goal.ID, Name: goal.Name})
		}
	}
	return refs
}

// accountFirstDate is the earliest of the account's opened date and its own replay sources, or nil.
func accountFirstDate(data chartData, account chartAccount) *time.Time {
	var first *time.Time
	consider := func(value time.Time) {
		date := dateOnlyUTC(value)
		if first == nil || date.Before(*first) {
			first = &date
		}
	}
	if account.OpenedAt != nil {
		consider(*account.OpenedAt)
	}
	for _, row := range data.Transactions {
		if row.AccountID == account.ID {
			consider(row.Date)
		}
	}
	for _, row := range data.Valuations {
		if row.AccountID == account.ID {
			consider(row.Date)
		}
	}
	for _, row := range data.PositionEvents {
		if row.accountID == account.ID {
			consider(row.tradeDate)
		}
	}
	return first
}

// addMonthsClamped moves by whole months keeping the day of month, clamped to the target month's last day.
func addMonthsClamped(value time.Time, months int) time.Time {
	firstOfTarget := time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, months, 0)
	lastDay := firstOfTarget.AddDate(0, 1, -1).Day()
	day := value.Day()
	if day > lastDay {
		day = lastDay
	}
	return time.Date(firstOfTarget.Year(), firstOfTarget.Month(), day, 0, 0, 0, 0, time.UTC)
}

func firstOfMonth(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func rateAvailable(rates []chartRate, from, to string, at time.Time) (time.Time, bool) {
	var latest time.Time
	found := false
	for _, rate := range rates {
		matches := rate.Base == from && rate.Quote == to || rate.Base == to && rate.Quote == from
		if !matches || rate.EffectiveDate.After(at) {
			continue
		}
		if !found || rate.EffectiveDate.After(latest) {
			latest, found = rate.EffectiveDate, true
		}
	}
	return latest, found
}

// positionFeeInAccountCurrency converts a position event fee into the account currency using the event's
// applied trade rate when the fee was charged in the trade currency, otherwise the effective-dated rate.
func positionFeeInAccountCurrency(data chartData, account chartAccount, event chartPositionEvent) (int64, bool, error) {
	if event.FeeMinor == nil || *event.FeeMinor == 0 {
		return 0, true, nil
	}
	fee, err := absInt64(*event.FeeMinor)
	if err != nil {
		return 0, false, err
	}
	currency := event.FeeCurrency
	if currency == "" {
		currency = event.TradeCurrency
	}
	if currency == "" || currency == account.Currency {
		return fee, true, nil
	}
	if event.AppliedRate != "" && currency == event.TradeCurrency {
		converted, convertErr := convertMinorAtRate(fee, currency, account.Currency, event.AppliedRate, false)
		return converted, convertErr == nil, convertErr
	}
	return convertChartMinor(fee, currency, account.Currency, data.Rates, endOfChartDay(event.tradeDate))
}

// ---- flows --------------------------------------------------------------------------------------------------

const (
	flowContribution = "contribution"
	flowWithdrawal   = "withdrawal"
	flowIncome       = "income"
	flowFee          = "fee"
)

// classifyFlow maps a transaction to an external flow for net-worth bridges. Transfers, trades, generic
// purchase/sale, realised gain/loss, and manual adjustments are not external flows; their effect lands in the
// growth residual. On liability accounts only the debt-specific types are flows (opening balance and
// increases reduce net worth like a withdrawal; payments add to it like a contribution); interest and fees
// charged on debt are treated as growth because their ledger signs describe the debt, not the owner's cash.
func classifyFlow(transactionType string, isLiability bool) string {
	if isLiability {
		switch transactionType {
		case "opening_balance", "liability_increase":
			return flowWithdrawal
		case "liability_payment":
			return flowContribution
		}
		return ""
	}
	switch transactionType {
	case "opening_balance", "deposit":
		return flowContribution
	case "withdrawal":
		return flowWithdrawal
	case "interest", "dividend":
		return flowIncome
	case "fee":
		return flowFee
	}
	return ""
}

// insightsFlowRecord is one external flow in its account currency, with its base-currency conversion at the
// record date (nil when no effective rate exists).
type insightsFlowRecord struct {
	Account      chartAccount
	Class        string
	Type         string
	Date         time.Time
	NativeMinor  int64
	BaseMinor    *int64
	InstrumentID *uuid.UUID
}

// insightsFlowRecords returns the external flows dated within [from, to] for accounts included in net worth.
// complete is false when any flow lacks a rate (position fees into the account currency, or into the base).
func insightsFlowRecords(data chartData, base string, from, to time.Time) ([]insightsFlowRecord, bool, error) {
	accounts := map[uuid.UUID]chartAccount{}
	for _, account := range data.Accounts {
		if account.IsIncludedInNetWorth {
			accounts[account.ID] = account
		}
	}
	groupInstruments := map[string]uuid.UUID{}
	for _, event := range data.PositionEvents {
		if event.EventGroupID != nil {
			groupInstruments[event.accountID.String()+"|"+event.EventGroupID.String()] = event.instrumentID
		}
	}
	records := []insightsFlowRecord{}
	complete := true
	appendRecord := func(record insightsFlowRecord, currency string) error {
		converted, found, err := convertChartMinor(record.NativeMinor, currency, base, data.Rates, endOfChartDay(record.Date))
		if err != nil {
			return err
		}
		if found {
			record.BaseMinor = &converted
		} else {
			complete = false
		}
		records = append(records, record)
		return nil
	}
	for _, row := range data.Transactions {
		account, ok := accounts[row.AccountID]
		if !ok || !inDateWindow(row.Date, from, to) {
			continue
		}
		class := classifyFlow(row.Type, account.IsLiability)
		if class == "" {
			continue
		}
		amount, err := absInt64(row.Amount)
		if err != nil {
			return nil, false, err
		}
		record := insightsFlowRecord{Account: account, Class: class, Type: row.Type, Date: dateOnlyUTC(row.Date), NativeMinor: amount}
		if row.Type == "dividend" && row.EventGroupID != nil {
			if instrumentID, found := groupInstruments[row.AccountID.String()+"|"+row.EventGroupID.String()]; found {
				record.InstrumentID = &instrumentID
			}
		}
		if err := appendRecord(record, row.Currency); err != nil {
			return nil, false, err
		}
	}
	for _, event := range data.PositionEvents {
		account, ok := accounts[event.accountID]
		if !ok || account.IsLiability || !inDateWindow(event.tradeDate, from, to) || event.FeeMinor == nil || *event.FeeMinor == 0 {
			continue
		}
		fee, found, err := positionFeeInAccountCurrency(data, account, event)
		if err != nil {
			return nil, false, err
		}
		if !found {
			complete = false
			continue
		}
		record := insightsFlowRecord{Account: account, Class: flowFee, Type: "position_fee", Date: dateOnlyUTC(event.tradeDate), NativeMinor: fee}
		if err := appendRecord(record, account.Currency); err != nil {
			return nil, false, err
		}
	}
	return records, complete, nil
}

type insightsFlowWindow struct {
	Start, End                                       insightsPoint
	Contributions, Withdrawals, Income, Fees, Growth int64
	Complete                                         bool
}

// computeFlowWindow bridges net worth from the end of the day before from to the end of to. Flows are
// converted at each record's date; growth is the residual, so start + contributions + income + growth −
// withdrawals − fees = end holds exactly.
func computeFlowWindow(cache *insightsPointCache, from, to time.Time) (insightsFlowWindow, error) {
	start, err := cache.at(from.AddDate(0, 0, -1))
	if err != nil {
		return insightsFlowWindow{}, err
	}
	end, err := cache.at(to)
	if err != nil {
		return insightsFlowWindow{}, err
	}
	records, flowsComplete, err := insightsFlowRecords(cache.data, cache.base, from, to)
	if err != nil {
		return insightsFlowWindow{}, err
	}
	window := insightsFlowWindow{Start: start, End: end, Complete: start.Complete && end.Complete && flowsComplete}
	for _, record := range records {
		if record.BaseMinor == nil {
			continue
		}
		var target *int64
		switch record.Class {
		case flowContribution:
			target = &window.Contributions
		case flowWithdrawal:
			target = &window.Withdrawals
		case flowIncome:
			target = &window.Income
		case flowFee:
			target = &window.Fees
		}
		if *target, err = checkedAdd(*target, *record.BaseMinor); err != nil {
			return insightsFlowWindow{}, err
		}
	}
	growth := new(big.Int).Sub(big.NewInt(end.NetWorth), big.NewInt(start.NetWorth))
	growth.Sub(growth, big.NewInt(window.Contributions))
	growth.Add(growth, big.NewInt(window.Withdrawals))
	growth.Sub(growth, big.NewInt(window.Income))
	growth.Add(growth, big.NewInt(window.Fees))
	if window.Growth, err = checkedInt64(growth); err != nil {
		return insightsFlowWindow{}, err
	}
	return window, nil
}

func flowMonths(cache *insightsPointCache, from, to time.Time) ([]MonthlyFlowPointRead, error) {
	months := []MonthlyFlowPointRead{}
	for month := firstOfMonth(from); !month.After(to); month = month.AddDate(0, 1, 0) {
		start, end := month, month.AddDate(0, 1, -1)
		if start.Before(from) {
			start = from
		}
		if end.After(to) {
			end = to
		}
		window, err := computeFlowWindow(cache, start, end)
		if err != nil {
			return nil, err
		}
		change, err := checkedAdd(window.End.NetWorth, -window.Start.NetWorth)
		if err != nil {
			return nil, err
		}
		months = append(months, MonthlyFlowPointRead{
			Month: start.Format(time.DateOnly), ContributionsMinor: formatMinor(window.Contributions),
			WithdrawalsMinor: formatMinor(window.Withdrawals), IncomeMinor: formatMinor(window.Income),
			FeesMinor: formatMinor(window.Fees), GrowthMinor: formatMinor(window.Growth),
			NetChangeMinor: formatMinor(change), Complete: window.Complete,
		})
	}
	return months, nil
}

func buildFlowsReport(data chartData, base string, now time.Time, rangeName string) (FlowsReportRead, error) {
	today := dateOnlyUTC(now)
	from := insightsRangeStart(data, today, rangeName)
	cache := newInsightsPointCache(data, base)
	window, err := computeFlowWindow(cache, from, today)
	if err != nil {
		return FlowsReportRead{}, err
	}
	months := []MonthlyFlowPointRead{}
	if len(chartSourceDates(data)) > 0 {
		if months, err = flowMonths(cache, from, today); err != nil {
			return FlowsReportRead{}, err
		}
	}
	return FlowsReportRead{
		BaseCurrency: base, Range: rangeName, From: from.Format(time.DateOnly), To: today.Format(time.DateOnly),
		StartValueMinor: formatMinor(window.Start.NetWorth), EndValueMinor: formatMinor(window.End.NetWorth),
		ContributionsMinor: formatMinor(window.Contributions), IncomeMinor: formatMinor(window.Income),
		GrowthMinor: formatMinor(window.Growth), WithdrawalsMinor: formatMinor(window.Withdrawals),
		FeesMinor: formatMinor(window.Fees), Complete: window.Complete, Months: months,
	}, nil
}

// ---- income -------------------------------------------------------------------------------------------------

type incomeAccumulator struct {
	account      chartAccount
	instrumentID *uuid.UUID
	name         string
	native       int64
	base         int64
	baseComplete bool
}

func (accumulator *incomeAccumulator) add(record insightsFlowRecord) error {
	var err error
	if accumulator.native, err = checkedAdd(accumulator.native, record.NativeMinor); err != nil {
		return err
	}
	if record.BaseMinor == nil {
		accumulator.baseComplete = false
		return nil
	}
	accumulator.base, err = checkedAdd(accumulator.base, *record.BaseMinor)
	return err
}

func (accumulator *incomeAccumulator) baseValue() *string {
	if !accumulator.baseComplete {
		return nil
	}
	return minorPointer(accumulator.base)
}

// sortIncomeAccumulators orders by base value descending with unconvertible lines last, then name and ID.
func sortIncomeAccumulators(values []*incomeAccumulator) {
	sort.SliceStable(values, func(i, j int) bool {
		left, right := values[i], values[j]
		if left.baseComplete != right.baseComplete {
			return left.baseComplete
		}
		if left.baseComplete && left.base != right.base {
			return left.base > right.base
		}
		if left.name != right.name {
			return left.name < right.name
		}
		return left.account.ID.String() < right.account.ID.String()
	})
}

func buildIncomeReport(data chartData, base string, now time.Time, rangeName string) (IncomeReportRead, error) {
	flows, err := buildFlowsReport(data, base, now, rangeName)
	if err != nil {
		return IncomeReportRead{}, err
	}
	today := dateOnlyUTC(now)
	from := insightsRangeStart(data, today, rangeName)
	records, _, err := insightsFlowRecords(data, base, from, today)
	if err != nil {
		return IncomeReportRead{}, err
	}
	instruments := instrumentIndex(data)
	interest, fees, dividends := map[uuid.UUID]*incomeAccumulator{}, map[uuid.UUID]*incomeAccumulator{}, map[string]*incomeAccumulator{}
	interestTotal, dividendTotal := int64(0), int64(0)
	for _, record := range records {
		var accumulator *incomeAccumulator
		switch {
		case record.Type == "interest":
			if accumulator = interest[record.Account.ID]; accumulator == nil {
				accumulator = &incomeAccumulator{account: record.Account, name: record.Account.Name, baseComplete: true}
				interest[record.Account.ID] = accumulator
			}
			if record.BaseMinor != nil {
				if interestTotal, err = checkedAdd(interestTotal, *record.BaseMinor); err != nil {
					return IncomeReportRead{}, err
				}
			}
		case record.Type == "dividend":
			key := record.Account.ID.String() + "|"
			name := "Dividends"
			if record.InstrumentID != nil {
				key += record.InstrumentID.String()
				if instrument, found := instruments[*record.InstrumentID]; found {
					name = instrument.Name
				}
			}
			if accumulator = dividends[key]; accumulator == nil {
				accumulator = &incomeAccumulator{account: record.Account, instrumentID: record.InstrumentID, name: name, baseComplete: true}
				dividends[key] = accumulator
			}
			if record.BaseMinor != nil {
				if dividendTotal, err = checkedAdd(dividendTotal, *record.BaseMinor); err != nil {
					return IncomeReportRead{}, err
				}
			}
		case record.Class == flowFee:
			if accumulator = fees[record.Account.ID]; accumulator == nil {
				accumulator = &incomeAccumulator{account: record.Account, name: record.Account.Name, baseComplete: true}
				fees[record.Account.ID] = accumulator
			}
		default:
			continue
		}
		if err := accumulator.add(record); err != nil {
			return IncomeReportRead{}, err
		}
	}
	accountLines := func(values map[uuid.UUID]*incomeAccumulator) []IncomeAccountLineRead {
		list := make([]*incomeAccumulator, 0, len(values))
		for _, value := range values {
			list = append(list, value)
		}
		sortIncomeAccumulators(list)
		lines := make([]IncomeAccountLineRead, 0, len(list))
		for _, value := range list {
			lines = append(lines, IncomeAccountLineRead{AccountID: value.account.ID, Name: value.account.Name,
				Currency: value.account.Currency, NativeMinor: formatMinor(value.native), BaseMinor: value.baseValue()})
		}
		return lines
	}
	dividendList := make([]*incomeAccumulator, 0, len(dividends))
	for _, value := range dividends {
		dividendList = append(dividendList, value)
	}
	sortIncomeAccumulators(dividendList)
	dividendLines := make([]IncomeDividendLineRead, 0, len(dividendList))
	for _, value := range dividendList {
		dividendLines = append(dividendLines, IncomeDividendLineRead{AccountID: value.account.ID, AccountName: value.account.Name,
			InstrumentID: value.instrumentID, Name: value.name, Currency: value.account.Currency,
			NativeMinor: formatMinor(value.native), BaseMinor: value.baseValue()})
	}
	return IncomeReportRead{
		BaseCurrency: base, From: flows.From, To: flows.To, Complete: flows.Complete,
		Totals: IncomeTotalsRead{InterestMinor: formatMinor(interestTotal), DividendsMinor: formatMinor(dividendTotal),
			CapitalGrowthMinor: flows.GrowthMinor, FeesMinor: flows.FeesMinor, ContributionsMinor: flows.ContributionsMinor},
		InterestByAccount: accountLines(interest), Dividends: dividendLines, FeesByAccount: accountLines(fees),
		Months: flows.Months,
	}, nil
}

// ---- net-worth statistics -----------------------------------------------------------------------------------

// netWorthStatDates returns the first source date, the first of each later month, and today.
func netWorthStatDates(data chartData, today time.Time) []time.Time {
	sources := chartSourceDates(data)
	if len(sources) == 0 || sources[0].After(today) {
		return []time.Time{}
	}
	first := dateOnlyUTC(sources[0])
	dates := []time.Time{first}
	for month := firstOfMonth(first).AddDate(0, 1, 0); month.Before(today); month = month.AddDate(0, 1, 0) {
		dates = append(dates, month)
	}
	if !dates[len(dates)-1].Equal(today) {
		dates = append(dates, today)
	}
	return dates
}

func changePercent(change, baseline int64) *string {
	return percentOfFixed(big.NewInt(change), big.NewInt(baseline), insightsOneDecimalDigits)
}

func buildNetWorthStats(data chartData, base string, now time.Time) (NetWorthStatsRead, error) {
	today := dateOnlyUTC(now)
	todayText := today.Format(time.DateOnly)
	cache := newInsightsPointCache(data, base)
	dates := netWorthStatDates(data, today)
	if len(dates) == 0 {
		return NetWorthStatsRead{
			BaseCurrency: base, Complete: true, Months: []NetWorthMonthRead{},
			YearOverYear: NetWorthYearOverYearRead{FromDate: todayText, ToDate: todayText, ChangeMinor: minorPointer(0)},
			Highest:      NetWorthHighestRead{Date: todayText, NetWorthMinor: "0"},
			SinceStart:   NetWorthSinceStartRead{StartDate: todayText, StartMinor: "0", ChangeMinor: "0"},
		}, nil
	}
	points := make([]insightsPoint, 0, len(dates))
	months := make([]NetWorthMonthRead, 0, len(dates))
	complete := true
	highestIndex := -1
	for index, date := range dates {
		point, err := cache.at(date)
		if err != nil {
			return NetWorthStatsRead{}, err
		}
		var change *string
		if index > 0 && point.Complete && points[index-1].Complete {
			value, changeErr := checkedAdd(point.NetWorth, -points[index-1].NetWorth)
			if changeErr != nil {
				return NetWorthStatsRead{}, changeErr
			}
			change = minorPointer(value)
		}
		points = append(points, point)
		complete = complete && point.Complete
		if point.Complete && (highestIndex < 0 || point.NetWorth > points[highestIndex].NetWorth) {
			highestIndex = index
		}
		months = append(months, NetWorthMonthRead{Month: date.Format(time.DateOnly), NetWorthMinor: formatMinor(point.NetWorth),
			AssetsMinor: formatMinor(point.Assets), LiabilitiesMinor: formatMinor(point.Liabilities), ChangeMinor: change, Complete: point.Complete})
	}
	if highestIndex < 0 {
		highestIndex = 0
	}
	current := points[len(points)-1]
	yearAgo := today.AddDate(0, 0, -insightsDaysPerYear)
	if yearAgo.Before(dates[0]) {
		yearAgo = dates[0]
	}
	baseline, err := cache.at(yearAgo)
	if err != nil {
		return NetWorthStatsRead{}, err
	}
	yearOverYear := NetWorthYearOverYearRead{FromDate: yearAgo.Format(time.DateOnly), ToDate: todayText}
	if current.Complete && baseline.Complete {
		change, changeErr := checkedAdd(current.NetWorth, -baseline.NetWorth)
		if changeErr != nil {
			return NetWorthStatsRead{}, changeErr
		}
		yearOverYear.ChangeMinor = minorPointer(change)
		yearOverYear.ChangePercent = changePercent(change, baseline.NetWorth)
	}
	start := points[0]
	sinceChange, err := checkedAdd(current.NetWorth, -start.NetWorth)
	if err != nil {
		return NetWorthStatsRead{}, err
	}
	sinceStart := NetWorthSinceStartRead{StartDate: dates[0].Format(time.DateOnly), StartMinor: formatMinor(start.NetWorth),
		ChangeMinor: formatMinor(sinceChange)}
	if start.Complete && current.Complete {
		sinceStart.ChangePercent = changePercent(sinceChange, start.NetWorth)
	}
	return NetWorthStatsRead{
		BaseCurrency: base, Complete: complete, Months: months, YearOverYear: yearOverYear,
		Highest:    NetWorthHighestRead{Date: dates[highestIndex].Format(time.DateOnly), NetWorthMinor: formatMinor(points[highestIndex].NetWorth)},
		SinceStart: sinceStart,
	}, nil
}

// ---- account comparison -------------------------------------------------------------------------------------

// buildAccountComparison compares active accounts in their native currencies. The start value is measured at
// the end of the range start date (or zero when the account began later), flows are those dated after it up
// to today, and periodDays counts calendar days from the effective start to today.
func buildAccountComparison(data chartData, now time.Time, rangeName string) (AccountComparisonRead, error) {
	today := dateOnlyUTC(now)
	from := insightsRangeStart(data, today, rangeName)
	rows := make([]AccountComparisonRowRead, 0, len(data.Accounts))
	for _, account := range data.Accounts {
		row, err := accountComparisonRow(data, account, from, today)
		if err != nil {
			return AccountComparisonRead{}, err
		}
		rows = append(rows, row)
	}
	return AccountComparisonRead{From: from.Format(time.DateOnly), To: today.Format(time.DateOnly), Rows: rows}, nil
}

func accountComparisonRow(data chartData, account chartAccount, from, today time.Time) (AccountComparisonRowRead, error) {
	effectiveStart := from
	startedLater := false
	if first := accountFirstDate(data, account); first != nil && first.After(from) {
		effectiveStart, startedLater = *first, true
	}
	periodDays := daysBetween(effectiveStart, today)
	if periodDays < 0 {
		periodDays = 0
	}
	startValue, startComplete := int64(0), true
	if !startedLater {
		var err error
		startValue, startComplete, _, err = chartAccountValue(data, account, endOfChartDay(from))
		if err != nil {
			return AccountComparisonRowRead{}, err
		}
	}
	endValue, endComplete, _, err := chartAccountValue(data, account, endOfChartDay(today))
	if err != nil {
		return AccountComparisonRowRead{}, err
	}
	deposits, withdrawals, netIncome := int64(0), int64(0), int64(0)
	for _, row := range data.Transactions {
		date := dateOnlyUTC(row.Date)
		if row.AccountID != account.ID || !date.After(from) || date.After(today) {
			continue
		}
		amount, absErr := absInt64(row.Amount)
		if absErr != nil {
			return AccountComparisonRowRead{}, absErr
		}
		switch {
		case row.Type == "deposit" || row.Type == "opening_balance" || row.Type == "transfer" && row.Amount > 0:
			deposits, err = checkedAdd(deposits, amount)
		case row.Type == "withdrawal" || row.Type == "transfer" && row.Amount < 0:
			withdrawals, err = checkedAdd(withdrawals, amount)
		case row.Type == "interest" || row.Type == "dividend":
			netIncome, err = checkedAdd(netIncome, amount)
		case row.Type == "fee":
			netIncome, err = checkedAdd(netIncome, -amount)
		}
		if err != nil {
			return AccountComparisonRowRead{}, err
		}
	}
	for _, event := range data.PositionEvents {
		date := dateOnlyUTC(event.tradeDate)
		if event.accountID != account.ID || !date.After(from) || date.After(today) {
			continue
		}
		fee, found, feeErr := positionFeeInAccountCurrency(data, account, event)
		if feeErr != nil {
			return AccountComparisonRowRead{}, feeErr
		}
		if found {
			if netIncome, err = checkedAdd(netIncome, -fee); err != nil {
				return AccountComparisonRowRead{}, err
			}
		}
	}
	row := AccountComparisonRowRead{
		AccountID: account.ID, Name: account.Name, Currency: account.Currency, TrackingMode: account.TrackingMode,
		IsLiability: account.IsLiability, PeriodDays: periodDays, DepositsMinor: formatMinor(deposits),
		WithdrawalsMinor: formatMinor(withdrawals), NetIncomeMinor: formatMinor(netIncome),
	}
	if startComplete {
		row.StartMinor = minorPointer(startValue)
	}
	if endComplete {
		row.EndMinor = minorPointer(endValue)
	}
	row.AnnualizedReturnBPS, row.ReturnStatus = simpleAnnualizedReturn(account, startValue, endValue, deposits, withdrawals, periodDays, startComplete && endComplete)
	return row, nil
}

// simpleAnnualizedReturn is a Modified-Dietz-style simple annualised return computed exactly with big.Rat:
// gain = end − start − deposits + withdrawals; capital = start + deposits/2 − withdrawals/2;
// bps = round(gain / capital × 365 / periodDays × 10000), rounded half away from zero.
//
// Status precedence: position accounts are methodology_unavailable (cash-flow-aware TWR is not implemented),
// liabilities are not_applicable, incomplete start or end values are incomplete. When the average invested
// capital is zero or negative, or the period has no days, the ratio is undefined or misleading, so the status
// is short_period with a null number (there is not enough invested history to annualise). Otherwise periods
// under 90 days are short_period with the number still returned as a warning, and everything else is ok.
func simpleAnnualizedReturn(account chartAccount, start, end, deposits, withdrawals int64, periodDays int, complete bool) (*int64, string) {
	switch {
	case account.TrackingMode == "positions":
		return nil, "methodology_unavailable"
	case account.IsLiability:
		return nil, "not_applicable"
	case !complete:
		return nil, "incomplete"
	}
	gain := new(big.Rat).SetInt64(end)
	gain.Sub(gain, new(big.Rat).SetInt64(start))
	gain.Sub(gain, new(big.Rat).SetInt64(deposits))
	gain.Add(gain, new(big.Rat).SetInt64(withdrawals))
	capital := new(big.Rat).SetInt64(start)
	capital.Add(capital, new(big.Rat).SetFrac64(deposits, 2))
	capital.Sub(capital, new(big.Rat).SetFrac64(withdrawals, 2))
	if capital.Sign() <= 0 || periodDays <= 0 {
		return nil, "short_period"
	}
	value := new(big.Rat).Quo(gain, capital)
	value.Mul(value, big.NewRat(insightsDaysPerYear*insightsBasisPointsPerUnit, int64(periodDays)))
	bps, err := roundedRatInt64(value)
	if err != nil {
		return nil, "short_period"
	}
	if periodDays < insightsReturnShortPeriod {
		return &bps, "short_period"
	}
	return &bps, "ok"
}

// ---- account summaries --------------------------------------------------------------------------------------

func buildAccountSummaries(data chartData, goals []GoalRecord, settings GoalsReportsSettings, now time.Time) ([]AccountSummaryRead, error) {
	today := dateOnlyUTC(now)
	instruments := instrumentIndex(data)
	result := make([]AccountSummaryRead, 0, len(data.Accounts))
	for _, account := range data.Accounts {
		summary, err := accountSummary(data, account, goals, instruments, settings, today)
		if err != nil {
			return nil, err
		}
		result = append(result, summary)
	}
	return result, nil
}

func accountSummary(data chartData, account chartAccount, goals []GoalRecord, instruments map[uuid.UUID]chartInstrument, settings GoalsReportsSettings, today time.Time) (AccountSummaryRead, error) {
	summary := AccountSummaryRead{AccountID: account.ID, Freshness: "not_applicable", MissingPrices: []InstrumentRefRead{},
		MissingCurrencies: []string{}, LinkedGoals: linkedGoalRefs(goals, account.ID)}

	dates := []time.Time{}
	if first := accountFirstDate(data, account); first != nil {
		for months := insightsSparklineMonths; months >= 1; months-- {
			date := addMonthsClamped(today, -months)
			if !date.Before(*first) {
				dates = append(dates, date)
			}
		}
	}
	dates = append(dates, today)
	summary.Sparkline = make([]AccountHistoryPointRead, 0, len(dates))
	for _, date := range dates {
		value, complete, _, err := chartAccountValue(data, account, endOfChartDay(date))
		if err != nil {
			return AccountSummaryRead{}, err
		}
		summary.Sparkline = append(summary.Sparkline, AccountHistoryPointRead{Date: date.Format(time.DateOnly), ValueMinor: formatMinor(value), Complete: complete})
	}

	lastUpdated := account.CreatedAt
	found := false
	latestTransaction, latestValuation := time.Time{}, time.Time{}
	touch := func(values ...time.Time) {
		for _, value := range values {
			if !found || value.After(lastUpdated) {
				lastUpdated, found = value, true
			}
		}
	}
	for _, row := range data.Transactions {
		if row.AccountID == account.ID {
			touch(row.CreatedAt, row.UpdatedAt)
			if date := dateOnlyUTC(row.Date); !date.After(today) && date.After(latestTransaction) {
				latestTransaction = date
			}
		}
	}
	for _, row := range data.Valuations {
		if row.AccountID == account.ID {
			touch(row.CreatedAt)
			if date := dateOnlyUTC(row.Date); !date.After(today) && date.After(latestValuation) {
				latestValuation = date
			}
		}
	}
	for _, row := range data.PositionEvents {
		if row.accountID == account.ID {
			touch(row.createdAt, row.UpdatedAt)
			if date := dateOnlyUTC(row.tradeDate); account.TrackingMode == "positions" && !date.After(today) && date.After(latestTransaction) {
				latestTransaction = date
			}
		}
	}
	summary.LastUpdatedAt = lastUpdated.UTC().Format(time.RFC3339)

	asOf := latestTransaction
	if asOf.IsZero() && account.OpenedAt != nil {
		asOf = dateOnlyUTC(*account.OpenedAt)
	}
	if asOf.IsZero() {
		asOf = dateOnlyUTC(account.CreatedAt)
	}

	at := endOfChartDay(today)
	value, complete, missing, err := chartAccountValue(data, account, at)
	if err != nil {
		return AccountSummaryRead{}, err
	}
	if account.TrackingMode == "positions" {
		snapshot, snapshotErr := buildChartPositionSnapshot(data, account, at)
		if snapshotErr != nil {
			return AccountSummaryRead{}, snapshotErr
		}
		count := len(snapshot.Positions)
		summary.PositionCount = &count
		summary.Freshness = "fresh"
		var oldestPrice time.Time
		for instrumentID, position := range snapshot.Positions {
			if position.Price == nil {
				summary.Freshness = "missing"
				continue
			}
			priceDate := dateOnlyUTC(position.Price.EffectiveDate)
			if oldestPrice.IsZero() || priceDate.Before(oldestPrice) {
				oldestPrice = priceDate
			}
			if summary.Freshness == "fresh" && priceIsStale(priceDate, today, staleThresholdDays(settings, instruments[instrumentID].AssetType)) {
				summary.Freshness = "stale"
			}
		}
		if !oldestPrice.IsZero() {
			asOf = oldestPrice
		}
	} else if !latestValuation.IsZero() {
		asOf = latestValuation
		summary.Freshness = "fresh"
		if today.After(latestValuation.AddDate(0, 0, insightsStaleValuationDays)) {
			summary.Freshness = "stale"
		}
	}
	summary.AsOfDate = asOf.Format(time.DateOnly)

	for _, reason := range missing {
		if instrumentText, isPrice := strings.CutPrefix(reason, "price:"); isPrice {
			instrumentID, parseErr := uuid.Parse(instrumentText)
			if parseErr != nil {
				return AccountSummaryRead{}, fmt.Errorf("parse missing price instrument: %w", parseErr)
			}
			summary.MissingPrices = append(summary.MissingPrices, InstrumentRefRead{InstrumentID: instrumentID, Name: instruments[instrumentID].Name})
		} else if !containsString(summary.MissingCurrencies, reason) {
			summary.MissingCurrencies = append(summary.MissingCurrencies, reason)
		}
	}
	baseFound := true
	if complete {
		_, baseFound, err = convertChartMinor(value, account.Currency, settings.BaseCurrency, data.Rates, at)
	} else if account.Currency != settings.BaseCurrency {
		_, baseFound = rateAvailable(data.Rates, account.Currency, settings.BaseCurrency, at)
	}
	if err != nil {
		return AccountSummaryRead{}, err
	}
	if !baseFound && !containsString(summary.MissingCurrencies, account.Currency) {
		summary.MissingCurrencies = append(summary.MissingCurrencies, account.Currency)
	}
	sort.Strings(summary.MissingCurrencies)
	sort.Slice(summary.MissingPrices, func(i, j int) bool {
		if summary.MissingPrices[i].Name != summary.MissingPrices[j].Name {
			return summary.MissingPrices[i].Name < summary.MissingPrices[j].Name
		}
		return summary.MissingPrices[i].InstrumentID.String() < summary.MissingPrices[j].InstrumentID.String()
	})
	summary.ValueComplete = complete && baseFound
	return summary, nil
}

// ---- attention ----------------------------------------------------------------------------------------------

type attentionCurrencyUse struct {
	accounts []uuid.UUID
	since    time.Time
}

func (use *attentionCurrencyUse) add(accountID uuid.UUID, since *time.Time) {
	if !containsUUID(use.accounts, accountID) {
		use.accounts = append(use.accounts, accountID)
	}
	if since != nil && (use.since.IsZero() || since.Before(use.since)) {
		use.since = *since
	}
}

func containsUUID(values []uuid.UUID, target uuid.UUID) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func sortUUIDs(values []uuid.UUID) {
	sort.Slice(values, func(i, j int) bool { return values[i].String() < values[j].String() })
}

var attentionKindOrder = map[string]int{"missing_rate": 0, "missing_price": 1, "stale_price": 2, "stale_rate": 3, "goal_behind": 4}

func buildAttention(data chartData, settings GoalsReportsSettings, enabled []string, goals []GoalRecord, alerts []GoalAlertRead, now time.Time) (AttentionSummaryRead, error) {
	today := dateOnlyUTC(now)
	at := endOfChartDay(today)
	base := settings.BaseCurrency
	instruments := instrumentIndex(data)
	current, err := chartPointAt(data, base, at)
	if err != nil {
		return AttentionSummaryRead{}, err
	}
	items := []AttentionItemRead{}

	used := map[string]*attentionCurrencyUse{}
	use := func(currency string, accountID uuid.UUID, since *time.Time) {
		if currency == base || currency == "" {
			return
		}
		if used[currency] == nil {
			used[currency] = &attentionCurrencyUse{}
		}
		used[currency].add(accountID, since)
	}
	type priceIssue struct {
		item  AttentionItemRead
		since time.Time
	}
	prices := map[uuid.UUID]*priceIssue{}
	for _, account := range data.Accounts {
		use(account.Currency, account.ID, accountFirstDate(data, account))
		if account.TrackingMode != "positions" {
			continue
		}
		snapshot, snapshotErr := buildChartPositionSnapshot(data, account, at)
		if snapshotErr != nil {
			return AttentionSummaryRead{}, snapshotErr
		}
		for instrumentID, position := range snapshot.Positions {
			instrument := instruments[instrumentID]
			var heldSince *time.Time
			for _, event := range data.PositionEvents {
				if event.accountID == account.ID && event.instrumentID == instrumentID {
					date := dateOnlyUTC(event.tradeDate)
					if heldSince == nil || date.Before(*heldSince) {
						heldSince = &date
					}
				}
			}
			use(instrument.Currency, account.ID, heldSince)
			if existing := prices[instrumentID]; existing != nil {
				if !containsUUID(existing.item.AccountIDs, account.ID) {
					existing.item.AccountIDs = append(existing.item.AccountIDs, account.ID)
				}
				if existing.item.Kind == "missing_price" && heldSince != nil && heldSince.Before(existing.since) {
					existing.since = *heldSince
				}
				continue
			}
			label := instrument.Symbol
			if label == "" {
				label = instrument.Name
			}
			id := instrumentID
			fix := AttentionFixRead{Href: "/instruments/" + instrumentID.String() + "?addPrice=1"}
			if position.Price == nil {
				fix.Label = "Add a price"
				issue := &priceIssue{item: AttentionItemRead{ID: "missing_price:" + instrumentID.String(), Kind: "missing_price", Severity: "warning",
					Title:        "No price for " + label,
					Detail:       instrument.Name + " is held but has no price yet, so its value is left out of your totals.",
					InstrumentID: &id, AccountIDs: []uuid.UUID{account.ID}, Fix: fix}}
				if heldSince != nil {
					issue.since = *heldSince
				}
				prices[instrumentID] = issue
				continue
			}
			threshold := staleThresholdDays(settings, instrument.AssetType)
			priceDate := dateOnlyUTC(position.Price.EffectiveDate)
			if !priceIsStale(priceDate, today, threshold) {
				continue
			}
			fix.Label = "Update price"
			prices[instrumentID] = &priceIssue{since: priceDate, item: AttentionItemRead{ID: "stale_price:" + instrumentID.String(), Kind: "stale_price", Severity: "warning",
				Title:        fmt.Sprintf("%s price is %d days old", label, daysBetween(priceDate, today)),
				Detail:       fmt.Sprintf("Prices older than %d days are marked stale for %s. Totals still use the latest price.", threshold, assetTypeLabel(instrument.AssetType)),
				InstrumentID: &id, AccountIDs: []uuid.UUID{account.ID}, Fix: fix}}
		}
	}
	for _, issue := range prices {
		if !issue.since.IsZero() {
			issue.item.Since = issue.since.Format(time.DateOnly)
		}
		sortUUIDs(issue.item.AccountIDs)
		items = append(items, issue.item)
	}

	rateCurrencies := map[string]bool{}
	for currency := range used {
		rateCurrencies[currency] = true
	}
	for _, currency := range enabled {
		if currency != base && currency != "" {
			rateCurrencies[currency] = true
		}
	}
	for currency := range rateCurrencies {
		pair := &CurrencyPairRead{Base: currency, Quote: base}
		fix := AttentionFixRead{Href: "/settings/currencies?add=" + currency + "-" + base}
		accounts := []uuid.UUID{}
		if usage := used[currency]; usage != nil {
			accounts = append(accounts, usage.accounts...)
			sortUUIDs(accounts)
		}
		latest, found := rateAvailable(data.Rates, currency, base, at)
		if !found {
			usage := used[currency]
			if usage == nil {
				continue
			}
			fix.Label = "Add " + currency + " → " + base + " rate"
			item := AttentionItemRead{ID: "missing_rate:" + currency, Kind: "missing_rate", Severity: "warning",
				Title:  currency + " → " + base + " exchange rate missing",
				Detail: "Values held in " + currency + " can't be included in your " + base + " totals until you add a rate.",
				Pair:   pair, AccountIDs: accounts, Until: today.Format(time.DateOnly), Fix: fix}
			if !usage.since.IsZero() {
				item.Since = usage.since.Format(time.DateOnly)
			}
			items = append(items, item)
			continue
		}
		age := daysBetween(latest, today)
		if age <= insightsStaleRateDays {
			continue
		}
		detail := "Totals still use it, but they may drift from current values until you add a newer rate."
		if len(accounts) == 0 {
			detail = "No accounts use " + currency + " yet, so your totals are unaffected."
		}
		fix.Label = "Update rate"
		items = append(items, AttentionItemRead{ID: "stale_rate:" + currency, Kind: "stale_rate", Severity: "info",
			Title: fmt.Sprintf("%s → %s rate is %d days old", currency, base, age), Detail: detail,
			Pair: pair, AccountIDs: accounts, Since: dateOnlyUTC(latest).Format(time.DateOnly), Fix: fix})
	}

	linked := map[uuid.UUID]*uuid.UUID{}
	for _, goal := range goals {
		linked[goal.ID] = goal.LinkedAccountID
	}
	for _, alert := range alerts {
		goalID := alert.GoalID
		accounts := []uuid.UUID{}
		if accountID := linked[goalID]; accountID != nil {
			accounts = append(accounts, *accountID)
		}
		items = append(items, AttentionItemRead{ID: "goal_behind:" + goalID.String(), Kind: "goal_behind", Severity: "info",
			Title:  alert.GoalName + " is behind plan",
			Detail: "At the saved plan, this goal won't reach its target by " + alert.TargetDate + ".",
			GoalID: &goalID, AccountIDs: accounts, Fix: AttentionFixRead{Label: "Review goal", Href: "/goals/" + goalID.String()}})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Severity != items[j].Severity {
			return items[i].Severity == "warning"
		}
		if attentionKindOrder[items[i].Kind] != attentionKindOrder[items[j].Kind] {
			return attentionKindOrder[items[i].Kind] < attentionKindOrder[items[j].Kind]
		}
		return items[i].ID < items[j].ID
	})
	return AttentionSummaryRead{TotalsComplete: current.Complete, Items: items}, nil
}

func assetTypeLabel(assetType string) string {
	switch assetType {
	case "etf":
		return "ETFs"
	case "fund":
		return "funds"
	default:
		return "stocks"
	}
}

// ---- account extras and instrument holdings -----------------------------------------------------------------

func buildAccountExtras(data chartData, goals []GoalRecord, settings GoalsReportsSettings, accountID uuid.UUID, now time.Time) (AccountExtrasRead, error) {
	var account *chartAccount
	for index := range data.Accounts {
		if data.Accounts[index].ID == accountID {
			account = &data.Accounts[index]
			break
		}
	}
	if account == nil {
		return AccountExtrasRead{}, ErrGoalsReportsNotFound
	}
	today := dateOnlyUTC(now)
	extras := AccountExtrasRead{AccountID: accountID, Weights: []AccountWeightRead{}, PriceHistory: []InstrumentPriceHistoryRead{},
		LinkedGoals: linkedGoalRefs(goals, accountID)}
	if account.TrackingMode != "positions" {
		return extras, nil
	}
	instruments := instrumentIndex(data)
	snapshot, err := buildChartPositionSnapshot(data, *account, endOfChartDay(today))
	if err != nil {
		return AccountExtrasRead{}, err
	}
	positionsTotal := int64(0)
	for _, position := range snapshot.Positions {
		if position.Complete {
			if positionsTotal, err = checkedAdd(positionsTotal, position.Value); err != nil {
				return AccountExtrasRead{}, err
			}
		}
	}
	cash, err := checkedAdd(snapshot.Total, -positionsTotal)
	if err != nil {
		return AccountExtrasRead{}, err
	}
	// Weights are shares of cash plus positions. When any holding is unvalued the denominator is unknown, so
	// every weight (including cash) is null rather than overstated.
	total := big.NewInt(snapshot.Total)
	if !snapshot.Complete || snapshot.Total <= 0 {
		total = big.NewInt(0)
	}
	for instrumentID, position := range snapshot.Positions {
		instrument := instruments[instrumentID]
		weight := AccountWeightRead{InstrumentID: instrumentID, Name: instrument.Name, Symbol: instrument.Symbol}
		if position.Complete {
			weight.WeightPercent = percentOfFixed(big.NewInt(position.Value), total, insightsOneDecimalDigits)
		}
		extras.Weights = append(extras.Weights, weight)
	}
	sort.Slice(extras.Weights, func(i, j int) bool {
		if extras.Weights[i].Name != extras.Weights[j].Name {
			return extras.Weights[i].Name < extras.Weights[j].Name
		}
		return extras.Weights[i].InstrumentID.String() < extras.Weights[j].InstrumentID.String()
	})
	extras.CashWeightPercent = percentOfFixed(big.NewInt(cash), total, insightsOneDecimalDigits)

	held := []uuid.UUID{}
	for _, event := range data.PositionEvents {
		if event.accountID == accountID && !containsUUID(held, event.instrumentID) {
			held = append(held, event.instrumentID)
		}
	}
	for _, instrumentID := range held {
		instrument := instruments[instrumentID]
		threshold := staleThresholdDays(settings, instrument.AssetType)
		history := InstrumentPriceHistoryRead{InstrumentID: instrumentID, Name: instrument.Name, Symbol: instrument.Symbol,
			Currency: instrument.Currency, StaleThresholdDays: threshold, Points: instrumentPricePoints(data.Prices, instrumentID),
			StaleRanges: priceStaleRanges(data.Prices, instrumentID, threshold, today)}
		extras.PriceHistory = append(extras.PriceHistory, history)
	}
	sort.Slice(extras.PriceHistory, func(i, j int) bool {
		if extras.PriceHistory[i].Name != extras.PriceHistory[j].Name {
			return extras.PriceHistory[i].Name < extras.PriceHistory[j].Name
		}
		return extras.PriceHistory[i].InstrumentID.String() < extras.PriceHistory[j].InstrumentID.String()
	})
	return extras, nil
}

func instrumentPricePoints(prices []chartPrice, instrumentID uuid.UUID) []PricePointRead {
	selected := []chartPrice{}
	for _, price := range prices {
		if price.InstrumentID == instrumentID {
			selected = append(selected, price)
		}
	}
	sort.SliceStable(selected, func(i, j int) bool {
		if !selected[i].EffectiveDate.Equal(selected[j].EffectiveDate) {
			return selected[i].EffectiveDate.Before(selected[j].EffectiveDate)
		}
		return selected[i].CreatedAt.Before(selected[j].CreatedAt)
	})
	points := make([]PricePointRead, 0, len(selected))
	for _, price := range selected {
		points = append(points, PricePointRead{Date: dateOnlyUTC(price.EffectiveDate).Format(time.DateOnly), Price: price.Price})
	}
	return points
}

func buildInstrumentHoldings(data chartData, settings GoalsReportsSettings, instrumentID uuid.UUID, now time.Time) (InstrumentHoldingsRead, error) {
	instrument, found := instrumentIndex(data)[instrumentID]
	if !found {
		return InstrumentHoldingsRead{}, ErrGoalsReportsNotFound
	}
	today := dateOnlyUTC(now)
	threshold := staleThresholdDays(settings, instrument.AssetType)
	result := InstrumentHoldingsRead{InstrumentID: instrumentID, StaleThresholdDays: threshold,
		StaleRanges: priceStaleRanges(data.Prices, instrumentID, threshold, today), Holdings: []InstrumentHoldingRead{}}
	for _, account := range data.Accounts {
		if account.TrackingMode != "positions" || account.ArchivedAt != nil {
			continue
		}
		snapshot, err := buildChartPositionSnapshot(data, account, endOfChartDay(today))
		if err != nil {
			return InstrumentHoldingsRead{}, err
		}
		position, held := snapshot.Positions[instrumentID]
		if !held {
			continue
		}
		holding := InstrumentHoldingRead{AccountID: account.ID, AccountName: account.Name, Quantity: canonicalRat(position.Quantity), Currency: instrument.Currency}
		if position.Price != nil {
			quoteMinor, valueErr := decimalProductMinor(canonicalRat(position.Quantity), position.Price.Price, instrument.Currency)
			if valueErr != nil {
				return InstrumentHoldingsRead{}, valueErr
			}
			holding.ValueMinor = minorPointer(quoteMinor)
		}
		result.Holdings = append(result.Holdings, holding)
	}
	return result, nil
}
