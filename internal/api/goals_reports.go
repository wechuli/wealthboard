package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type RequestAuthenticator interface {
	AuthenticateRequest(*http.Request) (webauth.Principal, error)
}

type GoalsReportsReader interface {
	ListGoals(context.Context, uuid.UUID) ([]service.GoalRead, error)
	GetGoal(context.Context, uuid.UUID, uuid.UUID) (service.GoalRead, error)
	CalculateGoalScenarios(context.Context, uuid.UUID, uuid.UUID, service.GoalScenarioInput) (service.GoalScenariosRead, error)
	ListMilestones(context.Context, uuid.UUID, uuid.UUID) ([]service.GoalMilestoneRead, error)
	ListAlerts(context.Context, uuid.UUID) ([]service.GoalAlertRead, error)
	Dashboard(context.Context, uuid.UUID, ...string) (service.DashboardRead, error)
	ReportSummary(context.Context, uuid.UUID) (service.ReportSummaryRead, error)
	ReportAllocation(context.Context, uuid.UUID) (service.ReportAllocationRead, error)
	AccountAnalytics(context.Context, uuid.UUID, uuid.UUID) (service.AccountAnalyticsRead, error)
}

type GoalsReportsHandler struct {
	authenticator RequestAuthenticator
	service       GoalsReportsReader
}

func NewGoalsReportsHandler(authenticator RequestAuthenticator, service GoalsReportsReader) *GoalsReportsHandler {
	return &GoalsReportsHandler{authenticator: authenticator, service: service}
}

func RegisterGoalsReportsRoutes(router chi.Router, handler *GoalsReportsHandler) {
	router.Get("/goals/alerts", handler.GoalAlerts)
	router.Get("/goals/{id}/milestones", handler.GoalMilestones)
	router.Get("/goals/{id}/scenarios", handler.GoalScenarios)
	router.Get("/goals/{id}", handler.GoalDetail)
	router.Get("/goals", handler.Goals)
	router.Get("/dashboard", handler.Dashboard)
	router.Get("/accounts/{accountID}/analytics", handler.AccountAnalytics)
	router.Get("/reports/summary", handler.ReportSummary)
	router.Get("/reports/allocation", handler.ReportAllocation)
}

func (handler *GoalsReportsHandler) GoalScenarios(response http.ResponseWriter, request *http.Request) {
	goalID, ok := readResourceID(response, request)
	if !ok {
		return
	}
	contribution := request.URL.Query().Get("monthlyContributionMinor")
	annualReturn, err := strconv.ParseInt(request.URL.Query().Get("annualReturnBps"), 10, 32)
	if contribution == "" || err != nil || annualReturn < 0 || annualReturn > 10000 {
		writeProblem(response, http.StatusUnprocessableEntity, "Invalid request", "Enter a non-negative contribution and an annual return from 0% to 100%.")
		return
	}
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.CalculateGoalScenarios(ctx, userID, goalID, service.GoalScenarioInput{
			MonthlyContributionMinor: contribution,
			AnnualReturnBPS:          int32(annualReturn),
		})
	})
}

func (handler *GoalsReportsHandler) Goals(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.ListGoals(ctx, userID)
	})
}

func (handler *GoalsReportsHandler) GoalDetail(response http.ResponseWriter, request *http.Request) {
	goalID, ok := readResourceID(response, request)
	if !ok {
		return
	}
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.GetGoal(ctx, userID, goalID)
	})
}

func (handler *GoalsReportsHandler) GoalMilestones(response http.ResponseWriter, request *http.Request) {
	goalID, ok := readResourceID(response, request)
	if !ok {
		return
	}
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.ListMilestones(ctx, userID, goalID)
	})
}

func (handler *GoalsReportsHandler) GoalAlerts(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.ListAlerts(ctx, userID)
	})
}

func (handler *GoalsReportsHandler) Dashboard(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.Dashboard(ctx, userID, request.URL.Query().Get("range"))
	})
}

func (handler *GoalsReportsHandler) AccountAnalytics(response http.ResponseWriter, request *http.Request) {
	accountID, err := uuid.Parse(chi.URLParam(request, "accountID"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
		return
	}
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.AccountAnalytics(ctx, userID, accountID)
	})
}

func (handler *GoalsReportsHandler) ReportSummary(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.ReportSummary(ctx, userID)
	})
}

func (handler *GoalsReportsHandler) ReportAllocation(response http.ResponseWriter, request *http.Request) {
	handler.authorizedRead(response, request, func(ctx context.Context, userID uuid.UUID) (any, error) {
		return handler.service.ReportAllocation(ctx, userID)
	})
}

func (handler *GoalsReportsHandler) authorizedRead(response http.ResponseWriter, request *http.Request, read func(context.Context, uuid.UUID) (any, error)) {
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
	if errors.Is(err, service.ErrGoalsReportsNotFound) {
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
		return
	}
	if errors.Is(err, service.ErrGoalsReportsInvalidInput) {
		writeProblem(response, http.StatusUnprocessableEntity, "Invalid request", "Enter a non-negative contribution and an annual return from 0% to 100%.")
		return
	}
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The requested data is temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, value)
}

func readResourceID(response http.ResponseWriter, request *http.Request) (uuid.UUID, bool) {
	resourceID, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
		return uuid.Nil, false
	}
	return resourceID, true
}
