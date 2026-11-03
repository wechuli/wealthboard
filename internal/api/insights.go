package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

// InsightsReader serves the owner-scoped read models used by the redesigned client.
type InsightsReader interface {
	AccountSummaries(context.Context, uuid.UUID) ([]service.AccountSummaryRead, error)
	Attention(context.Context, uuid.UUID) (service.AttentionSummaryRead, error)
	FlowsReport(context.Context, uuid.UUID, string) (service.FlowsReportRead, error)
	IncomeReport(context.Context, uuid.UUID, string) (service.IncomeReportRead, error)
	NetWorthStats(context.Context, uuid.UUID) (service.NetWorthStatsRead, error)
	AccountComparison(context.Context, uuid.UUID, string) (service.AccountComparisonRead, error)
	AccountExtras(context.Context, uuid.UUID, uuid.UUID) (service.AccountExtrasRead, error)
	InstrumentHoldings(context.Context, uuid.UUID, uuid.UUID) (service.InstrumentHoldingsRead, error)
}

type InsightsHandler struct {
	authenticator RequestAuthenticator
	service       InsightsReader
}

func NewInsightsHandler(authenticator RequestAuthenticator, service InsightsReader) *InsightsHandler {
	return &InsightsHandler{authenticator: authenticator, service: service}
}

func RegisterInsightsRoutes(router chi.Router, handler *InsightsHandler) {
	router.Get("/accounts/summaries", handler.AccountSummaries)
	router.Get("/accounts/{accountID}/extras", handler.AccountExtras)
	router.Get("/attention", handler.Attention)
	router.Get("/reports/flows", handler.FlowsReport)
	router.Get("/reports/income", handler.IncomeReport)
	router.Get("/reports/net-worth-stats", handler.NetWorthStats)
	router.Get("/reports/account-comparison", handler.AccountComparison)
	router.Get("/instruments/{id}/holdings", handler.InstrumentHoldings)
}

func (handler *InsightsHandler) AccountSummaries(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.AccountSummaries(ctx, userID)
	})
}

func (handler *InsightsHandler) Attention(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.Attention(ctx, userID)
	})
}

func (handler *InsightsHandler) FlowsReport(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		rangeName, err := insightsRange(request)
		if err != nil {
			return nil, err
		}
		return handler.service.FlowsReport(ctx, userID, rangeName)
	})
}

func (handler *InsightsHandler) IncomeReport(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		rangeName, err := insightsRange(request)
		if err != nil {
			return nil, err
		}
		return handler.service.IncomeReport(ctx, userID, rangeName)
	})
}

func (handler *InsightsHandler) NetWorthStats(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.NetWorthStats(ctx, userID)
	})
}

func (handler *InsightsHandler) AccountComparison(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		rangeName, err := insightsRange(request)
		if err != nil {
			return nil, err
		}
		return handler.service.AccountComparison(ctx, userID, rangeName)
	})
}

func (handler *InsightsHandler) AccountExtras(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		accountID, err := uuid.Parse(chi.URLParam(request, "accountID"))
		if err != nil {
			return nil, service.ErrGoalsReportsNotFound
		}
		return handler.service.AccountExtras(ctx, userID, accountID)
	})
}

func (handler *InsightsHandler) InstrumentHoldings(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		instrumentID, err := uuid.Parse(chi.URLParam(request, "id"))
		if err != nil {
			return nil, service.ErrGoalsReportsNotFound
		}
		return handler.service.InstrumentHoldings(ctx, userID, instrumentID)
	})
}

// insightsRange validates the optional range query at the API boundary; omitted means 1y.
func insightsRange(request *http.Request) (string, error) {
	value := request.URL.Query().Get("range")
	switch value {
	case "":
		return "1y", nil
	case "1m", "3m", "6m", "1y", "all":
		return value, nil
	default:
		return "", service.ErrInsightsInvalidRange
	}
}

// authorizedRead authenticates, requires portfolio:read, and maps service errors to problem responses. Range
// validation happens after authentication so unauthenticated callers learn nothing about parameters.
func (handler *InsightsHandler) authorizedRead(response http.ResponseWriter, request *http.Request, read func(context.Context, uuid.UUID) (any, error)) {
	principal, err := handler.authenticator.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return
	}
	if !principal.HasScope(webauth.ScopePortfolioRead) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant portfolio:read.")
		return
	}
	value, err := read(request.Context(), principal.UserID)
	switch {
	case errors.Is(err, service.ErrGoalsReportsNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
	case errors.Is(err, service.ErrInsightsInvalidRange):
		writeProblem(response, http.StatusUnprocessableEntity, "Invalid request", "range must be one of 1m, 3m, 6m, 1y, or all.")
	case err != nil:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The requested data is temporarily unavailable.")
	default:
		writeJSON(response, http.StatusOK, value)
	}
}
