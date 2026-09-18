package domain

import (
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type parityFixtures struct {
	CurrencyGroups map[string]string
	Money          []struct {
		Name, Input, Currency, Expected string
		Digits                          *int
		Error                           bool
	}
	Format []struct {
		Amount             Minor
		Currency, Expected string
		Digits             *int
	}
	Decimals []struct {
		Input, Expected string
		Error           bool
	}
	Signs []struct {
		Type               TransactionType
		Positive, Negative string
	}
	Conversions []struct {
		Name                         string
		Amount                       Minor
		From, To, AsOf               string
		Rates                        []ExchangeRate
		Expected, Selected           string
		Inverse, Error, GoRangeError bool
	}
	Replays []struct {
		Name, ThroughDate, Expected string
		Events                      []FinancialEvent
	}
	Flows struct {
		Entries  []FlowEntry
		Expected FlowMetrics
	}
	NetWorth struct {
		Holdings []Holding
		Expected NetWorthTotals
	}
}

func loadFixtures(t *testing.T) parityFixtures {
	t.Helper()
	data, err := os.ReadFile("../../tests/fixtures/go-financial-parity.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures parityFixtures
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	return fixtures
}

func assertResult(t *testing.T, result, expected string, err error, wantError bool) {
	t.Helper()
	if wantError {
		if err == nil {
			t.Fatalf("expected rejection, got %q", result)
		}
		return
	}
	if err != nil || result != expected {
		t.Fatalf("got %q (%v), want %q", result, err, expected)
	}
}

func TestSharedParity(t *testing.T) {
	fixtures := loadFixtures(t)
	t.Run("currencies", func(t *testing.T) {
		for expected, group := range fixtures.CurrencyGroups {
			digits, _ := strconv.Atoi(expected)
			if currencyGroups[digits] != group {
				t.Fatal("catalog differs from shared fixture")
			}
			for _, code := range strings.Fields(group) {
				actual, err := CurrencyDigits(strings.ToLower(code))
				if err != nil || actual != digits {
					t.Fatalf("%s: got %d (%v), want %d", code, actual, err, digits)
				}
			}
		}
	})
	for _, fixture := range fixtures.Money {
		t.Run("money/"+fixture.Name, func(t *testing.T) {
			var result Minor
			var err error
			if fixture.Digits != nil {
				result, err = ParseMoneyDigits(fixture.Input, *fixture.Digits)
			} else {
				result, err = ParseMoney(fixture.Input, fixture.Currency)
			}
			assertResult(t, result.String(), fixture.Expected, err, fixture.Error)
		})
	}
	for _, fixture := range fixtures.Format {
		t.Run("format/"+fixture.Amount.String()+fixture.Currency, func(t *testing.T) {
			var result string
			var err error
			if fixture.Digits != nil {
				result, err = MinorToDecimalDigits(fixture.Amount, *fixture.Digits)
			} else {
				result, err = MinorToDecimalString(fixture.Amount, fixture.Currency)
			}
			assertResult(t, result, fixture.Expected, err, false)
		})
	}
	for _, fixture := range fixtures.Decimals {
		t.Run("decimal/"+fixture.Input, func(t *testing.T) {
			result, err := CanonicalDecimal(fixture.Input)
			assertResult(t, result, fixture.Expected, err, fixture.Error)
		})
	}
	for _, fixture := range fixtures.Signs {
		t.Run("sign/"+string(fixture.Type), func(t *testing.T) {
			for _, test := range []struct {
				amount   Minor
				expected string
			}{
				{123, fixture.Positive}, {-123, fixture.Negative}, {0, "0"},
			} {
				result, err := TransactionEffect(fixture.Type, test.amount)
				assertResult(t, result.String(), test.expected, err, false)
			}
		})
	}
	for _, fixture := range fixtures.Conversions {
		t.Run("conversion/"+fixture.Name, func(t *testing.T) {
			result, err := ConvertMinor(fixture.Amount, fixture.From, fixture.To, fixture.Rates, fixture.AsOf)
			assertResult(t, result.String(), fixture.Expected, err, fixture.Error || fixture.GoRangeError)
			if fixture.GoRangeError && !errors.Is(err, ErrRange) {
				t.Fatal("expected explicit backend int64 range rejection")
			}
			selected := SelectExchangeRate(fixture.From, fixture.To, fixture.Rates, fixture.AsOf)
			if fixture.Selected != "" {
				if selected == nil || selected.Rate.Rate != fixture.Selected || selected.Inverse != fixture.Inverse {
					t.Fatalf("unexpected selected rate: %+v", selected)
				}
			} else if fixture.Error && selected != nil {
				t.Fatal("unexpected future rate")
			}
		})
	}
	for _, fixture := range fixtures.Replays {
		t.Run("replay/"+fixture.Name, func(t *testing.T) {
			original := append([]FinancialEvent{}, fixture.Events...)
			result, err := ReplayBalance(fixture.Events, fixture.ThroughDate)
			assertResult(t, result.String(), fixture.Expected, err, false)
			if !reflect.DeepEqual(original, fixture.Events) {
				t.Fatal("replay mutated input")
			}
		})
	}
	t.Run("flows", func(t *testing.T) {
		result, err := CalculateFlowMetrics(fixtures.Flows.Entries)
		if err != nil || result != fixtures.Flows.Expected {
			t.Fatalf("got %+v (%v), want %+v", result, err, fixtures.Flows.Expected)
		}
	})
	t.Run("net-worth", func(t *testing.T) {
		result, err := CalculateNetWorthTotals(fixtures.NetWorth.Holdings)
		if err != nil || result != fixtures.NetWorth.Expected {
			t.Fatalf("got %+v (%v), want %+v", result, err, fixtures.NetWorth.Expected)
		}
	})
}

func TestBackendBoundaries(t *testing.T) {
	t.Run("JSON strings across int64", func(t *testing.T) {
		for _, text := range []string{"0", "9007199254740991", "9007199254740992", "9223372036854775807", "-9223372036854775808"} {
			value, err := ParseMinor(text)
			assertResult(t, value.String(), text, err, false)
			data, err := json.Marshal(value)
			if err != nil || string(data) != `"`+text+`"` {
				t.Fatalf("invalid JSON %s (%v)", data, err)
			}
			var decoded Minor
			if err := json.Unmarshal(data, &decoded); err != nil || decoded != value {
				t.Fatal("JSON roundtrip failed", err)
			}
		}
	})
	t.Run("reject invalid minor input", func(t *testing.T) {
		for _, input := range []string{"", " 1", "+1", "01", "-0", "1.0", "1e2", "NaN", "9223372036854775808", "-9223372036854775809", strings.Repeat("9", 1000)} {
			if _, err := ParseMinor(input); err == nil {
				t.Fatalf("accepted %q", input)
			}
		}
		for _, input := range []string{`1`, `null`, `1.5`, `true`, `"1.0"`, `"9223372036854775808"`} {
			value := Minor(7)
			if err := json.Unmarshal([]byte(input), &value); err == nil || value != 7 {
				t.Fatalf("invalid JSON changed value: %s", input)
			}
		}
	})
	t.Run("bounded decimals and money", func(t *testing.T) {
		for _, input := range []string{strings.Repeat("0", 81), strings.Repeat("9", 1000), strings.Repeat(" ", 1000) + "1", "1,000", "Infinity", "1/2", "--1", "1 2"} {
			if _, err := CanonicalDecimal(input); err == nil {
				t.Fatal("accepted invalid bounded decimal")
			}
		}
		if _, err := CanonicalDecimal(strings.Repeat("1", 80)); err != nil {
			t.Fatal(err)
		}
		for _, input := range []string{strings.Repeat(",", 256) + "1", strings.Repeat("0", 81)} {
			if _, err := ParseMoney(input, "USD"); err == nil {
				t.Fatal("accepted oversized money")
			}
		}
		for _, digits := range []int{-1, 5, 1000000} {
			if _, err := ParseMoneyDigits("1", digits); err == nil {
				t.Fatal("accepted invalid scale")
			}
			if _, err := MinorToDecimalDigits(1, digits); err == nil {
				t.Fatal("formatted invalid scale")
			}
		}
	})
	t.Run("unknown currencies never default to two digits", func(t *testing.T) {
		for _, currency := range []string{"", "ZZZ", "US", "USDD", "CLF", "UYW"} {
			if _, err := CurrencyDigits(currency); !errors.Is(err, ErrCurrency) {
				t.Fatal(err)
			}
			if _, err := ParseMoney("1", currency); !errors.Is(err, ErrCurrency) {
				t.Fatal(err)
			}
			if _, err := MinorToDecimalString(1, currency); !errors.Is(err, ErrCurrency) {
				t.Fatal(err)
			}
			if _, err := ConvertMinor(1, currency, currency, nil, ""); !errors.Is(err, ErrCurrency) {
				t.Fatal(err)
			}
		}
	})
	t.Run("invalid selected rates", func(t *testing.T) {
		for _, rate := range []string{"0", "-0", "-1", "+1", "1e2", "NaN", "Infinity", "1/2", "1,000", strings.Repeat("1", 81)} {
			rates := []ExchangeRate{{BaseCurrency: "USD", QuoteCurrency: "KES", Rate: rate}}
			for _, currencies := range [][2]string{{"USD", "KES"}, {"KES", "USD"}} {
				if _, err := ConvertMinor(1, currencies[0], currencies[1], rates, ""); !errors.Is(err, ErrDecimal) {
					t.Fatalf("accepted invalid rate %q (%v)", rate, err)
				}
			}
		}
	})
	t.Run("duplicate date takes first rate", func(t *testing.T) {
		rates := []ExchangeRate{
			{BaseCurrency: "USD", QuoteCurrency: "KES", Rate: "2", EffectiveDate: "2026-01-01"},
			{BaseCurrency: "USD", QuoteCurrency: "KES", Rate: "3", EffectiveDate: "2026-01-01"},
		}
		value, err := ConvertMinor(100, "USD", "KES", rates, "")
		assertResult(t, value.String(), "200", err, false)
	})
	t.Run("overflow and invalid event kinds", func(t *testing.T) {
		if _, err := TransactionEffect("deposit", math.MinInt64); !errors.Is(err, ErrRange) {
			t.Fatal(err)
		}
		value, err := TransactionEffect("withdrawal", math.MinInt64)
		assertResult(t, value.String(), "-9223372036854775808", err, false)
		if _, err := TransactionEffect("unknown", 1); !errors.Is(err, ErrEvent) {
			t.Fatal(err)
		}
		if _, err := ReplayBalance([]FinancialEvent{{Kind: "unknown"}}, ""); !errors.Is(err, ErrEvent) {
			t.Fatal(err)
		}
		if _, err := ReplayBalance([]FinancialEvent{{Kind: "transaction", Type: "unknown"}}, ""); !errors.Is(err, ErrEvent) {
			t.Fatal(err)
		}
		events := []FinancialEvent{
			{Kind: "transaction", Type: "deposit", AmountMinor: math.MaxInt64, Date: "1"},
			{Kind: "transaction", Type: "deposit", AmountMinor: 1, Date: "2"},
		}
		if _, err := ReplayBalance(events, ""); !errors.Is(err, ErrRange) {
			t.Fatal(err)
		}
		events = append(events, FinancialEvent{Kind: "valuation", ValueMinor: 7, Date: "3"})
		value, err = ReplayBalance(events, "")
		assertResult(t, value.String(), "7", err, false)
		if _, err := CalculateFlowMetrics([]FlowEntry{{"deposit", math.MaxInt64}, {"deposit", 1}}); !errors.Is(err, ErrRange) {
			t.Fatal(err)
		}
		if _, err := CalculateFlowMetrics([]FlowEntry{{"unknown", 1}}); !errors.Is(err, ErrEvent) {
			t.Fatal(err)
		}
		if _, err := CalculateNetWorthTotals([]Holding{{ValueMinor: math.MaxInt64}, {ValueMinor: 1}}); !errors.Is(err, ErrRange) {
			t.Fatal(err)
		}
		if _, err := CalculateNetWorthTotals([]Holding{{ValueMinor: math.MaxInt64, IsLiability: true}, {ValueMinor: 1, IsLiability: true}}); !errors.Is(err, ErrRange) {
			t.Fatal(err)
		}
		if _, err := CalculateNetWorthTotals([]Holding{{ValueMinor: math.MinInt64, IsLiability: true}}); !errors.Is(err, ErrRange) {
			t.Fatal(err)
		}
	})
}

func FuzzMinorRoundTrip(f *testing.F) {
	for _, value := range []int64{0, 1, -1, MaxSafeMinor, -MaxSafeMinor, math.MaxInt64, math.MinInt64} {
		f.Add(value, uint8(2))
	}
	f.Fuzz(func(t *testing.T, value int64, scale uint8) {
		digits := int(scale % 5)
		text, err := MinorToDecimalDigits(Minor(value), digits)
		if err != nil {
			t.Fatal(err)
		}
		rational, err := decimalRat(text)
		if err != nil {
			t.Fatal(err)
		}
		rational.Mul(rational, new(big.Rat).SetInt(pow10(digits)))
		if !rational.IsInt() || rational.Num().Cmp(big.NewInt(value)) != 0 {
			t.Fatal("format lost minor units")
		}
		if value >= -MaxSafeMinor && value <= MaxSafeMinor {
			parsed, err := ParseMoneyDigits(text, digits)
			if err != nil || parsed != Minor(value) {
				t.Fatal("money roundtrip failed", err)
			}
		}
		data, err := json.Marshal(Minor(value))
		if err != nil {
			t.Fatal(err)
		}
		var parsed Minor
		if err := json.Unmarshal(data, &parsed); err != nil || parsed != Minor(value) {
			t.Fatal("minor JSON roundtrip failed", err)
		}
	})
}

func FuzzCanonicalDecimal(f *testing.F) {
	for _, value := range []string{"0", "-0.000", "001.2300", "1e2", strings.Repeat("9", 81)} {
		f.Add(value)
	}
	f.Fuzz(func(t *testing.T, input string) {
		value, err := CanonicalDecimal(input)
		if err != nil {
			return
		}
		again, err := CanonicalDecimal(value)
		if err != nil || again != value {
			t.Fatal("canonicalization is not idempotent")
		}
		original, ok := new(big.Rat).SetString(strings.TrimSpace(input))
		if !ok {
			t.Fatal("accepted invalid rational")
		}
		canonical, _ := new(big.Rat).SetString(value)
		if original.Cmp(canonical) != 0 {
			t.Fatal("canonicalization changed value")
		}
	})
}
