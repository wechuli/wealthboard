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

type LedgerMutator interface {
	CreateAccount(context.Context, uuid.UUID, service.AccountMutationInput) (uuid.UUID, error)
	UpdateAccount(context.Context, uuid.UUID, uuid.UUID, service.AccountMutationInput) error
	SetAccountArchived(context.Context, uuid.UUID, uuid.UUID, bool) error
	DeleteAccount(context.Context, uuid.UUID, uuid.UUID, string) error
	CreateTransaction(context.Context, uuid.UUID, service.TransactionMutationInput) (uuid.UUID, error)
	UpdateTransaction(context.Context, uuid.UUID, uuid.UUID, service.TransactionMutationInput) error
	DeleteTransaction(context.Context, uuid.UUID, uuid.UUID) error
	CreateValuation(context.Context, uuid.UUID, service.ValuationMutationInput) (uuid.UUID, error)
	DeleteValuation(context.Context, uuid.UUID, uuid.UUID) error
	CreateTransfer(context.Context, uuid.UUID, service.TransferMutationInput) (uuid.UUID, error)
}

type LedgerHandler struct {
	authenticator RequestAuthenticator
	service       LedgerMutator
	trustedOrigin string
}

func NewLedgerHandler(authenticator RequestAuthenticator, ledger LedgerMutator, trustedOrigin string) *LedgerHandler {
	return &LedgerHandler{authenticator: authenticator, service: ledger, trustedOrigin: trustedOrigin}
}

func RegisterLedgerRoutes(router chi.Router, handler *LedgerHandler) {
	router.Post("/accounts", handler.CreateAccount)
	router.Patch("/accounts/{id}", handler.UpdateAccount)
	router.Post("/accounts/{id}/archive", handler.ArchiveAccount)
	router.Delete("/accounts/{id}", handler.DeleteAccount)
	router.Post("/transactions", handler.CreateTransaction)
	router.Patch("/transactions/{id}", handler.UpdateTransaction)
	router.Delete("/transactions/{id}", handler.DeleteTransaction)
	router.Post("/valuations", handler.CreateValuation)
	router.Delete("/valuations/{id}", handler.DeleteValuation)
	router.Post("/transfers", handler.CreateTransfer)
}

type accountWriteRequest struct {
	IdempotencyKey       string  `json:"idempotencyKey"`
	Name                 string  `json:"name"`
	Description          string  `json:"description"`
	CategoryID           string  `json:"categoryId"`
	InstitutionID        *string `json:"institutionId"`
	AccountReference     string  `json:"accountReference"`
	Currency             string  `json:"currency"`
	TrackingMode         string  `json:"trackingMode"`
	OpeningValueMinor    string  `json:"openingValueMinor"`
	CostBasisMinor       *string `json:"costBasisMinor"`
	IsIncludedInNetWorth bool    `json:"isIncludedInNetWorth"`
	Notes                string  `json:"notes"`
	OpenedAt             *string `json:"openedAt"`
}

type transactionWriteRequest struct {
	IdempotencyKey  string `json:"idempotencyKey"`
	AccountID       string `json:"accountId"`
	Type            string `json:"type"`
	AmountMinor     string `json:"amountMinor"`
	TransactionDate string `json:"transactionDate"`
	Description     string `json:"description"`
	ExternalID      string `json:"externalId"`
	Notes           string `json:"notes"`
}

func (handler *LedgerHandler) CreateAccount(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body accountWriteRequest
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	input, err := body.input(true)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	id, err := handler.service.CreateAccount(request.Context(), principal.UserID, input)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, map[string]string{"id": id.String()})
}

func (handler *LedgerHandler) UpdateAccount(response http.ResponseWriter, request *http.Request) {
	principal, resourceID, ok := handler.authorizeResource(response, request)
	if !ok {
		return
	}
	var body accountWriteRequest
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	input, err := body.input(false)
	if err == nil {
		err = handler.service.UpdateAccount(request.Context(), principal.UserID, resourceID, input)
	}
	handler.writeNoContent(response, err)
}

func (handler *LedgerHandler) ArchiveAccount(response http.ResponseWriter, request *http.Request) {
	principal, resourceID, ok := handler.authorizeResource(response, request)
	if !ok {
		return
	}
	var body struct {
		Archived *bool `json:"archived"`
	}
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	if body.Archived == nil {
		handler.writeError(response, service.ErrLedgerValidation)
		return
	}
	handler.writeNoContent(response, handler.service.SetAccountArchived(request.Context(), principal.UserID, resourceID, *body.Archived))
}

func (handler *LedgerHandler) DeleteAccount(response http.ResponseWriter, request *http.Request) {
	principal, resourceID, ok := handler.authorizeResource(response, request)
	if !ok {
		return
	}
	var body struct {
		ConfirmationName string `json:"confirmationName"`
	}
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	handler.writeNoContent(response, handler.service.DeleteAccount(request.Context(), principal.UserID, resourceID, body.ConfirmationName))
}

func (handler *LedgerHandler) CreateTransaction(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body transactionWriteRequest
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	input, err := body.input(true)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	id, err := handler.service.CreateTransaction(request.Context(), principal.UserID, input)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, map[string]string{"id": id.String()})
}

func (handler *LedgerHandler) UpdateTransaction(response http.ResponseWriter, request *http.Request) {
	principal, resourceID, ok := handler.authorizeResource(response, request)
	if !ok {
		return
	}
	var body transactionWriteRequest
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	input, err := body.input(false)
	if err == nil {
		err = handler.service.UpdateTransaction(request.Context(), principal.UserID, resourceID, input)
	}
	handler.writeNoContent(response, err)
}

func (handler *LedgerHandler) DeleteTransaction(response http.ResponseWriter, request *http.Request) {
	principal, resourceID, ok := handler.authorizeResource(response, request)
	if !ok {
		return
	}
	handler.writeNoContent(response, handler.service.DeleteTransaction(request.Context(), principal.UserID, resourceID))
}

func (handler *LedgerHandler) CreateValuation(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body struct {
		IdempotencyKey string `json:"idempotencyKey"`
		AccountID      string `json:"accountId"`
		ValueMinor     string `json:"valueMinor"`
		ValuationDate  string `json:"valuationDate"`
		Notes          string `json:"notes"`
	}
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	key, accountID, amount, date, err := parseLedgerValues(body.IdempotencyKey, body.AccountID, body.ValueMinor, body.ValuationDate, true)
	if err != nil {
		handler.writeError(response, err)
		return
	}
	id, err := handler.service.CreateValuation(request.Context(), principal.UserID, service.ValuationMutationInput{
		IdempotencyKey: key, AccountID: accountID, ValueMinor: amount, ValuationDate: date, Notes: body.Notes,
	})
	if err != nil {
		handler.writeError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, map[string]string{"id": id.String()})
}

func (handler *LedgerHandler) DeleteValuation(response http.ResponseWriter, request *http.Request) {
	principal, resourceID, ok := handler.authorizeResource(response, request)
	if !ok {
		return
	}
	handler.writeNoContent(response, handler.service.DeleteValuation(request.Context(), principal.UserID, resourceID))
}

func (handler *LedgerHandler) CreateTransfer(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body struct {
		IdempotencyKey         string `json:"idempotencyKey"`
		FromAccountID          string `json:"fromAccountId"`
		ToAccountID            string `json:"toAccountId"`
		SourceAmountMinor      string `json:"sourceAmountMinor"`
		DestinationAmountMinor string `json:"destinationAmountMinor"`
		TransactionDate        string `json:"transactionDate"`
		Description            string `json:"description"`
	}
	if !decodeLedgerJSON(response, request, &body) {
		return
	}
	key, err := uuid.Parse(body.IdempotencyKey)
	fromID, fromErr := uuid.Parse(body.FromAccountID)
	toID, toErr := uuid.Parse(body.ToAccountID)
	sourceAmount, sourceErr := service.ParseMinorUnits(body.SourceAmountMinor)
	var destinationAmount int64
	var destinationErr error
	if body.DestinationAmountMinor != "" {
		destinationAmount, destinationErr = service.ParseMinorUnits(body.DestinationAmountMinor)
	}
	date, dateErr := time.Parse(time.DateOnly, body.TransactionDate)
	if err != nil || fromErr != nil || toErr != nil || sourceErr != nil || destinationErr != nil || dateErr != nil {
		handler.writeError(response, service.ErrLedgerValidation)
		return
	}
	id, err := handler.service.CreateTransfer(request.Context(), principal.UserID, service.TransferMutationInput{
		IdempotencyKey: key, FromAccountID: fromID, ToAccountID: toID,
		SourceAmountMinor: sourceAmount, DestinationAmountMinor: destinationAmount,
		TransactionDate: date, Description: body.Description,
	})
	if err != nil {
		handler.writeError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, map[string]string{"id": id.String()})
}

func (handler *LedgerHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.authenticator.AuthenticateRequest(request)
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
			writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid session and CSRF token are required.")
			return webauth.Principal{}, false
		}
	}
	return principal, true
}

func (handler *LedgerHandler) authorizeResource(response http.ResponseWriter, request *http.Request) (webauth.Principal, uuid.UUID, bool) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return webauth.Principal{}, uuid.Nil, false
	}
	resourceID, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
		return webauth.Principal{}, uuid.Nil, false
	}
	return principal, resourceID, true
}

func (handler *LedgerHandler) writeNoContent(response http.ResponseWriter, err error) {
	if err != nil {
		handler.writeError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *LedgerHandler) writeError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrLedgerNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
	case errors.Is(err, service.ErrLedgerConflict):
		writeProblem(response, http.StatusConflict, "Conflict", "The request conflicts with existing ledger data.")
	case errors.Is(err, service.ErrLedgerValidation):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Provide valid ledger details.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The ledger could not be changed.")
	}
}

func decodeLedgerJSON(response http.ResponseWriter, request *http.Request, destination any) bool {
	if err := decodeJSON(response, request, destination); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide one valid JSON request body.")
		return false
	}
	return true
}

func (body accountWriteRequest) input(creating bool) (service.AccountMutationInput, error) {
	categoryID, err := uuid.Parse(body.CategoryID)
	if err != nil {
		return service.AccountMutationInput{}, service.ErrLedgerValidation
	}
	var key *uuid.UUID
	if body.IdempotencyKey != "" {
		parsed, parseErr := uuid.Parse(body.IdempotencyKey)
		if parseErr != nil {
			return service.AccountMutationInput{}, service.ErrLedgerValidation
		}
		key = &parsed
	} else if creating {
		return service.AccountMutationInput{}, service.ErrLedgerValidation
	}
	institutionID, err := parseOptionalLedgerUUID(body.InstitutionID)
	if err != nil {
		return service.AccountMutationInput{}, err
	}
	var opening int64
	if creating {
		opening, err = service.ParseMinorUnits(body.OpeningValueMinor)
		if err != nil {
			return service.AccountMutationInput{}, err
		}
	}
	costBasis, err := parseOptionalMinor(body.CostBasisMinor)
	if err != nil {
		return service.AccountMutationInput{}, err
	}
	openedAt, err := parseOptionalLedgerDate(body.OpenedAt)
	if err != nil {
		return service.AccountMutationInput{}, err
	}
	return service.AccountMutationInput{
		IdempotencyKey: key, Name: body.Name, Description: body.Description,
		CategoryID: categoryID, InstitutionID: institutionID, AccountReference: body.AccountReference,
		Currency: strings.ToUpper(body.Currency), TrackingMode: body.TrackingMode,
		OpeningValueMinor: opening, CostBasisMinor: costBasis,
		IsIncludedInNetWorth: body.IsIncludedInNetWorth, Notes: body.Notes, OpenedAt: openedAt,
	}, nil
}

func (body transactionWriteRequest) input(creating bool) (service.TransactionMutationInput, error) {
	key, accountID, amount, date, err := parseLedgerValues(body.IdempotencyKey, body.AccountID, body.AmountMinor, body.TransactionDate, creating)
	if err != nil {
		return service.TransactionMutationInput{}, err
	}
	return service.TransactionMutationInput{
		IdempotencyKey: key, AccountID: accountID, Type: body.Type, AmountMinor: amount,
		TransactionDate: date, Description: body.Description, ExternalID: body.ExternalID, Notes: body.Notes,
	}, nil
}

func parseLedgerValues(keyValue, accountValue, amountValue, dateValue string, requireKey bool) (uuid.UUID, uuid.UUID, int64, time.Time, error) {
	var key uuid.UUID
	var err error
	if keyValue != "" {
		key, err = uuid.Parse(keyValue)
	} else if requireKey {
		err = errors.New("missing idempotency key")
	}
	var accountID uuid.UUID
	var accountErr error
	if accountValue != "" {
		accountID, accountErr = uuid.Parse(accountValue)
	} else if requireKey {
		accountErr = errors.New("missing account ID")
	}
	amount, amountErr := service.ParseMinorUnits(amountValue)
	date, dateErr := time.Parse(time.DateOnly, dateValue)
	if err != nil || accountErr != nil || amountErr != nil || dateErr != nil {
		return uuid.Nil, uuid.Nil, 0, time.Time{}, service.ErrLedgerValidation
	}
	return key, accountID, amount, date, nil
}

func parseOptionalLedgerUUID(value *string) (*uuid.UUID, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	parsed, err := uuid.Parse(*value)
	if err != nil {
		return nil, service.ErrLedgerValidation
	}
	return &parsed, nil
}

func parseOptionalMinor(value *string) (*int64, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	parsed, err := service.ParseMinorUnits(*value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func parseOptionalLedgerDate(value *string) (*time.Time, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.DateOnly, *value)
	if err != nil {
		return nil, service.ErrLedgerValidation
	}
	return &parsed, nil
}
