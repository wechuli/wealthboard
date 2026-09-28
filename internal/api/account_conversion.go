package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type accountConversionAuthorizer interface {
	AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error)
}

type accountConversionService interface {
	Preview(context.Context, uuid.UUID, service.AccountConversionInput) (service.AccountConversionPreview, error)
	Execute(context.Context, uuid.UUID, service.AccountConversionInput) (service.AccountConversionResult, error)
}

type AccountConversionHandler struct {
	auth    accountConversionAuthorizer
	service accountConversionService
}

type accountConversionRequest struct {
	SourceAccountID   uuid.UUID                               `json:"sourceAccountId"`
	TargetName        string                                  `json:"targetName"`
	ConversionDate    string                                  `json:"conversionDate"`
	OpeningCash       string                                  `json:"openingCash"`
	Holdings          []service.AccountConversionHoldingInput `json:"holdings"`
	IdempotencyKey    *string                                 `json:"idempotencyKey"`
	ConfirmDifference bool                                    `json:"confirmDifference"`
}

func NewAccountConversionHandler(auth accountConversionAuthorizer, conversions accountConversionService) *AccountConversionHandler {
	return &AccountConversionHandler{auth: auth, service: conversions}
}

func RegisterAccountConversionRoutes(router chi.Router, handler *AccountConversionHandler) {
	router.Post("/account-conversions/preview", handler.Preview)
	router.Post("/account-conversions", handler.Execute)
}

func (handler *AccountConversionHandler) Preview(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	input, ok := decodeAccountConversion(response, request)
	if !ok {
		return
	}
	preview, err := handler.service.Preview(request.Context(), principal.UserID, input)
	if err != nil {
		writeAccountConversionError(response, err)
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	writeJSON(response, http.StatusOK, preview)
}

func (handler *AccountConversionHandler) Execute(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	input, ok := decodeAccountConversion(response, request)
	if !ok {
		return
	}
	result, err := handler.service.Execute(request.Context(), principal.UserID, input)
	if err != nil {
		writeAccountConversionError(response, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	response.Header().Set("Cache-Control", "no-store")
	writeJSON(response, status, result)
}

func (handler *AccountConversionHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthorizePortfolioMutation(request)
	switch {
	case errors.Is(err, errMutationOrigin):
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
	case errors.Is(err, errMutationScope):
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant portfolio:write.")
	case err != nil:
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid mutation authentication is required.")
	default:
		return principal, true
	}
	return webauth.Principal{}, false
}

func decodeAccountConversion(response http.ResponseWriter, request *http.Request) (service.AccountConversionInput, bool) {
	var body accountConversionRequest
	if !decodeMutationInput(response, request, &body) {
		return service.AccountConversionInput{}, false
	}
	conversionDate, err := time.Parse(time.DateOnly, body.ConversionDate)
	if err != nil || conversionDate.Format(time.DateOnly) != body.ConversionDate {
		writeAccountConversionError(response, accountConversionValidation("conversionDate must use YYYY-MM-DD"))
		return service.AccountConversionInput{}, false
	}
	key, err := accountConversionIdempotencyKey(body.IdempotencyKey, request.Header.Get("Idempotency-Key"))
	if err != nil {
		writeAccountConversionError(response, err)
		return service.AccountConversionInput{}, false
	}
	return service.AccountConversionInput{
		SourceAccountID: body.SourceAccountID, TargetName: body.TargetName, ConversionDate: conversionDate,
		OpeningCash: body.OpeningCash, Holdings: body.Holdings, IdempotencyKey: key,
		ConfirmDifference: body.ConfirmDifference,
	}, true
}

func accountConversionIdempotencyKey(bodyKey *string, headerKey string) (uuid.UUID, error) {
	var parsedBody uuid.UUID
	if bodyKey != nil && strings.TrimSpace(*bodyKey) != "" {
		value, err := uuid.Parse(strings.TrimSpace(*bodyKey))
		if err != nil {
			return uuid.Nil, accountConversionValidation("idempotency key must be a UUID")
		}
		parsedBody = value
	}
	parsedHeader := uuid.Nil
	if strings.TrimSpace(headerKey) != "" {
		value, err := uuid.Parse(strings.TrimSpace(headerKey))
		if err != nil {
			return uuid.Nil, accountConversionValidation("Idempotency-Key must be a UUID")
		}
		parsedHeader = value
	}
	if parsedBody != uuid.Nil && parsedHeader != uuid.Nil && parsedBody != parsedHeader {
		return uuid.Nil, accountConversionValidation("body and header idempotency keys must match")
	}
	if parsedHeader != uuid.Nil {
		return parsedHeader, nil
	}
	if parsedBody != uuid.Nil {
		return parsedBody, nil
	}
	return uuid.Nil, accountConversionValidation("Idempotency-Key must be a UUID")
}

func writeAccountConversionError(response http.ResponseWriter, err error) {
	detail := accountConversionErrorDetail(err)
	switch {
	case errors.Is(err, service.ErrAccountConversionValidation):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", detail)
	case errors.Is(err, service.ErrAccountConversionConflict):
		writeProblem(response, http.StatusConflict, "Conflict", detail)
	case errors.Is(err, service.ErrAccountConversionNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The account conversion could not be completed.")
	}
}

func accountConversionValidation(detail string) error {
	return fmt.Errorf("%w: %s", service.ErrAccountConversionValidation, detail)
}

func accountConversionErrorDetail(err error) string {
	detail := err.Error()
	if index := strings.LastIndex(detail, ": "); index >= 0 {
		return detail[index+2:]
	}
	return detail
}
