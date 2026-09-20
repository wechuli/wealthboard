package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type corporateActionAuthenticator interface {
	AuthenticateRequest(*http.Request) (webauth.Principal, error)
}

type corporateActionService interface {
	RecordStockSplit(context.Context, uuid.UUID, service.StockSplitInput) (uuid.UUID, error)
	RecordSpinoff(context.Context, uuid.UUID, service.SpinoffInput) (uuid.UUID, error)
	RecordMerger(context.Context, uuid.UUID, service.MergerInput) (uuid.UUID, error)
	RecordDividendReinvestment(context.Context, uuid.UUID, service.DividendReinvestmentInput) (uuid.UUID, error)
	RecordInKindTransfer(context.Context, uuid.UUID, service.InKindTransferInput) (uuid.UUID, error)
	DeleteGroup(context.Context, uuid.UUID, uuid.UUID) error
}

type CorporateActionHandler struct {
	auth          corporateActionAuthenticator
	service       corporateActionService
	trustedOrigin string
}

func NewCorporateActionHandler(auth corporateActionAuthenticator, actions corporateActionService, trustedOrigin string) *CorporateActionHandler {
	return &CorporateActionHandler{auth: auth, service: actions, trustedOrigin: trustedOrigin}
}

func RegisterCorporateActionRoutes(router chi.Router, handler *CorporateActionHandler) {
	router.Post("/corporate-actions/stock-splits", handler.RecordStockSplit)
	router.Post("/corporate-actions/spinoffs", handler.RecordSpinoff)
	router.Post("/corporate-actions/mergers", handler.RecordMerger)
	router.Post("/corporate-actions/dividend-reinvestments", handler.RecordDividendReinvestment)
	router.Post("/corporate-actions/in-kind-transfers", handler.RecordInKindTransfer)
	router.Delete("/corporate-actions/{id}", handler.DeleteGroup)
}

type stockSplitRequest struct {
	AccountID      uuid.UUID `json:"accountId"`
	InstrumentID   uuid.UUID `json:"instrumentId"`
	Numerator      string    `json:"numerator"`
	Denominator    string    `json:"denominator"`
	ActionDate     string    `json:"actionDate"`
	IdempotencyKey uuid.UUID `json:"idempotencyKey"`
	Notes          string    `json:"notes"`
}

type spinoffRequest struct {
	AccountID          uuid.UUID `json:"accountId"`
	SourceInstrumentID uuid.UUID `json:"sourceInstrumentId"`
	NewInstrumentID    uuid.UUID `json:"newInstrumentId"`
	Numerator          string    `json:"numerator"`
	Denominator        string    `json:"denominator"`
	ActionDate         string    `json:"actionDate"`
	IdempotencyKey     uuid.UUID `json:"idempotencyKey"`
	Notes              string    `json:"notes"`
}

type mergerRequest struct {
	AccountID               uuid.UUID `json:"accountId"`
	SourceInstrumentID      uuid.UUID `json:"sourceInstrumentId"`
	DestinationInstrumentID uuid.UUID `json:"destinationInstrumentId"`
	Numerator               string    `json:"numerator"`
	Denominator             string    `json:"denominator"`
	ActionDate              string    `json:"actionDate"`
	IdempotencyKey          uuid.UUID `json:"idempotencyKey"`
	Notes                   string    `json:"notes"`
}

type dividendReinvestmentRequest struct {
	AccountID           uuid.UUID `json:"accountId"`
	InstrumentID        uuid.UUID `json:"instrumentId"`
	DividendAmount      string    `json:"dividendAmount"`
	Quantity            string    `json:"quantity"`
	UnitPrice           string    `json:"unitPrice"`
	TradeCurrency       string    `json:"tradeCurrency"`
	FeeAmount           string    `json:"feeAmount"`
	FeeCurrency         string    `json:"feeCurrency"`
	CashEffect          string    `json:"cashEffect"`
	AppliedExchangeRate string    `json:"appliedExchangeRate"`
	ActivityDate        string    `json:"activityDate"`
	IdempotencyKey      uuid.UUID `json:"idempotencyKey"`
	Notes               string    `json:"notes"`
}

type inKindTransferRequest struct {
	SourceAccountID      uuid.UUID `json:"sourceAccountId"`
	DestinationAccountID uuid.UUID `json:"destinationAccountId"`
	InstrumentID         uuid.UUID `json:"instrumentId"`
	Quantity             string    `json:"quantity"`
	TransferDate         string    `json:"transferDate"`
	FeeAmount            string    `json:"feeAmount"`
	IdempotencyKey       uuid.UUID `json:"idempotencyKey"`
	Notes                string    `json:"notes"`
}

func (handler *CorporateActionHandler) RecordStockSplit(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body stockSplitRequest
	if !decodeInvestmentMutation(response, request, &body) {
		return
	}
	date, key, ok := corporateDateAndKey(response, request, body.ActionDate, "actionDate", body.IdempotencyKey)
	if !ok {
		return
	}
	groupID, err := handler.service.RecordStockSplit(request.Context(), principal.UserID, service.StockSplitInput{
		AccountID: body.AccountID, InstrumentID: body.InstrumentID, Numerator: body.Numerator,
		Denominator: body.Denominator, ActionDate: date, IdempotencyKey: key, Notes: body.Notes,
	})
	handler.writeGroup(response, groupID, err)
}

func (handler *CorporateActionHandler) RecordSpinoff(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body spinoffRequest
	if !decodeInvestmentMutation(response, request, &body) {
		return
	}
	date, key, ok := corporateDateAndKey(response, request, body.ActionDate, "actionDate", body.IdempotencyKey)
	if !ok {
		return
	}
	groupID, err := handler.service.RecordSpinoff(request.Context(), principal.UserID, service.SpinoffInput{
		AccountID: body.AccountID, SourceInstrumentID: body.SourceInstrumentID,
		NewInstrumentID: body.NewInstrumentID, Numerator: body.Numerator, Denominator: body.Denominator,
		ActionDate: date, IdempotencyKey: key, Notes: body.Notes,
	})
	handler.writeGroup(response, groupID, err)
}

func (handler *CorporateActionHandler) RecordMerger(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body mergerRequest
	if !decodeInvestmentMutation(response, request, &body) {
		return
	}
	date, key, ok := corporateDateAndKey(response, request, body.ActionDate, "actionDate", body.IdempotencyKey)
	if !ok {
		return
	}
	groupID, err := handler.service.RecordMerger(request.Context(), principal.UserID, service.MergerInput{
		AccountID: body.AccountID, SourceInstrumentID: body.SourceInstrumentID,
		DestinationInstrumentID: body.DestinationInstrumentID, Numerator: body.Numerator,
		Denominator: body.Denominator, ActionDate: date, IdempotencyKey: key, Notes: body.Notes,
	})
	handler.writeGroup(response, groupID, err)
}

func (handler *CorporateActionHandler) RecordDividendReinvestment(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body dividendReinvestmentRequest
	if !decodeInvestmentMutation(response, request, &body) {
		return
	}
	date, key, ok := corporateDateAndKey(response, request, body.ActivityDate, "activityDate", body.IdempotencyKey)
	if !ok {
		return
	}
	groupID, err := handler.service.RecordDividendReinvestment(request.Context(), principal.UserID, service.DividendReinvestmentInput{
		AccountID: body.AccountID, InstrumentID: body.InstrumentID, DividendAmount: body.DividendAmount,
		Quantity: body.Quantity, UnitPrice: body.UnitPrice, TradeCurrency: body.TradeCurrency,
		FeeAmount: body.FeeAmount, FeeCurrency: body.FeeCurrency, CashEffect: body.CashEffect,
		AppliedExchangeRate: body.AppliedExchangeRate, ActivityDate: date, IdempotencyKey: key, Notes: body.Notes,
	})
	handler.writeGroup(response, groupID, err)
}

func (handler *CorporateActionHandler) RecordInKindTransfer(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body inKindTransferRequest
	if !decodeInvestmentMutation(response, request, &body) {
		return
	}
	date, key, ok := corporateDateAndKey(response, request, body.TransferDate, "transferDate", body.IdempotencyKey)
	if !ok {
		return
	}
	groupID, err := handler.service.RecordInKindTransfer(request.Context(), principal.UserID, service.InKindTransferInput{
		SourceAccountID: body.SourceAccountID, DestinationAccountID: body.DestinationAccountID,
		InstrumentID: body.InstrumentID, Quantity: body.Quantity, TransferDate: date,
		FeeAmount: body.FeeAmount, IdempotencyKey: key, Notes: body.Notes,
	})
	handler.writeGroup(response, groupID, err)
}

func (handler *CorporateActionHandler) DeleteGroup(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	eventID, ok := investmentPathID(response, request)
	if !ok {
		return
	}
	if err := handler.service.DeleteGroup(request.Context(), principal.UserID, eventID); err != nil {
		writeInvestmentMutationError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *CorporateActionHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return webauth.Principal{}, false
	}
	if !principal.HasScope(webauth.ScopePortfolioWrite) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant portfolio:write.")
		return webauth.Principal{}, false
	}
	if principal.Method == "session" {
		if request.Header.Get("Origin") != handler.trustedOrigin {
			writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
			return webauth.Principal{}, false
		}
		if !webauth.VerifyCSRF(principal.CSRFToken, request.Header.Get("X-CSRF-Token")) {
			writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid browser session and CSRF token are required.")
			return webauth.Principal{}, false
		}
	}
	return principal, true
}

func (handler *CorporateActionHandler) writeGroup(response http.ResponseWriter, groupID uuid.UUID, err error) {
	if err != nil {
		writeInvestmentMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, map[string]uuid.UUID{"eventGroupId": groupID})
}

func corporateDateAndKey(response http.ResponseWriter, request *http.Request, dateValue, dateField string, bodyKey uuid.UUID) (time.Time, uuid.UUID, bool) {
	date, err := time.Parse(time.DateOnly, dateValue)
	if err != nil {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", dateField+" must use YYYY-MM-DD")
		return time.Time{}, uuid.Nil, false
	}
	key, err := corporateIdempotencyKey(bodyKey, request.Header.Get("Idempotency-Key"))
	if err != nil {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", err.Error())
		return time.Time{}, uuid.Nil, false
	}
	return date, key, true
}

func corporateIdempotencyKey(bodyKey uuid.UUID, headerValue string) (uuid.UUID, error) {
	headerValue = strings.TrimSpace(headerValue)
	if headerValue == "" {
		if bodyKey == uuid.Nil {
			return uuid.Nil, errors.New("idempotency key is required")
		}
		return bodyKey, nil
	}
	headerKey, err := uuid.Parse(headerValue)
	if err != nil {
		return uuid.Nil, errors.New("idempotency key must be a UUID")
	}
	if bodyKey != uuid.Nil && bodyKey != headerKey {
		return uuid.Nil, errors.New("body and header idempotency keys must match")
	}
	return headerKey, nil
}
