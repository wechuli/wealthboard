package api

import (
	"context"
	"database/sql"
	"encoding/json"
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

type fakeFeatureAuthenticator struct {
	principal webauth.Principal
	err       error
}

func (auth fakeFeatureAuthenticator) AuthenticateRequest(*http.Request) (webauth.Principal, error) {
	return auth.principal, auth.err
}

type fakeFeatureReadService struct {
	settings       service.SettingsRead
	instruments    []service.Instrument
	instrument     service.InstrumentDetail
	instrumentErr  error
	estate         service.EstateWorkspaceRead
	snapshot       service.EstateSnapshot
	snapshotErr    error
	ai             service.AIRead
	lastUserID     uuid.UUID
	lastResourceID uuid.UUID
}

func (fake *fakeFeatureReadService) Settings(_ context.Context, userID uuid.UUID) (service.SettingsRead, error) {
	fake.lastUserID = userID
	return fake.settings, nil
}

func (fake *fakeFeatureReadService) Instruments(_ context.Context, userID uuid.UUID) ([]service.Instrument, error) {
	fake.lastUserID = userID
	return fake.instruments, nil
}

func (fake *fakeFeatureReadService) Instrument(_ context.Context, userID, resourceID uuid.UUID) (service.InstrumentDetail, error) {
	fake.lastUserID, fake.lastResourceID = userID, resourceID
	return fake.instrument, fake.instrumentErr
}

func (fake *fakeFeatureReadService) EstateWorkspace(_ context.Context, userID uuid.UUID) (service.EstateWorkspaceRead, error) {
	fake.lastUserID = userID
	return fake.estate, nil
}

func (fake *fakeFeatureReadService) EstateSnapshot(_ context.Context, userID, resourceID uuid.UUID) (service.EstateSnapshot, error) {
	fake.lastUserID, fake.lastResourceID = userID, resourceID
	return fake.snapshot, fake.snapshotErr
}

func (fake *fakeFeatureReadService) AI(_ context.Context, userID uuid.UUID) (service.AIRead, error) {
	fake.lastUserID = userID
	return fake.ai, nil
}

func TestFeatureReadRoutesRequirePortfolioReadAndPassOwner(t *testing.T) {
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	fake := &fakeFeatureReadService{settings: service.SettingsRead{
		Settings: service.UserSettings{DisplayName: "Owner", BaseCurrency: "KES"},
	}}
	router := featureRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}, fake)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/settings", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if fake.lastUserID != ownerID {
		t.Fatalf("service owner = %s, want %s", fake.lastUserID, ownerID)
	}
	if !strings.Contains(response.Body.String(), `"displayName":"Owner"`) {
		t.Fatalf("body = %s", response.Body.String())
	}

	response = httptest.NewRecorder()
	featureRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeExportsRead},
	}}, fake).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/settings", nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("missing scope status = %d, want 403", response.Code)
	}
}

func TestForeignInstrumentAndSnapshotReturnNotFound(t *testing.T) {
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	resourceID := uuid.MustParse("00000000-0000-0000-0000-000000000202")
	fake := &fakeFeatureReadService{instrumentErr: sql.ErrNoRows, snapshotErr: sql.ErrNoRows}
	router := featureRouter(fakeFeatureAuthenticator{principal: webauth.Principal{
		UserID: ownerID, Method: "session",
	}}, fake)

	for _, path := range []string{"/instruments/" + resourceID.String(), "/estate/snapshots/" + resourceID.String()} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, body = %s", path, response.Code, response.Body.String())
		}
		if fake.lastUserID != ownerID || fake.lastResourceID != resourceID {
			t.Fatalf("%s called with user=%s resource=%s", path, fake.lastUserID, fake.lastResourceID)
		}
	}
}

func TestFeatureReadsRejectInvalidIDsAndAuthentication(t *testing.T) {
	fake := &fakeFeatureReadService{}
	response := httptest.NewRecorder()
	featureRouter(fakeFeatureAuthenticator{principal: webauth.Principal{UserID: uuid.New(), Method: "session"}}, fake).
		ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/instruments/not-a-uuid", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("invalid id status = %d, want 404", response.Code)
	}

	response = httptest.NewRecorder()
	featureRouter(fakeFeatureAuthenticator{err: errors.New("invalid")}, fake).
		ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/ai", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("authentication status = %d, want 401", response.Code)
	}
}

func TestAIResponseExcludesEncryptedCredentialAndKeepsDecimalStrings(t *testing.T) {
	ownerID := uuid.New()
	fake := &fakeFeatureReadService{ai: service.AIRead{
		Settings: &service.AIProviderSettings{Provider: "openai", HasStoredAPIKey: true},
	}}
	response := httptest.NewRecorder()
	featureRouter(fakeFeatureAuthenticator{principal: webauth.Principal{UserID: ownerID, Method: "session"}}, fake).
		ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/ai", nil))
	body := response.Body.String()
	if response.Code != http.StatusOK || strings.Contains(body, "encrypted") {
		t.Fatalf("AI response status = %d, body = %s", response.Code, body)
	}

	priceBody, err := json.Marshal(service.SecurityPrice{Price: "1234567890.123456789"})
	if err != nil {
		t.Fatalf("marshal price: %v", err)
	}
	if !strings.Contains(string(priceBody), `"price":"1234567890.123456789"`) {
		t.Fatalf("decimal price was not serialized as a string: %s", priceBody)
	}
	valueBody, err := json.Marshal(service.EstateDirective{CurrentValueMinor: "9007199254740993"})
	if err != nil {
		t.Fatalf("marshal estate value: %v", err)
	}
	if !strings.Contains(string(valueBody), `"currentValueMinor":"9007199254740993"`) {
		t.Fatalf("minor-unit value was not serialized as a string: %s", valueBody)
	}
}

func featureRouter(auth featureReadAuthenticator, reads featureReadService) http.Handler {
	router := chi.NewRouter()
	RegisterFeatureReadRoutes(router, NewFeatureReadHandler(auth, reads))
	return router
}
