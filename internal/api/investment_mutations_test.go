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

type fakeInvestmentMutationService struct {
	resultID    uuid.UUID
	err         error
	lastUserID  uuid.UUID
	lastAccount uuid.UUID
	lastPage    service.ReadPage
	lastEvent   service.PositionEventMutationInput
	createCalls int
}

func (fake *fakeInvestmentMutationService) PositionEvents(_ context.Context, userID, accountID uuid.UUID, page service.ReadPage) (service.Page[service.PositionEvent], error) {
	fake.lastUserID, fake.lastAccount, fake.lastPage = userID, accountID, page
	return service.Page[service.PositionEvent]{Items: []service.PositionEvent{}, Limit: page.Limit, Offset: page.Offset}, fake.err
}

func (fake *fakeInvestmentMutationService) GetPositionEvent(_ context.Context, userID, accountID, eventID uuid.UUID) (service.PositionEvent, error) {
	fake.lastUserID, fake.lastAccount, fake.resultID = userID, accountID, eventID
	return service.PositionEvent{ID: eventID, AccountID: accountID}, fake.err
}

func (fake *fakeInvestmentMutationService) PositionReconciliations(_ context.Context, userID, accountID uuid.UUID, page service.ReadPage) (service.Page[service.PositionReconciliation], error) {
	fake.lastUserID, fake.lastAccount, fake.lastPage = userID, accountID, page
	return service.Page[service.PositionReconciliation]{Items: []service.PositionReconciliation{}, Limit: page.Limit, Offset: page.Offset}, fake.err
}

func (fake *fakeInvestmentMutationService) CreateInstrument(_ context.Context, userID uuid.UUID, _ service.InstrumentMutationInput) (uuid.UUID, error) {
	fake.lastUserID, fake.createCalls = userID, fake.createCalls+1
	return fake.resultID, fake.err
}

func (fake *fakeInvestmentMutationService) UpdateInstrument(context.Context, uuid.UUID, uuid.UUID, service.InstrumentMutationInput) error {
	return fake.err
}

func (fake *fakeInvestmentMutationService) SetInstrumentArchived(context.Context, uuid.UUID, uuid.UUID, bool) error {
	return fake.err
}

func (fake *fakeInvestmentMutationService) DeleteInstrument(_ context.Context, userID, _ uuid.UUID) error {
	fake.lastUserID = userID
	return fake.err
}

func (fake *fakeInvestmentMutationService) UpsertSecurityPrice(context.Context, uuid.UUID, service.SecurityPriceMutationInput) (uuid.UUID, error) {
	return fake.resultID, fake.err
}

func (fake *fakeInvestmentMutationService) DeleteSecurityPrice(context.Context, uuid.UUID, uuid.UUID) error {
	return fake.err
}

func (fake *fakeInvestmentMutationService) CreatePositionEvent(_ context.Context, userID uuid.UUID, input service.PositionEventMutationInput) (uuid.UUID, error) {
	fake.lastUserID, fake.lastEvent = userID, input
	return fake.resultID, fake.err
}

func (fake *fakeInvestmentMutationService) UpdatePositionEvent(context.Context, uuid.UUID, uuid.UUID, service.PositionEventMutationInput) (uuid.UUID, error) {
	return fake.resultID, fake.err
}

func (fake *fakeInvestmentMutationService) DeletePositionEvent(context.Context, uuid.UUID, uuid.UUID) error {
	return fake.err
}

func (fake *fakeInvestmentMutationService) CreatePositionReconciliation(context.Context, uuid.UUID, service.PositionReconciliationMutationInput) (uuid.UUID, error) {
	return fake.resultID, fake.err
}

func (fake *fakeInvestmentMutationService) DeletePositionReconciliation(context.Context, uuid.UUID, uuid.UUID) error {
	return fake.err
}

func TestInvestmentPositionEventReadPassesOwnerAndAccount(t *testing.T) {
	userID, accountID, eventID := uuid.New(), uuid.New(), uuid.New()
	fake := &fakeInvestmentMutationService{}
	router := investmentMutationRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: userID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, fake)
	path := "/accounts/" + accountID.String() + "/position-events/" + eventID.String()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != http.StatusOK || fake.lastUserID != userID || fake.lastAccount != accountID || fake.resultID != eventID {
		t.Fatalf("position read status=%d, user=%s, account=%s, event=%s", response.Code, fake.lastUserID, fake.lastAccount, fake.resultID)
	}
	fake.err = service.ErrInvestmentMutationNotFound
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign or missing event status = %d", response.Code)
	}
}

func TestInvestmentMutationSessionRequiresOriginAndCSRF(t *testing.T) {
	ownerID := uuid.New()
	csrf := "test-csrf-token-that-is-long-enough"
	fake := &fakeInvestmentMutationService{resultID: uuid.New()}
	router := investmentMutationRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "session", CSRFToken: csrf,
	}}, fake)
	body := `{"name":"Fund","identifierType":"custom","assetType":"fund","quoteCurrency":"USD"}`

	request := httptest.NewRequest(http.MethodPost, "/instruments", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || fake.createCalls != 0 {
		t.Fatalf("missing origin status = %d, calls = %d", response.Code, fake.createCalls)
	}

	request = httptest.NewRequest(http.MethodPost, "/instruments", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || fake.createCalls != 0 {
		t.Fatalf("missing CSRF status = %d, calls = %d", response.Code, fake.createCalls)
	}

	request = httptest.NewRequest(http.MethodPost, "/instruments", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	request.Header.Set("X-CSRF-Token", csrf)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || fake.lastUserID != ownerID {
		t.Fatalf("authorized status = %d, owner = %s, body = %s", response.Code, fake.lastUserID, response.Body.String())
	}
}

func TestInvestmentMutationRequiresPortfolioWrite(t *testing.T) {
	fake := &fakeInvestmentMutationService{resultID: uuid.New()}
	ownerID := uuid.New()
	body := `{"name":"Fund","identifierType":"custom","assetType":"fund","quoteCurrency":"USD"}`

	for _, test := range []struct {
		name       string
		scopes     []webauth.Scope
		wantStatus int
	}{
		{name: "read only", scopes: []webauth.Scope{webauth.ScopePortfolioRead}, wantStatus: http.StatusForbidden},
		{name: "write", scopes: []webauth.Scope{webauth.ScopePortfolioWrite}, wantStatus: http.StatusCreated},
	} {
		t.Run(test.name, func(t *testing.T) {
			router := investmentMutationRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
				UserID: ownerID, Method: "api_key", Scopes: test.scopes,
			}}, fake)
			request := httptest.NewRequest(http.MethodPost, "/instruments", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestInvestmentMutationParsesEventAndMapsForeignNotFound(t *testing.T) {
	ownerID, eventID := uuid.New(), uuid.New()
	fake := &fakeInvestmentMutationService{resultID: eventID}
	router := investmentMutationRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}, fake)
	body := `{"accountId":"` + uuid.NewString() + `","instrumentId":"` + uuid.NewString() + `","type":"buy","quantity":"1.25","unitPrice":"10.50","tradeCurrency":"USD","tradeDate":"2026-09-19","idempotencyKey":"` + uuid.NewString() + `"}`
	request := httptest.NewRequest(http.MethodPost, "/position-events", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || fake.lastUserID != ownerID || fake.lastEvent.Quantity != "1.25" {
		t.Fatalf("event status = %d, owner = %s, event = %+v", response.Code, fake.lastUserID, fake.lastEvent)
	}

	fake.err = ErrInvestmentMutationNotFoundForTest()
	request = httptest.NewRequest(http.MethodDelete, "/instruments/"+uuid.NewString(), nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign delete status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestInvestmentPositionReadsRequireReadScopeAndPassOwnerPagination(t *testing.T) {
	ownerID, accountID := uuid.New(), uuid.New()
	fake := &fakeInvestmentMutationService{}
	router := investmentMutationRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, fake)

	request := httptest.NewRequest(http.MethodGet, "/accounts/"+accountID.String()+"/position-events?limit=25&offset=5", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || fake.lastUserID != ownerID || fake.lastAccount != accountID || fake.lastPage != (service.ReadPage{Limit: 25, Offset: 5}) {
		t.Fatalf("event read status = %d, owner = %s, account = %s, page = %+v", response.Code, fake.lastUserID, fake.lastAccount, fake.lastPage)
	}

	fake.err = ErrInvestmentMutationNotFoundForTest()
	request = httptest.NewRequest(http.MethodGet, "/accounts/"+accountID.String()+"/position-reconciliations", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign reconciliation read status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestInvestmentPositionReadsRejectWriteOnlyScopeAndInvalidPagination(t *testing.T) {
	accountID := uuid.New()
	fake := &fakeInvestmentMutationService{}
	router := investmentMutationRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}, fake)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/accounts/"+accountID.String()+"/position-events", nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("write-only read status = %d, want 403", response.Code)
	}

	router = investmentMutationRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, fake)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/accounts/"+accountID.String()+"/position-events?limit=101", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid pagination status = %d, want 400", response.Code)
	}
}

func ErrInvestmentMutationNotFoundForTest() error {
	return errors.Join(service.ErrInvestmentMutationNotFound, errors.New("foreign resource"))
}

func investmentMutationRouter(auth investmentMutationAuthenticator, mutations investmentMutationService) http.Handler {
	router := chi.NewRouter()
	RegisterInvestmentMutationRoutes(router, NewInvestmentMutationHandler(auth, mutations, "https://wealthboard.example"))
	return router
}
