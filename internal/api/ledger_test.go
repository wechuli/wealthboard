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

type ledgerFakeAuthenticator struct {
	principal webauth.Principal
	err       error
}

func (authenticator ledgerFakeAuthenticator) AuthenticateRequest(*http.Request) (webauth.Principal, error) {
	return authenticator.principal, authenticator.err
}

type fakeLedgerMutator struct {
	createdID            uuid.UUID
	lastUserID           uuid.UUID
	lastTransaction      service.TransactionMutationInput
	deleteTransactionErr error
}

func (fake *fakeLedgerMutator) CreateAccount(_ context.Context, userID uuid.UUID, _ service.AccountMutationInput) (uuid.UUID, error) {
	fake.lastUserID = userID
	return fake.createdID, nil
}
func (fake *fakeLedgerMutator) UpdateAccount(context.Context, uuid.UUID, uuid.UUID, service.AccountMutationInput) error {
	return nil
}
func (fake *fakeLedgerMutator) SetAccountArchived(context.Context, uuid.UUID, uuid.UUID, bool) error {
	return nil
}
func (fake *fakeLedgerMutator) DeleteAccount(context.Context, uuid.UUID, uuid.UUID, string) error {
	return nil
}
func (fake *fakeLedgerMutator) CreateTransaction(_ context.Context, userID uuid.UUID, input service.TransactionMutationInput) (uuid.UUID, error) {
	fake.lastUserID, fake.lastTransaction = userID, input
	return fake.createdID, nil
}
func (fake *fakeLedgerMutator) UpdateTransaction(context.Context, uuid.UUID, uuid.UUID, service.TransactionMutationInput) error {
	return nil
}
func (fake *fakeLedgerMutator) DeleteTransaction(_ context.Context, _ uuid.UUID, _ uuid.UUID) error {
	return fake.deleteTransactionErr
}
func (fake *fakeLedgerMutator) CreateValuation(context.Context, uuid.UUID, service.ValuationMutationInput) (uuid.UUID, error) {
	return fake.createdID, nil
}
func (fake *fakeLedgerMutator) DeleteValuation(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}
func (fake *fakeLedgerMutator) CreateTransfer(context.Context, uuid.UUID, service.TransferMutationInput) (uuid.UUID, error) {
	return fake.createdID, nil
}

func TestLedgerRoutesRequirePortfolioWriteAndBrowserCSRF(t *testing.T) {
	tests := []struct {
		name      string
		principal webauth.Principal
		headers   map[string]string
		want      int
	}{
		{name: "write scope required", principal: webauth.Principal{UserID: uuid.New(), Method: "api_key"}, want: http.StatusForbidden},
		{name: "session origin required", principal: webauth.Principal{UserID: uuid.New(), Method: "session", CSRFToken: "token", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}, want: http.StatusForbidden},
		{name: "session csrf required", principal: webauth.Principal{UserID: uuid.New(), Method: "session", CSRFToken: "token", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}, headers: map[string]string{"Origin": "https://wealth.test"}, want: http.StatusUnauthorized},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := chi.NewRouter()
			RegisterLedgerRoutes(router, NewLedgerHandler(ledgerFakeAuthenticator{principal: test.principal}, &fakeLedgerMutator{}, "https://wealth.test"))
			request := httptest.NewRequest(http.MethodPost, "/transactions", strings.NewReader(`{}`))
			request.Header.Set("Content-Type", "application/json")
			for name, value := range test.headers {
				request.Header.Set(name, value)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestLedgerTransactionRoutePropagatesOwnerAndBigintString(t *testing.T) {
	userID, accountID, resultID, key := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	fake := &fakeLedgerMutator{createdID: resultID}
	router := chi.NewRouter()
	RegisterLedgerRoutes(router, NewLedgerHandler(ledgerFakeAuthenticator{principal: webauth.Principal{
		UserID: userID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}, fake, "https://wealth.test"))
	body := `{"idempotencyKey":"` + key.String() + `","accountId":"` + accountID.String() + `","type":"deposit","amountMinor":"9223372036854775807","transactionDate":"2026-09-20"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/transactions", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if fake.lastUserID != userID || fake.lastTransaction.AccountID != accountID || fake.lastTransaction.AmountMinor != int64(9223372036854775807) {
		t.Fatalf("service input = user %s, transaction %+v", fake.lastUserID, fake.lastTransaction)
	}
}

func TestLedgerRouteRejectsJSONNumberForMinorUnits(t *testing.T) {
	userID, accountID, key := uuid.New(), uuid.New(), uuid.New()
	router := chi.NewRouter()
	RegisterLedgerRoutes(router, NewLedgerHandler(ledgerFakeAuthenticator{principal: webauth.Principal{
		UserID: userID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}, &fakeLedgerMutator{}, "https://wealth.test"))
	body := `{"idempotencyKey":"` + key.String() + `","accountId":"` + accountID.String() + `","type":"deposit","amountMinor":10,"transactionDate":"2026-09-20"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/transactions", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body = %s", response.Code, response.Body.String())
	}
}

func TestLedgerRouteMapsForeignResourceToNotFound(t *testing.T) {
	fake := &fakeLedgerMutator{deleteTransactionErr: service.ErrLedgerNotFound}
	router := chi.NewRouter()
	RegisterLedgerRoutes(router, NewLedgerHandler(ledgerFakeAuthenticator{principal: webauth.Principal{
		UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}, fake, "https://wealth.test"))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodDelete, "/transactions/"+uuid.NewString(), nil))
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "The requested resource does not exist") {
		t.Fatalf("status/body = %d/%s", response.Code, response.Body.String())
	}
}

func TestLedgerRouteRejectsInvalidAuthentication(t *testing.T) {
	router := chi.NewRouter()
	RegisterLedgerRoutes(router, NewLedgerHandler(ledgerFakeAuthenticator{err: errors.New("invalid")}, &fakeLedgerMutator{}, "https://wealth.test"))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodDelete, "/transactions/"+uuid.NewString(), nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}
