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
	"github.com/wechuli/wealthboard/internal/oauth"
)

type fakeConnectedApps struct {
	approvedBy     uuid.UUID
	level          string
	changesAllowed bool
	revokedBy      uuid.UUID
}

func (*fakeConnectedApps) ConsentRequest(_ context.Context, id uuid.UUID) (oauth.ConsentRequest, error) {
	return oauth.ConsentRequest{ID: id, ClientName: "Claude", RedirectHost: "https://claude.ai", Scopes: []string{"portfolio:read"}}, nil
}

func (fake *fakeConnectedApps) Approve(_ context.Context, userID, _ uuid.UUID, level string, allowChanges bool) (string, error) {
	if level != oauth.DataLevelDetailed && level != oauth.DataLevelSummary || allowChanges && level != oauth.DataLevelDetailed {
		return "", oauth.ErrInvalidChoice
	}
	if allowChanges {
		fake.changesAllowed = true
		return "https://claude.ai/cb?code=c", nil
	}
	fake.approvedBy, fake.level = userID, level
	return "https://claude.ai/cb?code=c", nil
}

func (*fakeConnectedApps) Deny(context.Context, uuid.UUID) (string, error) {
	return "https://claude.ai/cb?error=access_denied", nil
}

func (*fakeConnectedApps) ConnectedApps(context.Context, uuid.UUID) ([]oauth.ConnectedApp, error) {
	return []oauth.ConnectedApp{}, nil
}

func (fake *fakeConnectedApps) RevokeConnectedApp(_ context.Context, userID, _ uuid.UUID) error {
	fake.revokedBy = userID
	return oauth.ErrNotFound
}

func (*fakeConnectedApps) ClearToolCalls(context.Context, uuid.UUID, uuid.UUID) error { return nil }

func TestConnectedAppsRoutesRequireABrowserSession(t *testing.T) {
	ownerID := uuid.New()
	csrfToken := "test-csrf-token-that-is-long-enough"
	auth, _ := testAuthHandler(t, &fakeAuthenticationService{principal: webauth.Principal{UserID: ownerID, Method: "session", CSRFToken: csrfToken}}, &fakeLoginRateLimiter{})
	auth.EnableAPIKeys(&fakeAPIKeyService{principal: webauth.Principal{UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioRead, webauth.ScopePortfolioWrite}}})
	service := &fakeConnectedApps{}
	router := chi.NewRouter()
	RegisterConnectedAppsRoutes(router, NewConnectedAppsHandler(auth, service))
	requestID := uuid.NewString()

	send := func(method, path, body string, session, csrf, apiKey bool) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", "https://wealthboard.example")
		if session {
			request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "valid-session"})
		}
		if csrf {
			request.Header.Set("X-CSRF-Token", csrfToken)
		}
		if apiKey {
			request.Header.Set("Authorization", "Bearer wbk_v1_example")
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	for name, test := range map[string]struct {
		method, path, body    string
		session, csrf, apiKey bool
		want                  int
	}{
		"read with session":         {http.MethodGet, "/oauth/requests/" + requestID, "", true, false, false, http.StatusOK},
		"read with API key":         {http.MethodGet, "/oauth/requests/" + requestID, "", false, false, true, http.StatusUnauthorized},
		"approve with API key":      {http.MethodPost, "/oauth/requests/" + requestID + "/approve", `{"dataLevel":"detailed"}`, true, true, true, http.StatusUnauthorized},
		"approve without CSRF":      {http.MethodPost, "/oauth/requests/" + requestID + "/approve", `{"dataLevel":"detailed"}`, true, false, false, http.StatusUnauthorized},
		"approve unknown level":     {http.MethodPost, "/oauth/requests/" + requestID + "/approve", `{"dataLevel":"everything"}`, true, true, false, http.StatusUnprocessableEntity},
		"approve with session":      {http.MethodPost, "/oauth/requests/" + requestID + "/approve", `{"dataLevel":"summary"}`, true, true, false, http.StatusOK},
		"approve summary changes":   {http.MethodPost, "/oauth/requests/" + requestID + "/approve", `{"dataLevel":"summary","allowChanges":true}`, true, true, false, http.StatusUnprocessableEntity},
		"approve detailed changes":  {http.MethodPost, "/oauth/requests/" + requestID + "/approve", `{"dataLevel":"detailed","allowChanges":true}`, true, true, false, http.StatusOK},
		"list with API key":         {http.MethodGet, "/connected-apps", "", false, false, true, http.StatusUnauthorized},
		"list with session":         {http.MethodGet, "/connected-apps", "", true, false, false, http.StatusOK},
		"revoke without CSRF":       {http.MethodDelete, "/connected-apps/" + uuid.NewString(), "", true, false, false, http.StatusUnauthorized},
		"revoke another user's app": {http.MethodDelete, "/connected-apps/" + uuid.NewString(), "", true, true, false, http.StatusNotFound},
		"malformed request ID":      {http.MethodGet, "/oauth/requests/not-a-uuid", "", true, false, false, http.StatusNotFound},
	} {
		t.Run(name, func(t *testing.T) {
			response := send(test.method, test.path, test.body, test.session, test.csrf, test.apiKey)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.want, response.Body.String())
			}
		})
	}
	if service.approvedBy != ownerID || service.level != oauth.DataLevelSummary || !service.changesAllowed || service.revokedBy != ownerID {
		t.Fatalf("service saw approvedBy=%s level=%s revokedBy=%s", service.approvedBy, service.level, service.revokedBy)
	}
}
