package service

import (
	"errors"
	"fmt"
	"testing"
)

func TestPublicDetailExposesOnlyPublicErrors(t *testing.T) {
	detail, ok := PublicDetail(fmt.Errorf("wrapped: %w", investmentValidationError("fee cannot be negative")))
	if !ok || detail != "Fee cannot be negative." {
		t.Fatalf("detail = %q, ok = %v", detail, ok)
	}
	if !errors.Is(investmentValidationError("x"), ErrInvestmentMutationValidation) || !errors.Is(estateValidation("x"), ErrEstateValidation) {
		t.Fatal("public errors must still match their sentinel")
	}
	if got := investmentConflictError("idempotency key was already used").Error(); got != "investment mutation conflict: idempotency key was already used" {
		t.Fatalf("Error() = %q", got)
	}
	if _, ok := PublicDetail(mutationDatabaseError(errors.New("pq: relation secret_table"), "insert secret")); ok {
		t.Fatal("database errors must not expose a public detail")
	}
	if _, ok := PublicDetail(fmt.Errorf("%w: internal", ErrInvestmentMutationValidation)); ok {
		t.Fatal("plain sentinel-wrapped errors must not expose a public detail")
	}
	if _, ok := PublicDetail(investmentValidationError("  ")); ok {
		t.Fatal("blank details must not be exposed")
	}
}

func TestFormatEstateBPS(t *testing.T) {
	for value, want := range map[int32]string{0: "0%", 10000: "100%", 2500: "25%", 1250: "12.5%", 1: "0.01%", 3333: "33.33%"} {
		if got := formatEstateBPS(value); got != want {
			t.Errorf("formatEstateBPS(%d) = %q, want %q", value, got, want)
		}
	}
}
