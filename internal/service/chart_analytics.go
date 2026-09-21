package service

import (
	"context"
	"database/sql"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
)

type chartAccount struct {
	ID                   uuid.UUID
	Name                 string
	Currency             string
	TrackingMode         string
	CurrentValueMinor    int64
	CostBasisMinor       *int64
	IsLiability          bool
	IsIncludedInNetWorth bool
	CategoryName         string
	IsLiquid             bool
	IsInvestible         bool
	InstitutionName      string
}

type chartTransaction struct {
	AccountID uuid.UUID
	Type      string
	Amount    int64
	Currency  string
	Date      time.Time
	CreatedAt time.Time
}

type chartValuation struct {
	AccountID uuid.UUID
	Value     int64
	Date      time.Time
	CreatedAt time.Time
}

type chartRate struct {
	Base, Quote, Rate string
	EffectiveDate     time.Time
	CreatedAt         time.Time
}

type chartPositionEvent struct {
	positionEventRow
	CashEffect int64
}

type chartPrice struct {
	InstrumentID     uuid.UUID
	InstrumentName   string
	InstrumentSymbol string
	Currency         string
	Price            string
	EffectiveDate    time.Time
	CreatedAt        time.Time
}

type chartData struct {
	Accounts       []chartAccount
	Transactions   []chartTransaction
	Valuations     []chartValuation
	Rates          []chartRate
	PositionEvents []chartPositionEvent
	Prices         []chartPrice
}

type chartPositionValue struct {
	Quantity *big.Rat
	Price    *chartPrice
	Value    int64
}

type chartPositionSnapshot struct {
	Total     int64
	Positions map[uuid.UUID]chartPositionValue
	Complete  bool
	Missing   []string
}

type chartAnalyticsRepository interface {
	LoadChartData(context.Context, uuid.UUID) (chartData, error)
}

func (repository *SQLGoalsReportsRepository) LoadChartData(ctx context.Context, userID uuid.UUID) (chartData, error) {
	data := chartData{}
	rows, err := repository.db.QueryContext(ctx, `
SELECT accounts.id, accounts.name, accounts.currency, accounts.tracking_mode,
	accounts.current_value_minor, accounts.cost_basis_minor, accounts.is_liability, accounts.is_included_in_net_worth,
       categories.name, categories.is_liquid, categories.is_investible,
       COALESCE(institutions.name, 'Unspecified')
FROM accounts
JOIN categories ON categories.user_id=accounts.user_id AND categories.id=accounts.category_id
LEFT JOIN institutions ON institutions.user_id=accounts.user_id AND institutions.id=accounts.institution_id
WHERE accounts.user_id=$1 AND accounts.archived_at IS NULL
ORDER BY accounts.name,accounts.id`, userID)
	if err != nil {
		return data, fmt.Errorf("load chart accounts: %w", err)
	}
	for rows.Next() {
		var item chartAccount
		if err := rows.Scan(&item.ID, &item.Name, &item.Currency, &item.TrackingMode, &item.CurrentValueMinor, &item.CostBasisMinor,
			&item.IsLiability, &item.IsIncludedInNetWorth, &item.CategoryName, &item.IsLiquid,
			&item.IsInvestible, &item.InstitutionName); err != nil {
			rows.Close()
			return data, fmt.Errorf("scan chart account: %w", err)
		}
		data.Accounts = append(data.Accounts, item)
	}
	if err := closeChartRows(rows); err != nil {
		return data, err
	}

	rows, err = repository.db.QueryContext(ctx, `
SELECT account_id,type,amount_minor,currency,transaction_date,created_at
FROM transactions WHERE user_id=$1
ORDER BY transaction_date,created_at,id`, userID)
	if err != nil {
		return data, fmt.Errorf("load chart transactions: %w", err)
	}
	for rows.Next() {
		var item chartTransaction
		if err := rows.Scan(&item.AccountID, &item.Type, &item.Amount, &item.Currency, &item.Date, &item.CreatedAt); err != nil {
			rows.Close()
			return data, fmt.Errorf("scan chart transaction: %w", err)
		}
		data.Transactions = append(data.Transactions, item)
	}
	if err := closeChartRows(rows); err != nil {
		return data, err
	}

	rows, err = repository.db.QueryContext(ctx, `
SELECT account_id,value_minor,valuation_date,created_at
FROM valuation_snapshots WHERE user_id=$1
ORDER BY valuation_date,created_at,id`, userID)
	if err != nil {
		return data, fmt.Errorf("load chart valuations: %w", err)
	}
	for rows.Next() {
		var item chartValuation
		if err := rows.Scan(&item.AccountID, &item.Value, &item.Date, &item.CreatedAt); err != nil {
			rows.Close()
			return data, fmt.Errorf("scan chart valuation: %w", err)
		}
		data.Valuations = append(data.Valuations, item)
	}
	if err := closeChartRows(rows); err != nil {
		return data, err
	}

	rows, err = repository.db.QueryContext(ctx, `
SELECT base_currency,quote_currency,rate::text,effective_date,created_at
FROM exchange_rates WHERE user_id=$1
ORDER BY effective_date,created_at,id`, userID)
	if err != nil {
		return data, fmt.Errorf("load chart exchange rates: %w", err)
	}
	for rows.Next() {
		var item chartRate
		if err := rows.Scan(&item.Base, &item.Quote, &item.Rate, &item.EffectiveDate, &item.CreatedAt); err != nil {
			rows.Close()
			return data, fmt.Errorf("scan chart exchange rate: %w", err)
		}
		data.Rates = append(data.Rates, item)
	}
	if err := closeChartRows(rows); err != nil {
		return data, err
	}

	rows, err = repository.db.QueryContext(ctx, `
SELECT event.id,event.account_id,event.instrument_id,event.related_instrument_id,event.type,event.quantity::text,
       event.trade_date,event.event_sequence,COALESCE(event.action_ratio_numerator::text,''),
       COALESCE(event.action_ratio_denominator::text,''),event.created_at,event.cash_effect_minor
FROM position_events event
JOIN accounts ON accounts.user_id=event.user_id AND accounts.id=event.account_id
WHERE event.user_id=$1 AND accounts.archived_at IS NULL
ORDER BY event.account_id,event.trade_date,event.event_sequence,event.created_at,event.id`, userID)
	if err != nil {
		return data, fmt.Errorf("load chart position events: %w", err)
	}
	for rows.Next() {
		var item chartPositionEvent
		var related sql.NullString
		if err := rows.Scan(&item.id, &item.accountID, &item.instrumentID, &related, &item.eventType,
			&item.quantity, &item.tradeDate, &item.eventSequence, &item.actionRatioNumerator,
			&item.actionRatioDenominator, &item.createdAt, &item.CashEffect); err != nil {
			rows.Close()
			return data, fmt.Errorf("scan chart position event: %w", err)
		}
		if related.Valid {
			parsed, parseErr := uuid.Parse(related.String)
			if parseErr != nil {
				rows.Close()
				return data, fmt.Errorf("parse chart related instrument: %w", parseErr)
			}
			item.relatedInstrumentID = &parsed
		}
		data.PositionEvents = append(data.PositionEvents, item)
	}
	if err := closeChartRows(rows); err != nil {
		return data, err
	}

	rows, err = repository.db.QueryContext(ctx, `
SELECT price.instrument_id,instrument.name,COALESCE(instrument.symbol,''),instrument.quote_currency,price.price::text,price.effective_date,price.created_at
FROM security_prices price
JOIN investment_instruments instrument ON instrument.user_id=price.user_id AND instrument.id=price.instrument_id
WHERE price.user_id=$1
ORDER BY price.effective_date,price.created_at,price.id`, userID)
	if err != nil {
		return data, fmt.Errorf("load chart security prices: %w", err)
	}
	for rows.Next() {
		var item chartPrice
		if err := rows.Scan(&item.InstrumentID, &item.InstrumentName, &item.InstrumentSymbol, &item.Currency, &item.Price, &item.EffectiveDate, &item.CreatedAt); err != nil {
			rows.Close()
			return data, fmt.Errorf("scan chart security price: %w", err)
		}
		data.Prices = append(data.Prices, item)
	}
	if err := closeChartRows(rows); err != nil {
		return data, err
	}
	return data, nil
}

func closeChartRows(rows *sql.Rows) error {
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close chart rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate chart rows: %w", err)
	}
	return nil
}

func (service *GoalsReportsService) chartDashboard(ctx context.Context, userID uuid.UUID, rangeName string) (DashboardRead, bool, error) {
	repository, ok := service.repository.(chartAnalyticsRepository)
	if !ok {
		return DashboardRead{}, false, nil
	}
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return DashboardRead{}, true, fmt.Errorf("load chart settings: %w", err)
	}
	data, err := repository.LoadChartData(ctx, userID)
	if err != nil {
		return DashboardRead{}, true, err
	}
	goalCount, err := service.repository.CountGoals(ctx, userID)
	if err != nil {
		return DashboardRead{}, true, fmt.Errorf("count chart goals: %w", err)
	}
	result, err := buildChartDashboard(data, settings, service.now(), rangeName, goalCount)
	return result, true, err
}

func buildChartDashboard(data chartData, settings GoalsReportsSettings, now time.Time, rangeName string, goalCount int64) (DashboardRead, error) {
	if !validChartRange(rangeName) {
		rangeName = "1y"
	}
	currentPoint, err := chartPointAt(data, settings.BaseCurrency, now)
	if err != nil {
		return DashboardRead{}, err
	}
	periodChanges, err := chartPeriodChanges(data, settings.BaseCurrency, now, currentPoint)
	if err != nil {
		return DashboardRead{}, err
	}
	history, err := chartHistory(data, settings.BaseCurrency, now, rangeName)
	if err != nil {
		return DashboardRead{}, err
	}
	flows, flowComplete, flowMissing, err := chartFlows(data, settings.BaseCurrency)
	if err != nil {
		return DashboardRead{}, err
	}
	allocation, investible, institutions, currencies, instruments := chartAllocations(data, settings.BaseCurrency, now)
	missing := append([]string{}, currentPoint.MissingCurrencies...)
	for _, currency := range flowMissing {
		if !containsString(missing, currency) {
			missing = append(missing, currency)
		}
	}
	sort.Strings(missing)
	reasons := []string{}
	if !flowComplete {
		reasons = append(reasons, "One or more cash flows lack an effective-dated exchange rate.")
	}
	for _, account := range data.Accounts {
		if account.TrackingMode == "positions" {
			reasons = append(reasons, "Position-account growth attribution is not included in contribution and growth totals.")
			break
		}
	}
	return DashboardRead{
		AsOf: now.UTC().Format(time.RFC3339), BaseCurrency: settings.BaseCurrency,
		Totals: CurrentTotals{Assets: currentPoint.AssetsMinor, Liabilities: currentPoint.LiabilitiesMinor,
			NetWorth: currentPoint.NetWorthMinor, Liquid: currentPoint.LiquidMinor, Investible: currentPoint.InvestibleMinor,
			Contributions: flows.Contributions, Withdrawals: flows.Withdrawals, Income: flows.Income,
			Fees: flows.Fees, CapitalGrowth: flows.CapitalGrowth},
		AccountCount: len(data.Accounts), GoalCount: goalCount, CurrentComplete: currentPoint.Complete,
		MissingCurrencies: missing, HistoricalAvailable: len(history) > 1,
		HistoricalComplete: allHistoryComplete(history), PeriodChanges: periodChanges, ValueBasis: "effective_dated_replay",
		History: history, Allocation: allocation, InvestibleAllocation: investible,
		InstitutionAllocation: institutions, CurrencyAllocation: currencies,
		InstrumentAllocation: instruments,
		CompositionComplete:  len(reasons) == 0, CompletenessReasons: reasons,
	}, nil
}

func chartPeriodChanges(data chartData, baseCurrency string, now time.Time, current HistoricalPointRead) (DashboardPeriodChangesRead, error) {
	today := dateOnlyUTC(now)
	oneMonth, err := chartNetWorthChange(data, baseCurrency, endOfChartDay(today.AddDate(0, 0, -30)), current)
	if err != nil {
		return DashboardPeriodChangesRead{}, err
	}
	threeMonths, err := chartNetWorthChange(data, baseCurrency, endOfChartDay(today.AddDate(0, 0, -90)), current)
	if err != nil {
		return DashboardPeriodChangesRead{}, err
	}
	oneYear, err := chartNetWorthChange(data, baseCurrency, endOfChartDay(today.AddDate(0, 0, -365)), current)
	if err != nil {
		return DashboardPeriodChangesRead{}, err
	}
	allTimeDate := endOfChartDay(today)
	if dates := chartSourceDates(data); len(dates) > 0 {
		allTimeDate = endOfChartDay(dates[0].AddDate(0, 0, -1))
	}
	allTime, err := chartNetWorthChange(data, baseCurrency, allTimeDate, current)
	if err != nil {
		return DashboardPeriodChangesRead{}, err
	}
	return DashboardPeriodChangesRead{OneMonth: oneMonth, ThreeMonths: threeMonths, OneYear: oneYear, AllTime: allTime}, nil
}

func chartNetWorthChange(data chartData, baseCurrency string, at time.Time, current HistoricalPointRead) (*string, error) {
	baseline, err := chartPointAt(data, baseCurrency, at)
	if err != nil {
		return nil, err
	}
	if !current.Complete || !baseline.Complete {
		return nil, nil
	}
	currentValue, err := strconv.ParseInt(current.NetWorthMinor, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse current net worth: %w", err)
	}
	baselineValue, err := strconv.ParseInt(baseline.NetWorthMinor, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse baseline net worth: %w", err)
	}
	value := strconv.FormatInt(currentValue-baselineValue, 10)
	return &value, nil
}

func chartAccountListValues(data chartData, account chartAccount, baseCurrency string, now time.Time) (*string, *string, error) {
	current, currentComplete, _, err := chartAccountValue(data, account, endOfChartDay(now))
	if err != nil {
		return nil, nil, err
	}
	baseline, baselineComplete, _, err := chartAccountValue(data, account, endOfChartDay(dateOnlyUTC(now).AddDate(0, 0, -30)))
	if err != nil {
		return nil, nil, err
	}
	if !currentComplete {
		return nil, nil, nil
	}
	convertedCurrent, found, err := convertChartMinor(current, account.Currency, baseCurrency, data.Rates, now)
	if err != nil || !found {
		return nil, nil, err
	}
	converted := strconv.FormatInt(convertedCurrent, 10)
	if !baselineComplete {
		return &converted, nil, nil
	}
	convertedBaseline, found, err := convertChartMinor(baseline, account.Currency, baseCurrency, data.Rates, dateOnlyUTC(now).AddDate(0, 0, -30))
	if err != nil || !found {
		return &converted, nil, err
	}
	change := strconv.FormatInt(convertedCurrent-convertedBaseline, 10)
	return &converted, &change, nil
}

func chartHistory(data chartData, baseCurrency string, now time.Time, rangeName string) ([]HistoricalPointRead, error) {
	dates := chartSourceDates(data)
	if len(dates) == 0 {
		return []HistoricalPointRead{}, nil
	}
	today := dateOnlyUTC(now)
	earliest := dateOnlyUTC(dates[0])
	start := earliest
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
	if start.Before(earliest) {
		start = earliest
	}
	stepDaily := rangeName == "1m" || rangeName == "3m"
	points := []HistoricalPointRead{}
	for cursor := start; !cursor.After(today); {
		point, err := chartPointAt(data, baseCurrency, endOfChartDay(cursor))
		if err != nil {
			return nil, err
		}
		points = append(points, point)
		if stepDaily {
			cursor = cursor.AddDate(0, 0, 1)
		} else {
			cursor = cursor.AddDate(0, 1, 0)
		}
	}
	if len(points) == 0 || points[len(points)-1].Date[:10] != today.Format(time.DateOnly) {
		point, err := chartPointAt(data, baseCurrency, endOfChartDay(today))
		if err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	return points, nil
}

func chartPointAt(data chartData, baseCurrency string, at time.Time) (HistoricalPointRead, error) {
	assets, liabilities, liquid, investible := int64(0), int64(0), int64(0), int64(0)
	missing := []string{}
	for _, account := range data.Accounts {
		if !account.IsIncludedInNetWorth {
			continue
		}
		value, complete, currencies, err := chartAccountValue(data, account, at)
		if err != nil {
			return HistoricalPointRead{}, err
		}
		if !complete {
			for _, currency := range currencies {
				if !containsString(missing, currency) {
					missing = append(missing, currency)
				}
			}
			continue
		}
		converted, found, err := convertChartMinor(value, account.Currency, baseCurrency, data.Rates, at)
		if err != nil {
			return HistoricalPointRead{}, err
		}
		if !found {
			if !containsString(missing, account.Currency) {
				missing = append(missing, account.Currency)
			}
			continue
		}
		if account.IsLiability {
			liabilities, err = checkedAdd(liabilities, converted)
		} else {
			assets, err = checkedAdd(assets, converted)
			if err == nil && account.IsLiquid {
				liquid, err = checkedAdd(liquid, converted)
			}
			if err == nil && account.IsInvestible {
				investible, err = checkedAdd(investible, converted)
			}
		}
		if err != nil {
			return HistoricalPointRead{}, err
		}
	}
	sort.Strings(missing)
	netWorth, err := checkedAdd(assets, -liabilities)
	if err != nil {
		return HistoricalPointRead{}, err
	}
	return HistoricalPointRead{Date: at.UTC().Format(time.RFC3339), AssetsMinor: strconv.FormatInt(assets, 10),
		LiabilitiesMinor: strconv.FormatInt(liabilities, 10), NetWorthMinor: strconv.FormatInt(netWorth, 10),
		LiquidMinor: strconv.FormatInt(liquid, 10), InvestibleMinor: strconv.FormatInt(investible, 10),
		Complete: len(missing) == 0, MissingCurrencies: missing}, nil
}

func chartAccountValue(data chartData, account chartAccount, at time.Time) (int64, bool, []string, error) {
	if account.TrackingMode != "positions" {
		balance := int64(0)
		type event struct {
			date, created time.Time
			valuation     bool
			typeName      string
			amount        int64
		}
		events := []event{}
		for _, row := range data.Transactions {
			if row.AccountID == account.ID && !row.Date.After(at) {
				events = append(events, event{date: row.Date, created: row.CreatedAt, typeName: row.Type, amount: row.Amount})
			}
		}
		for _, row := range data.Valuations {
			if row.AccountID == account.ID && !row.Date.After(at) {
				events = append(events, event{date: row.Date, created: row.CreatedAt, valuation: true, amount: row.Value})
			}
		}
		sort.SliceStable(events, func(i, j int) bool {
			if !events[i].date.Equal(events[j].date) {
				return events[i].date.Before(events[j].date)
			}
			if !events[i].created.Equal(events[j].created) {
				return events[i].created.Before(events[j].created)
			}
			return !events[i].valuation && events[j].valuation
		})
		for _, row := range events {
			if row.valuation {
				balance = row.amount
				continue
			}
			effect, err := transactionEffect(row.typeName, row.amount)
			if err != nil {
				return 0, false, nil, err
			}
			balance, err = checkedAdd(balance, effect)
			if err != nil {
				return 0, false, nil, err
			}
		}
		return balance, true, nil, nil
	}

	snapshot, err := buildChartPositionSnapshot(data, account, at)
	if err != nil {
		return 0, false, nil, err
	}
	return snapshot.Total, snapshot.Complete, snapshot.Missing, nil
}

func buildChartPositionSnapshot(data chartData, account chartAccount, at time.Time) (chartPositionSnapshot, error) {
	cash := int64(0)
	for _, row := range data.Transactions {
		if row.AccountID == account.ID && !row.Date.After(at) {
			effect := investmentTransactionEffect(row.Type, row.Amount)
			if !effect.IsInt64() {
				return chartPositionSnapshot{}, investmentValidationError("position cash is outside the supported range")
			}
			var err error
			cash, err = checkedAdd(cash, effect.Int64())
			if err != nil {
				return chartPositionSnapshot{}, err
			}
		}
	}
	rows := []positionEventRow{}
	for _, row := range data.PositionEvents {
		if row.accountID == account.ID && !row.tradeDate.After(at) {
			rows = append(rows, row.positionEventRow)
			var err error
			cash, err = checkedAdd(cash, row.CashEffect)
			if err != nil {
				return chartPositionSnapshot{}, err
			}
		}
	}
	quantities, err := replayPositionEvents(rows, true)
	if err != nil {
		return chartPositionSnapshot{}, err
	}
	missing := []string{}
	total := cash
	positions := map[uuid.UUID]chartPositionValue{}
	for key, quantity := range quantities {
		if key.accountID != account.ID || quantity.Sign() == 0 {
			continue
		}
		price, found := latestChartPrice(data.Prices, key.instrumentID, at, latestSplitDate(rows, key.instrumentID))
		if !found {
			missing = append(missing, "price:"+key.instrumentID.String())
			positions[key.instrumentID] = chartPositionValue{Quantity: cloneRat(quantity)}
			continue
		}
		quoteMinor, err := decimalProductMinor(canonicalRat(quantity), price.Price, price.Currency)
		if err != nil {
			return chartPositionSnapshot{}, err
		}
		accountMinor, converted, err := convertChartMinor(quoteMinor, price.Currency, account.Currency, data.Rates, at)
		if err != nil {
			return chartPositionSnapshot{}, err
		}
		if !converted {
			missing = append(missing, price.Currency)
			positions[key.instrumentID] = chartPositionValue{Quantity: cloneRat(quantity), Price: &price}
			continue
		}
		total, err = checkedAdd(total, accountMinor)
		if err != nil {
			return chartPositionSnapshot{}, err
		}
		positions[key.instrumentID] = chartPositionValue{Quantity: cloneRat(quantity), Price: &price, Value: accountMinor}
	}
	return chartPositionSnapshot{Total: total, Positions: positions, Complete: len(missing) == 0, Missing: missing}, nil
}

func latestChartPrice(prices []chartPrice, instrumentID uuid.UUID, at, after time.Time) (chartPrice, bool) {
	var selected chartPrice
	found := false
	for _, price := range prices {
		if price.InstrumentID != instrumentID || price.EffectiveDate.After(at) || price.EffectiveDate.Before(after) {
			continue
		}
		if !found || price.EffectiveDate.After(selected.EffectiveDate) || price.EffectiveDate.Equal(selected.EffectiveDate) && price.CreatedAt.After(selected.CreatedAt) {
			selected, found = price, true
		}
	}
	return selected, found
}

func latestSplitDate(events []positionEventRow, instrumentID uuid.UUID) time.Time {
	var result time.Time
	for _, event := range events {
		if event.instrumentID == instrumentID && event.eventType == "split" && event.tradeDate.After(result) {
			result = event.tradeDate
		}
	}
	return result
}

func convertChartMinor(amount int64, from, to string, rates []chartRate, at time.Time) (int64, bool, error) {
	if from == to {
		return amount, true, nil
	}
	var selected chartRate
	found := false
	for _, rate := range rates {
		matches := rate.Base == from && rate.Quote == to || rate.Base == to && rate.Quote == from
		if !matches || rate.EffectiveDate.After(at) {
			continue
		}
		if !found || rate.EffectiveDate.After(selected.EffectiveDate) || rate.EffectiveDate.Equal(selected.EffectiveDate) && rate.CreatedAt.After(selected.CreatedAt) {
			selected, found = rate, true
		}
	}
	if !found {
		return 0, false, nil
	}
	value, err := convertMinorAtRate(amount, from, to, selected.Rate, selected.Base != from)
	return value, true, err
}

type chartFlowTotals struct{ Contributions, Withdrawals, Income, Fees, CapitalGrowth string }

func chartFlows(data chartData, baseCurrency string) (chartFlowTotals, bool, []string, error) {
	values := map[string]int64{"contributions": 0, "withdrawals": 0, "income": 0, "fees": 0, "growth": 0}
	missing := []string{}
	accounts := map[uuid.UUID]chartAccount{}
	for _, account := range data.Accounts {
		accounts[account.ID] = account
	}
	for _, row := range data.Transactions {
		account, ok := accounts[row.AccountID]
		if !ok || account.IsLiability || !account.IsIncludedInNetWorth {
			continue
		}
		amount := row.Amount
		if amount < 0 {
			amount = -amount
		}
		converted, found, err := convertChartMinor(amount, row.Currency, baseCurrency, data.Rates, row.Date)
		if err != nil {
			return chartFlowTotals{}, false, nil, err
		}
		if !found {
			if !containsString(missing, row.Currency) {
				missing = append(missing, row.Currency)
			}
			continue
		}
		key, sign := "", int64(1)
		switch row.Type {
		case "opening_balance", "deposit", "purchase":
			key = "contributions"
		case "withdrawal", "sale":
			key = "withdrawals"
		case "interest", "dividend":
			key = "income"
		case "fee":
			key = "fees"
		case "capital_gain":
			key = "growth"
		case "capital_loss":
			key, sign = "growth", -1
		}
		if key != "" {
			values[key], err = checkedAdd(values[key], sign*converted)
			if err != nil {
				return chartFlowTotals{}, false, nil, err
			}
		}
	}
	for _, account := range data.Accounts {
		if account.IsLiability || !account.IsIncludedInNetWorth || account.TrackingMode == "positions" {
			continue
		}
		type growthEvent struct {
			date, created time.Time
			valuation     bool
			typeName      string
			amount        int64
		}
		events := []growthEvent{}
		for _, transaction := range data.Transactions {
			if transaction.AccountID == account.ID {
				events = append(events, growthEvent{date: transaction.Date, created: transaction.CreatedAt, typeName: transaction.Type, amount: transaction.Amount})
			}
		}
		for _, valuation := range data.Valuations {
			if valuation.AccountID == account.ID {
				events = append(events, growthEvent{date: valuation.Date, created: valuation.CreatedAt, valuation: true, amount: valuation.Value})
			}
		}
		sort.SliceStable(events, func(i, j int) bool {
			if !events[i].date.Equal(events[j].date) {
				return events[i].date.Before(events[j].date)
			}
			if !events[i].created.Equal(events[j].created) {
				return events[i].created.Before(events[j].created)
			}
			return !events[i].valuation && events[j].valuation
		})
		balance := int64(0)
		for _, event := range events {
			if !event.valuation {
				effect, effectErr := transactionEffect(event.typeName, event.amount)
				if effectErr != nil {
					return chartFlowTotals{}, false, nil, effectErr
				}
				balance, effectErr = checkedAdd(balance, effect)
				if effectErr != nil {
					return chartFlowTotals{}, false, nil, effectErr
				}
				continue
			}
			delta := event.amount - balance
			converted, found, conversionErr := convertChartMinor(delta, account.Currency, baseCurrency, data.Rates, event.date)
			if conversionErr != nil {
				return chartFlowTotals{}, false, nil, conversionErr
			}
			if found {
				values["growth"], _ = checkedAdd(values["growth"], converted)
			} else if !containsString(missing, account.Currency) {
				missing = append(missing, account.Currency)
			}
			balance = event.amount
		}
	}
	sort.Strings(missing)
	return chartFlowTotals{Contributions: strconv.FormatInt(values["contributions"], 10),
		Withdrawals: strconv.FormatInt(values["withdrawals"], 10), Income: strconv.FormatInt(values["income"], 10),
		Fees: strconv.FormatInt(values["fees"], 10), CapitalGrowth: strconv.FormatInt(values["growth"], 10)}, len(missing) == 0, missing, nil
}

func chartAllocations(data chartData, baseCurrency string, at time.Time) ([]AllocationItemRead, []AllocationItemRead, []AllocationItemRead, []AllocationItemRead, []AllocationItemRead) {
	categories, investible, institutions, currencies, instruments := map[string]int64{}, map[string]int64{}, map[string]int64{}, map[string]int64{}, map[string]int64{}
	for _, account := range data.Accounts {
		if account.IsLiability || !account.IsIncludedInNetWorth {
			continue
		}
		value, complete, _, err := chartAccountValue(data, account, at)
		if err != nil || !complete {
			continue
		}
		converted, found, err := convertChartMinor(value, account.Currency, baseCurrency, data.Rates, at)
		if err != nil || !found {
			continue
		}
		categories[account.CategoryName] += converted
		institutions[account.InstitutionName] += converted
		currencies[account.Currency] += converted
		if account.IsInvestible {
			investible[account.CategoryName] += converted
		}
		if account.TrackingMode == "positions" {
			snapshot, snapshotErr := buildChartPositionSnapshot(data, account, at)
			if snapshotErr == nil {
				for _, position := range snapshot.Positions {
					if position.Price == nil {
						continue
					}
					baseValue, convertedPosition, conversionErr := convertChartMinor(position.Value, account.Currency, baseCurrency, data.Rates, at)
					if conversionErr != nil || !convertedPosition {
						continue
					}
					label := position.Price.InstrumentSymbol
					if label == "" {
						label = position.Price.InstrumentName
					}
					instruments[label] += baseValue
				}
			}
		}
	}
	return allocationItems(categories, sumMap(categories)), allocationItems(investible, sumMap(investible)),
		allocationItems(institutions, sumMap(institutions)), allocationItems(currencies, sumMap(currencies)),
		allocationItems(instruments, sumMap(instruments))
}

func (service *GoalsReportsService) AccountAnalytics(ctx context.Context, userID, accountID uuid.UUID) (AccountAnalyticsRead, error) {
	repository, ok := service.repository.(chartAnalyticsRepository)
	if !ok {
		return AccountAnalyticsRead{}, ErrGoalsReportsNotFound
	}
	data, err := repository.LoadChartData(ctx, userID)
	if err != nil {
		return AccountAnalyticsRead{}, err
	}
	var account *chartAccount
	for index := range data.Accounts {
		if data.Accounts[index].ID == accountID {
			account = &data.Accounts[index]
			break
		}
	}
	if account == nil {
		return AccountAnalyticsRead{}, ErrGoalsReportsNotFound
	}
	metrics, err := chartAccountMetrics(data, *account)
	if err != nil {
		return AccountAnalyticsRead{}, err
	}
	dates := chartSourceDatesForAccount(data, accountID)
	history := []AccountHistoryPointRead{}
	complete := true
	reasons := []string{}
	for _, date := range dates {
		value, pointComplete, missing, valueErr := chartAccountValue(data, *account, endOfChartDay(date))
		if valueErr != nil {
			return AccountAnalyticsRead{}, valueErr
		}
		history = append(history, AccountHistoryPointRead{Date: date.Format(time.DateOnly), ValueMinor: strconv.FormatInt(value, 10), Complete: pointComplete})
		if !pointComplete {
			complete = false
			for _, reason := range missing {
				if !containsString(reasons, reason) {
					reasons = append(reasons, reason)
				}
			}
		}
	}
	var movement *PositionMovementAttributionRead
	var positionSummary *AccountPositionSummaryRead
	if account.TrackingMode == "positions" {
		snapshot, snapshotErr := buildChartPositionSnapshot(data, *account, endOfChartDay(service.now()))
		if snapshotErr != nil {
			return AccountAnalyticsRead{}, snapshotErr
		}
		positionsMinor := int64(0)
		for _, position := range snapshot.Positions {
			positionsMinor, err = checkedAdd(positionsMinor, position.Value)
			if err != nil {
				return AccountAnalyticsRead{}, err
			}
		}
		positionSummary = &AccountPositionSummaryRead{
			CashMinor:      strconv.FormatInt(snapshot.Total-positionsMinor, 10),
			PositionsMinor: strconv.FormatInt(positionsMinor, 10),
			Complete:       snapshot.Complete,
		}
	}
	if account.TrackingMode == "positions" && len(dates) > 0 {
		attribution, attributionErr := chartMovementAttribution(data, *account, endOfChartDay(dates[0]), endOfChartDay(service.now()))
		if attributionErr != nil {
			return AccountAnalyticsRead{}, attributionErr
		}
		movement = &attribution
		if !attribution.Complete {
			complete = false
			reasons = append(reasons, "Position movement attribution is incomplete because a historical price or exchange rate is unavailable.")
		}
	}
	return AccountAnalyticsRead{AccountID: accountID, Currency: account.Currency, Metrics: metrics, PositionSummary: positionSummary, History: history,
		HistoryComplete: complete, MovementAttributionAvailable: movement != nil, MovementAttribution: movement, CompletenessReasons: reasons}, nil
}

func chartAccountMetrics(data chartData, account chartAccount) (AccountFlowMetricsRead, error) {
	contributions, withdrawals, transfersIn, transfersOut := int64(0), int64(0), int64(0), int64(0)
	interest, dividends, fees, realizedGrowth, opening := int64(0), int64(0), int64(0), int64(0), int64(0)
	for _, row := range data.Transactions {
		if row.AccountID != account.ID {
			continue
		}
		rawAmount := row.Amount
		amount := rawAmount
		if amount < 0 {
			amount = -amount
		}
		var target *int64
		sign := int64(1)
		switch row.Type {
		case "opening_balance":
			target = &contributions
			if opening == 0 {
				opening = amount
			}
		case "deposit", "purchase":
			target = &contributions
		case "withdrawal", "sale":
			target = &withdrawals
		case "interest":
			target = &interest
		case "dividend":
			target = &dividends
		case "fee":
			target = &fees
		case "capital_gain":
			target = &realizedGrowth
		case "capital_loss":
			target, sign = &realizedGrowth, -1
		case "transfer":
			if rawAmount >= 0 {
				target = &transfersIn
			} else {
				target = &transfersOut
			}
		}
		if target != nil {
			value, addErr := checkedAdd(*target, sign*amount)
			if addErr != nil {
				return AccountFlowMetricsRead{}, addErr
			}
			*target = value
		}
	}
	income, err := checkedAdd(interest, dividends)
	if err != nil {
		return AccountFlowMetricsRead{}, err
	}
	contributionBasis := contributions
	if account.CostBasisMinor != nil {
		contributionBasis, err = checkedAdd(*account.CostBasisMinor, contributions-opening)
		if err != nil {
			return AccountFlowMetricsRead{}, err
		}
	}
	estimatedGain, err := checkedAdd(account.CurrentValueMinor, -contributionBasis)
	if err == nil {
		estimatedGain, err = checkedAdd(estimatedGain, -transfersIn)
	}
	if err == nil {
		estimatedGain, err = checkedAdd(estimatedGain, withdrawals)
	}
	if err == nil {
		estimatedGain, err = checkedAdd(estimatedGain, transfersOut)
	}
	if err != nil {
		return AccountFlowMetricsRead{}, err
	}
	return AccountFlowMetricsRead{
		ContributionsMinor: strconv.FormatInt(contributions, 10), WithdrawalsMinor: strconv.FormatInt(withdrawals, 10),
		IncomeMinor: strconv.FormatInt(income, 10), FeesMinor: strconv.FormatInt(fees, 10),
		CapitalGrowthMinor: strconv.FormatInt(realizedGrowth, 10), EstimatedGainMinor: strconv.FormatInt(estimatedGain, 10),
	}, nil
}

func chartMovementAttribution(data chartData, account chartAccount, from, to time.Time) (PositionMovementAttributionRead, error) {
	start, err := buildChartPositionSnapshot(data, account, from)
	if err != nil {
		return PositionMovementAttributionRead{}, err
	}
	end, err := buildChartPositionSnapshot(data, account, to)
	if err != nil {
		return PositionMovementAttributionRead{}, err
	}
	externalCash, income, fees, adjustments, tradeCash := int64(0), int64(0), int64(0), int64(0), int64(0)
	for _, row := range data.Transactions {
		if row.AccountID != account.ID || !row.Date.After(from) || row.Date.After(to) {
			continue
		}
		amount := row.Amount
		if amount < 0 && row.Type != "transfer" && row.Type != "manual_adjustment" {
			amount = -amount
		}
		switch row.Type {
		case "opening_balance", "deposit":
			externalCash += amount
		case "withdrawal":
			externalCash -= amount
		case "transfer":
			externalCash += amount
		case "interest", "dividend":
			income += amount
		case "fee":
			fees -= amount
		case "manual_adjustment":
			adjustments += amount
		}
	}
	for _, row := range data.PositionEvents {
		if row.accountID == account.ID && row.tradeDate.After(from) && !row.tradeDate.After(to) {
			tradeCash += row.CashEffect
		}
	}
	instruments := map[uuid.UUID]bool{}
	for id := range start.Positions {
		instruments[id] = true
	}
	for id := range end.Positions {
		instruments[id] = true
	}
	quantityMovement, priceMovement, currencyMovement := int64(0), int64(0), int64(0)
	complete := start.Complete && end.Complete
	for instrumentID := range instruments {
		startPosition := start.Positions[instrumentID]
		endPosition := end.Positions[instrumentID]
		startQuantity := cloneRat(startPosition.Quantity)
		endQuantity := cloneRat(endPosition.Quantity)
		if startQuantity.Sign() == 0 && endQuantity.Sign() == 0 {
			continue
		}
		baseline := startPosition.Price
		conversionDate := from
		if baseline == nil {
			baseline = endPosition.Price
			conversionDate = to
		}
		if baseline == nil || startQuantity.Sign() > 0 && startPosition.Price == nil || endQuantity.Sign() > 0 && endPosition.Price == nil {
			complete = false
			continue
		}
		quantityDelta := new(big.Rat).Sub(endQuantity, startQuantity)
		quantityQuote, valueErr := decimalProductMinor(canonicalRat(quantityDelta), baseline.Price, baseline.Currency)
		if valueErr != nil {
			return PositionMovementAttributionRead{}, valueErr
		}
		quantityValue, found, conversionErr := convertChartMinor(quantityQuote, baseline.Currency, account.Currency, data.Rates, conversionDate)
		if conversionErr != nil {
			return PositionMovementAttributionRead{}, conversionErr
		}
		if !found {
			complete = false
			continue
		}
		priceValue := int64(0)
		if startPosition.Price != nil && endPosition.Price != nil {
			startPrice, startOK := new(big.Rat).SetString(startPosition.Price.Price)
			endPrice, endOK := new(big.Rat).SetString(endPosition.Price.Price)
			if !startOK || !endOK {
				return PositionMovementAttributionRead{}, fmt.Errorf("parse stored position price")
			}
			priceDelta := new(big.Rat).Sub(endPrice, startPrice)
			priceQuote, priceErr := decimalProductMinor(canonicalRat(endQuantity), canonicalRat(priceDelta), endPosition.Price.Currency)
			if priceErr != nil {
				return PositionMovementAttributionRead{}, priceErr
			}
			priceValue, found, conversionErr = convertChartMinor(priceQuote, endPosition.Price.Currency, account.Currency, data.Rates, from)
			if conversionErr != nil {
				return PositionMovementAttributionRead{}, conversionErr
			}
			if !found {
				complete = false
				continue
			}
		}
		quantityMovement += quantityValue
		priceMovement += priceValue
		currencyMovement += endPosition.Value - startPosition.Value - quantityValue - priceValue
	}
	change := end.Total - start.Total
	attributed := externalCash + income + fees + adjustments + tradeCash + quantityMovement + priceMovement + currencyMovement
	return PositionMovementAttributionRead{
		From: from.Format(time.RFC3339), To: to.Format(time.RFC3339), StartValueMinor: strconv.FormatInt(start.Total, 10),
		EndValueMinor: strconv.FormatInt(end.Total, 10), ChangeMinor: strconv.FormatInt(change, 10),
		ExternalCashMinor: strconv.FormatInt(externalCash, 10), IncomeMinor: strconv.FormatInt(income, 10),
		FeesMinor: strconv.FormatInt(fees, 10), CashAdjustmentsMinor: strconv.FormatInt(adjustments, 10),
		InternalTradeCashMinor: strconv.FormatInt(tradeCash, 10), QuantityMovementMinor: strconv.FormatInt(quantityMovement, 10),
		PriceMovementMinor: strconv.FormatInt(priceMovement, 10), CurrencyMovementMinor: strconv.FormatInt(currencyMovement, 10),
		UnattributedMinor: strconv.FormatInt(change-attributed, 10), Complete: complete, Methodology: "position_bridge_v1",
		ReturnStatus: "unavailable", ReturnMessage: "Annualized return is unavailable until cash-flow-aware TWR methodology is implemented.",
	}, nil
}

func chartSourceDates(data chartData) []time.Time {
	dates := []time.Time{}
	for _, row := range data.Transactions {
		dates = append(dates, row.Date)
	}
	for _, row := range data.Valuations {
		dates = append(dates, row.Date)
	}
	for _, row := range data.PositionEvents {
		dates = append(dates, row.tradeDate)
	}
	for _, row := range data.Prices {
		dates = append(dates, row.EffectiveDate)
	}
	return uniqueChartDates(dates)
}

func chartSourceDatesForAccount(data chartData, accountID uuid.UUID) []time.Time {
	dates := []time.Time{}
	instruments := map[uuid.UUID]bool{}
	for _, row := range data.Transactions {
		if row.AccountID == accountID {
			dates = append(dates, row.Date)
		}
	}
	for _, row := range data.Valuations {
		if row.AccountID == accountID {
			dates = append(dates, row.Date)
		}
	}
	for _, row := range data.PositionEvents {
		if row.accountID == accountID {
			dates = append(dates, row.tradeDate)
			instruments[row.instrumentID] = true
		}
	}
	for _, row := range data.Prices {
		if instruments[row.InstrumentID] {
			dates = append(dates, row.EffectiveDate)
		}
	}
	return uniqueChartDates(dates)
}

func uniqueChartDates(values []time.Time) []time.Time {
	sort.Slice(values, func(i, j int) bool { return values[i].Before(values[j]) })
	result := []time.Time{}
	seen := map[string]bool{}
	for _, value := range values {
		date := dateOnlyUTC(value)
		key := date.Format(time.DateOnly)
		if !seen[key] {
			result = append(result, date)
			seen[key] = true
		}
	}
	return result
}

func validChartRange(value string) bool {
	return value == "1m" || value == "3m" || value == "6m" || value == "1y" || value == "all"
}
func endOfChartDay(value time.Time) time.Time {
	return dateOnlyUTC(value).Add(24*time.Hour - time.Nanosecond)
}
func allHistoryComplete(values []HistoricalPointRead) bool {
	for _, value := range values {
		if !value.Complete {
			return false
		}
	}
	return true
}
func sumMap(values map[string]int64) int64 {
	total := int64(0)
	for _, value := range values {
		total += value
	}
	return total
}

func goalProjection(goal GoalRead, now time.Time) []GoalProjectionPointRead {
	if goal.Plan == nil || goal.ValueIncomplete {
		return []GoalProjectionPointRead{}
	}
	current, currentOK := new(big.Int).SetString(goal.CurrentAmountMinor, 10)
	target, targetOK := new(big.Int).SetString(goal.TargetAmountMinor, 10)
	contribution, contributionOK := new(big.Int).SetString(goal.Plan.PlannedContributionMinor, 10)
	targetDate, dateErr := time.Parse(time.DateOnly, goal.TargetDate)
	startDate := dateOnlyUTC(now)
	if !currentOK || !targetOK || !contributionOK || dateErr != nil || !targetDate.After(startDate) {
		return []GoalProjectionPointRead{}
	}
	months := monthsBetweenChart(startDate, targetDate)
	step := (months + 23) / 24
	if step < 1 {
		step = 1
	}
	points := []GoalProjectionPointRead{}
	for month := 0; month <= months; month += step {
		points = append(points, goalProjectionPoint(goal, current, target, contribution, startDate, month))
	}
	if len(points) == 0 || points[len(points)-1].Date[:10] != startDate.AddDate(0, months, 0).Format(time.DateOnly) {
		points = append(points, goalProjectionPoint(goal, current, target, contribution, startDate, months))
	}
	return points
}

func goalProjectionPoint(goal GoalRead, current, target, contribution *big.Int, start time.Time, months int) GoalProjectionPointRead {
	value := new(big.Rat).SetInt(current)
	contributions := new(big.Int).Set(current)
	monthlyRate := new(big.Rat).SetFrac(big.NewInt(int64(goal.AssumedAnnualReturnBPS)), big.NewInt(120000))
	factor := new(big.Rat).Add(big.NewRat(1, 1), monthlyRate)
	planStart, _ := time.Parse(time.DateOnly, goal.Plan.StartDate)
	var planEnd time.Time
	if goal.Plan.EndDate != nil {
		planEnd, _ = time.Parse(time.DateOnly, *goal.Plan.EndDate)
	}
	for month := 1; month <= months; month++ {
		value.Mul(value, factor)
		date := start.AddDate(0, month, 0)
		if !date.Before(planStart) && (planEnd.IsZero() || !date.After(planEnd)) {
			value.Add(value, new(big.Rat).SetInt(contribution))
			contributions.Add(contributions, contribution)
		}
	}
	projected, _ := roundedRatInt64(value)
	return GoalProjectionPointRead{Date: start.AddDate(0, months, 0).Format(time.RFC3339), ProjectedMinor: strconv.FormatInt(projected, 10),
		ContributionsMinor: contributions.String(), TargetMinor: target.String()}
}

func monthsBetweenChart(start, end time.Time) int {
	months := (end.Year()-start.Year())*12 + int(end.Month()-start.Month())
	if end.Day() < start.Day() {
		months--
	}
	if months < 0 {
		return 0
	}
	return months
}
