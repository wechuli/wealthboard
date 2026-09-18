// Package domain contains pure financial rules. Callers must supply already
// owner-scoped data; this package neither authorizes requests nor accesses storage.
package domain

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
)

const MaxDecimalLength = 80

var (
	ErrDecimal   = errors.New("enter a bounded plain decimal")
	ErrRange     = errors.New("amount is outside the supported range")
	plainDecimal = regexp.MustCompile(`^-?[0-9]+(?:\.[0-9]+)?$`)
)

// CanonicalDecimal rejects exponents, non-finite numbers, separators and plus
// signs. The 80-byte limit applies before trimming, bounding parsing work.
func CanonicalDecimal(input string) (string, error) {
	if len(input) > MaxDecimalLength {
		return "", ErrDecimal
	}
	value := strings.TrimSpace(input)
	if !plainDecimal.MatchString(value) {
		return "", ErrDecimal
	}
	negative := strings.HasPrefix(value, "-")
	value = strings.TrimPrefix(value, "-")
	parts := strings.SplitN(value, ".", 2)
	whole := strings.TrimLeft(parts[0], "0")
	if whole == "" {
		whole = "0"
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = strings.TrimRight(parts[1], "0")
	}
	value = whole
	if fraction != "" {
		value += "." + fraction
	}
	if negative && value != "0" {
		value = "-" + value
	}
	return value, nil
}

func decimalRat(input string) (*big.Rat, error) {
	canonical, err := CanonicalDecimal(input)
	if err != nil {
		return nil, err
	}
	value, ok := new(big.Rat).SetString(canonical)
	if !ok {
		return nil, ErrDecimal
	}
	return value, nil
}

func pow10(exponent int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(exponent)), nil)
}

// halfUp rounds ties away from zero, including negative monetary values.
func halfUp(value *big.Rat) *big.Int {
	numerator := new(big.Int).Abs(value.Num())
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(numerator, value.Denom(), remainder)
	if remainder.Lsh(remainder, 1).Cmp(value.Denom()) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if value.Sign() < 0 {
		quotient.Neg(quotient)
	}
	return quotient
}

// decimalContext reproduces Decimal.js's default precision=20, ROUND_HALF_UP
// after EACH arithmetic operation, not merely the final monetary boundary.
func decimalContext(value *big.Rat) *big.Rat {
	if value.Sign() == 0 {
		return new(big.Rat)
	}
	n := new(big.Int).Abs(value.Num())
	d := value.Denom()
	exponent := len(n.String()) - len(d.String())
	if exponent >= 0 {
		if n.Cmp(new(big.Int).Mul(d, pow10(exponent))) < 0 {
			exponent--
		}
	} else if new(big.Int).Mul(n, pow10(-exponent)).Cmp(d) < 0 {
		exponent--
	}
	scale := 19 - exponent
	factor := new(big.Rat).SetInt(pow10(absInt(scale)))
	scaled := new(big.Rat).Set(value)
	if scale >= 0 {
		scaled.Mul(scaled, factor)
	} else {
		scaled.Quo(scaled, factor)
	}
	result := new(big.Rat).SetInt(halfUp(scaled))
	if scale >= 0 {
		return result.Quo(result, factor)
	}
	return result.Mul(result, factor)
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
