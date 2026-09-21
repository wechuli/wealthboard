package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakeRequestAuthenticator struct {
	principal webauth.Principal
	err       error
}

func (authenticator fakeRequestAuthenticator) AuthenticateRequest(*http.Request) (webauth.Principal, error) {
	return authenticator.principal, authenticator.err
}

type fakeGoalsReportsReader struct {
	goal       service.GoalRead
	getGoalErr error
	lastUserID uuid.UUID
	lastGoalID uuid.UUID
}

func (reader *fakeGoalsReportsReader) CalculateGoalScenarios(_ context.Context, userID, goalID uuid.UUID, input service.GoalScenarioInput) (service.GoalScenariosRead, error) {
	reader.lastUserID, reader.lastGoalID = userID, goalID
	return service.GoalScenariosRead{SavedPlan: service.GoalScenarioRead{MonthlyContributionMinor: input.MonthlyContributionMinor, AnnualReturnBPS: input.AnnualReturnBPS}}, reader.getGoalErr
}

func (reader *fakeGoalsReportsReader) ListGoals(_ context.Context, userID uuid.UUID) ([]service.GoalRead, error) {
	reader.lastUserID = userID
	return []service.GoalRead{reader.goal}, nil
}

func (reader *fakeGoalsReportsReader) GetGoal(_ context.Context, userID, goalID uuid.UUID) (service.GoalRead, error) {
	reader.lastUserID, reader.lastGoalID = userID, goalID
	return reader.goal, reader.getGoalErr
}

func (reader *fakeGoalsReportsReader) ListMilestones(_ context.Context, userID, goalID uuid.UUID) ([]service.GoalMilestoneRead, error) {
	reader.lastUserID, reader.lastGoalID = userID, goalID
	return []service.GoalMilestoneRead{}, nil
}

func (reader *fakeGoalsReportsReader) ListAlerts(_ context.Context, userID uuid.UUID) ([]service.GoalAlertRead, error) {
	reader.lastUserID = userID
	return []service.GoalAlertRead{}, nil
}

func (reader *fakeGoalsReportsReader) Dashboard(_ context.Context, userID uuid.UUID, _ ...string) (service.DashboardRead, error) {
	reader.lastUserID = userID
	return service.DashboardRead{BaseCurrency: "KES", CurrentComplete: true}, nil
}

func (reader *fakeGoalsReportsReader) AccountAnalytics(_ context.Context, userID, accountID uuid.UUID) (service.AccountAnalyticsRead, error) {
	reader.lastUserID, reader.lastGoalID = userID, accountID
	return service.AccountAnalyticsRead{AccountID: accountID, Currency: "KES", History: []service.AccountHistoryPointRead{}}, reader.getGoalErr
}

func (reader *fakeGoalsReportsReader) ReportSummary(_ context.Context, userID uuid.UUID) (service.ReportSummaryRead, error) {
	reader.lastUserID = userID
	return service.ReportSummaryRead{BaseCurrency: "KES"}, nil
}

func (reader *fakeGoalsReportsReader) ReportAllocation(_ context.Context, userID uuid.UUID) (service.ReportAllocationRead, error) {
	reader.lastUserID = userID
	return service.ReportAllocationRead{BaseCurrency: "KES", Categories: []service.AllocationItemRead{}}, nil
}

func TestGoalsReportsRoutesAuthenticateAndPropagateOwner(t *testing.T) {
	userID, goalID := uuid.New(), uuid.New()
	reader := &fakeGoalsReportsReader{goal: service.GoalRead{ID: goalID, TargetAmountMinor: "10000", CurrentAmountMinor: "2500"}}
	router := chi.NewRouter()
	RegisterGoalsReportsRoutes(router, NewGoalsReportsHandler(fakeRequestAuthenticator{principal: webauth.Principal{
		UserID: userID, Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, reader))

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/goals/"+goalID.String(), nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if reader.lastUserID != userID || reader.lastGoalID != goalID {
		t.Fatalf("service identifiers = %s/%s", reader.lastUserID, reader.lastGoalID)
	}
	if !strings.Contains(response.Body.String(), `"targetAmountMinor":"10000"`) || !strings.Contains(response.Body.String(), `"currentAmountMinor":"2500"`) {
		t.Fatalf("money values were not JSON strings: %s", response.Body.String())
	}
}

func TestGoalScenariosRouteValidatesAndPropagatesAssumptions(t *testing.T) {
	userID, goalID := uuid.New(), uuid.New()
	reader := &fakeGoalsReportsReader{}
	router := chi.NewRouter()
	RegisterGoalsReportsRoutes(router, NewGoalsReportsHandler(fakeRequestAuthenticator{principal: webauth.Principal{
		UserID: userID, Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, reader))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/goals/"+goalID.String()+"/scenarios?monthlyContributionMinor=13000000&annualReturnBps=800", nil))
	if response.Code != http.StatusOK || reader.lastUserID != userID || reader.lastGoalID != goalID {
		t.Fatalf("scenario status/identifiers = %d %s/%s", response.Code, reader.lastUserID, reader.lastGoalID)
	}
	if !strings.Contains(response.Body.String(), `"monthlyContributionMinor":"13000000"`) {
		t.Fatalf("scenario body = %s", response.Body.String())
	}
}

func TestAccountAnalyticsRoutePropagatesOwnerAndHidesForeignAccount(t *testing.T) {
	userID, accountID := uuid.New(), uuid.New()
	reader := &fakeGoalsReportsReader{}
	router := chi.NewRouter()
	RegisterGoalsReportsRoutes(router, NewGoalsReportsHandler(fakeRequestAuthenticator{principal: webauth.Principal{
		UserID: userID, Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, reader))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/accounts/"+accountID.String()+"/analytics", nil))
	if response.Code != http.StatusOK || reader.lastUserID != userID || reader.lastGoalID != accountID {
		t.Fatalf("owner analytics status/identifiers = %d %s/%s", response.Code, reader.lastUserID, reader.lastGoalID)
	}
	reader.getGoalErr = service.ErrGoalsReportsNotFound
	foreign := httptest.NewRecorder()
	router.ServeHTTP(foreign, httptest.NewRequest(http.MethodGet, "/accounts/"+uuid.NewString()+"/analytics", nil))
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign analytics status = %d, body = %s", foreign.Code, foreign.Body.String())
	}
}

func TestGoalsReportsRouteReturnsNotFoundForForeignGoal(t *testing.T) {
	reader := &fakeGoalsReportsReader{getGoalErr: service.ErrGoalsReportsNotFound}
	router := chi.NewRouter()
	RegisterGoalsReportsRoutes(router, NewGoalsReportsHandler(fakeRequestAuthenticator{principal: webauth.Principal{
		UserID: uuid.New(), Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, reader))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/goals/"+uuid.NewString(), nil))
	if response.Code != http.StatusNotFound || response.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("status/content type = %d/%q, body = %s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}
}

func TestGoalsReportsRoutesEnforcePortfolioReadScope(t *testing.T) {
	tests := []struct {
		name          string
		authenticator fakeRequestAuthenticator
		wantStatus    int
	}{
		{name: "authentication required", authenticator: fakeRequestAuthenticator{err: errors.New("invalid")}, wantStatus: http.StatusUnauthorized},
		{name: "scope required", authenticator: fakeRequestAuthenticator{principal: webauth.Principal{UserID: uuid.New()}}, wantStatus: http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := chi.NewRouter()
			RegisterGoalsReportsRoutes(router, NewGoalsReportsHandler(test.authenticator, &fakeGoalsReportsReader{}))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/dashboard", nil))
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}
