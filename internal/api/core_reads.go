package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type coreReadAuthenticator interface {
	AuthenticateRequest(*http.Request) (webauth.Principal, error)
}

type coreReadService interface {
	Settings(context.Context, uuid.UUID) (service.Settings, error)
	Categories(context.Context, uuid.UUID) ([]service.Category, error)
	Institutions(context.Context, uuid.UUID) ([]service.Institution, error)
	Accounts(context.Context, uuid.UUID, string) ([]service.Account, error)
	Account(context.Context, uuid.UUID, uuid.UUID) (service.Account, error)
	Transactions(context.Context, uuid.UUID, service.ActivityFilter) (service.Page[service.Transaction], error)
	Valuations(context.Context, uuid.UUID, service.ActivityFilter) (service.Page[service.Valuation], error)
	Activity(context.Context, uuid.UUID, service.ActivityFilter) (service.Page[service.ActivityItem], error)
}

type CoreReadHandler struct {
	auth    coreReadAuthenticator
	service coreReadService
}

func NewCoreReadHandler(auth coreReadAuthenticator, reads coreReadService) *CoreReadHandler {
	return &CoreReadHandler{auth: auth, service: reads}
}

func (handler *CoreReadHandler) Categories(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	result, err := handler.service.Categories(request.Context(), principal.UserID)
	handler.writeResult(response, map[string]any{"items": result}, err)
}

func (handler *CoreReadHandler) Institutions(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	result, err := handler.service.Institutions(request.Context(), principal.UserID)
	handler.writeResult(response, map[string]any{"items": result}, err)
}

func (handler *CoreReadHandler) Accounts(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	archived := request.URL.Query().Get("archived")
	if archived == "" {
		archived = "active"
	}
	if archived != "active" && archived != "archived" && archived != "all" {
		writeProblem(response, http.StatusBadRequest, "Invalid filters", "archived must be active, archived, or all")
		return
	}
	result, err := handler.service.Accounts(request.Context(), principal.UserID, archived)
	handler.writeResult(response, map[string]any{"items": result}, err)
}

func (handler *CoreReadHandler) Account(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	accountID, ok := pathAccountID(response, request)
	if !ok {
		return
	}
	result, err := handler.service.Account(request.Context(), principal.UserID, accountID)
	handler.writeResult(response, result, err)
}

func (handler *CoreReadHandler) AccountTransactions(response http.ResponseWriter, request *http.Request) {
	handler.accountActivity(response, request, "transactions")
}

func (handler *CoreReadHandler) AccountValuations(response http.ResponseWriter, request *http.Request) {
	handler.accountActivity(response, request, "valuations")
}

func (handler *CoreReadHandler) AccountActivity(response http.ResponseWriter, request *http.Request) {
	handler.accountActivity(response, request, "activity")
}

func (handler *CoreReadHandler) Transactions(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	filter, err := parseActivityFilter(request, nil, true)
	if err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid filters", err.Error())
		return
	}
	result, err := handler.service.Transactions(request.Context(), principal.UserID, filter)
	handler.writeResult(response, result, err)
}

func (handler *CoreReadHandler) accountActivity(response http.ResponseWriter, request *http.Request, kind string) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	accountID, ok := pathAccountID(response, request)
	if !ok {
		return
	}
	filter, err := parseActivityFilter(request, &accountID, kind == "transactions")
	if err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid filters", err.Error())
		return
	}
	switch kind {
	case "transactions":
		result, readErr := handler.service.Transactions(request.Context(), principal.UserID, filter)
		handler.writeResult(response, result, readErr)
	case "valuations":
		result, readErr := handler.service.Valuations(request.Context(), principal.UserID, filter)
		handler.writeResult(response, result, readErr)
	default:
		result, readErr := handler.service.Activity(request.Context(), principal.UserID, filter)
		handler.writeResult(response, result, readErr)
	}
}

func (handler *CoreReadHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return webauth.Principal{}, false
	}
	if !principal.HasScope(webauth.ScopePortfolioRead) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant portfolio:read.")
		return webauth.Principal{}, false
	}
	return principal, true
}

func (handler *CoreReadHandler) writeResult(response http.ResponseWriter, result any, err error) {
	if errors.Is(err, service.ErrCoreReadNotFound) {
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
		return
	}
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The requested data is temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func pathAccountID(response http.ResponseWriter, request *http.Request) (uuid.UUID, bool) {
	value := chi.URLParam(request, "accountID")
	accountID, err := uuid.Parse(value)
	if err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid account ID", "accountID must be a UUID.")
		return uuid.Nil, false
	}
	return accountID, true
}

func parseActivityFilter(request *http.Request, fixedAccountID *uuid.UUID, allowType bool) (service.ActivityFilter, error) {
	query := request.URL.Query()
	filter := service.ActivityFilter{AccountID: fixedAccountID}
	var err error
	filter.Page.Limit, err = parseBoundedInt(query.Get("limit"), service.DefaultReadLimit, 1, service.MaxReadLimit)
	if err != nil {
		return service.ActivityFilter{}, errors.New("limit must be between 1 and 100")
	}
	filter.Page.Offset, err = parseBoundedInt(query.Get("offset"), 0, 0, service.MaxReadOffset)
	if err != nil {
		return service.ActivityFilter{}, errors.New("offset must be between 0 and 10000")
	}
	if fixedAccountID == nil && query.Get("accountId") != "" {
		accountID, parseErr := uuid.Parse(query.Get("accountId"))
		if parseErr != nil {
			return service.ActivityFilter{}, errors.New("accountId must be a UUID")
		}
		filter.AccountID = &accountID
	}
	if query.Get("type") != "" {
		if !allowType || !transactionTypes[query.Get("type")] {
			return service.ActivityFilter{}, errors.New("type is not a supported transaction type")
		}
		filter.Type = query.Get("type")
	}
	filter.From, err = parseOptionalDate(query.Get("from"))
	if err != nil {
		return service.ActivityFilter{}, errors.New("from must use YYYY-MM-DD")
	}
	filter.To, err = parseOptionalDate(query.Get("to"))
	if err != nil {
		return service.ActivityFilter{}, errors.New("to must use YYYY-MM-DD")
	}
	if filter.From != nil && filter.To != nil && filter.From.After(*filter.To) {
		return service.ActivityFilter{}, errors.New("from must not be after to")
	}
	return filter, nil
}

func parseBoundedInt(value string, fallback, minimum, maximum int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, errors.New("integer outside supported range")
	}
	return parsed, nil
}

func parseOptionalDate(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.DateOnly, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

var transactionTypes = map[string]bool{
	"opening_balance": true, "deposit": true, "withdrawal": true, "interest": true,
	"dividend": true, "capital_gain": true, "capital_loss": true, "fee": true,
	"purchase": true, "sale": true, "manual_adjustment": true, "liability_payment": true,
	"liability_increase": true, "transfer": true,
}
