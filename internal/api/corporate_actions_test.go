package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakeCorporateActionService struct {
	groupID        uuid.UUID
	err            error
	method         string
	userID         uuid.UUID
	idempotencyKey uuid.UUID
	date           string
	deleteID       uuid.UUID
	calls          int
}

func (fake *fakeCorporateActionService) record(method string, userID, key uuid.UUID, date string) (uuid.UUID, error) {
	fake.method, fake.userID, fake.idempotencyKey, fake.date = method, userID, key, date
	fake.calls++
	return fake.groupID, fake.err
}

func (fake *fakeCorporateActionService) RecordStockSplit(_ context.Context, userID uuid.UUID, input service.StockSplitInput) (uuid.UUID, error) {
	return fake.record("split", userID, input.IdempotencyKey, input.ActionDate.Format("2006-01-02"))
}

func (fake *fakeCorporateActionService) RecordSpinoff(_ context.Context, userID uuid.UUID, input service.SpinoffInput) (uuid.UUID, error) {
	return fake.record("spinoff", userID, input.IdempotencyKey, input.ActionDate.Format("2006-01-02"))
}

func (fake *fakeCorporateActionService) RecordMerger(_ context.Context, userID uuid.UUID, input service.MergerInput) (uuid.UUID, error) {
	return fake.record("merger", userID, input.IdempotencyKey, input.ActionDate.Format("2006-01-02"))
}

func (fake *fakeCorporateActionService) RecordDividendReinvestment(_ context.Context, userID uuid.UUID, input service.DividendReinvestmentInput) (uuid.UUID, error) {
	return fake.record("dividend", userID, input.IdempotencyKey, input.ActivityDate.Format("2006-01-02"))
}

func (fake *fakeCorporateActionService) RecordInKindTransfer(_ context.Context, userID uuid.UUID, input service.InKindTransferInput) (uuid.UUID, error) {
	return fake.record("transfer", userID, input.IdempotencyKey, input.TransferDate.Format("2006-01-02"))
}

func (fake *fakeCorporateActionService) DeleteGroup(_ context.Context, userID, eventID uuid.UUID) error {
	fake.method, fake.userID, fake.deleteID = "delete", userID, eventID
	fake.calls++
	return fake.err
}

func TestCorporateActionRoutesPassOwnerDateAndIdempotency(t *testing.T) {
	ownerID, accountID, secondAccountID := uuid.New(), uuid.New(), uuid.New()
	instrumentID, secondInstrumentID := uuid.New(), uuid.New()
	groupID, key := uuid.New(), uuid.New()
	auth := fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		want   string
	}{
		{name: "split", method: http.MethodPost, path: "/corporate-actions/stock-splits", want: "split", body: `{"accountId":"` + accountID.String() + `","instrumentId":"` + instrumentID.String() + `","numerator":"2","denominator":"1","actionDate":"2026-09-20"}`},
		{name: "spinoff", method: http.MethodPost, path: "/corporate-actions/spinoffs", want: "spinoff", body: `{"accountId":"` + accountID.String() + `","sourceInstrumentId":"` + instrumentID.String() + `","newInstrumentId":"` + secondInstrumentID.String() + `","numerator":"1","denominator":"4","actionDate":"2026-09-20"}`},
		{name: "merger", method: http.MethodPost, path: "/corporate-actions/mergers", want: "merger", body: `{"accountId":"` + accountID.String() + `","sourceInstrumentId":"` + instrumentID.String() + `","destinationInstrumentId":"` + secondInstrumentID.String() + `","numerator":"3","denominator":"2","actionDate":"2026-09-20"}`},
		{name: "dividend", method: http.MethodPost, path: "/corporate-actions/dividend-reinvestments", want: "dividend", body: `{"accountId":"` + accountID.String() + `","instrumentId":"` + instrumentID.String() + `","dividendAmount":"10.00","quantity":"1","unitPrice":"10.00","activityDate":"2026-09-20"}`},
		{name: "transfer", method: http.MethodPost, path: "/corporate-actions/in-kind-transfers", want: "transfer", body: `{"sourceAccountId":"` + accountID.String() + `","destinationAccountId":"` + secondAccountID.String() + `","instrumentId":"` + instrumentID.String() + `","quantity":"1","transferDate":"2026-09-20"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeCorporateActionService{groupID: groupID}
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Idempotency-Key", key.String())
			response := httptest.NewRecorder()
			corporateActionRouter(auth, fake).ServeHTTP(response, request)
			if response.Code != http.StatusCreated || fake.calls != 1 || fake.method != test.want || fake.userID != ownerID || fake.idempotencyKey != key || fake.date != "2026-09-20" {
				t.Fatalf("status=%d fake=%+v body=%s", response.Code, fake, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), groupID.String()) {
				t.Fatalf("response body = %s, want group ID", response.Body.String())
			}
		})
	}
}

func TestCorporateActionRoutesEnforceSessionAndKeyConsistency(t *testing.T) {
	ownerID, accountID, instrumentID := uuid.New(), uuid.New(), uuid.New()
	csrf := "corporate-action-csrf-token-long-enough"
	bodyKey, headerKey := uuid.New(), uuid.New()
	body := `{"accountId":"` + accountID.String() + `","instrumentId":"` + instrumentID.String() + `","numerator":"2","denominator":"1","actionDate":"2026-09-20","idempotencyKey":"` + bodyKey.String() + `"}`
	fake := &fakeCorporateActionService{groupID: uuid.New()}
	router := corporateActionRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "session", CSRFToken: csrf,
	}}, fake)

	request := httptest.NewRequest(http.MethodPost, "/corporate-actions/stock-splits", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || fake.calls != 0 {
		t.Fatalf("missing origin status=%d calls=%d", response.Code, fake.calls)
	}

	request = httptest.NewRequest(http.MethodPost, "/corporate-actions/stock-splits", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	request.Header.Set("X-CSRF-Token", csrf)
	request.Header.Set("Idempotency-Key", headerKey.String())
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || fake.calls != 0 {
		t.Fatalf("key mismatch status=%d calls=%d body=%s", response.Code, fake.calls, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, "/corporate-actions/stock-splits", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	request.Header.Set("X-CSRF-Token", csrf)
	request.Header.Set("Idempotency-Key", bodyKey.String())
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || fake.calls != 1 {
		t.Fatalf("authorized status=%d calls=%d body=%s", response.Code, fake.calls, response.Body.String())
	}
}

func TestCorporateActionDeleteAndForeignNotFound(t *testing.T) {
	ownerID, eventID := uuid.New(), uuid.New()
	fake := &fakeCorporateActionService{}
	auth := fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}

	request := httptest.NewRequest(http.MethodDelete, "/corporate-actions/"+eventID.String(), nil)
	response := httptest.NewRecorder()
	corporateActionRouter(auth, fake).ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || fake.method != "delete" || fake.userID != ownerID || fake.deleteID != eventID {
		t.Fatalf("delete status=%d fake=%+v body=%s", response.Code, fake, response.Body.String())
	}

	fake.err = service.ErrInvestmentMutationNotFound
	request = httptest.NewRequest(http.MethodDelete, "/corporate-actions/"+uuid.NewString(), nil)
	response = httptest.NewRecorder()
	corporateActionRouter(auth, fake).ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign delete status=%d body=%s", response.Code, response.Body.String())
	}
}

func corporateActionRouter(auth corporateActionAuthenticator, actions corporateActionService) http.Handler {
	router := chi.NewRouter()
	RegisterCorporateActionRoutes(router, NewCorporateActionHandler(auth, actions, "https://wealthboard.example"))
	return router
}
