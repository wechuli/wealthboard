package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/domain"
)

const maxAuthBodyBytes = 4 << 10

var usernamePattern = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

type authenticationService interface {
	AuthenticateLocal(context.Context, string, string) (webauth.AuthenticatedUser, error)
	ChangePassword(context.Context, webauth.Principal, string, string) (webauth.AuthenticatedUser, error)
	VerifyLocalPassword(context.Context, uuid.UUID, string) (bool, error)
	VerifySession(context.Context, string) (webauth.Principal, error)
}

type oidcIdentityService interface {
	ResolveLogin(context.Context, webauth.OIDCIdentityClaims) (webauth.AuthenticatedUser, error)
	Link(context.Context, uuid.UUID, int, webauth.OIDCIdentityClaims) (webauth.AuthenticatedUser, error)
	Reauthenticate(context.Context, uuid.UUID, int, webauth.OIDCIdentityClaims) (webauth.AuthenticatedUser, error)
	Unlink(context.Context, uuid.UUID, int, string) (webauth.AuthenticatedUser, error)
	EnableLocal(context.Context, uuid.UUID, int, string, string, string) (webauth.AuthenticatedUser, error)
	RemoveLocal(context.Context, uuid.UUID, int, string) (webauth.AuthenticatedUser, error)
}

type registrationService interface {
	RegisterLocal(context.Context, webauth.RegistrationInput) (webauth.AuthenticatedUser, error)
}

type loginRateLimiter interface {
	Take(context.Context, string, string) (webauth.LoginRateLimit, error)
	TakeOIDC(context.Context, string, string) (webauth.LoginRateLimit, error)
	TakeSignup(context.Context, string) (webauth.LoginRateLimit, error)
	RecordSuccess(context.Context, webauth.LoginRateLimit) error
}

type apiKeyService interface {
	Authenticate(context.Context, []string) (webauth.Principal, error)
	Create(context.Context, uuid.UUID, string, []webauth.Scope, *time.Time) (webauth.CreatedAPIKey, error)
	List(context.Context, uuid.UUID) ([]webauth.APIKeyMetadata, error)
	Revoke(context.Context, uuid.UUID, uuid.UUID) error
	RevokeAll(context.Context, uuid.UUID) (int64, error)
}

type AuthHandler struct {
	service        authenticationService
	registration   registrationService
	limiter        loginRateLimiter
	sessions       *webauth.SessionManager
	policy         webauth.Policy
	trustedOrigin  string
	now            func() time.Time
	apiKeys        apiKeyService
	oidc           *webauth.OIDCClient
	oidcIdentities oidcIdentityService
}

func (handler *AuthHandler) EnableAPIKeys(service apiKeyService) {
	handler.apiKeys = service
}

func (handler *AuthHandler) EnableOIDC(client *webauth.OIDCClient, identities oidcIdentityService) {
	handler.oidc = client
	handler.oidcIdentities = identities
}

func (handler *AuthHandler) Config(response http.ResponseWriter, _ *http.Request) {
	providerName := ""
	if handler.oidc != nil {
		providerName = handler.oidc.Config().ProviderName
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"localEnabled": handler.policy.LocalEnabled,
		"oidcEnabled":  handler.policy.OIDCEnabled,
		"providerName": providerName,
	})
}

func NewAuthHandler(
	service authenticationService,
	registration registrationService,
	limiter loginRateLimiter,
	sessions *webauth.SessionManager,
	policy webauth.Policy,
	trustedOrigin string,
) *AuthHandler {
	return &AuthHandler{
		service:       service,
		registration:  registration,
		limiter:       limiter,
		sessions:      sessions,
		policy:        policy,
		trustedOrigin: trustedOrigin,
		now:           time.Now,
	}
}

func (handler *AuthHandler) Signup(response http.ResponseWriter, request *http.Request) {
	if !handler.policy.LocalEnabled {
		writeProblem(response, http.StatusForbidden, "Account creation unavailable", "Local account creation is not enabled.")
		return
	}
	if !handler.hasTrustedOrigin(request) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
		return
	}

	var input struct {
		Username        string `json:"username"`
		DisplayName     string `json:"displayName"`
		BaseCurrency    string `json:"baseCurrency"`
		Password        string `json:"password"`
		ConfirmPassword string `json:"confirmPassword"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide a valid JSON request body.")
		return
	}
	input.Username = webauth.NormalizeUsername(input.Username)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.BaseCurrency = domain.NormalizeCurrency(input.BaseCurrency)
	if input.BaseCurrency == "" {
		input.BaseCurrency = domain.DefaultCurrency
	}
	if !webauth.ValidUsername(input.Username) || input.DisplayName == "" || len(input.DisplayName) > 80 || strings.ContainsAny(input.DisplayName, "\x00\n\r\t") || len(input.Password) < 12 || len(input.Password) > 256 || input.Password != input.ConfirmPassword || !domain.IsSupportedCurrency(input.BaseCurrency) {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Provide valid account details.")
		return
	}

	limit, err := handler.limiter.TakeSignup(request.Context(), clientAddress(request))
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Your account could not be created.")
		return
	}
	if !limit.Allowed {
		response.Header().Set("Retry-After", strconv.Itoa(int(limit.RetryAfter.Seconds())))
		writeProblem(response, http.StatusTooManyRequests, "Too many attempts", "Try again later.")
		return
	}

	user, err := handler.registration.RegisterLocal(request.Context(), webauth.RegistrationInput{
		Username:     input.Username,
		DisplayName:  input.DisplayName,
		Password:     input.Password,
		BaseCurrency: input.BaseCurrency,
	})
	if err != nil {
		if errors.Is(err, webauth.ErrUsernameUnavailable) {
			writeProblem(response, http.StatusConflict, "Username unavailable", "That username is unavailable.")
			return
		}
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Your account could not be created.")
		return
	}
	if err := handler.limiter.RecordSuccess(request.Context(), limit); err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Your account could not be created.")
		return
	}
	handler.issueSession(response, user)
}

func (handler *AuthHandler) Login(response http.ResponseWriter, request *http.Request) {
	if !handler.policy.LocalEnabled {
		writeProblem(response, http.StatusForbidden, "Authentication method unavailable", "Local sign-in is not enabled.")
		return
	}
	if !handler.hasTrustedOrigin(request) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
		return
	}

	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide a valid JSON request body.")
		return
	}
	input.Username = webauth.NormalizeUsername(input.Username)
	if !usernamePattern.MatchString(input.Username) || len(input.Password) < 1 || len(input.Password) > 256 {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Enter a valid username and password.")
		return
	}

	limit, err := handler.limiter.Take(request.Context(), input.Username, clientAddress(request))
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Sign in is temporarily unavailable.")
		return
	}
	if !limit.Allowed {
		response.Header().Set("Retry-After", strconv.Itoa(int(limit.RetryAfter.Seconds())))
		writeProblem(response, http.StatusTooManyRequests, "Too many attempts", "Try again later.")
		return
	}

	user, err := handler.service.AuthenticateLocal(request.Context(), input.Username, input.Password)
	if err != nil {
		if errors.Is(err, webauth.ErrInvalidCredentials) {
			writeProblem(response, http.StatusUnauthorized, "Authentication failed", "Invalid username or password.")
			return
		}
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Sign in is temporarily unavailable.")
		return
	}
	if err := handler.limiter.RecordSuccess(request.Context(), limit); err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Sign in is temporarily unavailable.")
		return
	}

	handler.issueSession(response, user)
}

func (handler *AuthHandler) ChangePassword(response http.ResponseWriter, request *http.Request) {
	if !handler.policy.LocalEnabled {
		writeProblem(response, http.StatusForbidden, "Authentication method unavailable", "Local password changes are not enabled.")
		return
	}
	if !handler.hasTrustedOrigin(request) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
		return
	}
	principal, err := handler.principal(request)
	if err != nil || !webauth.VerifyCSRF(principal.CSRFToken, request.Header.Get("X-CSRF-Token")) {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid session and CSRF token are required.")
		return
	}

	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
		ConfirmPassword string `json:"confirmPassword"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide a valid JSON request body.")
		return
	}
	if len(input.CurrentPassword) < 1 || len(input.CurrentPassword) > 256 || len(input.NewPassword) < 12 || len(input.NewPassword) > 256 || input.NewPassword != input.ConfirmPassword {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Provide valid password details.")
		return
	}
	user, err := handler.service.ChangePassword(request.Context(), principal, input.CurrentPassword, input.NewPassword)
	if err != nil {
		if errors.Is(err, webauth.ErrInvalidCredentials) {
			writeProblem(response, http.StatusUnauthorized, "Authentication failed", "The current password is incorrect.")
			return
		}
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The password could not be changed.")
		return
	}
	handler.issueSession(response, user)
}

func (handler *AuthHandler) issueSession(response http.ResponseWriter, user webauth.AuthenticatedUser) {
	csrfToken, ok := handler.setSessionCookie(response, user)
	if !ok {
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"user":      map[string]string{"id": user.UserID.String(), "username": user.Username},
		"csrfToken": csrfToken,
	})
}

func (handler *AuthHandler) setSessionCookie(response http.ResponseWriter, user webauth.AuthenticatedUser) (string, bool) {
	csrfToken, err := webauth.NewCSRFToken()
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Sign in is temporarily unavailable.")
		return "", false
	}
	issuedAt := handler.now().UTC()
	expiresAt := issuedAt.Add(time.Duration(user.SessionTimeoutMinutes) * time.Minute)
	token, err := handler.sessions.Sign(webauth.Session{
		UserID:    user.UserID,
		Version:   user.SessionVersion,
		CSRFToken: csrfToken,
	}, issuedAt, expiresAt)
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Sign in is temporarily unavailable.")
		return "", false
	}

	http.SetCookie(response, handler.sessions.Cookie(token, expiresAt))
	return csrfToken, true
}

func (handler *AuthHandler) Session(response http.ResponseWriter, request *http.Request) {
	principal, err := handler.principal(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid session is required.")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"user":      map[string]string{"id": principal.UserID.String(), "username": principal.Username},
		"csrfToken": principal.CSRFToken,
	})
}

func (handler *AuthHandler) Principal(response http.ResponseWriter, request *http.Request) {
	principal, err := handler.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return
	}
	scopes := principal.Scopes
	if scopes == nil {
		scopes = []webauth.Scope{}
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"userId":     principal.UserID.String(),
		"username":   principal.Username,
		"authMethod": principal.Method,
		"scopes":     scopes,
	})
}

func (handler *AuthHandler) Logout(response http.ResponseWriter, request *http.Request) {
	if !handler.hasTrustedOrigin(request) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
		return
	}
	principal, err := handler.principal(request)
	if err != nil || !webauth.VerifyCSRF(principal.CSRFToken, request.Header.Get("X-CSRF-Token")) {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid session and CSRF token are required.")
		return
	}
	http.SetCookie(response, handler.sessions.ExpiredCookie())
	writeJSON(response, http.StatusOK, map[string]string{"status": "signed_out"})
}

func (handler *AuthHandler) ListAPIKeys(response http.ResponseWriter, request *http.Request) {
	principal, err := handler.principal(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid browser session is required.")
		return
	}
	keys, err := handler.apiKeys.List(request.Context(), principal.UserID)
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "API keys are temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"keys": keys})
}

func (handler *AuthHandler) CreateAPIKey(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	var input struct {
		Name      string          `json:"name"`
		Scopes    []webauth.Scope `json:"scopes"`
		ExpiresAt *time.Time      `json:"expiresAt"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide a valid JSON request body.")
		return
	}
	created, err := handler.apiKeys.Create(request.Context(), principal.UserID, input.Name, input.Scopes, input.ExpiresAt)
	if err != nil {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Provide valid API key details.")
		return
	}
	writeJSON(response, http.StatusCreated, created)
}

func (handler *AuthHandler) RevokeAPIKey(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	keyID, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The API key was not found.")
		return
	}
	if err := handler.apiKeys.Revoke(request.Context(), principal.UserID, keyID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeProblem(response, http.StatusNotFound, "Not Found", "The API key was not found.")
			return
		}
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The API key could not be revoked.")
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusNoContent)
}

func (handler *AuthHandler) RevokeAllAPIKeys(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	count, err := handler.apiKeys.RevokeAll(request.Context(), principal.UserID)
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "API keys could not be revoked.")
		return
	}
	writeJSON(response, http.StatusOK, map[string]int64{"revoked": count})
}

func (handler *AuthHandler) AuthenticateRequest(request *http.Request) (webauth.Principal, error) {
	authorization := request.Header.Values("Authorization")
	if len(authorization) > 0 {
		if handler.apiKeys == nil {
			return webauth.Principal{}, webauth.ErrInvalidCredentials
		}
		return handler.apiKeys.Authenticate(request.Context(), authorization)
	}
	return handler.principal(request)
}

func (handler *AuthHandler) RequireScope(scope webauth.Scope, next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		principal, err := handler.AuthenticateRequest(request)
		if err != nil {
			writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
			return
		}
		if !principal.HasScope(scope) {
			writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant the required scope.")
			return
		}
		next.ServeHTTP(response, request)
	})
}

func (handler *AuthHandler) authorizeSessionMutation(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	if !handler.hasTrustedOrigin(request) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
		return webauth.Principal{}, false
	}
	principal, err := handler.principal(request)
	if err != nil || !webauth.VerifyCSRF(principal.CSRFToken, request.Header.Get("X-CSRF-Token")) {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid browser session and CSRF token are required.")
		return webauth.Principal{}, false
	}
	return principal, true
}

func (handler *AuthHandler) principal(request *http.Request) (webauth.Principal, error) {
	if len(request.Header.Values("Authorization")) > 0 {
		return webauth.Principal{}, webauth.ErrInvalidSession
	}
	cookie, err := request.Cookie(webauth.SessionCookieName)
	if err != nil {
		return webauth.Principal{}, webauth.ErrInvalidSession
	}
	return handler.service.VerifySession(request.Context(), cookie.Value)
}

func (handler *AuthHandler) hasTrustedOrigin(request *http.Request) bool {
	return request.Header.Get("Origin") == handler.trustedOrigin
}

func decodeJSON(response http.ResponseWriter, request *http.Request, destination any) error {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("content type must be application/json")
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxAuthBodyBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func clientAddress(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}
