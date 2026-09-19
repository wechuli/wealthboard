package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type investmentMutationAuthenticator interface {
	AuthenticateRequest(*http.Request) (webauth.Principal, error)
}

type investmentMutationService interface {
	CreateInstrument(context.Context, uuid.UUID, service.InstrumentMutationInput) (uuid.UUID, error)
	UpdateInstrument(context.Context, uuid.UUID, uuid.UUID, service.InstrumentMutationInput) error
	SetInstrumentArchived(context.Context, uuid.UUID, uuid.UUID, bool) error
	DeleteInstrument(context.Context, uuid.UUID, uuid.UUID) error
	UpsertSecurityPrice(context.Context, uuid.UUID, service.SecurityPriceMutationInput) (uuid.UUID, error)
	DeleteSecurityPrice(context.Context, uuid.UUID, uuid.UUID) error
	CreatePositionEvent(context.Context, uuid.UUID, service.PositionEventMutationInput) (uuid.UUID, error)
	UpdatePositionEvent(context.Context, uuid.UUID, uuid.UUID, service.PositionEventMutationInput) (uuid.UUID, error)
	DeletePositionEvent(context.Context, uuid.UUID, uuid.UUID) error
	CreatePositionReconciliation(context.Context, uuid.UUID, service.PositionReconciliationMutationInput) (uuid.UUID, error)
	DeletePositionReconciliation(context.Context, uuid.UUID, uuid.UUID) error
}

type InvestmentMutationHandler struct {
	auth          investmentMutationAuthenticator
	service       investmentMutationService
	trustedOrigin string
}

func NewInvestmentMutationHandler(auth investmentMutationAuthenticator, mutations investmentMutationService, trustedOrigin string) *InvestmentMutationHandler {
	return &InvestmentMutationHandler{auth: auth, service: mutations, trustedOrigin: trustedOrigin}
}

func RegisterInvestmentMutationRoutes(router chi.Router, handler *InvestmentMutationHandler) {
	router.Post("/instruments", handler.CreateInstrument)
	router.Put("/instruments/{id}", handler.UpdateInstrument)
	router.Patch("/instruments/{id}/archive", handler.ArchiveInstrument)
	router.Delete("/instruments/{id}", handler.DeleteInstrument)
	router.Put("/security-prices", handler.UpsertSecurityPrice)
	router.Delete("/security-prices/{id}", handler.DeleteSecurityPrice)
	router.Post("/position-events", handler.CreatePositionEvent)
	router.Put("/position-events/{id}", handler.UpdatePositionEvent)
	router.Delete("/position-events/{id}", handler.DeletePositionEvent)
	router.Post("/position-reconciliations", handler.CreatePositionReconciliation)
	router.Delete("/position-reconciliations/{id}", handler.DeletePositionReconciliation)
}

func (handler *InvestmentMutationHandler) CreateInstrument(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.InstrumentMutationInput
	if !decodeInvestmentMutation(response, request, &input) {
		return
	}
	id, err := handler.service.CreateInstrument(request.Context(), principal.UserID, input)
	handler.writeID(response, http.StatusCreated, id, err)
}

func (handler *InvestmentMutationHandler) UpdateInstrument(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := investmentPathID(response, request)
	if !ok {
		return
	}
	var input service.InstrumentMutationInput
	if !decodeInvestmentMutation(response, request, &input) {
		return
	}
	if err := handler.service.UpdateInstrument(request.Context(), principal.UserID, id, input); err != nil {
		writeInvestmentMutationError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *InvestmentMutationHandler) ArchiveInstrument(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := investmentPathID(response, request)
	if !ok {
		return
	}
	var input struct {
		Archived bool `json:"archived"`
	}
	if !decodeInvestmentMutation(response, request, &input) {
		return
	}
	if err := handler.service.SetInstrumentArchived(request.Context(), principal.UserID, id, input.Archived); err != nil {
		writeInvestmentMutationError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *InvestmentMutationHandler) DeleteInstrument(response http.ResponseWriter, request *http.Request) {
	handler.deleteByID(response, request, handler.service.DeleteInstrument)
}

func (handler *InvestmentMutationHandler) UpsertSecurityPrice(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input securityPriceRequest
	if !decodeInvestmentMutation(response, request, &input) {
		return
	}
	parsed, err := input.serviceInput()
	if err != nil {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", err.Error())
		return
	}
	id, err := handler.service.UpsertSecurityPrice(request.Context(), principal.UserID, parsed)
	handler.writeID(response, http.StatusOK, id, err)
}

func (handler *InvestmentMutationHandler) DeleteSecurityPrice(response http.ResponseWriter, request *http.Request) {
	handler.deleteByID(response, request, handler.service.DeleteSecurityPrice)
}

func (handler *InvestmentMutationHandler) CreatePositionEvent(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	input, ok := decodePositionEventRequest(response, request)
	if !ok {
		return
	}
	id, err := handler.service.CreatePositionEvent(request.Context(), principal.UserID, input)
	handler.writeID(response, http.StatusCreated, id, err)
}

func (handler *InvestmentMutationHandler) UpdatePositionEvent(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := investmentPathID(response, request)
	if !ok {
		return
	}
	input, ok := decodePositionEventRequest(response, request)
	if !ok {
		return
	}
	resultID, err := handler.service.UpdatePositionEvent(request.Context(), principal.UserID, id, input)
	handler.writeID(response, http.StatusOK, resultID, err)
}

func (handler *InvestmentMutationHandler) DeletePositionEvent(response http.ResponseWriter, request *http.Request) {
	handler.deleteByID(response, request, handler.service.DeletePositionEvent)
}

func (handler *InvestmentMutationHandler) CreatePositionReconciliation(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input positionReconciliationRequest
	if !decodeInvestmentMutation(response, request, &input) {
		return
	}
	parsed, err := input.serviceInput()
	if err != nil {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", err.Error())
		return
	}
	id, err := handler.service.CreatePositionReconciliation(request.Context(), principal.UserID, parsed)
	handler.writeID(response, http.StatusCreated, id, err)
}

func (handler *InvestmentMutationHandler) DeletePositionReconciliation(response http.ResponseWriter, request *http.Request) {
	handler.deleteByID(response, request, handler.service.DeletePositionReconciliation)
}

func (handler *InvestmentMutationHandler) deleteByID(response http.ResponseWriter, request *http.Request, mutation func(context.Context, uuid.UUID, uuid.UUID) error) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := investmentPathID(response, request)
	if !ok {
		return
	}
	if err := mutation(request.Context(), principal.UserID, id); err != nil {
		writeInvestmentMutationError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *InvestmentMutationHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
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

func (handler *InvestmentMutationHandler) writeID(response http.ResponseWriter, status int, id uuid.UUID, err error) {
	if err != nil {
		writeInvestmentMutationError(response, err)
		return
	}
	writeJSON(response, status, map[string]any{"id": id})
}

type securityPriceRequest struct {
	InstrumentID  uuid.UUID `json:"instrumentId"`
	ExternalID    string    `json:"externalId"`
	Price         string    `json:"price"`
	EffectiveDate string    `json:"effectiveDate"`
	Source        string    `json:"source"`
	Provenance    string    `json:"provenance"`
}

func (input securityPriceRequest) serviceInput() (service.SecurityPriceMutationInput, error) {
	date, err := time.Parse(time.DateOnly, input.EffectiveDate)
	if err != nil {
		return service.SecurityPriceMutationInput{}, errors.New("effectiveDate must use YYYY-MM-DD")
	}
	return service.SecurityPriceMutationInput{
		InstrumentID: input.InstrumentID, ExternalID: input.ExternalID, Price: input.Price,
		EffectiveDate: date, Source: input.Source, Provenance: input.Provenance,
	}, nil
}

type positionEventRequest struct {
	AccountID           uuid.UUID `json:"accountId"`
	InstrumentID        uuid.UUID `json:"instrumentId"`
	Type                string    `json:"type"`
	Quantity            string    `json:"quantity"`
	UnitPrice           string    `json:"unitPrice"`
	TradeCurrency       string    `json:"tradeCurrency"`
	FeeAmount           string    `json:"feeAmount"`
	FeeCurrency         string    `json:"feeCurrency"`
	CashEffect          string    `json:"cashEffect"`
	AppliedExchangeRate string    `json:"appliedExchangeRate"`
	OpeningCostBasis    string    `json:"openingCostBasis"`
	TradeDate           string    `json:"tradeDate"`
	SettlementDate      string    `json:"settlementDate"`
	ExternalID          string    `json:"externalId"`
	IdempotencyKey      uuid.UUID `json:"idempotencyKey"`
	Description         string    `json:"description"`
	Notes               string    `json:"notes"`
}

func decodePositionEventRequest(response http.ResponseWriter, request *http.Request) (service.PositionEventMutationInput, bool) {
	var input positionEventRequest
	if !decodeInvestmentMutation(response, request, &input) {
		return service.PositionEventMutationInput{}, false
	}
	tradeDate, err := time.Parse(time.DateOnly, input.TradeDate)
	if err != nil {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "tradeDate must use YYYY-MM-DD")
		return service.PositionEventMutationInput{}, false
	}
	var settlementDate *time.Time
	if input.SettlementDate != "" {
		parsed, parseErr := time.Parse(time.DateOnly, input.SettlementDate)
		if parseErr != nil {
			writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "settlementDate must use YYYY-MM-DD")
			return service.PositionEventMutationInput{}, false
		}
		settlementDate = &parsed
	}
	return service.PositionEventMutationInput{
		AccountID: input.AccountID, InstrumentID: input.InstrumentID, Type: input.Type,
		Quantity: input.Quantity, UnitPrice: input.UnitPrice, TradeCurrency: input.TradeCurrency,
		FeeAmount: input.FeeAmount, FeeCurrency: input.FeeCurrency, CashEffect: input.CashEffect,
		AppliedExchangeRate: input.AppliedExchangeRate, OpeningCostBasis: input.OpeningCostBasis,
		TradeDate: tradeDate, SettlementDate: settlementDate, ExternalID: input.ExternalID,
		IdempotencyKey: input.IdempotencyKey, Description: input.Description, Notes: input.Notes,
	}, true
}

type positionReconciliationRequest struct {
	AccountID       uuid.UUID `json:"accountId"`
	ObservationDate string    `json:"observationDate"`
	ReportedCash    string    `json:"reportedCash"`
	ReportedTotal   string    `json:"reportedTotal"`
	Notes           string    `json:"notes"`
}

func (input positionReconciliationRequest) serviceInput() (service.PositionReconciliationMutationInput, error) {
	date, err := time.Parse(time.DateOnly, input.ObservationDate)
	if err != nil {
		return service.PositionReconciliationMutationInput{}, errors.New("observationDate must use YYYY-MM-DD")
	}
	return service.PositionReconciliationMutationInput{
		AccountID: input.AccountID, ObservationDate: date, ReportedCash: input.ReportedCash,
		ReportedTotal: input.ReportedTotal, Notes: input.Notes,
	}, nil
}

func decodeInvestmentMutation(response http.ResponseWriter, request *http.Request, destination any) bool {
	if err := decodeJSON(response, request, destination); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide one valid JSON request body.")
		return false
	}
	return true
}

func investmentPathID(response http.ResponseWriter, request *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
		return uuid.Nil, false
	}
	return id, true
}

func writeInvestmentMutationError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrInvestmentMutationNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
	case errors.Is(err, service.ErrInvestmentMutationConflict):
		writeProblem(response, http.StatusConflict, "Conflict", "The mutation conflicts with existing investment activity.")
	case errors.Is(err, service.ErrInvestmentMutationValidation):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "The investment mutation is invalid.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The investment mutation could not be completed.")
	}
}
