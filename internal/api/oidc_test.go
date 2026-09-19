package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
)

type fakeOIDCIdentityService struct {
	resolved webauth.AuthenticatedUser
	err      error
}

func (service *fakeOIDCIdentityService) ResolveLogin(context.Context, webauth.OIDCIdentityClaims) (webauth.AuthenticatedUser, error) {
	return service.resolved, service.err
}

func (service *fakeOIDCIdentityService) Link(context.Context, uuid.UUID, int, webauth.OIDCIdentityClaims) (webauth.AuthenticatedUser, error) {
	return service.resolved, service.err
}

func (service *fakeOIDCIdentityService) Reauthenticate(context.Context, uuid.UUID, int, webauth.OIDCIdentityClaims) (webauth.AuthenticatedUser, error) {
	return service.resolved, service.err
}

func (service *fakeOIDCIdentityService) Unlink(context.Context, uuid.UUID, int, string) (webauth.AuthenticatedUser, error) {
	return service.resolved, service.err
}

func (service *fakeOIDCIdentityService) EnableLocal(context.Context, uuid.UUID, int, string, string, string) (webauth.AuthenticatedUser, error) {
	return service.resolved, service.err
}

func (service *fakeOIDCIdentityService) RemoveLocal(context.Context, uuid.UUID, int, string) (webauth.AuthenticatedUser, error) {
	return service.resolved, service.err
}

func TestOIDCStartCreatesPKCETransactionCookie(t *testing.T) {
	var provider *httptest.Server
	provider = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(response, request)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"issuer": provider.URL, "authorization_endpoint": provider.URL + "/authorize", "token_endpoint": provider.URL + "/token", "jwks_uri": provider.URL + "/jwks", "id_token_signing_alg_values_supported": []string{"RS256"},
		})
	}))
	defer provider.Close()

	handler, _ := testAuthHandler(t, &fakeAuthenticationService{verifyErr: webauth.ErrInvalidSession}, &fakeLoginRateLimiter{decision: webauth.LoginRateLimit{Allowed: true}})
	handler.policy = webauth.Policy{Methods: []webauth.Method{webauth.MethodLocal, webauth.MethodOIDC}, LocalEnabled: true, OIDCEnabled: true}
	client := webauth.NewOIDCClient(webauth.OIDCConfig{
		Issuer: provider.URL, ClientID: "wealthboard", ClientSecret: "secret", ProviderName: "Test", CallbackURL: "https://wealthboard.example/api/v1/auth/oidc/callback", TransactionSecret: make([]byte, 32),
	}, true)
	handler.EnableOIDC(client, &fakeOIDCIdentityService{})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/start?next=%2Faccounts%3Fperiod%3D1y", nil)
	response := httptest.NewRecorder()
	handler.OIDCStart(response, request)
	if response.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect: %v", err)
	}
	if location.Path != "/authorize" || location.Query().Get("response_type") != "code" || location.Query().Get("code_challenge_method") != "S256" || location.Query().Get("nonce") == "" {
		t.Fatalf("authorization redirect = %s", location)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != webauth.OIDCTransactionCookieName || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].Path != "/api/v1/auth/oidc/callback" {
		t.Fatalf("transaction cookies = %+v", cookies)
	}
	transaction, err := client.OpenTransaction(cookies[0].Value)
	if err != nil || transaction.Next != "/accounts?period=1y" || transaction.Intent != webauth.OIDCIntentLogin {
		t.Fatalf("transaction = %+v, error = %v", transaction, err)
	}
}

func TestOIDCCallbackAlwaysConsumesTransactionCookie(t *testing.T) {
	handler, _ := testAuthHandler(t, &fakeAuthenticationService{}, &fakeLoginRateLimiter{decision: webauth.LoginRateLimit{Allowed: true}})
	handler.policy = webauth.Policy{OIDCEnabled: true}
	handler.EnableOIDC(webauth.NewOIDCClient(webauth.OIDCConfig{
		Issuer: "https://identity.example", ClientID: "wealthboard", CallbackURL: "https://wealthboard.example/api/v1/auth/oidc/callback", TransactionSecret: make([]byte, 32),
	}, true), &fakeOIDCIdentityService{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/callback?state=wrong", nil)
	request.AddCookie(&http.Cookie{Name: webauth.OIDCTransactionCookieName, Value: "invalid"})
	response := httptest.NewRecorder()
	handler.OIDCCallback(response, request)

	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "https://wealthboard.example/login?oidc_error=invalid_callback" {
		t.Fatalf("status = %d, location = %q", response.Code, response.Header().Get("Location"))
	}
	cookies := response.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != webauth.OIDCTransactionCookieName || cookies[0].MaxAge != -1 {
		t.Fatalf("callback cookies = %+v", cookies)
	}
}

func TestOIDCRoutesAreHiddenWhenDisabled(t *testing.T) {
	handler, _ := testAuthHandler(t, &fakeAuthenticationService{}, &fakeLoginRateLimiter{})
	response := httptest.NewRecorder()
	handler.OIDCStart(response, httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/start", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
}
