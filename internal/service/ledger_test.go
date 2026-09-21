package service

import (
	"database/sql"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLedgerTransactionEffectMatchesFinanceSemantics(t *testing.T) {
	tests := []struct {
		transactionType string
		amount          int64
		want            int64
	}{
		{transactionType: "deposit", amount: 125, want: 125},
		{transactionType: "deposit", amount: -125, want: 125},
		{transactionType: "withdrawal", amount: 125, want: -125},
		{transactionType: "withdrawal", amount: -125, want: -125},
		{transactionType: "manual_adjustment", amount: -40, want: -40},
		{transactionType: "transfer", amount: 90, want: 90},
	}
	for _, test := range tests {
		t.Run(test.transactionType, func(t *testing.T) {
			got, err := transactionEffect(test.transactionType, test.amount)
			if err != nil {
				t.Fatalf("transactionEffect() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("transactionEffect(%q, %d) = %d, want %d", test.transactionType, test.amount, got, test.want)
			}
		})
	}
}

func TestLedgerTransactionEffectRejectsPositiveOverflow(t *testing.T) {
	_, err := transactionEffect("deposit", math.MinInt64)
	if !errors.Is(err, ErrLedgerValidation) {
		t.Fatalf("transactionEffect() error = %v, want validation", err)
	}
}

func TestTransactionExternalIDMatchesBlankAndLegacyRows(t *testing.T) {
	input := TransactionMutationInput{
		Type: "deposit", AmountMinor: 100_000_000,
		TransactionDate: time.Date(2026, time.September, 21, 0, 0, 0, 0, time.UTC),
	}
	if !transactionExternalIDMatches(sql.NullString{}, input, "") {
		t.Fatal("blank external ID did not match NULL")
	}
	if !transactionExternalIDMatches(sql.NullString{String: "derived-2026-09-21-deposit-100000000", Valid: true}, input, "") {
		t.Fatal("blank external ID did not match legacy derived ID")
	}
	if transactionExternalIDMatches(sql.NullString{String: "another-id", Valid: true}, input, "") {
		t.Fatal("blank external ID matched unrelated explicit ID")
	}
}

func TestParseMinorUnitsUsesStrictBigintStrings(t *testing.T) {
	for _, value := range []string{"", " 10", "10.00", "9223372036854775808"} {
		if _, err := ParseMinorUnits(value); !errors.Is(err, ErrLedgerValidation) {
			t.Fatalf("ParseMinorUnits(%q) error = %v, want validation", value, err)
		}
	}
	if got, err := ParseMinorUnits("-9223372036854775808"); err != nil || got != math.MinInt64 {
		t.Fatalf("ParseMinorUnits(min bigint) = %d, %v", got, err)
	}
}

func TestValidateLedgerInputs(t *testing.T) {
	validAccount := AccountMutationInput{Name: "Cash", CategoryID: uuid.New(), Currency: "KES", TrackingMode: "balance"}
	if err := validateAccountInput(validAccount, true); err != nil {
		t.Fatalf("valid account rejected: %v", err)
	}
	invalidAccount := validAccount
	invalidAccount.Name = "\n"
	if err := validateAccountInput(invalidAccount, true); !errors.Is(err, ErrLedgerValidation) {
		t.Fatalf("invalid account error = %v, want validation", err)
	}
	if err := validateTransactionInput(TransactionMutationInput{
		IdempotencyKey: uuid.New(), AccountID: uuid.New(), Type: "transfer", AmountMinor: 10,
	}, true); !errors.Is(err, ErrLedgerValidation) {
		t.Fatalf("reserved transaction error = %v, want validation", err)
	}
}
