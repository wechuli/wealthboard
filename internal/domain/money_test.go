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

func TestParseDecimalAmountIsExact(t *testing.T) {
	for _, test := range []struct {
		value, currency string
		want            int64
	}{
		{"1500.50", "KES", 150050},
		{"1500.5", "KES", 150050},
		{"1500", "KES", 150000},
		{" 0.05 ", "USD", 5},
		{"-12.50", "KES", -1250},
		{"1500", "JPY", 1500},
		{"1.234", "KWD", 1234},
		{"92233720368547758.07", "USD", 9223372036854775807},
	} {
		got, err := ParseDecimalAmount(test.value, test.currency)
		if err != nil || got != test.want {
			t.Errorf("ParseDecimalAmount(%q, %q) = %d, %v; want %d", test.value, test.currency, got, err, test.want)
		}
	}
	for _, test := range []struct{ value, currency string }{
		{"1,500.00", "KES"}, {"1e3", "KES"}, {"12.345", "KES"}, {"1.5", "JPY"}, {"", "KES"},
		{"abc", "KES"}, {".5", "KES"}, {"5.", "KES"}, {"92233720368547758.08", "USD"}, {"+5", "KES"},
	} {
		if _, err := ParseDecimalAmount(test.value, test.currency); !errors.Is(err, ErrInvalidAmount) {
			t.Errorf("ParseDecimalAmount(%q, %q) error = %v", test.value, test.currency, err)
		}
	}
}
