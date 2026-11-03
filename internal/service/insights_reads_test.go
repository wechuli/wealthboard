package service

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/google/uuid"
)

func insightsDay(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func insightsTxn(accountID uuid.UUID, kind string, amount int64, currency string, date time.Time) chartTransaction {
	return chartTransaction{ID: uuid.New(), AccountID: accountID, Type: kind, Amount: amount, Currency: currency,
		Date: date, CreatedAt: date.Add(time.Hour), UpdatedAt: date.Add(time.Hour)}
}

func insightsEvent(accountID, instrumentID uuid.UUID, kind, quantity string, date time.Time) chartPositionEvent {
	return chartPositionEvent{positionEventRow: positionEventRow{id: uuid.New(), accountID: accountID, instrumentID: instrumentID,
		eventType: kind, quantity: quantity, tradeDate: date, createdAt: date.Add(time.Hour)}, UpdatedAt: date.Add(time.Hour)}
}

func insightsPrice(instrumentID uuid.UUID, price string, date time.Time) chartPrice {
	return chartPrice{InstrumentID: instrumentID, Currency: "KES", Price: price, EffectiveDate: date, CreatedAt: date}
}

func parseMinor(t *testing.T, value string) int64 {
	t.Helper()
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok || !parsed.IsInt64() {
		t.Fatalf("invalid minor units %q", value)
	}
	return parsed.Int64()
}

var insightsTestSettings = GoalsReportsSettings{BaseCurrency: "KES", Timezone: "UTC", PositionStaleDaysStock: 7, PositionStaleDaysETF: 7, PositionStaleDaysFund: 31}

func flowsFixture() (chartData, uuid.UUID, uuid.UUID, uuid.UUID) {
	savings, wallet, loan := uuid.New(), uuid.New(), uuid.New()
	return chartData{
		Accounts: []chartAccount{
			{ID: savings, Name: "Savings", Currency: "KES", TrackingMode: "balance", IsIncludedInNetWorth: true},
			{ID: wallet, Name: "Wallet", Currency: "KES", TrackingMode: "balance", IsIncludedInNetWorth: true},
			{ID: loan, Name: "Car loan", Currency: "KES", TrackingMode: "balance", IsIncludedInNetWorth: true, IsLiability: true},
		},
		Transactions: []chartTransaction{
			insightsTxn(savings, "opening_balance", 1000, "KES", insightsDay(2026, 1, 5)),
			insightsTxn(loan, "opening_balance", 5000, "KES", insightsDay(2026, 1, 5)),
			insightsTxn(savings, "deposit", 500, "KES", insightsDay(2026, 3, 10)),
			insightsTxn(savings, "interest", 20, "KES", insightsDay(2026, 4, 1)),
			insightsTxn(savings, "fee", 5, "KES", insightsDay(2026, 4, 2)),
			insightsTxn(loan, "liability_payment", 1000, "KES", insightsDay(2026, 4, 15)),
			insightsTxn(savings, "withdrawal", 100, "KES", insightsDay(2026, 5, 1)),
			insightsTxn(savings, "transfer", -300, "KES", insightsDay(2026, 5, 20)),
			insightsTxn(wallet, "transfer", 300, "KES", insightsDay(2026, 5, 20)),
		},
		Valuations: []chartValuation{{ID: uuid.New(), AccountID: savings, Value: 2000, Date: insightsDay(2026, 5, 15), CreatedAt: insightsDay(2026, 5, 15)}},
	}, savings, wallet, loan
}

func assertFlowsReconcile(t *testing.T, report FlowsReportRead) {
	t.Helper()
	start, end := parseMinor(t, report.StartValueMinor), parseMinor(t, report.EndValueMinor)
	bridged := start + parseMinor(t, report.ContributionsMinor) + parseMinor(t, report.IncomeMinor) + parseMinor(t, report.GrowthMinor) -
		parseMinor(t, report.WithdrawalsMinor) - parseMinor(t, report.FeesMinor)
	if bridged != end {
		t.Fatalf("bridge does not reconcile: start %d + flows = %d, end %d (%+v)", start, bridged, end, report)
	}
	totals := map[string]int64{}
	netChange := int64(0)
	for _, month := range report.Months {
		totals["contributions"] += parseMinor(t, month.ContributionsMinor)
		totals["withdrawals"] += parseMinor(t, month.WithdrawalsMinor)
		totals["income"] += parseMinor(t, month.IncomeMinor)
		totals["fees"] += parseMinor(t, month.FeesMinor)
		totals["growth"] += parseMinor(t, month.GrowthMinor)
		monthChange := parseMinor(t, month.NetChangeMinor)
		components := parseMinor(t, month.ContributionsMinor) + parseMinor(t, month.IncomeMinor) + parseMinor(t, month.GrowthMinor) -
			parseMinor(t, month.WithdrawalsMinor) - parseMinor(t, month.FeesMinor)
		if components != monthChange {
			t.Fatalf("month %s components %d != net change %d", month.Month, components, monthChange)
		}
		netChange += monthChange
	}
	for key, want := range map[string]string{"contributions": report.ContributionsMinor, "withdrawals": report.WithdrawalsMinor,
		"income": report.IncomeMinor, "fees": report.FeesMinor, "growth": report.GrowthMinor} {
		if totals[key] != parseMinor(t, want) {
			t.Fatalf("monthly %s sum %d != total %s", key, totals[key], want)
		}
	}
	if netChange != end-start {
		t.Fatalf("monthly net change %d != end-start %d", netChange, end-start)
	}
}

func TestFlowsReportReconcilesExactlyAndClassifiesFlows(t *testing.T) {
	data, _, _, _ := flowsFixture()
	report, err := buildFlowsReport(data, "KES", time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC), "all")
	if err != nil {
		t.Fatalf("flows report: %v", err)
	}
	// Liability payment is a contribution; the liability opening balance is a withdrawal; transfers are excluded.
	if report.BaseCurrency != "KES" || report.Range != "all" || report.From != "2026-01-05" || report.To != "2026-06-30" ||
		report.StartValueMinor != "0" || report.EndValueMinor != "-2000" || report.ContributionsMinor != "2500" ||
		report.IncomeMinor != "20" || report.GrowthMinor != "585" || report.WithdrawalsMinor != "5100" || report.FeesMinor != "5" || !report.Complete {
		t.Fatalf("flows report = %+v", report)
	}
	full := report
	assertFlowsReconcile(t, full)
	if len(full.Months) != 6 || full.Months[0].Month != "2026-01-05" || full.Months[5].Month != "2026-06-01" {
		t.Fatalf("months = %+v", full.Months)
	}
	may := full.Months[4]
	if may.Month != "2026-05-01" || may.WithdrawalsMinor != "100" || may.GrowthMinor != "585" || may.NetChangeMinor != "485" || !may.Complete {
		t.Fatalf("May flows = %+v", may)
	}
	april := full.Months[3]
	if april.ContributionsMinor != "1000" || april.IncomeMinor != "20" || april.FeesMinor != "5" || april.GrowthMinor != "0" {
		t.Fatalf("April flows = %+v", april)
	}
}

func TestFlowsReportShortRangeUsesValueBeforeRangeStart(t *testing.T) {
	data, _, _, _ := flowsFixture()
	report, err := buildFlowsReport(data, "KES", time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC), "1m")
	if err != nil {
		t.Fatalf("flows report: %v", err)
	}
	if report.From != "2026-05-31" || report.StartValueMinor != "-2000" || report.EndValueMinor != "-2000" || report.GrowthMinor != "0" ||
		len(report.Months) != 2 || report.Months[0].Month != "2026-05-31" {
		t.Fatalf("1m flows report = %+v", report)
	}
	assertFlowsReconcile(t, report)
}

func TestFlowsReportMissingFlowRateIsIncomplete(t *testing.T) {
	account := uuid.New()
	data := chartData{
		Accounts:     []chartAccount{{ID: account, Name: "Dollar savings", Currency: "USD", TrackingMode: "balance", IsIncludedInNetWorth: true}},
		Transactions: []chartTransaction{insightsTxn(account, "opening_balance", 100, "USD", insightsDay(2026, 1, 1))},
		Rates:        []chartRate{{Base: "USD", Quote: "KES", Rate: "130", EffectiveDate: insightsDay(2026, 1, 15)}},
	}
	report, err := buildFlowsReport(data, "KES", insightsDay(2026, 2, 1), "all")
	if err != nil {
		t.Fatalf("flows report: %v", err)
	}
	if report.Complete || report.EndValueMinor != "13000" || report.ContributionsMinor != "0" || report.Months[0].Complete {
		t.Fatalf("missing flow rate should make the report incomplete: %+v", report)
	}
	assertFlowsReconcile(t, report)
}

func TestIncomeReportGroupsInterestDividendsAndFees(t *testing.T) {
	data, savings, _, _ := flowsFixture()
	broker, instrument := uuid.New(), uuid.New()
	group := uuid.New()
	fee := int64(7)
	data.Accounts = append(data.Accounts, chartAccount{ID: broker, Name: "Broker", Currency: "USD", TrackingMode: "positions", IsIncludedInNetWorth: true})
	data.Instruments = []chartInstrument{{ID: instrument, Name: "Fictional Fund", Currency: "USD", AssetType: "fund"}}
	dividend := insightsTxn(broker, "dividend", 300, "USD", insightsDay(2026, 6, 1))
	dividend.EventGroupID = &group
	untied := insightsTxn(broker, "dividend", 50, "USD", insightsDay(2026, 6, 2))
	buy := insightsEvent(broker, instrument, "buy", "1", insightsDay(2026, 6, 1))
	buy.EventGroupID, buy.FeeMinor, buy.FeeCurrency, buy.TradeCurrency = &group, &fee, "USD", "USD"
	data.Transactions = append(data.Transactions, dividend, untied)
	data.PositionEvents = []chartPositionEvent{buy}
	data.Prices = []chartPrice{{InstrumentID: instrument, Currency: "USD", Price: "3", EffectiveDate: insightsDay(2026, 6, 1)}}
	data.Rates = []chartRate{{Base: "USD", Quote: "KES", Rate: "100", EffectiveDate: insightsDay(2026, 6, 1)}}

	report, err := buildIncomeReport(data, "KES", insightsDay(2026, 6, 30), "all")
	if err != nil {
		t.Fatalf("income report: %v", err)
	}
	if report.Totals.InterestMinor != "20" || report.Totals.DividendsMinor != "35000" || report.Totals.FeesMinor != "705" || !report.Complete {
		t.Fatalf("income totals = %+v complete=%v", report.Totals, report.Complete)
	}
	if len(report.InterestByAccount) != 1 || report.InterestByAccount[0].AccountID != savings || report.InterestByAccount[0].NativeMinor != "20" ||
		report.InterestByAccount[0].BaseMinor == nil || *report.InterestByAccount[0].BaseMinor != "20" {
		t.Fatalf("interest by account = %+v", report.InterestByAccount)
	}
	if len(report.Dividends) != 2 || report.Dividends[0].InstrumentID == nil || *report.Dividends[0].InstrumentID != instrument ||
		report.Dividends[0].Name != "Fictional Fund" || report.Dividends[0].NativeMinor != "300" || *report.Dividends[0].BaseMinor != "30000" ||
		report.Dividends[1].InstrumentID != nil || report.Dividends[1].NativeMinor != "50" {
		t.Fatalf("dividends = %+v", report.Dividends)
	}
	if len(report.FeesByAccount) != 2 || report.FeesByAccount[0].AccountID != broker || *report.FeesByAccount[0].BaseMinor != "700" ||
		report.FeesByAccount[1].AccountID != savings || report.FeesByAccount[1].NativeMinor != "5" {
		t.Fatalf("fees by account = %+v", report.FeesByAccount)
	}
}

func TestNetWorthStatsHighestYearOverYearAndIncompleteChanges(t *testing.T) {
	kes, usd := uuid.New(), uuid.New()
	data := chartData{
		Accounts: []chartAccount{
			{ID: kes, Name: "Savings", Currency: "KES", TrackingMode: "balance", IsIncludedInNetWorth: true},
			{ID: usd, Name: "Dollar", Currency: "USD", TrackingMode: "balance", IsIncludedInNetWorth: true},
		},
		Transactions: []chartTransaction{
			insightsTxn(kes, "opening_balance", 1000, "KES", insightsDay(2025, 1, 10)),
			insightsTxn(kes, "deposit", 1000, "KES", insightsDay(2025, 6, 1)),
			insightsTxn(usd, "opening_balance", 100, "USD", insightsDay(2025, 8, 15)),
			insightsTxn(kes, "deposit", 500, "KES", insightsDay(2026, 3, 1)),
			insightsTxn(kes, "withdrawal", 1000, "KES", insightsDay(2026, 4, 1)),
		},
		Rates: []chartRate{{Base: "USD", Quote: "KES", Rate: "100", EffectiveDate: insightsDay(2025, 10, 1)}},
	}
	stats, err := buildNetWorthStats(data, "KES", insightsDay(2026, 4, 15))
	if err != nil {
		t.Fatalf("net worth stats: %v", err)
	}
	if stats.Complete || len(stats.Months) != 17 || stats.Months[0].Month != "2025-01-10" || stats.Months[1].Month != "2025-02-01" ||
		stats.Months[16].Month != "2026-04-15" {
		t.Fatalf("stats months = %+v", stats.Months)
	}
	byMonth := map[string]NetWorthMonthRead{}
	for _, month := range stats.Months {
		byMonth[month.Month] = month
	}
	if stats.Months[0].ChangeMinor != nil || byMonth["2025-02-01"].ChangeMinor == nil || *byMonth["2025-02-01"].ChangeMinor != "0" ||
		byMonth["2025-09-01"].Complete || byMonth["2025-09-01"].ChangeMinor != nil || byMonth["2025-10-01"].ChangeMinor != nil ||
		byMonth["2025-11-01"].ChangeMinor == nil || *byMonth["2025-11-01"].ChangeMinor != "0" {
		t.Fatalf("incomplete points must have null changes: %+v", stats.Months)
	}
	if stats.Highest != (NetWorthHighestRead{Date: "2026-03-01", NetWorthMinor: "12500"}) {
		t.Fatalf("highest = %+v", stats.Highest)
	}
	if stats.YearOverYear.FromDate != "2025-04-15" || stats.YearOverYear.ChangeMinor == nil || *stats.YearOverYear.ChangeMinor != "10500" ||
		stats.YearOverYear.ChangePercent == nil || *stats.YearOverYear.ChangePercent != "1050.0" {
		t.Fatalf("year over year = %+v", stats.YearOverYear)
	}
	if stats.SinceStart.StartDate != "2025-01-10" || stats.SinceStart.StartMinor != "1000" || stats.SinceStart.ChangeMinor != "10500" ||
		stats.SinceStart.ChangePercent == nil || *stats.SinceStart.ChangePercent != "1050.0" {
		t.Fatalf("since start = %+v", stats.SinceStart)
	}

	empty, err := buildNetWorthStats(chartData{}, "KES", insightsDay(2026, 4, 15))
	if err != nil || len(empty.Months) != 0 || empty.Highest.NetWorthMinor != "0" || empty.SinceStart.ChangeMinor != "0" ||
		empty.YearOverYear.ChangePercent != nil || !empty.Complete {
		t.Fatalf("empty stats = %+v err=%v", empty, err)
	}
}

func TestAccountComparisonStatusesAndExactReturn(t *testing.T) {
	savings, recent, empty, broker, loan := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	data := chartData{
		Accounts: []chartAccount{
			{ID: savings, Name: "A savings", Currency: "KES", TrackingMode: "balance"},
			{ID: recent, Name: "B recent", Currency: "KES", TrackingMode: "balance"},
			{ID: empty, Name: "C empty", Currency: "KES", TrackingMode: "balance"},
			{ID: broker, Name: "D broker", Currency: "KES", TrackingMode: "positions"},
			{ID: loan, Name: "E loan", Currency: "KES", TrackingMode: "balance", IsLiability: true},
		},
		Transactions: []chartTransaction{
			insightsTxn(savings, "opening_balance", 100000, "KES", insightsDay(2025, 1, 1)),
			insightsTxn(savings, "deposit", 20000, "KES", insightsDay(2025, 10, 1)),
			insightsTxn(savings, "withdrawal", 10000, "KES", insightsDay(2026, 2, 1)),
			insightsTxn(savings, "interest", 300, "KES", insightsDay(2026, 3, 1)),
			insightsTxn(savings, "fee", 50, "KES", insightsDay(2026, 3, 2)),
			insightsTxn(recent, "opening_balance", 1000, "KES", insightsDay(2026, 5, 1)),
			insightsTxn(broker, "deposit", 5000, "KES", insightsDay(2025, 1, 1)),
			insightsTxn(loan, "opening_balance", 9000, "KES", insightsDay(2025, 1, 1)),
		},
		Valuations: []chartValuation{
			{ID: uuid.New(), AccountID: savings, Value: 125000, Date: insightsDay(2026, 6, 30), CreatedAt: insightsDay(2026, 6, 30)},
			{ID: uuid.New(), AccountID: recent, Value: 1010, Date: insightsDay(2026, 6, 30), CreatedAt: insightsDay(2026, 6, 30)},
		},
	}
	comparison, err := buildAccountComparison(data, insightsDay(2026, 7, 1), "1y")
	if err != nil {
		t.Fatalf("account comparison: %v", err)
	}
	if comparison.From != "2025-07-01" || comparison.To != "2026-07-01" || len(comparison.Rows) != 5 {
		t.Fatalf("comparison = %+v", comparison)
	}
	rows := comparison.Rows
	// gain = 125000 − 100000 − 20000 + 10000 = 15000; capital = 100000 + 10000 − 5000 = 105000;
	// 15000 / 105000 × 365 / 365 × 10000 = 1428.57… → 1429 bps.
	if rows[0].ReturnStatus != "ok" || rows[0].AnnualizedReturnBPS == nil || *rows[0].AnnualizedReturnBPS != 1429 || rows[0].PeriodDays != 365 ||
		*rows[0].StartMinor != "100000" || *rows[0].EndMinor != "125000" || rows[0].DepositsMinor != "20000" ||
		rows[0].WithdrawalsMinor != "10000" || rows[0].NetIncomeMinor != "250" {
		t.Fatalf("savings row = %+v", rows[0])
	}
	// Opened 2026-05-01: start 0, 61 days, gain 10 on capital 500 → 10/500 × 365/61 × 10000 = 1196.7 → 1197.
	if rows[1].ReturnStatus != "short_period" || rows[1].AnnualizedReturnBPS == nil || *rows[1].AnnualizedReturnBPS != 1197 ||
		rows[1].PeriodDays != 61 || *rows[1].StartMinor != "0" || rows[1].DepositsMinor != "1000" {
		t.Fatalf("recent row = %+v", rows[1])
	}
	if rows[2].ReturnStatus != "short_period" || rows[2].AnnualizedReturnBPS != nil {
		t.Fatalf("zero-capital row = %+v", rows[2])
	}
	if rows[3].ReturnStatus != "methodology_unavailable" || rows[3].AnnualizedReturnBPS != nil || *rows[3].EndMinor != "5000" {
		t.Fatalf("position row = %+v", rows[3])
	}
	if rows[4].ReturnStatus != "not_applicable" || rows[4].AnnualizedReturnBPS != nil || !rows[4].IsLiability {
		t.Fatalf("liability row = %+v", rows[4])
	}
	if bps, status := simpleAnnualizedReturn(chartAccount{TrackingMode: "balance"}, 100, 110, 0, 0, 365, false); bps != nil || status != "incomplete" {
		t.Fatalf("incomplete return = %v %s", bps, status)
	}
}

func TestAccountSummariesFreshnessSparklineAndCompleteness(t *testing.T) {
	now := time.Date(2026, 3, 31, 12, 0, 0, 0, time.UTC)
	today := dateOnlyUTC(now)
	savings, house, fresh, stale, missing, dollar := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	freshStock, staleStock, unpricedFund := uuid.New(), uuid.New(), uuid.New()
	opened := insightsDay(2025, 12, 15)
	archivedAt := insightsDay(2026, 3, 1)
	opening := insightsTxn(savings, "opening_balance", 1000, "KES", opened)
	opening.UpdatedAt = time.Date(2026, 1, 2, 8, 0, 0, 0, time.UTC)
	deposit := insightsTxn(savings, "deposit", 500, "KES", insightsDay(2026, 2, 10))
	goalID := uuid.New()
	data := chartData{
		Accounts: []chartAccount{
			{ID: savings, Name: "Savings", Currency: "KES", TrackingMode: "balance", OpenedAt: &opened, CreatedAt: opened},
			{ID: house, Name: "House", Currency: "KES", TrackingMode: "balance", CreatedAt: opened},
			{ID: fresh, Name: "Fresh broker", Currency: "KES", TrackingMode: "positions", CreatedAt: opened},
			{ID: stale, Name: "Stale broker", Currency: "KES", TrackingMode: "positions", CreatedAt: opened},
			{ID: missing, Name: "Missing broker", Currency: "KES", TrackingMode: "positions", CreatedAt: opened},
			{ID: dollar, Name: "Dollar", Currency: "USD", TrackingMode: "balance", CreatedAt: opened, ArchivedAt: &archivedAt},
		},
		Transactions: []chartTransaction{opening, deposit, insightsTxn(dollar, "opening_balance", 100, "USD", opened)},
		Valuations:   []chartValuation{{ID: uuid.New(), AccountID: house, Value: 900000, Date: today.AddDate(0, 0, -400), CreatedAt: today.AddDate(0, 0, -400)}},
		PositionEvents: []chartPositionEvent{
			insightsEvent(fresh, freshStock, "opening_position", "2", opened),
			insightsEvent(stale, staleStock, "opening_position", "1", opened),
			insightsEvent(missing, unpricedFund, "opening_position", "3", opened),
		},
		Prices: []chartPrice{insightsPrice(freshStock, "50", today.AddDate(0, 0, -3)), insightsPrice(staleStock, "10", today.AddDate(0, 0, -10))},
		Instruments: []chartInstrument{
			{ID: freshStock, Name: "Fresh stock", Currency: "KES", AssetType: "stock"},
			{ID: staleStock, Name: "Stale stock", Currency: "KES", AssetType: "stock"},
			{ID: unpricedFund, Name: "Unpriced fund", Currency: "KES", AssetType: "fund"},
		},
	}
	goals := []GoalRecord{{ID: goalID, Name: "Emergency fund", LinkedAccountID: &savings}}
	summaries, err := buildAccountSummaries(data, goals, insightsTestSettings, now)
	if err != nil {
		t.Fatalf("summaries: %v", err)
	}
	byID := map[uuid.UUID]AccountSummaryRead{}
	for _, summary := range summaries {
		byID[summary.AccountID] = summary
	}
	if len(summaries) != 6 {
		t.Fatalf("summaries = %+v", summaries)
	}
	saving := byID[savings]
	wantSparkline := []AccountHistoryPointRead{{Date: "2025-12-31", ValueMinor: "1000", Complete: true}, {Date: "2026-01-31", ValueMinor: "1000", Complete: true},
		{Date: "2026-02-28", ValueMinor: "1500", Complete: true}, {Date: "2026-03-31", ValueMinor: "1500", Complete: true}}
	if len(saving.Sparkline) != len(wantSparkline) {
		t.Fatalf("sparkline = %+v", saving.Sparkline)
	}
	for index := range wantSparkline {
		if saving.Sparkline[index] != wantSparkline[index] {
			t.Fatalf("sparkline = %+v", saving.Sparkline)
		}
	}
	if saving.Freshness != "not_applicable" || saving.AsOfDate != "2026-02-10" || saving.LastUpdatedAt != "2026-02-10T01:00:00Z" ||
		saving.PositionCount != nil || !saving.ValueComplete || len(saving.LinkedGoals) != 1 || saving.LinkedGoals[0].ID != goalID {
		t.Fatalf("savings summary = %+v", saving)
	}
	if byID[house].Freshness != "stale" || byID[house].AsOfDate != today.AddDate(0, 0, -400).Format(time.DateOnly) {
		t.Fatalf("house summary = %+v", byID[house])
	}
	if summary := byID[fresh]; summary.Freshness != "fresh" || summary.PositionCount == nil || *summary.PositionCount != 1 ||
		summary.AsOfDate != today.AddDate(0, 0, -3).Format(time.DateOnly) || !summary.ValueComplete {
		t.Fatalf("fresh summary = %+v", summary)
	}
	if byID[stale].Freshness != "stale" {
		t.Fatalf("stale summary = %+v", byID[stale])
	}
	if summary := byID[missing]; summary.Freshness != "missing" || summary.ValueComplete || len(summary.MissingPrices) != 1 ||
		summary.MissingPrices[0] != (InstrumentRefRead{InstrumentID: unpricedFund, Name: "Unpriced fund"}) {
		t.Fatalf("missing summary = %+v", summary)
	}
	if summary := byID[dollar]; summary.ValueComplete || len(summary.MissingCurrencies) != 1 || summary.MissingCurrencies[0] != "USD" {
		t.Fatalf("archived dollar summary = %+v", summary)
	}
}

func TestAttentionReportsKindsAndDedupesInstruments(t *testing.T) {
	now := insightsDay(2026, 3, 31)
	dollar, first, second := uuid.New(), uuid.New(), uuid.New()
	unpriced, stalePriced := uuid.New(), uuid.New()
	goalID := uuid.New()
	data := chartData{
		Accounts: []chartAccount{
			{ID: dollar, Name: "Dollar savings", Currency: "USD", TrackingMode: "balance", IsIncludedInNetWorth: true},
			{ID: first, Name: "Broker one", Currency: "KES", TrackingMode: "positions", IsIncludedInNetWorth: true},
			{ID: second, Name: "Broker two", Currency: "KES", TrackingMode: "positions", IsIncludedInNetWorth: true},
		},
		Transactions: []chartTransaction{insightsTxn(dollar, "opening_balance", 100, "USD", insightsDay(2026, 1, 10))},
		PositionEvents: []chartPositionEvent{
			insightsEvent(first, unpriced, "opening_position", "1", insightsDay(2026, 2, 1)),
			insightsEvent(second, unpriced, "opening_position", "2", insightsDay(2026, 1, 20)),
			insightsEvent(first, stalePriced, "opening_position", "1", insightsDay(2026, 2, 1)),
		},
		Prices: []chartPrice{insightsPrice(stalePriced, "10", insightsDay(2026, 3, 1))},
		Rates:  []chartRate{{Base: "EUR", Quote: "KES", Rate: "140", EffectiveDate: insightsDay(2026, 2, 1)}},
		Instruments: []chartInstrument{
			{ID: unpriced, Name: "Unpriced fund", Symbol: "UPF", Currency: "KES", AssetType: "fund"},
			{ID: stalePriced, Name: "Old stock", Symbol: "OLD", Currency: "KES", AssetType: "stock"},
		},
	}
	goals := []GoalRecord{{ID: goalID, Name: "Car", LinkedAccountID: &dollar}}
	alerts := []GoalAlertRead{{GoalID: goalID, GoalName: "Car", TargetDate: "2027-01-01"}}
	summary, err := buildAttention(data, insightsTestSettings, []string{"USD", "EUR"}, goals, alerts, now)
	if err != nil {
		t.Fatalf("attention: %v", err)
	}
	if summary.TotalsComplete || len(summary.Items) != 5 {
		t.Fatalf("attention = %+v", summary)
	}
	ids := []string{}
	for _, item := range summary.Items {
		ids = append(ids, item.ID)
	}
	wantIDs := []string{"missing_rate:USD", "missing_price:" + unpriced.String(), "stale_price:" + stalePriced.String(), "stale_rate:EUR", "goal_behind:" + goalID.String()}
	for index := range wantIDs {
		if ids[index] != wantIDs[index] {
			t.Fatalf("attention ids = %v, want %v", ids, wantIDs)
		}
	}
	rate := summary.Items[0]
	if rate.Severity != "warning" || rate.Pair == nil || *rate.Pair != (CurrencyPairRead{Base: "USD", Quote: "KES"}) || rate.Since != "2026-01-10" ||
		len(rate.AccountIDs) != 1 || rate.AccountIDs[0] != dollar || rate.Fix.Href != "/settings/currencies?add=USD-KES" ||
		rate.Title != "USD → KES exchange rate missing" {
		t.Fatalf("missing rate item = %+v", rate)
	}
	price := summary.Items[1]
	accounts := []uuid.UUID{first, second}
	sortUUIDs(accounts)
	if price.Kind != "missing_price" || len(price.AccountIDs) != 2 || price.AccountIDs[0] != accounts[0] || price.AccountIDs[1] != accounts[1] ||
		price.Since != "2026-01-20" || price.Fix.Href != "/instruments/"+unpriced.String()+"?addPrice=1" || *price.InstrumentID != unpriced {
		t.Fatalf("missing price item = %+v", price)
	}
	if stalePrice := summary.Items[2]; stalePrice.Severity != "warning" || stalePrice.Since != "2026-03-01" || stalePrice.Title != "OLD price is 30 days old" {
		t.Fatalf("stale price item = %+v", stalePrice)
	}
	if staleRate := summary.Items[3]; staleRate.Severity != "info" || len(staleRate.AccountIDs) != 0 || staleRate.Since != "2026-02-01" {
		t.Fatalf("stale rate item = %+v", staleRate)
	}
	if goal := summary.Items[4]; goal.Severity != "info" || goal.Fix.Href != "/goals/"+goalID.String() || len(goal.AccountIDs) != 1 || *goal.GoalID != goalID {
		t.Fatalf("goal item = %+v", goal)
	}
}

func TestAccountExtrasWeightsAndStaleRanges(t *testing.T) {
	now := insightsDay(2026, 2, 20)
	broker, cashOnly, instrumentA, instrumentB := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	data := chartData{
		Accounts: []chartAccount{
			{ID: broker, Name: "Broker", Currency: "KES", TrackingMode: "positions"},
			{ID: cashOnly, Name: "Cash", Currency: "KES", TrackingMode: "balance"},
		},
		Transactions: []chartTransaction{insightsTxn(broker, "deposit", 100000, "KES", insightsDay(2026, 1, 1))},
		PositionEvents: []chartPositionEvent{
			insightsEvent(broker, instrumentA, "opening_position", "10", insightsDay(2026, 1, 1)),
			insightsEvent(broker, instrumentB, "opening_position", "5", insightsDay(2026, 1, 1)),
		},
		Prices: []chartPrice{
			insightsPrice(instrumentA, "100", insightsDay(2026, 2, 5)), insightsPrice(instrumentA, "90", insightsDay(2026, 1, 1)),
			insightsPrice(instrumentA, "95", insightsDay(2026, 1, 20)), insightsPrice(instrumentB, "400", insightsDay(2026, 2, 19)),
		},
		Instruments: []chartInstrument{
			{ID: instrumentA, Name: "Alpha", Symbol: "ALP", Currency: "KES", AssetType: "stock"},
			{ID: instrumentB, Name: "Beta", Symbol: "BET", Currency: "KES", AssetType: "etf"},
		},
	}
	goalID := uuid.New()
	extras, err := buildAccountExtras(data, []GoalRecord{{ID: goalID, Name: "House", LinkedAccountID: &broker}}, insightsTestSettings, broker, now)
	if err != nil {
		t.Fatalf("extras: %v", err)
	}
	if len(extras.Weights) != 2 || *extras.Weights[0].WeightPercent != "25.0" || *extras.Weights[1].WeightPercent != "50.0" ||
		extras.CashWeightPercent == nil || *extras.CashWeightPercent != "25.0" || len(extras.LinkedGoals) != 1 {
		t.Fatalf("weights = %+v cash=%v", extras.Weights, extras.CashWeightPercent)
	}
	alpha := extras.PriceHistory[0]
	wantRanges := []DateRangeRead{{From: "2026-01-09", To: "2026-01-20"}, {From: "2026-01-28", To: "2026-02-05"}, {From: "2026-02-13", To: "2026-02-20"}}
	if alpha.InstrumentID != instrumentA || alpha.StaleThresholdDays != 7 || len(alpha.Points) != 3 || alpha.Points[0].Date != "2026-01-01" ||
		alpha.Points[2].Price != "100" || len(alpha.StaleRanges) != 3 {
		t.Fatalf("alpha history = %+v", alpha)
	}
	for index := range wantRanges {
		if alpha.StaleRanges[index] != wantRanges[index] {
			t.Fatalf("alpha stale ranges = %+v", alpha.StaleRanges)
		}
	}
	if len(extras.PriceHistory[1].StaleRanges) != 0 {
		t.Fatalf("beta stale ranges = %+v", extras.PriceHistory[1].StaleRanges)
	}

	unpriced := uuid.New()
	data.Instruments = append(data.Instruments, chartInstrument{ID: unpriced, Name: "Gamma", Currency: "KES", AssetType: "fund"})
	data.PositionEvents = append(data.PositionEvents, insightsEvent(broker, unpriced, "opening_position", "1", insightsDay(2026, 1, 1)))
	incomplete, err := buildAccountExtras(data, nil, insightsTestSettings, broker, now)
	if err != nil {
		t.Fatalf("incomplete extras: %v", err)
	}
	for _, weight := range incomplete.Weights {
		if weight.WeightPercent != nil {
			t.Fatalf("incomplete holdings must not report weights: %+v", incomplete.Weights)
		}
	}
	if incomplete.CashWeightPercent != nil {
		t.Fatalf("incomplete cash weight = %v", *incomplete.CashWeightPercent)
	}
	balance, err := buildAccountExtras(data, nil, insightsTestSettings, cashOnly, now)
	if err != nil || len(balance.Weights) != 0 || len(balance.PriceHistory) != 0 || balance.CashWeightPercent != nil {
		t.Fatalf("balance extras = %+v err=%v", balance, err)
	}
	if _, err := buildAccountExtras(data, nil, insightsTestSettings, uuid.New(), now); !errors.Is(err, ErrGoalsReportsNotFound) {
		t.Fatalf("unknown account extras error = %v", err)
	}
}

func TestInstrumentHoldingsListsCurrentActiveHolders(t *testing.T) {
	now := insightsDay(2026, 2, 20)
	first, second, closed, archived := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	priced, unpriced := uuid.New(), uuid.New()
	archivedAt := insightsDay(2026, 2, 1)
	data := chartData{
		Accounts: []chartAccount{
			{ID: first, Name: "A broker", Currency: "KES", TrackingMode: "positions"},
			{ID: second, Name: "B broker", Currency: "USD", TrackingMode: "positions"},
			{ID: closed, Name: "C broker", Currency: "KES", TrackingMode: "positions"},
			{ID: archived, Name: "D broker", Currency: "KES", TrackingMode: "positions", ArchivedAt: &archivedAt},
		},
		PositionEvents: []chartPositionEvent{
			insightsEvent(first, priced, "opening_position", "10", insightsDay(2026, 1, 1)),
			insightsEvent(second, priced, "opening_position", "2.5", insightsDay(2026, 1, 1)),
			insightsEvent(closed, priced, "opening_position", "5", insightsDay(2026, 1, 1)),
			insightsEvent(closed, priced, "sell", "5", insightsDay(2026, 1, 10)),
			insightsEvent(archived, priced, "opening_position", "7", insightsDay(2026, 1, 1)),
			insightsEvent(first, unpriced, "opening_position", "1", insightsDay(2026, 1, 1)),
		},
		Prices: []chartPrice{insightsPrice(priced, "100", insightsDay(2026, 1, 1))},
		Instruments: []chartInstrument{
			{ID: priced, Name: "Priced", Currency: "KES", AssetType: "fund"},
			{ID: unpriced, Name: "Unpriced", Currency: "KES", AssetType: "stock"},
		},
	}
	holdings, err := buildInstrumentHoldings(data, insightsTestSettings, priced, now)
	if err != nil {
		t.Fatalf("holdings: %v", err)
	}
	if holdings.StaleThresholdDays != 31 || len(holdings.StaleRanges) != 1 || holdings.StaleRanges[0] != (DateRangeRead{From: "2026-02-02", To: "2026-02-20"}) ||
		len(holdings.Holdings) != 2 {
		t.Fatalf("holdings = %+v", holdings)
	}
	if holding := holdings.Holdings[0]; holding.AccountID != first || holding.Quantity != "10" || *holding.ValueMinor != "100000" || holding.Currency != "KES" {
		t.Fatalf("first holding = %+v", holding)
	}
	if holding := holdings.Holdings[1]; holding.AccountID != second || holding.Quantity != "2.5" || *holding.ValueMinor != "25000" {
		t.Fatalf("second holding = %+v", holding)
	}
	missing, err := buildInstrumentHoldings(data, insightsTestSettings, unpriced, now)
	if err != nil || len(missing.Holdings) != 1 || missing.Holdings[0].ValueMinor != nil || len(missing.StaleRanges) != 0 {
		t.Fatalf("unpriced holdings = %+v err=%v", missing, err)
	}
	if _, err := buildInstrumentHoldings(data, insightsTestSettings, uuid.New(), now); !errors.Is(err, ErrGoalsReportsNotFound) {
		t.Fatalf("unknown instrument error = %v", err)
	}
}

func TestPercentOfFixedRoundsHalfAwayFromZero(t *testing.T) {
	for _, test := range []struct {
		numerator, denominator int64
		want                   string
	}{{1, 3, "33.3"}, {2, 3, "66.7"}, {-1, 8, "-12.5"}, {1, 2000, "0.1"}, {-1, 2000, "-0.1"}, {0, 5, "0.0"}, {5, -4, "-125.0"}} {
		got := percentOfFixed(big.NewInt(test.numerator), big.NewInt(test.denominator), 1)
		if got == nil || *got != test.want {
			t.Errorf("percentOfFixed(%d, %d) = %v, want %s", test.numerator, test.denominator, got, test.want)
		}
	}
	if percentOfFixed(big.NewInt(1), big.NewInt(0), 1) != nil {
		t.Error("zero denominator must return nil")
	}
}

func TestActivityEffectMinorFollowsReplaySigns(t *testing.T) {
	for _, test := range []struct {
		row  ActivityRow
		want *string
	}{
		{ActivityRow{Kind: "transaction", TrackingMode: "balance", Type: "withdrawal", AmountMinor: 500}, minorPointer(-500)},
		{ActivityRow{Kind: "transaction", TrackingMode: "balance", Type: "liability_payment", AmountMinor: 200}, minorPointer(-200)},
		{ActivityRow{Kind: "transaction", TrackingMode: "balance", Type: "transfer", AmountMinor: -300}, minorPointer(-300)},
		{ActivityRow{Kind: "transaction", TrackingMode: "positions", Type: "fee", AmountMinor: 25}, minorPointer(-25)},
		{ActivityRow{Kind: "transaction", TrackingMode: "positions", Type: "dividend", AmountMinor: 75}, minorPointer(75)},
		{ActivityRow{Kind: "position", TrackingMode: "positions", Type: "buy", AmountMinor: -10500}, minorPointer(-10500)},
		{ActivityRow{Kind: "valuation", Type: "valuation", AmountMinor: 9000}, nil},
		{ActivityRow{Kind: "price", Type: "security_price"}, nil},
	} {
		got := activityEffectMinor(test.row)
		if (got == nil) != (test.want == nil) || got != nil && *got != *test.want {
			t.Errorf("effect(%+v) = %v, want %v", test.row, got, test.want)
		}
	}
}

func TestActivityFeedRejectsForeignAccountAndForwardsFilters(t *testing.T) {
	owner, foreign, accountID := uuid.New(), uuid.New(), uuid.New()
	repository := &fakeCoreReadRepository{ownerID: owner, foreignAccountID: accountID, activityRows: []ActivityRow{{
		Kind: "transaction", ID: uuid.New(), AccountID: accountID, TrackingMode: "balance", Type: "fee", AmountMinor: 40,
		ActivityDate: insightsDay(2026, 1, 1),
	}}}
	reads := NewCoreReadService(repository)
	if _, err := reads.ActivityFeed(context.Background(), foreign, ActivityFilter{AccountID: &accountID}); !errors.Is(err, ErrCoreReadNotFound) {
		t.Fatalf("foreign account feed error = %v", err)
	}
	if repository.activityCalls != 0 {
		t.Fatalf("feed queried after ownership miss: %d", repository.activityCalls)
	}
	page, err := reads.ActivityFeed(context.Background(), owner, ActivityFilter{Kind: "transaction", Query: "fee"})
	if err != nil {
		t.Fatalf("owner feed: %v", err)
	}
	if repository.feedUserID != owner || repository.feedFilter.Kind != "transaction" || repository.feedFilter.Query != "fee" || repository.feedFilter.Page.Limit != DefaultReadLimit {
		t.Fatalf("feed repository call = %s %+v", repository.feedUserID, repository.feedFilter)
	}
	if len(page.Items) != 1 || page.Items[0].EffectMinor == nil || *page.Items[0].EffectMinor != "-40" || page.Items[0].AmountMinor != "40" {
		t.Fatalf("feed page = %+v", page)
	}
}

func TestAccountActivityAddsEffectFromOwnedAccountMode(t *testing.T) {
	owner, accountID := uuid.New(), uuid.New()
	repository := &fakeCoreReadRepository{ownerID: owner, foreignAccountID: accountID, activityRows: []ActivityRow{
		{Kind: "transaction", ID: uuid.New(), AccountID: accountID, Type: "withdrawal", AmountMinor: 90, ActivityDate: insightsDay(2026, 1, 2)},
		{Kind: "valuation", ID: uuid.New(), AccountID: accountID, Type: "valuation", AmountMinor: 900, ActivityDate: insightsDay(2026, 1, 1)},
	}}
	page, err := NewCoreReadService(repository).Activity(context.Background(), owner, ActivityFilter{AccountID: &accountID})
	if err != nil {
		t.Fatalf("activity: %v", err)
	}
	if page.Items[0].EffectMinor == nil || *page.Items[0].EffectMinor != "-90" || page.Items[1].EffectMinor != nil {
		t.Fatalf("activity effects = %+v", page.Items)
	}
}

func TestNormalizeInsightsRange(t *testing.T) {
	if value, err := normalizeInsightsRange(""); err != nil || value != "1y" {
		t.Fatalf("default range = %q %v", value, err)
	}
	if _, err := normalizeInsightsRange("2y"); !errors.Is(err, ErrInsightsInvalidRange) {
		t.Fatalf("invalid range error = %v", err)
	}
}
