package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakeCoreReadAuthenticator struct {
	principal webauth.Principal
	err       error
}

func (auth fakeCoreReadAuthenticator) AuthenticateRequest(*http.Request) (webauth.Principal, error) {
	return auth.principal, auth.err
}

type fakeCoreReadService struct {
	transactionUserID uuid.UUID
	transactionFilter service.ActivityFilter
	transactionCalls  int
	accountListCalls  int
	accountErr        error
}

func (fake *fakeCoreReadService) Settings(context.Context, uuid.UUID) (service.Settings, error) {
	return service.Settings{}, nil
}

func (fake *fakeCoreReadService) Categories(context.Context, uuid.UUID) ([]service.Category, error) {
	return []service.Category{}, nil
}

func (fake *fakeCoreReadService) Institutions(context.Context, uuid.UUID) ([]service.Institution, error) {
	return []service.Institution{}, nil
}

func (fake *fakeCoreReadService) Accounts(context.Context, uuid.UUID, string) ([]service.Account, error) {
	fake.accountListCalls++
	return []service.Account{}, nil
}

func (fake *fakeCoreReadService) Account(context.Context, uuid.UUID, uuid.UUID) (service.Account, error) {
	return service.Account{}, fake.accountErr
}

func (fake *fakeCoreReadService) Transactions(_ context.Context, userID uuid.UUID, filter service.ActivityFilter) (service.Page[service.Transaction], error) {
	fake.transactionCalls++
	fake.transactionUserID = userID
	fake.transactionFilter = filter
	return service.Page[service.Transaction]{
		Items: []service.Transaction{{
			ID:          uuid.MustParse("10000000-0000-0000-0000-000000000001"),
			AccountID:   uuid.MustParse("20000000-0000-0000-0000-000000000002"),
			AccountName: "Cash", Type: "deposit", AmountMinor: "9007199254740993",
			Currency: "KES", TransactionDate: "2026-09-20",
		}},
		Limit: filter.Page.Limit, Offset: filter.Page.Offset,
	}, nil
}

func (fake *fakeCoreReadService) Valuations(context.Context, uuid.UUID, service.ActivityFilter) (service.Page[service.Valuation], error) {
	return service.Page[service.Valuation]{}, nil
}

func (fake *fakeCoreReadService) Activity(context.Context, uuid.UUID, service.ActivityFilter) (service.Page[service.ActivityItem], error) {
	return service.Page[service.ActivityItem]{}, nil
}

func TestCoreReadTransactionsDerivesOwnerAndParsesFilters(t *testing.T) {
	userID := uuid.New()
	accountID := uuid.New()
	reads := &fakeCoreReadService{}
	handler := NewCoreReadHandler(fakeCoreReadAuthenticator{principal: webauth.Principal{
		UserID: userID,
		Method: "session",
	}}, reads)
	router := chi.NewRouter()
	router.Get("/api/v1/transactions", handler.Transactions)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/transactions?accountId="+accountID.String()+"&type=deposit&from=2026-09-01&to=2026-09-20&limit=25&offset=5", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if reads.transactionUserID != userID || reads.transactionFilter.AccountID == nil || *reads.transactionFilter.AccountID != accountID {
		t.Fatalf("service owner/filter = %s/%+v", reads.transactionUserID, reads.transactionFilter)
	}
	if reads.transactionFilter.Type != "deposit" || reads.transactionFilter.Page.Limit != 25 || reads.transactionFilter.Page.Offset != 5 {
		t.Fatalf("parsed filter = %+v", reads.transactionFilter)
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Items[0]["amountMinor"] != "9007199254740993" || body.Items[0]["transactionDate"] != "2026-09-20" {
		t.Fatalf("response item = %#v", body.Items[0])
	}
	if _, leaked := body.Items[0]["AmountMinor"]; leaked {
		t.Fatalf("response leaked capitalized Go field: %#v", body.Items[0])
	}
}

func TestCoreReadAccountMapsForeignResourceToNotFound(t *testing.T) {
	reads := &fakeCoreReadService{accountErr: service.ErrCoreReadNotFound}
	handler := NewCoreReadHandler(fakeCoreReadAuthenticator{principal: webauth.Principal{
		UserID: uuid.New(), Method: "session",
	}}, reads)
	router := chi.NewRouter()
	router.Get("/api/v1/accounts/{accountID}", handler.Account)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/accounts/"+uuid.NewString(), nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestCoreReadRejectsOversizedPageBeforeServiceCall(t *testing.T) {
	reads := &fakeCoreReadService{}
	handler := NewCoreReadHandler(fakeCoreReadAuthenticator{principal: webauth.Principal{
		UserID: uuid.New(), Method: "session",
	}}, reads)
	response := httptest.NewRecorder()

	handler.Transactions(response, httptest.NewRequest(http.MethodGet, "/api/v1/transactions?limit=101", nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if reads.transactionCalls != 0 {
		t.Fatalf("service called %d times for invalid pagination", reads.transactionCalls)
	}
}

func TestActivityFilterPaginationBoundaries(t *testing.T) {
	for _, test := range []struct {
		query   string
		page    service.ReadPage
		message string
	}{
		{"", service.ReadPage{Limit: 50}, ""},
		{"?limit=1&offset=0", service.ReadPage{Limit: 1}, ""},
		{"?limit=100&offset=10000", service.ReadPage{Limit: 100, Offset: 10000}, ""},
		{"?limit=%2B025&offset=00005", service.ReadPage{Limit: 25, Offset: 5}, ""},
		{"?limit=0", service.ReadPage{}, "limit must be between 1 and 100"},
		{"?limit=101", service.ReadPage{}, "limit must be between 1 and 100"},
		{"?limit=-1", service.ReadPage{}, "limit must be between 1 and 100"},
		{"?limit=2147483648", service.ReadPage{}, "limit must be between 1 and 100"},
		{"?offset=-1", service.ReadPage{}, "offset must be between 0 and 10000"},
		{"?offset=10001", service.ReadPage{}, "offset must be between 0 and 10000"},
		{"?offset=2147483647", service.ReadPage{}, "offset must be between 0 and 10000"},
		{"?offset=2147483648", service.ReadPage{}, "offset must be between 0 and 10000"},
		{"?offset=-2147483649", service.ReadPage{}, "offset must be between 0 and 10000"},
		{"?offset=9223372036854775808", service.ReadPage{}, "offset must be between 0 and 10000"},
		{"?offset=1.5", service.ReadPage{}, "offset must be between 0 and 10000"},
		{"?offset=%201", service.ReadPage{}, "offset must be between 0 and 10000"},
	} {
		t.Run(test.query, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/v1/transactions"+test.query, nil)
			filter, err := parseActivityFilter(request, nil, true)
			if test.message != "" {
				if err == nil || err.Error() != test.message {
					t.Fatalf("error = %v, want %q", err, test.message)
				}
				return
			}
			if err != nil || filter.Page != test.page {
				t.Fatalf("pagination = %+v, error = %v, want %+v", filter.Page, err, test.page)
			}
		})
	}
}

func TestCoreReadRejectsInvalidArchiveFilterBeforeServiceCall(t *testing.T) {
	reads := &fakeCoreReadService{}
	handler := NewCoreReadHandler(fakeCoreReadAuthenticator{principal: webauth.Principal{
		UserID: uuid.New(), Method: "session",
	}}, reads)
	response := httptest.NewRecorder()

	handler.Accounts(response, httptest.NewRequest(http.MethodGet, "/api/v1/accounts?archived=deleted", nil))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if reads.accountListCalls != 0 {
		t.Fatalf("service called %d times for invalid archive filter", reads.accountListCalls)
	}
}

func TestCoreReadRequiresAuthentication(t *testing.T) {
	handler := NewCoreReadHandler(fakeCoreReadAuthenticator{err: errors.New("invalid session")}, &fakeCoreReadService{})
	response := httptest.NewRecorder()

	handler.Categories(response, httptest.NewRequest(http.MethodGet, "/api/v1/categories", nil))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}
