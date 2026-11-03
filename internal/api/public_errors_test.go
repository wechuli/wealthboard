package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wechuli/wealthboard/internal/service"
)

func TestMutationErrorsReturnPublicDetailsOnly(t *testing.T) {
	for _, test := range []struct {
		name   string
		write  func(http.ResponseWriter, error)
		err    error
		status int
		detail string
	}{
		{"investment validation", writeInvestmentMutationError, &service.PublicError{Kind: service.ErrInvestmentMutationValidation, Detail: "fee cannot be negative"}, http.StatusUnprocessableEntity, "Fee cannot be negative."},
		{"investment conflict", writeInvestmentMutationError, &service.PublicError{Kind: service.ErrInvestmentMutationConflict, Detail: "use ordinary position event deletion for ungrouped activity"}, http.StatusConflict, "Use ordinary position event deletion for ungrouped activity."},
		{"investment private detail", writeInvestmentMutationError, fmt.Errorf("%w: insert position event", service.ErrInvestmentMutationConflict), http.StatusConflict, "The mutation conflicts with existing investment activity."},
		{"investment unexpected", writeInvestmentMutationError, errors.New("pq: connection refused"), http.StatusServiceUnavailable, "The investment mutation could not be completed."},
		{"estate validation", writeEstateMutationError, &service.PublicError{Kind: service.ErrEstateValidation, Detail: "allocations cannot exceed 100%; 25% remains in the primary tier"}, http.StatusUnprocessableEntity, "Allocations cannot exceed 100%; 25% remains in the primary tier."},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			test.write(response, test.err)
			var problem struct {
				Detail string `json:"detail"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
				t.Fatalf("decode problem: %v", err)
			}
			if response.Code != test.status || problem.Detail != test.detail {
				t.Fatalf("status = %d, detail = %q; want %d, %q", response.Code, problem.Detail, test.status, test.detail)
			}
		})
	}
}
