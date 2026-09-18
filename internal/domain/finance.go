package domain

import (
	"errors"
	"math/big"
	"sort"
)

var ErrEvent = errors.New("invalid financial event")

type TransactionType string

func TransactionEffect(kind TransactionType, amount Minor) (Minor, error) {
	value := big.NewInt(int64(amount))
	switch kind {
	case "opening_balance", "deposit", "interest", "dividend", "capital_gain", "purchase", "liability_increase":
		value.Abs(value)
	case "withdrawal", "capital_loss", "fee", "sale", "liability_payment":
		value.Abs(value).Neg(value)
	case "manual_adjustment", "transfer":
	default:
		return 0, ErrEvent
	}
	return checkedMinor(value)
}

type FinancialEvent struct {
	Kind        string          `json:"kind"`
	Date        string          `json:"date"`
	CreatedAt   string          `json:"createdAt"`
	Type        TransactionType `json:"type,omitempty"`
	AmountMinor Minor           `json:"amountMinor,omitempty"`
	ValueMinor  Minor           `json:"valueMinor,omitempty"`
}

// ReplayBalance copies input; valuations replace balances, never cash flow.
// Ties use transactions before valuations, preserving input order within a kind.
// Source dates/createdAt must be uniformly formatted UTC strings. Wide running
// sums preserve bigint semantics, with an int64 check at the returned boundary.
func ReplayBalance(events []FinancialEvent, throughDate string) (Minor, error) {
	ordered := make([]FinancialEvent, 0, len(events))
	for _, event := range events {
		if throughDate == "" || event.Date <= throughDate {
			ordered = append(ordered, event)
		}
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := ordered[i], ordered[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if a.CreatedAt != b.CreatedAt {
			return a.CreatedAt < b.CreatedAt
		}
		return a.Kind == "transaction" && b.Kind == "valuation"
	})
	balance := new(big.Int)
	for _, event := range ordered {
		switch event.Kind {
		case "valuation":
			balance.SetInt64(int64(event.ValueMinor))
		case "transaction":
			effect, err := TransactionEffect(event.Type, event.AmountMinor)
			if err != nil {
				return 0, err
			}
			balance.Add(balance, big.NewInt(int64(effect)))
		default:
			return 0, ErrEvent
		}
	}
	return checkedMinor(balance)
}

type FlowEntry struct {
	Type        TransactionType `json:"type"`
	AmountMinor Minor           `json:"amountMinor"`
}

type FlowMetrics struct {
	Contributions  Minor `json:"contributions"`
	Withdrawals    Minor `json:"withdrawals"`
	TransfersIn    Minor `json:"transfersIn"`
	TransfersOut   Minor `json:"transfersOut"`
	Interest       Minor `json:"interest"`
	Dividends      Minor `json:"dividends"`
	Fees           Minor `json:"fees"`
	RealizedGrowth Minor `json:"realizedGrowth"`
}

func CalculateFlowMetrics(entries []FlowEntry) (FlowMetrics, error) {
	sums := [8]big.Int{}
	for _, entry := range entries {
		if _, err := TransactionEffect(entry.Type, entry.AmountMinor); err != nil {
			return FlowMetrics{}, err
		}
		amount := new(big.Int).Abs(big.NewInt(int64(entry.AmountMinor)))
		index := -1
		switch entry.Type {
		case "opening_balance", "deposit", "purchase":
			index = 0
		case "withdrawal", "sale":
			index = 1
		case "transfer":
			index = 2
			if entry.AmountMinor < 0 {
				index = 3
			}
		case "interest":
			index = 4
		case "dividend":
			index = 5
		case "fee":
			index = 6
		case "capital_gain":
			index = 7
		case "capital_loss":
			index = 7
			amount.Neg(amount)
		}
		if index >= 0 {
			sums[index].Add(&sums[index], amount)
		}
	}
	result := FlowMetrics{}
	fields := []*Minor{&result.Contributions, &result.Withdrawals, &result.TransfersIn, &result.TransfersOut, &result.Interest, &result.Dividends, &result.Fees, &result.RealizedGrowth}
	for i, field := range fields {
		value, err := checkedMinor(&sums[i])
		if err != nil {
			return FlowMetrics{}, err
		}
		*field = value
	}
	return result, nil
}

type Holding struct {
	ValueMinor  Minor `json:"valueMinor"`
	IsLiability bool  `json:"isLiability"`
	Included    *bool `json:"included,omitempty"`
}

type NetWorthTotals struct {
	Assets      Minor `json:"assets"`
	Liabilities Minor `json:"liabilities"`
	NetWorth    Minor `json:"netWorth"`
}

func CalculateNetWorthTotals(holdings []Holding) (NetWorthTotals, error) {
	assets, liabilities := new(big.Int), new(big.Int)
	for _, holding := range holdings {
		if holding.Included != nil && !*holding.Included {
			continue
		}
		total := assets
		if holding.IsLiability {
			total = liabilities
		}
		total.Add(total, big.NewInt(int64(holding.ValueMinor)))
	}
	a, err := checkedMinor(assets)
	if err != nil {
		return NetWorthTotals{}, err
	}
	l, err := checkedMinor(liabilities)
	if err != nil {
		return NetWorthTotals{}, err
	}
	n, err := checkedMinor(new(big.Int).Sub(assets, liabilities))
	if err != nil {
		return NetWorthTotals{}, err
	}
	return NetWorthTotals{a, l, n}, nil
}
