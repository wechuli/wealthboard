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

type fakeMetadataAuthorizer struct {
	principal webauth.Principal
	err       error
}

func (fake fakeMetadataAuthorizer) AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error) {
	return fake.principal, fake.err
}

type fakeMetadataService struct {
	lastUserID     uuid.UUID
	lastResourceID uuid.UUID
	categoryInput  service.CategoryInput
	err            error
}

func (fake *fakeMetadataService) UpdateSettings(_ context.Context, userID uuid.UUID, _ service.SettingsInput) error {
	fake.lastUserID = userID
	return fake.err
}
func (fake *fakeMetadataService) CreateCategory(_ context.Context, userID uuid.UUID, input service.CategoryInput) (service.Category, error) {
	fake.lastUserID, fake.categoryInput = userID, input
	return service.Category{ID: uuid.New(), Name: input.Name}, fake.err
}
func (fake *fakeMetadataService) UpdateCategory(_ context.Context, userID, resourceID uuid.UUID, input service.CategoryInput) error {
	fake.lastUserID, fake.lastResourceID, fake.categoryInput = userID, resourceID, input
	return fake.err
}
func (fake *fakeMetadataService) ArchiveCategory(_ context.Context, userID, resourceID uuid.UUID, _ bool) error {
	fake.lastUserID, fake.lastResourceID = userID, resourceID
	return fake.err
}
func (fake *fakeMetadataService) ReorderCategory(_ context.Context, userID, resourceID uuid.UUID, _ string) error {
	fake.lastUserID, fake.lastResourceID = userID, resourceID
	return fake.err
}
func (fake *fakeMetadataService) CreateInstitution(_ context.Context, userID uuid.UUID, input service.InstitutionInput) (service.Institution, error) {
	fake.lastUserID = userID
	return service.Institution{ID: uuid.New(), Name: input.Name}, fake.err
}
func (fake *fakeMetadataService) UpdateInstitution(_ context.Context, userID, resourceID uuid.UUID, _ service.InstitutionInput) error {
	fake.lastUserID, fake.lastResourceID = userID, resourceID
	return fake.err
}
func (fake *fakeMetadataService) ArchiveInstitution(_ context.Context, userID, resourceID uuid.UUID, _ bool) error {
	fake.lastUserID, fake.lastResourceID = userID, resourceID
	return fake.err
}
func (fake *fakeMetadataService) CreateExchangeRate(_ context.Context, userID uuid.UUID, input service.ExchangeRateInput) (service.ExchangeRate, error) {
	fake.lastUserID = userID
	return service.ExchangeRate{ID: uuid.New(), Rate: input.Rate}, fake.err
}
func (fake *fakeMetadataService) DeleteExchangeRate(_ context.Context, userID, resourceID uuid.UUID) error {
	fake.lastUserID, fake.lastResourceID = userID, resourceID
	return fake.err
}

func TestMetadataMutationCreateCategoryPassesAuthenticatedOwner(t *testing.T) {
	ownerID := uuid.New()
	fake := &fakeMetadataService{}
	router := metadataMutationRouter(fakeMetadataAuthorizer{principal: webauth.Principal{UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}}, fake)
	request := httptest.NewRequest(http.MethodPost, "/categories", strings.NewReader(`{"name":"Cash","icon":"Wallet","assetOrLiability":"asset","isLiquid":true,"isInvestible":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || fake.lastUserID != ownerID || fake.categoryInput.Name != "Cash" {
		t.Fatalf("status=%d owner=%s input=%+v body=%s", response.Code, fake.lastUserID, fake.categoryInput, response.Body.String())
	}
}

func TestMetadataMutationMapsAuthorizationAndServiceErrors(t *testing.T) {
	tests := []struct {
		name       string
		authErr    error
		serviceErr error
		want       int
	}{
		{name: "authentication", authErr: errMutationUnauthorized, want: http.StatusUnauthorized},
		{name: "origin", authErr: errMutationOrigin, want: http.StatusForbidden},
		{name: "scope", authErr: errMutationScope, want: http.StatusForbidden},
		{name: "validation", serviceErr: &service.MetadataError{Kind: service.MetadataValidation, Detail: "bad input"}, want: http.StatusUnprocessableEntity},
		{name: "conflict", serviceErr: &service.MetadataError{Kind: service.MetadataConflict, Detail: "duplicate"}, want: http.StatusConflict},
		{name: "foreign resource", serviceErr: &service.MetadataError{Kind: service.MetadataNotFound, Detail: "not found"}, want: http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeMetadataService{err: test.serviceErr}
			auth := fakeMetadataAuthorizer{principal: webauth.Principal{UserID: uuid.New(), Method: "session"}, err: test.authErr}
			request := httptest.NewRequest(http.MethodDelete, "/exchange-rates/"+uuid.NewString(), nil)
			response := httptest.NewRecorder()
			metadataMutationRouter(auth, fake).ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestMetadataMutationRejectsUnknownJSONFields(t *testing.T) {
	fake := &fakeMetadataService{}
	request := httptest.NewRequest(http.MethodPost, "/categories", strings.NewReader(`{"name":"Cash","unexpected":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	metadataMutationRouter(fakeMetadataAuthorizer{principal: webauth.Principal{UserID: uuid.New(), Method: "session"}}, fake).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || fake.lastUserID != uuid.Nil {
		t.Fatalf("status=%d service owner=%s body=%s", response.Code, fake.lastUserID, response.Body.String())
	}
}

func TestMetadataMutationInvalidOrForeignIDIsNotFound(t *testing.T) {
	ownerID := uuid.New()
	foreignID := uuid.New()
	fake := &fakeMetadataService{err: &service.MetadataError{Kind: service.MetadataNotFound, Detail: "Category not found."}}
	auth := fakeMetadataAuthorizer{principal: webauth.Principal{UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}}
	for _, path := range []string{"/categories/not-a-uuid/archive", "/categories/" + foreignID.String() + "/archive"} {
		request := httptest.NewRequest(http.MethodPatch, path, strings.NewReader(`{"archived":true}`))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		metadataMutationRouter(auth, fake).ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status=%d body=%s", path, response.Code, response.Body.String())
		}
	}
	if fake.lastUserID != ownerID || fake.lastResourceID != foreignID {
		t.Fatalf("foreign call owner=%s resource=%s", fake.lastUserID, fake.lastResourceID)
	}
}

func TestAuthorizePortfolioMutationPreservesSessionAndAPIKeyRules(t *testing.T) {
	ownerID := uuid.New()
	csrfToken := "test-csrf-token-that-is-long-enough"
	handler, _ := testAuthHandler(t, &fakeAuthenticationService{principal: webauth.Principal{
		UserID: ownerID, Method: "session", CSRFToken: csrfToken,
	}}, &fakeLoginRateLimiter{})

	sessionRequest := httptest.NewRequest(http.MethodPut, "/settings", nil)
	sessionRequest.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "valid-session"})
	sessionRequest.Header.Set("Origin", "https://wealthboard.example")
	sessionRequest.Header.Set("X-CSRF-Token", csrfToken)
	principal, err := handler.AuthorizePortfolioMutation(sessionRequest)
	if err != nil || principal.UserID != ownerID {
		t.Fatalf("session authorization principal=%+v err=%v", principal, err)
	}

	untrusted := sessionRequest.Clone(sessionRequest.Context())
	untrusted.Header.Set("Origin", "https://evil.example")
	if _, err := handler.AuthorizePortfolioMutation(untrusted); !errors.Is(err, errMutationOrigin) {
		t.Fatalf("untrusted origin error=%v, want errMutationOrigin", err)
	}

	handler.EnableAPIKeys(&fakeAPIKeyService{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}})
	apiKeyRequest := httptest.NewRequest(http.MethodPost, "/categories", nil)
	apiKeyRequest.Header.Set("Authorization", "Bearer test")
	if _, err := handler.AuthorizePortfolioMutation(apiKeyRequest); err != nil {
		t.Fatalf("API key write authorization error=%v", err)
	}

	handler.EnableAPIKeys(&fakeAPIKeyService{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}})
	if _, err := handler.AuthorizePortfolioMutation(apiKeyRequest); !errors.Is(err, errMutationScope) {
		t.Fatalf("read-only API key error=%v, want errMutationScope", err)
	}
}

func TestAuthorizeScopedAndSessionOnlyMutations(t *testing.T) {
	ownerID := uuid.New()
	csrfToken := "test-csrf-token-that-is-long-enough"
	handler, _ := testAuthHandler(t, &fakeAuthenticationService{principal: webauth.Principal{
		UserID: ownerID, Method: "session", CSRFToken: csrfToken,
	}}, &fakeLoginRateLimiter{})

	sessionRequest := httptest.NewRequest(http.MethodPost, "/ai/credential", nil)
	sessionRequest.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "valid-session"})
	sessionRequest.Header.Set("Origin", "https://wealthboard.example")
	sessionRequest.Header.Set("X-CSRF-Token", csrfToken)
	principal, err := handler.AuthorizeSessionMutation(sessionRequest)
	if err != nil || principal.UserID != ownerID {
		t.Fatalf("session-only authorization principal=%+v err=%v", principal, err)
	}

	apiKeyRequest := httptest.NewRequest(http.MethodPost, "/ai/review", nil)
	apiKeyRequest.Header.Set("Authorization", "Bearer test")
	handler.EnableAPIKeys(&fakeAPIKeyService{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeAIInvoke},
	}})
	principal, err = handler.AuthorizeScopedMutation(apiKeyRequest, webauth.ScopeAIInvoke)
	if err != nil || principal.UserID != ownerID {
		t.Fatalf("AI API key authorization principal=%+v err=%v", principal, err)
	}
	if _, err := handler.AuthorizeSessionMutation(apiKeyRequest); !errors.Is(err, errMutationMethod) {
		t.Fatalf("session-only API key error=%v, want errMutationMethod", err)
	}

	handler.EnableAPIKeys(&fakeAPIKeyService{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}})
	if _, err := handler.AuthorizeScopedMutation(apiKeyRequest, webauth.ScopeAIInvoke); !errors.Is(err, errMutationScope) {
		t.Fatalf("wrong AI API key scope error=%v, want errMutationScope", err)
	}
}

func metadataMutationRouter(auth metadataMutationAuthorizer, mutations metadataMutationService) http.Handler {
	router := chi.NewRouter()
	RegisterMetadataMutationRoutes(router, NewMetadataMutationHandler(auth, mutations))
	return router
}
