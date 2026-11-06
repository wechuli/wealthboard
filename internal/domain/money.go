package domain

import (
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

var (
	ErrInvalidMinorUnits = errors.New("minor units must be a whole number")
	ErrInvalidAmount     = errors.New("invalid amount")

	decimalAmountPattern = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)
)

// CurrencyExponent is the number of minor-unit decimal places for a currency.
func CurrencyExponent(currency string) int {
	switch NormalizeCurrency(currency) {
	case "BHD", "KWD", "OMR":
		return 3
	case "BIF", "JPY", "RWF", "UGX":
		return 0
	default:
		return 2
	}
}

// FormatMinorUnits writes an integer minor-unit amount as an exact decimal string with
// the currency's precision, for example ("-1250", "KES") → "-12.50".
func FormatMinorUnits(minor, currency string) (string, error) {
	value, ok := new(big.Int).SetString(strings.TrimSpace(minor), 10)
	if !ok {
		return "", ErrInvalidMinorUnits
	}
	digits := CurrencyExponent(currency)
	negative := value.Sign() < 0
	text := value.Abs(value).String()
	if digits > 0 {
		if len(text) <= digits {
			text = strings.Repeat("0", digits-len(text)+1) + text
		}
		text = text[:len(text)-digits] + "." + text[len(text)-digits:]
	}
	if negative {
		return "-" + text, nil
	}
	return text, nil
}

// ParseDecimalAmount converts an exact decimal string such as "1500.5" into minor
// units for the currency. It rejects grouping separators, exponents, more decimal
// places than the currency allows, and values outside int64.
func ParseDecimalAmount(value, currency string) (int64, error) {
	value = strings.TrimSpace(value)
	if !decimalAmountPattern.MatchString(value) {
		return 0, fmt.Errorf("%w: use a plain decimal number such as 1500.00", ErrInvalidAmount)
	}
	digits := CurrencyExponent(currency)
	whole, fraction, _ := strings.Cut(value, ".")
	if len(fraction) > digits {
		return 0, fmt.Errorf("%w: %s supports at most %d decimal places", ErrInvalidAmount, NormalizeCurrency(currency), digits)
	}
	minor, ok := new(big.Int).SetString(whole+fraction+strings.Repeat("0", digits-len(fraction)), 10)
	if !ok || !minor.IsInt64() {
		return 0, fmt.Errorf("%w: the amount is too large", ErrInvalidAmount)
	}
	return minor.Int64(), nil
}
