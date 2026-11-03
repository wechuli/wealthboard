package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakeInsightsReader struct {
	userID       uuid.UUID
	resourceID   uuid.UUID
	rangeName    string
	notFound     bool
	failure      error
	summaryCalls int
}

func (reader *fakeInsightsReader) result(userID uuid.UUID) error {
	reader.userID = userID
	if reader.notFound {
		return service.ErrGoalsReportsNotFound
	}
	return reader.failure
}

func (reader *fakeInsightsReader) AccountSummaries(_ context.Context, userID uuid.UUID) ([]service.AccountSummaryRead, error) {
	reader.summaryCalls++
	return []service.AccountSummaryRead{{AccountID: uuid.MustParse("30000000-0000-0000-0000-000000000003"),
		Sparkline:     []service.AccountHistoryPointRead{{Date: "2026-01-31", ValueMinor: "9007199254740993", Complete: true}},
		LastUpdatedAt: "2026-02-01T00:00:00Z", AsOfDate: "2026-01-31", Freshness: "not_applicable",
		MissingPrices: []service.InstrumentRefRead{}, MissingCurrencies: []string{}, LinkedGoals: []service.GoalRefRead{}}}, reader.result(userID)
}

func (reader *fakeInsightsReader) Attention(_ context.Context, userID uuid.UUID) (service.AttentionSummaryRead, error) {
	return service.AttentionSummaryRead{Items: []service.AttentionItemRead{}}, reader.result(userID)
}

func (reader *fakeInsightsReader) FlowsReport(_ context.Context, userID uuid.UUID, rangeName string) (service.FlowsReportRead, error) {
	reader.rangeName = rangeName
	return service.FlowsReportRead{BaseCurrency: "KES", Range: rangeName, StartValueMinor: "100", EndValueMinor: "250",
		Months: []service.MonthlyFlowPointRead{}}, reader.result(userID)
}

func (reader *fakeInsightsReader) IncomeReport(_ context.Context, userID uuid.UUID, rangeName string) (service.IncomeReportRead, error) {
	reader.rangeName = rangeName
	return service.IncomeReportRead{BaseCurrency: "KES"}, reader.result(userID)
}

func (reader *fakeInsightsReader) NetWorthStats(_ context.Context, userID uuid.UUID) (service.NetWorthStatsRead, error) {
	return service.NetWorthStatsRead{BaseCurrency: "KES"}, reader.result(userID)
}

func (reader *fakeInsightsReader) AccountComparison(_ context.Context, userID uuid.UUID, rangeName string) (service.AccountComparisonRead, error) {
	reader.rangeName = rangeName
	return service.AccountComparisonRead{Rows: []service.AccountComparisonRowRead{{ReturnStatus: "methodology_unavailable", DepositsMinor: "0"}}}, reader.result(userID)
}

func (reader *fakeInsightsReader) AccountExtras(_ context.Context, userID, accountID uuid.UUID) (service.AccountExtrasRead, error) {
	reader.resourceID = accountID
	return service.AccountExtrasRead{AccountID: accountID}, reader.result(userID)
}

func (reader *fakeInsightsReader) InstrumentHoldings(_ context.Context, userID, instrumentID uuid.UUID) (service.InstrumentHoldingsRead, error) {
	reader.resourceID = instrumentID
	return service.InstrumentHoldingsRead{InstrumentID: instrumentID}, reader.result(userID)
}

func insightsTestRouter(authenticator fakeRequestAuthenticator, reader *fakeInsightsReader) chi.Router {
	router := chi.NewRouter()
	RegisterInsightsRoutes(router, NewInsightsHandler(authenticator, reader))
	return router
}

var insightsPaths = []string{
	"/accounts/summaries", "/attention", "/reports/flows", "/reports/income", "/reports/net-worth-stats",
	"/reports/account-comparison", "/accounts/" + uuid.NewString() + "/extras", "/instruments/" + uuid.NewString() + "/holdings",
}

func TestInsightsRoutesRequireAuthenticationAndPortfolioRead(t *testing.T) {
	for _, path := range insightsPaths {
		for _, test := range []struct {
			name          string
			authenticator fakeRequestAuthenticator
			want          int
		}{
			{"unauthenticated", fakeRequestAuthenticator{err: errors.New("no session")}, http.StatusUnauthorized},
			{"missing scope", fakeRequestAuthenticator{principal: webauth.Principal{UserID: uuid.New()}}, http.StatusForbidden},
		} {
			reader := &fakeInsightsReader{}
			response := httptest.NewRecorder()
			insightsTestRouter(test.authenticator, reader).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
			if response.Code != test.want || response.Header().Get("Content-Type") != "application/problem+json" {
				t.Fatalf("%s %s status = %d %q", test.name, path, response.Code, response.Header().Get("Content-Type"))
			}
			if reader.userID != uuid.Nil || reader.summaryCalls != 0 {
				t.Fatalf("%s %s reached the service", test.name, path)
			}
		}
	}
}

func TestInsightsRoutesValidateRangeAfterAuthentication(t *testing.T) {
	userID := uuid.New()
	authenticator := fakeRequestAuthenticator{principal: webauth.Principal{UserID: userID, Scopes: []webauth.Scope{webauth.ScopePortfolioRead}}}
	for _, path := range []string{"/reports/flows", "/reports/income", "/reports/account-comparison"} {
		reader := &fakeInsightsReader{}
		response := httptest.NewRecorder()
		insightsTestRouter(authenticator, reader).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path+"?range=2y", nil))
		if response.Code != http.StatusUnprocessableEntity || response.Header().Get("Content-Type") != "application/problem+json" || reader.userID != uuid.Nil {
			t.Fatalf("%s invalid range = %d %q body=%s", path, response.Code, response.Header().Get("Content-Type"), response.Body.String())
		}
		response = httptest.NewRecorder()
		insightsTestRouter(authenticator, reader).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || reader.rangeName != "1y" || reader.userID != userID {
			t.Fatalf("%s default range = %d %q owner=%s", path, response.Code, reader.rangeName, reader.userID)
		}
		response = httptest.NewRecorder()
		insightsTestRouter(authenticator, reader).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path+"?range=3m", nil))
		if response.Code != http.StatusOK || reader.rangeName != "3m" {
			t.Fatalf("%s explicit range = %d %q", path, response.Code, reader.rangeName)
		}
	}
}

func TestInsightsResourceRoutesHideUnknownAndUnparseableIDs(t *testing.T) {
	userID, accountID := uuid.New(), uuid.New()
	authenticator := fakeRequestAuthenticator{principal: webauth.Principal{UserID: userID, Scopes: []webauth.Scope{webauth.ScopePortfolioRead}}}
	for _, path := range []string{"/accounts/not-a-uuid/extras", "/instruments/not-a-uuid/holdings"} {
		reader := &fakeInsightsReader{}
		response := httptest.NewRecorder()
		insightsTestRouter(authenticator, reader).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound || response.Header().Get("Content-Type") != "application/problem+json" || reader.resourceID != uuid.Nil {
			t.Fatalf("%s = %d %q", path, response.Code, response.Header().Get("Content-Type"))
		}
	}
	for _, path := range []string{"/accounts/" + accountID.String() + "/extras", "/instruments/" + accountID.String() + "/holdings"} {
		reader := &fakeInsightsReader{notFound: true}
		response := httptest.NewRecorder()
		insightsTestRouter(authenticator, reader).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound || reader.userID != userID || reader.resourceID != accountID {
			t.Fatalf("%s foreign = %d owner=%s id=%s", path, response.Code, reader.userID, reader.resourceID)
		}
		if strings.Contains(response.Body.String(), accountID.String()) {
			t.Fatalf("not-found problem leaked the identifier: %s", response.Body.String())
		}
	}
	reader := &fakeInsightsReader{failure: errors.New("database password=secret")}
	response := httptest.NewRecorder()
	insightsTestRouter(authenticator, reader).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/attention", nil))
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "secret") {
		t.Fatalf("unexpected error mapping = %d %s", response.Code, response.Body.String())
	}
}

func TestInsightsRoutesReturnOwnerScopedJSON(t *testing.T) {
	userID := uuid.New()
	authenticator := fakeRequestAuthenticator{principal: webauth.Principal{UserID: userID, Scopes: []webauth.Scope{webauth.ScopePortfolioRead}}}
	reader := &fakeInsightsReader{}
	router := insightsTestRouter(authenticator, reader)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/accounts/summaries", nil))
	var summaries []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &summaries); err != nil || response.Code != http.StatusOK || reader.userID != userID {
		t.Fatalf("summaries = %d %s err=%v", response.Code, response.Body.String(), err)
	}
	if len(summaries) != 1 || summaries[0]["positionCount"] != nil || !strings.Contains(response.Body.String(), `"valueMinor":"9007199254740993"`) ||
		!strings.Contains(response.Body.String(), `"positionCount":null`) || !strings.Contains(response.Body.String(), `"missingPrices":[]`) {
		t.Fatalf("summary JSON shape = %s", response.Body.String())
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/reports/flows?range=all", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"startValueMinor":"100"`) || !strings.Contains(response.Body.String(), `"range":"all"`) {
		t.Fatalf("flows JSON = %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/reports/account-comparison", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"annualizedReturnBps":null`) || !strings.Contains(response.Body.String(), `"startMinor":null`) {
		t.Fatalf("comparison JSON = %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/attention", nil))
	if response.Code != http.StatusOK || response.Body.String() != "{\"totalsComplete\":false,\"items\":[]}\n" {
		t.Fatalf("attention JSON = %d %q", response.Code, response.Body.String())
	}
}

func TestActivityFeedRouteParsesFiltersAndHidesForeignAccounts(t *testing.T) {
	userID, accountID := uuid.New(), uuid.New()
	principal := webauth.Principal{UserID: userID, Scopes: []webauth.Scope{webauth.ScopePortfolioRead}}
	reads := &fakeCoreReadService{}
	handler := NewCoreReadHandler(fakeCoreReadAuthenticator{principal: principal}, reads)
	request := httptest.NewRequest(http.MethodGet, "/activity?kind=position&type=buy&accountId="+accountID.String()+"&from=2026-01-01&to=2026-02-01&q=+Fund+&limit=20&offset=40", nil)
	response := httptest.NewRecorder()
	handler.ActivityFeed(response, request)
	filter := reads.feedFilter
	if response.Code != http.StatusOK || reads.feedUserID != userID || filter.Kind != "position" || filter.Type != "buy" || filter.AccountID == nil ||
		*filter.AccountID != accountID || filter.Query != "Fund" || filter.Page.Limit != 20 || filter.Page.Offset != 40 ||
		filter.From.Format("2006-01-02") != "2026-01-01" || filter.To.Format("2006-01-02") != "2026-02-01" {
		t.Fatalf("activity feed = %d filter=%+v body=%s", response.Code, filter, response.Body.String())
	}
	for _, query := range []string{"kind=ledger", "type=rename", "limit=101", "offset=10001", "accountId=nope", "from=2026-02-02&to=2026-02-01", "q=" + strings.Repeat("x", 201)} {
		reads.feedCalls = 0
		response = httptest.NewRecorder()
		handler.ActivityFeed(response, httptest.NewRequest(http.MethodGet, "/activity?"+query, nil))
		if response.Code != http.StatusBadRequest || reads.feedCalls != 0 {
			t.Fatalf("invalid query %q = %d calls=%d", query, response.Code, reads.feedCalls)
		}
	}
	reads.accountErr = service.ErrCoreReadNotFound
	response = httptest.NewRecorder()
	handler.ActivityFeed(response, httptest.NewRequest(http.MethodGet, "/activity?accountId="+uuid.NewString(), nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign account feed = %d", response.Code)
	}
	for _, auth := range []fakeCoreReadAuthenticator{{err: errors.New("no session")}, {principal: webauth.Principal{UserID: userID}}} {
		reads.feedCalls = 0
		response = httptest.NewRecorder()
		NewCoreReadHandler(auth, reads).ActivityFeed(response, httptest.NewRequest(http.MethodGet, "/activity", nil))
		if (response.Code != http.StatusUnauthorized && response.Code != http.StatusForbidden) || reads.feedCalls != 0 {
			t.Fatalf("unauthorized feed = %d calls=%d", response.Code, reads.feedCalls)
		}
	}
}

func TestRouterServesInsightsBesideAccountRoutes(t *testing.T) {
	auth, _ := testAuthHandlerWithRegistration(t, nil, nil, nil)
	principal := webauth.Principal{UserID: uuid.New(), Scopes: []webauth.Scope{webauth.ScopePortfolioRead}}
	insights := &fakeInsightsReader{}
	reads := &fakeCoreReadService{}
	router := NewRouterWithReads(slog.New(slog.NewTextHandler(io.Discard, nil)), func(context.Context) error { return nil }, auth, nil, ReadHandlers{
		Core:     NewCoreReadHandler(fakeCoreReadAuthenticator{principal: principal}, reads),
		Insights: NewInsightsHandler(fakeRequestAuthenticator{principal: principal}, insights),
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/accounts/summaries", nil))
	if response.Code != http.StatusOK || insights.summaryCalls != 1 {
		t.Fatalf("summaries route = %d calls=%d body=%s", response.Code, insights.summaryCalls, response.Body.String())
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/activity", nil))
	if response.Code != http.StatusOK || reads.feedCalls != 1 {
		t.Fatalf("activity route = %d calls=%d", response.Code, reads.feedCalls)
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/instruments/"+uuid.NewString()+"/holdings", nil))
	if response.Code != http.StatusOK || insights.resourceID == uuid.Nil {
		t.Fatalf("holdings route = %d", response.Code)
	}
}
