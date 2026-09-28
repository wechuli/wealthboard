package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
)

const testSessionSecret = "test-session-secret-that-is-at-least-32-characters"

type fakeAuthenticationService struct {
	authenticated webauth.AuthenticatedUser
	authErr       error
	changed       webauth.AuthenticatedUser
	changeErr     error
	principal     webauth.Principal
	verifyErr     error
}

func (service *fakeAuthenticationService) ChangePassword(
	context.Context,
	webauth.Principal,
	string,
	string,
) (webauth.AuthenticatedUser, error) {
	return service.changed, service.changeErr
}

func (service *fakeAuthenticationService) VerifyLocalPassword(context.Context, uuid.UUID, string) (bool, error) {
	return true, nil
}

type fakeRegistrationService struct {
	registered webauth.AuthenticatedUser
	err        error
}

func (service *fakeRegistrationService) RegisterLocal(
	context.Context,
	webauth.RegistrationInput,
) (webauth.AuthenticatedUser, error) {
	return service.registered, service.err
}

func (service *fakeAuthenticationService) AuthenticateLocal(
	context.Context,
	string,
	string,
) (webauth.AuthenticatedUser, error) {
	return service.authenticated, service.authErr
}

func (service *fakeAuthenticationService) VerifySession(
	context.Context,
	string,
) (webauth.Principal, error) {
	return service.principal, service.verifyErr
}

type fakeLoginRateLimiter struct {
	decision  webauth.LoginRateLimit
	takeErr   error
	recordErr error
	recorded  bool
}

type fakeAPIKeyService struct {
	created    webauth.CreatedAPIKey
	listed     []webauth.APIKeyMetadata
	principal  webauth.Principal
	authErr    error
	revokeErr  error
	revokedAll int64
}

func (service *fakeAPIKeyService) Authenticate(context.Context, []string) (webauth.Principal, error) {
	return service.principal, service.authErr
}

func (service *fakeAPIKeyService) Create(context.Context, uuid.UUID, string, []webauth.Scope, *time.Time) (webauth.CreatedAPIKey, error) {
	return service.created, nil
}

func (service *fakeAPIKeyService) List(context.Context, uuid.UUID) ([]webauth.APIKeyMetadata, error) {
	return service.listed, nil
}

func (service *fakeAPIKeyService) Revoke(context.Context, uuid.UUID, uuid.UUID) error {
	return service.revokeErr
}

func (service *fakeAPIKeyService) RevokeAll(context.Context, uuid.UUID) (int64, error) {
	return service.revokedAll, nil
}

func (limiter *fakeLoginRateLimiter) Take(
	context.Context,
	string,
	string,
) (webauth.LoginRateLimit, error) {
	return limiter.decision, limiter.takeErr
}

func (limiter *fakeLoginRateLimiter) TakeSignup(
	context.Context,
	string,
) (webauth.LoginRateLimit, error) {
	return limiter.decision, limiter.takeErr
}

func (limiter *fakeLoginRateLimiter) TakeOIDC(
	context.Context,
	string,
	string,
) (webauth.LoginRateLimit, error) {
	return limiter.decision, limiter.takeErr
}

func (limiter *fakeLoginRateLimiter) RecordSuccess(
	context.Context,
	webauth.LoginRateLimit,
) error {
	limiter.recorded = true
	return limiter.recordErr
}

func TestLoginIssuesSessionAndCSRFToken(t *testing.T) {
	userID := uuid.MustParse("00000000-0000-0000-0000-000000000456")
	service := &fakeAuthenticationService{authenticated: webauth.AuthenticatedUser{
		UserID:                userID,
		Username:              "alice",
		SessionVersion:        3,
		SessionTimeoutMinutes: 60,
	}}
	limiter := &fakeLoginRateLimiter{decision: webauth.LoginRateLimit{Allowed: true}}
	handler, sessions := testAuthHandler(t, service, limiter)

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":" Alice ","password":"correct horse battery staple"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	response := httptest.NewRecorder()
	handler.Login(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !limiter.recorded {
		t.Fatal("successful login did not clear rate-limit attempts")
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != webauth.SessionCookieName || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("session cookies = %+v", cookies)
	}
	var body struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	session, err := sessions.Verify(cookies[0].Value, handler.now().Add(time.Minute))
	if err != nil {
		t.Fatalf("verify issued session: %v", err)
	}
	if body.CSRFToken == "" || session.CSRFToken != body.CSRFToken || session.UserID != userID {
		t.Fatalf("session and response CSRF mismatch")
	}
}

func TestSignupIssuesSession(t *testing.T) {
	registered := webauth.AuthenticatedUser{
		UserID:                uuid.MustParse("00000000-0000-0000-0000-000000000789"),
		Username:              "new-user",
		SessionVersion:        1,
		SessionTimeoutMinutes: 10080,
	}
	registration := &fakeRegistrationService{registered: registered}
	limiter := &fakeLoginRateLimiter{decision: webauth.LoginRateLimit{Allowed: true}}
	handler, _ := testAuthHandlerWithRegistration(t, &fakeAuthenticationService{}, registration, limiter)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/signup", strings.NewReader(`{"username":" New-User ","displayName":"New User","baseCurrency":"kes","password":"a secure password","confirmPassword":"a secure password"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	response := httptest.NewRecorder()
	handler.Signup(response, request)

	if response.Code != http.StatusOK || len(response.Result().Cookies()) != 1 || !limiter.recorded {
		t.Fatalf("signup status = %d, cookies = %d, recorded = %t, body = %s", response.Code, len(response.Result().Cookies()), limiter.recorded, response.Body.String())
	}
}

func TestSignupRejectsUsernameCollision(t *testing.T) {
	registration := &fakeRegistrationService{err: webauth.ErrUsernameUnavailable}
	limiter := &fakeLoginRateLimiter{decision: webauth.LoginRateLimit{Allowed: true}}
	handler, _ := testAuthHandlerWithRegistration(t, &fakeAuthenticationService{}, registration, limiter)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/signup", strings.NewReader(`{"username":"alice","displayName":"Alice","baseCurrency":"USD","password":"a secure password","confirmPassword":"a secure password"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	response := httptest.NewRecorder()
	handler.Signup(response, request)

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "That username is unavailable.") {
		t.Fatalf("signup status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestLoginRejectsUntrustedOriginAndUnknownFields(t *testing.T) {
	service := &fakeAuthenticationService{}
	limiter := &fakeLoginRateLimiter{decision: webauth.LoginRateLimit{Allowed: true}}
	handler, _ := testAuthHandler(t, service, limiter)

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"alice","password":"secret"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	handler.Login(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("untrusted origin status = %d, want %d", response.Code, http.StatusForbidden)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"alice","password":"secret","userId":"foreign"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	response = httptest.NewRecorder()
	handler.Login(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestLoginUsesGenericCredentialFailure(t *testing.T) {
	service := &fakeAuthenticationService{authErr: webauth.ErrInvalidCredentials}
	limiter := &fakeLoginRateLimiter{decision: webauth.LoginRateLimit{Allowed: true}}
	handler, _ := testAuthHandler(t, service, limiter)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"alice","password":"wrong"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	response := httptest.NewRecorder()
	handler.Login(response, request)

	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "Invalid username or password.") {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if limiter.recorded {
		t.Fatal("failed login cleared rate-limit attempts")
	}
}

func TestSessionAndLogout(t *testing.T) {
	principal := webauth.Principal{
		UserID:    uuid.MustParse("00000000-0000-0000-0000-000000000456"),
		Username:  "alice",
		Version:   3,
		CSRFToken: "test-csrf-token-that-is-long-enough",
	}
	service := &fakeAuthenticationService{principal: principal}
	handler, _ := testAuthHandler(t, service, &fakeLoginRateLimiter{})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "signed-token"})
	response := httptest.NewRecorder()
	handler.Session(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), principal.CSRFToken) {
		t.Fatalf("session status = %d, body = %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	request.Header.Set("Origin", "https://wealthboard.example")
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "signed-token"})
	response = httptest.NewRecorder()
	handler.Logout(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing CSRF status = %d, want %d", response.Code, http.StatusUnauthorized)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	request.Header.Set("Origin", "https://wealthboard.example")
	request.Header.Set("X-CSRF-Token", principal.CSRFToken)
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "signed-token"})
	response = httptest.NewRecorder()
	handler.Logout(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("logout status = %d, body = %s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge != -1 {
		t.Fatalf("logout cookies = %+v", cookies)
	}
}

func TestSessionRejectsInvalidCookie(t *testing.T) {
	service := &fakeAuthenticationService{verifyErr: errors.New("invalid")}
	handler, _ := testAuthHandler(t, service, &fakeLoginRateLimiter{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "invalid"})
	response := httptest.NewRecorder()
	handler.Session(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestAPIKeyManagementRequiresBrowserSession(t *testing.T) {
	principal := webauth.Principal{
		UserID: uuid.MustParse("00000000-0000-0000-0000-000000000456"),
		Method: "session", CSRFToken: "test-csrf-token-that-is-long-enough",
	}
	service := &fakeAuthenticationService{principal: principal}
	handler, _ := testAuthHandler(t, service, &fakeLoginRateLimiter{})
	keys := &fakeAPIKeyService{created: webauth.CreatedAPIKey{
		APIKeyMetadata: webauth.APIKeyMetadata{ID: uuid.MustParse("00000000-0000-0000-0000-000000000999"), Name: "CLI", Scopes: []webauth.Scope{webauth.ScopePortfolioRead}},
		Token:          "wbk_v1_one-time-secret",
	}}
	handler.EnableAPIKeys(keys)

	request := httptest.NewRequest(http.MethodPost, "/api/v1/api-keys", strings.NewReader(`{"name":"CLI"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://wealthboard.example")
	request.Header.Set("X-CSRF-Token", principal.CSRFToken)
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "signed-token"})
	response := httptest.NewRecorder()
	handler.CreateAPIKey(response, request)
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), "one-time-secret") {
		t.Fatalf("create key status = %d, body = %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/api/v1/api-keys", nil)
	request.Header.Set("Authorization", "Bearer invalid")
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "signed-token"})
	response = httptest.NewRecorder()
	handler.ListAPIKeys(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("API-key management with Authorization status = %d, want 401", response.Code)
	}
}

func TestRequireScopeEnforcesAPIKeyScope(t *testing.T) {
	handler, _ := testAuthHandler(t, &fakeAuthenticationService{}, &fakeLoginRateLimiter{})
	handler.EnableAPIKeys(&fakeAPIKeyService{principal: webauth.Principal{
		Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}})
	next := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { response.WriteHeader(http.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	handler.RequireScope(webauth.ScopePortfolioRead, next).ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("granted scope status = %d", response.Code)
	}

	response = httptest.NewRecorder()
	handler.RequireScope(webauth.ScopePortfolioWrite, next).ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("missing scope status = %d, want 403", response.Code)
	}
}

func TestPrincipalUsesAuthorizationWithoutCookieFallback(t *testing.T) {
	service := &fakeAuthenticationService{principal: webauth.Principal{
		UserID: uuid.MustParse("00000000-0000-0000-0000-000000000456"), Method: "session",
	}}
	handler, _ := testAuthHandler(t, service, &fakeLoginRateLimiter{})
	keys := &fakeAPIKeyService{authErr: webauth.ErrInvalidCredentials}
	handler.EnableAPIKeys(keys)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/principal", nil)
	request.Header.Set("Authorization", "Bearer invalid")
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "valid-session"})
	response := httptest.NewRecorder()
	handler.Principal(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("invalid bearer with valid cookie status = %d, want 401", response.Code)
	}

	keys.authErr = nil
	keys.principal = webauth.Principal{
		UserID: uuid.MustParse("00000000-0000-0000-0000-000000000789"), Method: "api_key",
		Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}
	response = httptest.NewRecorder()
	handler.Principal(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"authMethod":"api_key"`) || !strings.Contains(response.Body.String(), `"portfolio:read"`) {
		t.Fatalf("API key principal status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestAPIKeyListNeverContainsSecretOrHash(t *testing.T) {
	principal := webauth.Principal{
		UserID: uuid.MustParse("00000000-0000-0000-0000-000000000456"), Method: "session",
	}
	handler, _ := testAuthHandler(t, &fakeAuthenticationService{principal: principal}, &fakeLoginRateLimiter{})
	handler.EnableAPIKeys(&fakeAPIKeyService{listed: []webauth.APIKeyMetadata{{
		ID: uuid.MustParse("00000000-0000-0000-0000-000000000999"), Name: "CLI",
		DisplayPrefix: "wbk_v1_00000000", Scopes: []webauth.Scope{webauth.ScopePortfolioRead},
	}}})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/api-keys", nil)
	request.AddCookie(&http.Cookie{Name: webauth.SessionCookieName, Value: "valid-session"})
	response := httptest.NewRecorder()
	handler.ListAPIKeys(response, request)
	body := response.Body.String()
	if response.Code != http.StatusOK || strings.Contains(body, "token_hash") || strings.Contains(body, `"token"`) {
		t.Fatalf("API key list status = %d, body = %s", response.Code, body)
	}
}

func testAuthHandler(
	t *testing.T,
	service authenticationService,
	limiter loginRateLimiter,
) (*AuthHandler, *webauth.SessionManager) {
	return testAuthHandlerWithRegistration(t, service, &fakeRegistrationService{}, limiter)
}

func testAuthHandlerWithRegistration(
	t *testing.T,
	service authenticationService,
	registration registrationService,
	limiter loginRateLimiter,
) (*AuthHandler, *webauth.SessionManager) {
	t.Helper()
	sessions, err := webauth.NewSessionManager(testSessionSecret, true)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}
	handler := NewAuthHandler(
		service,
		registration,
		limiter,
		sessions,
		webauth.Policy{Methods: []webauth.Method{webauth.MethodLocal}, LocalEnabled: true},
		"https://wealthboard.example",
	)
	handler.now = func() time.Time { return time.Unix(2_000_000_000, 0) }
	return handler, sessions
}
