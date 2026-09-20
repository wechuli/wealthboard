package service

import (
	"errors"
	"math"
	"math/big"
	"testing"
)

func TestAccountConversionExactDecimalTotals(t *testing.T) {
	quantity, err := canonicalDecimal("1.234567890123456789", false, false, "quantity")
	if err != nil {
		t.Fatalf("canonical quantity: %v", err)
	}
	price, err := canonicalDecimal("10.005", false, false, "unit price")
	if err != nil {
		t.Fatalf("canonical price: %v", err)
	}
	minor, err := decimalProductMinor(quantity, price, "USD")
	if err != nil {
		t.Fatalf("position value: %v", err)
	}
	if quantity != "1.234567890123456789" || price != "10.005" || minor != 1235 {
		t.Fatalf("exact decimal result = %q * %q => %d", quantity, price, minor)
	}

	projected, err := checkedInt64(new(big.Int).Add(big.NewInt(65), big.NewInt(minor)))
	if err != nil || projected != 1300 {
		t.Fatalf("projected total = %d, err=%v", projected, err)
	}
}

func TestAccountConversionRejectsUnsafeMinorTotals(t *testing.T) {
	_, err := checkedInt64(new(big.Int).Add(big.NewInt(math.MaxInt64), big.NewInt(1)))
	if !errors.Is(err, ErrInvestmentMutationValidation) {
		t.Fatalf("unsafe total error = %v, want validation", err)
	}
	converted := accountConversionError(err)
	if !errors.Is(converted, ErrAccountConversionValidation) {
		t.Fatalf("converted error = %v, want account conversion validation", converted)
	}
}
