package domain

import (
	"errors"
	"testing"
)

func TestFormatMinorUnitsUsesCurrencyPrecision(t *testing.T) {
	for _, test := range []struct {
		minor, currency, want string
	}{
		{"1050", "KES", "10.50"},
		{"5", "usd", "0.05"},
		{"-1250", "KES", "-12.50"},
		{"0", "KES", "0.00"},
		{"1500", "JPY", "1500"},
		{"-7", "UGX", "-7"},
		{"1234", "KWD", "1.234"},
		{"9223372036854775807", "USD", "92233720368547758.07"},
		{"123456789012345678901234567890", "EUR", "1234567890123456789012345678.90"},
	} {
		got, err := FormatMinorUnits(test.minor, test.currency)
		if err != nil || got != test.want {
			t.Errorf("FormatMinorUnits(%q, %q) = %q, %v; want %q", test.minor, test.currency, got, err, test.want)
		}
	}
	for _, invalid := range []string{"", "1.5", "1e3", "abc", "--1"} {
		if _, err := FormatMinorUnits(invalid, "KES"); !errors.Is(err, ErrInvalidMinorUnits) {
			t.Errorf("FormatMinorUnits(%q) error = %v", invalid, err)
		}
	}
}

func TestCurrencyExponentMatchesSupportedMinorUnits(t *testing.T) {
	for currency, want := range map[string]int{"KES": 2, "USD": 2, "JPY": 0, "BIF": 0, "RWF": 0, "UGX": 0, "BHD": 3, "KWD": 3, "OMR": 3, " kwd ": 3} {
		if got := CurrencyExponent(currency); got != want {
			t.Errorf("CurrencyExponent(%q) = %d, want %d", currency, got, want)
		}
	}
}
