package service

import (
	"context"
	"fmt"
	"math/big"
	"strconv"
	"time"

	"github.com/google/uuid"
)

type PerformanceMonthRead struct {
	Month         string  `json:"month"`
	StartMinor    string  `json:"startMinor"`
	EndMinor      string  `json:"endMinor"`
	NetFlowMinor  string  `json:"netFlowMinor"`
	ReturnMinor   string  `json:"returnMinor"`
	ReturnPercent *string `json:"returnPercent"`
	Complete      bool    `json:"complete"`
}

type PerformanceReportRead struct {
	BaseCurrency               string                     `json:"baseCurrency"`
	Range                      string                     `json:"range"`
	From                       string                     `json:"from"`
	To                         string                     `json:"to"`
	StartValueMinor            string                     `json:"startValueMinor"`
	EndValueMinor              string                     `json:"endValueMinor"`
	ContributionsMinor         string                     `json:"contributionsMinor"`
	WithdrawalsMinor           string                     `json:"withdrawalsMinor"`
	NetContributionsMinor      string                     `json:"netContributionsMinor"`
	IncomeMinor                string                     `json:"incomeMinor"`
	FeesMinor                  string                     `json:"feesMinor"`
	GrowthMinor                string                     `json:"growthMinor"`
	InvestmentReturnMinor      string                     `json:"investmentReturnMinor"`
	TimeWeightedReturnPercent  *string                    `json:"timeWeightedReturnPercent"`
	MoneyWeightedReturnPercent *string                    `json:"moneyWeightedReturnPercent"`
	Methodology                string                     `json:"methodology"`
	Complete                   bool                       `json:"complete"`
	Notes                      []string                   `json:"notes"`
	Months                     []PerformanceMonthRead     `json:"months"`
	Accounts                   []AccountComparisonRowRead `json:"accounts"`
}

const performanceMethodology = "Investment return is the change in net worth minus net contributions (contributions less withdrawals; transfers between your own accounts are not contributions). " +
	"Time-weighted return chains each month's Modified Dietz return, so the timing and size of contributions don't affect it. " +
	"Money-weighted return is the Modified Dietz return for the whole period with each month's flows weighted from mid-month, so it reflects when money was added. " +
	"Both are period returns, not annualized; per-account rows carry Wealthboard's annualized return where available."

// PerformanceReport separates contributions and withdrawals from investment returns for a
// period, from the same base-currency flow bridge as the cash flow report.
func (service *InsightsService) PerformanceReport(ctx context.Context, userID uuid.UUID, rangeName string) (PerformanceReportRead, error) {
	flows, err := service.FlowsReport(ctx, userID, rangeName)
	if err != nil {
		return PerformanceReportRead{}, err
	}
	comparison, err := service.AccountComparison(ctx, userID, rangeName)
	if err != nil {
		return PerformanceReportRead{}, err
	}
	parse := func(value string) *big.Rat {
		parsed, ok := new(big.Rat).SetString(value)
		if !ok {
			return new(big.Rat)
		}
		return parsed
	}
	start, end := parse(flows.StartValueMinor), parse(flows.EndValueMinor)
	contributions, withdrawals := parse(flows.ContributionsMinor), parse(flows.WithdrawalsMinor)
	netFlow := new(big.Rat).Sub(contributions, withdrawals)
	investmentReturn := new(big.Rat).Sub(new(big.Rat).Sub(end, start), netFlow)
	report := PerformanceReportRead{
		BaseCurrency: flows.BaseCurrency, Range: flows.Range, From: flows.From, To: flows.To,
		StartValueMinor: flows.StartValueMinor, EndValueMinor: flows.EndValueMinor,
		ContributionsMinor: flows.ContributionsMinor, WithdrawalsMinor: flows.WithdrawalsMinor,
		NetContributionsMinor: ratMinor(netFlow), IncomeMinor: flows.IncomeMinor, FeesMinor: flows.FeesMinor,
		GrowthMinor: flows.GrowthMinor, InvestmentReturnMinor: ratMinor(investmentReturn),
		Methodology: performanceMethodology, Complete: flows.Complete, Notes: []string{}, Accounts: comparison.Rows,
		Months: make([]PerformanceMonthRead, 0, len(flows.Months)),
	}
	if !flows.Complete {
		report.Notes = append(report.Notes, "Some values are missing exchange rates, so returns cover only convertible accounts.")
	}
	half := big.NewRat(1, 2)
	chained := big.NewRat(1, 1)
	twrAvailable := len(flows.Months) > 0
	monthStart := new(big.Rat).Set(start)
	months := int64(len(flows.Months))
	weighted := new(big.Rat).Set(start)
	for index, month := range flows.Months {
		flow := new(big.Rat).Sub(parse(month.ContributionsMinor), parse(month.WithdrawalsMinor))
		monthEnd := new(big.Rat).Add(monthStart, parse(month.NetChangeMinor))
		gain := new(big.Rat).Sub(new(big.Rat).Sub(monthEnd, monthStart), flow)
		denominator := new(big.Rat).Add(monthStart, new(big.Rat).Mul(flow, half))
		point := PerformanceMonthRead{Month: month.Month, StartMinor: ratMinor(monthStart), EndMinor: ratMinor(monthEnd),
			NetFlowMinor: ratMinor(flow), ReturnMinor: ratMinor(gain), Complete: month.Complete}
		switch {
		case denominator.Sign() > 0:
			rate := new(big.Rat).Quo(gain, denominator)
			point.ReturnPercent = percent(rate)
			chained.Mul(chained, new(big.Rat).Add(big.NewRat(1, 1), rate))
		case gain.Sign() != 0:
			twrAvailable = false
		}
		// Each month's flows count from mid-month for the rest of the period.
		weight := big.NewRat(2*(months-int64(index))-1, 2*months)
		weighted.Add(weighted, new(big.Rat).Mul(flow, weight))
		report.Months = append(report.Months, point)
		monthStart = monthEnd
	}
	if twrAvailable {
		report.TimeWeightedReturnPercent = percent(new(big.Rat).Sub(chained, big.NewRat(1, 1)))
	} else {
		report.Notes = append(report.Notes, "Time-weighted return isn't available because a month had a gain or loss with no invested value.")
	}
	if weighted.Sign() > 0 {
		report.MoneyWeightedReturnPercent = percent(new(big.Rat).Quo(investmentReturn, weighted))
	} else {
		report.Notes = append(report.Notes, "Money-weighted return isn't available because no value was invested during the period.")
	}
	return report, nil
}

func ratMinor(value *big.Rat) string {
	if value.IsInt() {
		return value.Num().String()
	}
	return value.FloatString(0)
}

func percent(rate *big.Rat) *string {
	text := new(big.Rat).Mul(rate, big.NewRat(100, 1)).FloatString(2)
	return &text
}

type TaxAccountRead struct {
	AccountID           uuid.UUID `json:"accountId"`
	AccountName         string    `json:"accountName"`
	Currency            string    `json:"currency"`
	InterestMinor       string    `json:"interestMinor"`
	DividendsMinor      string    `json:"dividendsMinor"`
	CapitalGainsMinor   string    `json:"capitalGainsMinor"`
	CapitalLossesMinor  string    `json:"capitalLossesMinor"`
	FeesMinor           string    `json:"feesMinor"`
	WithholdingTaxMinor string    `json:"withholdingTaxMinor"`
	SaleProceedsMinor   string    `json:"saleProceedsMinor"`
	SaleCount           int       `json:"saleCount"`
}

type TaxRecordRead struct {
	ID          uuid.UUID `json:"id"`
	AccountID   uuid.UUID `json:"accountId"`
	AccountName string    `json:"accountName"`
	Category    string    `json:"category"`
	Type        string    `json:"type"`
	Date        string    `json:"date"`
	AmountMinor string    `json:"amountMinor"`
	Currency    string    `json:"currency"`
	Description string    `json:"description,omitempty"`
	Instrument  string    `json:"instrument,omitempty"`
	Quantity    string    `json:"quantity,omitempty"`
	UnitPrice   string    `json:"unitPrice,omitempty"`
}

type TaxReportRead struct {
	Year      int              `json:"year"`
	From      string           `json:"from"`
	To        string           `json:"to"`
	Accounts  []TaxAccountRead `json:"accounts"`
	Records   []TaxRecordRead  `json:"records"`
	Truncated bool             `json:"truncated"`
	Notes     []string         `json:"notes"`
}

// withholding matches fee descriptions that mention tax; prefix qualifies the column in joins.
func withholding(prefix string) string {
	column := "COALESCE(" + prefix + "description,'')"
	return "(" + column + " ILIKE '%withholding%' OR " + column + " ILIKE '%wht%' OR " + column + " ILIKE '%tax%')"
}

// TaxReport lists a calendar year's recorded income, recorded realized gains and losses,
// fees, withholding tax, and sale proceeds in each account's currency. It reports what is
// recorded; it does not calculate gains from lots or determine any tax obligation.
func (service *FeatureReads) TaxReport(ctx context.Context, userID uuid.UUID, year int, accountID *uuid.UUID) (TaxReportRead, error) {
	if year < 1900 || year > 9999 {
		return TaxReportRead{}, validation("year must be a four-digit year")
	}
	from := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(year, time.December, 31, 0, 0, 0, 0, time.UTC)
	var account any
	if accountID != nil {
		account = *accountID
		var exists bool
		if err := service.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE user_id=$1 AND id=$2)`, userID, *accountID).Scan(&exists); err != nil {
			return TaxReportRead{}, fmt.Errorf("check account: %w", err)
		}
		if !exists {
			return TaxReportRead{}, ErrCoreReadNotFound
		}
	}
	report := TaxReportRead{Year: year, From: from.Format(time.DateOnly), To: to.Format(time.DateOnly), Accounts: []TaxAccountRead{}, Records: []TaxRecordRead{}, Notes: []string{
		"These are amounts recorded in Wealthboard, in each account's currency. They are not a tax calculation or a statement of what is owed.",
		"Capital gains and losses are only those recorded as capital_gain or capital_loss transactions; gains on sales are not calculated from purchase lots.",
		"Withholding tax is identified from fee transactions whose description mentions tax or withholding; review the listed records.",
	}}
	rows, err := service.db.QueryContext(ctx, `
WITH activity AS (
    SELECT account_id,
           SUM(CASE WHEN type='interest' THEN ABS(amount_minor) ELSE 0 END) AS interest,
           SUM(CASE WHEN type='dividend' THEN ABS(amount_minor) ELSE 0 END) AS dividends,
           SUM(CASE WHEN type='capital_gain' THEN ABS(amount_minor) ELSE 0 END) AS gains,
           SUM(CASE WHEN type='capital_loss' THEN ABS(amount_minor) ELSE 0 END) AS losses,
           SUM(CASE WHEN type='fee' AND NOT `+withholding("")+` THEN ABS(amount_minor) ELSE 0 END) AS fees,
           SUM(CASE WHEN type='fee' AND `+withholding("")+` THEN ABS(amount_minor) ELSE 0 END) AS withholding
    FROM transactions WHERE user_id=$1 AND transaction_date BETWEEN $2 AND $3 AND ($4::UUID IS NULL OR account_id=$4)
    GROUP BY account_id
), sales AS (
    SELECT account_id, SUM(cash_effect_minor) AS proceeds, count(*) AS sale_count
    FROM position_events WHERE user_id=$1 AND type='sell' AND trade_date BETWEEN $2 AND $3 AND ($4::UUID IS NULL OR account_id=$4)
    GROUP BY account_id
)
SELECT a.id,a.name,a.currency,
       COALESCE(activity.interest,0)::TEXT,COALESCE(activity.dividends,0)::TEXT,COALESCE(activity.gains,0)::TEXT,
       COALESCE(activity.losses,0)::TEXT,COALESCE(activity.fees,0)::TEXT,COALESCE(activity.withholding,0)::TEXT,
       COALESCE(sales.proceeds,0)::TEXT,COALESCE(sales.sale_count,0)
FROM accounts a
LEFT JOIN activity ON activity.account_id=a.id
LEFT JOIN sales ON sales.account_id=a.id
WHERE a.user_id=$1 AND (activity.account_id IS NOT NULL OR sales.account_id IS NOT NULL)
ORDER BY a.name,a.id`, userID, from, to, account)
	if err != nil {
		return TaxReportRead{}, fmt.Errorf("load tax totals: %w", err)
	}
	for rows.Next() {
		var line TaxAccountRead
		if err := rows.Scan(&line.AccountID, &line.AccountName, &line.Currency, &line.InterestMinor, &line.DividendsMinor, &line.CapitalGainsMinor,
			&line.CapitalLossesMinor, &line.FeesMinor, &line.WithholdingTaxMinor, &line.SaleProceedsMinor, &line.SaleCount); err != nil {
			rows.Close()
			return TaxReportRead{}, fmt.Errorf("scan tax totals: %w", err)
		}
		report.Accounts = append(report.Accounts, line)
	}
	if err := rows.Close(); err != nil {
		return TaxReportRead{}, err
	}
	const maxRecords = 500
	records, err := service.db.QueryContext(ctx, `
SELECT * FROM (
    SELECT t.id,t.account_id,a.name,
           CASE WHEN t.type='fee' AND `+withholding("t.")+` THEN 'withholding_tax' WHEN t.type IN ('capital_gain','capital_loss') THEN 'realized_gain' ELSE 'income' END,
           t.type,t.transaction_date,t.amount_minor,t.currency,COALESCE(t.description,''),'','',''
    FROM transactions t JOIN accounts a ON a.user_id=t.user_id AND a.id=t.account_id
    WHERE t.user_id=$1 AND t.transaction_date BETWEEN $2 AND $3 AND ($4::UUID IS NULL OR t.account_id=$4)
      AND (t.type IN ('interest','dividend','capital_gain','capital_loss') OR (t.type='fee' AND `+withholding("t.")+`))
    UNION ALL
    SELECT e.id,e.account_id,a.name,'sale','sell',e.trade_date,e.cash_effect_minor,a.currency,COALESCE(e.description,''),
           i.name,e.quantity::TEXT,COALESCE(e.unit_price::TEXT,'')
    FROM position_events e JOIN accounts a ON a.user_id=e.user_id AND a.id=e.account_id
    JOIN investment_instruments i ON i.user_id=e.user_id AND i.id=e.instrument_id
    WHERE e.user_id=$1 AND e.type='sell' AND e.trade_date BETWEEN $2 AND $3 AND ($4::UUID IS NULL OR e.account_id=$4)
) records ORDER BY 6,3,1 LIMIT $5`, userID, from, to, account, maxRecords+1)
	if err != nil {
		return TaxReportRead{}, fmt.Errorf("load tax records: %w", err)
	}
	defer records.Close()
	for records.Next() {
		var record TaxRecordRead
		var date time.Time
		var amount int64
		if err := records.Scan(&record.ID, &record.AccountID, &record.AccountName, &record.Category, &record.Type, &date, &amount, &record.Currency,
			&record.Description, &record.Instrument, &record.Quantity, &record.UnitPrice); err != nil {
			return TaxReportRead{}, fmt.Errorf("scan tax record: %w", err)
		}
		record.Date, record.AmountMinor = date.Format(time.DateOnly), strconv.FormatInt(amount, 10)
		report.Records = append(report.Records, record)
	}
	if len(report.Records) > maxRecords {
		report.Records, report.Truncated = report.Records[:maxRecords], true
	}
	return report, records.Err()
}
