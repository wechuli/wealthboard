package domain

import (
	"errors"
	"math/big"
	"strings"
)

var ErrMissingExchangeRate = errors.New("no effective exchange rate is configured")

type ExchangeRate struct {
	BaseCurrency  string `json:"baseCurrency"`
	QuoteCurrency string `json:"quoteCurrency"`
	Rate          string `json:"rate"`
	EffectiveDate string `json:"effectiveDate,omitempty"`
}

type SelectedRate struct {
	Rate    ExchangeRate
	Inverse bool
}

// SelectExchangeRate expects canonical currency codes and uniformly formatted
// UTC timestamps/date strings, as do the TypeScript helpers. Blank dates are
// legacy undated rates. Equal dates prefer direct, then first input occurrence.
func SelectExchangeRate(from, to string, rates []ExchangeRate, asOf string) *SelectedRate {
	var direct, inverse *ExchangeRate
	for i := range rates {
		rate := &rates[i]
		if asOf != "" && rate.EffectiveDate != "" && rate.EffectiveDate > asOf {
			continue
		}
		if rate.BaseCurrency == from && rate.QuoteCurrency == to &&
			(direct == nil || rate.EffectiveDate > direct.EffectiveDate) {
			direct = rate
		}
		if rate.BaseCurrency == to && rate.QuoteCurrency == from &&
			(inverse == nil || rate.EffectiveDate > inverse.EffectiveDate) {
			inverse = rate
		}
	}
	if direct != nil && (inverse == nil || direct.EffectiveDate >= inverse.EffectiveDate) {
		return &SelectedRate{Rate: *direct}
	}
	if inverse != nil {
		return &SelectedRate{Rate: *inverse, Inverse: true}
	}
	return nil
}

func ConvertMinor(amount Minor, from, to string, rates []ExchangeRate, asOf string) (Minor, error) {
	from = strings.ToUpper(strings.TrimSpace(from))
	to = strings.ToUpper(strings.TrimSpace(to))
	fromDigits, err := CurrencyDigits(from)
	if err != nil {
		return 0, err
	}
	toDigits, err := CurrencyDigits(to)
	if err != nil {
		return 0, err
	}
	// Like TypeScript, same-currency conversion needs no rate. Unlike its raw
	// helper, unsupported currency codes never bypass validation.
	if from == to {
		return amount, nil
	}
	selected := SelectExchangeRate(from, to, rates, asOf)
	if selected == nil {
		return 0, ErrMissingExchangeRate
	}
	rate, err := decimalRat(selected.Rate.Rate)
	if err != nil || rate.Sign() <= 0 || strings.HasPrefix(strings.TrimSpace(selected.Rate.Rate), "-") {
		return 0, ErrDecimal
	}
	major := decimalContext(new(big.Rat).SetFrac(big.NewInt(int64(amount)), pow10(fromDigits)))
	target := new(big.Rat)
	if selected.Inverse {
		target.Quo(major, rate)
	} else {
		target.Mul(major, rate)
	}
	target = decimalContext(target)
	target = decimalContext(new(big.Rat).Mul(target, new(big.Rat).SetInt(pow10(toDigits))))
	return checkedMinor(halfUp(target))
}
