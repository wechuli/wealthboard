package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
)

func (handler *AuthHandler) OIDCStart(response http.ResponseWriter, request *http.Request) {
	if !handler.oidcAvailable() {
		problemNotFound(response, request)
		return
	}
	next := webauth.SafeRelativePath(request.URL.Query().Get("next"))
	if _, err := handler.principal(request); err == nil {
		http.Redirect(response, request, handler.appOrigin()+next, http.StatusSeeOther)
		return
	}
	handler.startOIDC(response, request, webauth.OIDCIntentLogin, nil, next)
}

func (handler *AuthHandler) OIDCLinkStart(response http.ResponseWriter, request *http.Request) {
	if !handler.hybridOIDCAvailable() {
		problemNotFound(response, request)
		return
	}
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		Next            string `json:"next"`
	}
	if err := decodeJSON(response, request, &input); err != nil || len(input.CurrentPassword) < 1 || len(input.CurrentPassword) > 256 {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Provide the current password.")
		return
	}
	verified, err := handler.service.VerifyLocalPassword(request.Context(), principal.UserID, input.CurrentPassword)
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Provider linking is temporarily unavailable.")
		return
	}
	if !verified {
		writeProblem(response, http.StatusUnauthorized, "Authentication failed", "The current password is incorrect.")
		return
	}
	handler.startOIDC(response, request, webauth.OIDCIntentLink, &principal, input.Next)
}

func (handler *AuthHandler) OIDCReauthStart(response http.ResponseWriter, request *http.Request) {
	if !handler.hybridOIDCAvailable() {
		problemNotFound(response, request)
		return
	}
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	handler.startOIDC(response, request, webauth.OIDCIntentReauthLocal, &principal, request.URL.Query().Get("next"))
}

func (handler *AuthHandler) startOIDC(response http.ResponseWriter, request *http.Request, intent webauth.OIDCIntent, principal *webauth.Principal, next string) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Referrer-Policy", "no-referrer")
	limit, err := handler.limiter.TakeOIDC(request.Context(), "start", clientAddress(request))
	if err != nil || !limit.Allowed {
		handler.oidcError(response, request, intent, "rate_limited")
		return
	}
	metadata, err := handler.oidc.Discover(request.Context())
	if err != nil {
		handler.oidcError(response, request, intent, "unavailable")
		return
	}
	authorizationURL, transaction, err := handler.oidc.AuthorizationRequest(metadata, intent, next, principal)
	if err != nil {
		handler.oidcError(response, request, intent, "unavailable")
		return
	}
	sealed, err := handler.oidc.SealTransaction(transaction)
	if err != nil {
		handler.oidcError(response, request, intent, "unavailable")
		return
	}
	http.SetCookie(response, handler.oidc.TransactionCookie(sealed))
	http.Redirect(response, request, authorizationURL.String(), http.StatusSeeOther)
}

func (handler *AuthHandler) OIDCCallback(response http.ResponseWriter, request *http.Request) {
	http.SetCookie(response, handler.expiredOIDCTransactionCookie())
	if !handler.oidcAvailable() {
		problemNotFound(response, request)
		return
	}
	limit, err := handler.limiter.TakeOIDC(request.Context(), "callback", clientAddress(request))
	if err != nil || !limit.Allowed {
		handler.oidcError(response, request, webauth.OIDCIntentLogin, "rate_limited")
		return
	}
	cookie, err := request.Cookie(webauth.OIDCTransactionCookieName)
	if err != nil {
		handler.oidcError(response, request, webauth.OIDCIntentLogin, "invalid_callback")
		return
	}
	transaction, err := handler.oidc.OpenTransaction(cookie.Value)
	if err != nil {
		handler.oidcError(response, request, webauth.OIDCIntentLogin, "invalid_callback")
		return
	}
	query := request.URL.Query()
	states, codes := query["state"], query["code"]
	if len(states) != 1 || !secureEqual(states[0], transaction.State) {
		handler.oidcError(response, request, transaction.Intent, "invalid_callback")
		return
	}
	if _, providerError := query["error"]; providerError {
		handler.oidcError(response, request, transaction.Intent, "provider_error")
		return
	}
	if len(codes) != 1 {
		handler.oidcError(response, request, transaction.Intent, "invalid_callback")
		return
	}
	metadata, err := handler.oidc.Discover(request.Context())
	if err != nil {
		handler.oidcError(response, request, transaction.Intent, "invalid_callback")
		return
	}
	idToken, err := handler.oidc.ExchangeCode(request.Context(), metadata, codes[0], transaction.Verifier)
	if err != nil {
		handler.oidcError(response, request, transaction.Intent, "invalid_callback")
		return
	}
	claims, err := handler.oidc.VerifyIDToken(request.Context(), metadata, idToken, transaction.Nonce)
	if err != nil {
		handler.oidcError(response, request, transaction.Intent, "invalid_callback")
		return
	}
	user, err := handler.completeOIDC(request, transaction, claims)
	if err != nil {
		code := "access_denied"
		if !errors.Is(err, webauth.ErrInvalidCredentials) && !errors.Is(err, webauth.ErrAuthenticationMethod) {
			code = "invalid_callback"
		}
		handler.oidcError(response, request, transaction.Intent, code)
		return
	}
	if transaction.Intent == webauth.OIDCIntentReauthLocal {
		grant, err := handler.oidc.SealReauthGrant(user.UserID)
		if err != nil {
			handler.oidcError(response, request, transaction.Intent, "invalid_callback")
			return
		}
		http.SetCookie(response, handler.oidc.ReauthCookie(grant))
	}
	if _, ok := handler.setSessionCookie(response, user); !ok {
		return
	}
	_ = handler.limiter.RecordSuccess(request.Context(), limit)
	handler.sessionHandoff(response, handler.appOrigin()+webauth.SafeRelativePath(transaction.Next))
}

func (handler *AuthHandler) completeOIDC(request *http.Request, transaction webauth.OIDCTransaction, claims webauth.OIDCIdentityClaims) (webauth.AuthenticatedUser, error) {
	switch transaction.Intent {
	case webauth.OIDCIntentLogin:
		return handler.oidcIdentities.ResolveLogin(request.Context(), claims)
	case webauth.OIDCIntentLink, webauth.OIDCIntentReauthLocal:
		userID, err := uuid.Parse(transaction.LinkingUserID)
		if err != nil {
			return webauth.AuthenticatedUser{}, webauth.ErrAuthenticationMethod
		}
		if transaction.Intent == webauth.OIDCIntentLink {
			return handler.oidcIdentities.Link(request.Context(), userID, transaction.LinkingSessionVersion, claims)
		}
		return handler.oidcIdentities.Reauthenticate(request.Context(), userID, transaction.LinkingSessionVersion, claims)
	default:
		return webauth.AuthenticatedUser{}, webauth.ErrAuthenticationMethod
	}
}

func (handler *AuthHandler) OIDCUnlink(response http.ResponseWriter, request *http.Request) {
	if !handler.hybridOIDCAvailable() {
		problemNotFound(response, request)
		return
	}
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	var input struct {
		CurrentPassword string `json:"currentPassword"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide a valid JSON request body.")
		return
	}
	verified, err := handler.service.VerifyLocalPassword(request.Context(), principal.UserID, input.CurrentPassword)
	if err != nil || !verified {
		writeProblem(response, http.StatusUnauthorized, "Authentication failed", "The current password is incorrect.")
		return
	}
	user, err := handler.oidcIdentities.Unlink(request.Context(), principal.UserID, principal.Version, handler.oidc.Config().Issuer)
	if err != nil {
		writeProblem(response, http.StatusConflict, "Authentication method unchanged", "OIDC sign-in could not be unlinked.")
		return
	}
	handler.issueSession(response, user)
}

func (handler *AuthHandler) EnableLocalCredential(response http.ResponseWriter, request *http.Request) {
	if !handler.hybridOIDCAvailable() {
		problemNotFound(response, request)
		return
	}
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	if !handler.consumeReauthGrant(response, request, principal) {
		writeProblem(response, http.StatusUnauthorized, "Reauthentication required", "Verify with the OIDC provider before continuing.")
		return
	}
	var input struct {
		Username        string `json:"username"`
		Password        string `json:"password"`
		ConfirmPassword string `json:"confirmPassword"`
	}
	if err := decodeJSON(response, request, &input); err != nil || input.Password != input.ConfirmPassword {
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Provide valid local credential details.")
		return
	}
	user, err := handler.oidcIdentities.EnableLocal(request.Context(), principal.UserID, principal.Version, handler.oidc.Config().Issuer, input.Username, input.Password)
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, webauth.ErrUsernameUnavailable) {
			status = http.StatusConflict
		}
		writeProblem(response, status, "Authentication method unchanged", "Local sign-in could not be enabled.")
		return
	}
	handler.issueSession(response, user)
}

func (handler *AuthHandler) RemoveLocalCredential(response http.ResponseWriter, request *http.Request) {
	if !handler.hybridOIDCAvailable() {
		problemNotFound(response, request)
		return
	}
	principal, ok := handler.authorizeSessionMutation(response, request)
	if !ok {
		return
	}
	if !handler.consumeReauthGrant(response, request, principal) {
		writeProblem(response, http.StatusUnauthorized, "Reauthentication required", "Verify with the OIDC provider before continuing.")
		return
	}
	user, err := handler.oidcIdentities.RemoveLocal(request.Context(), principal.UserID, principal.Version, handler.oidc.Config().Issuer)
	if err != nil {
		writeProblem(response, http.StatusConflict, "Authentication method unchanged", "Local sign-in could not be removed.")
		return
	}
	handler.issueSession(response, user)
}

func (handler *AuthHandler) consumeReauthGrant(response http.ResponseWriter, request *http.Request, principal webauth.Principal) bool {
	http.SetCookie(response, handler.oidc.ExpiredReauthCookie())
	cookie, err := request.Cookie(webauth.OIDCReauthCookieName)
	return err == nil && handler.oidc.OpenReauthGrant(cookie.Value, principal.UserID) == nil
}

func (handler *AuthHandler) oidcAvailable() bool {
	return handler.policy.OIDCEnabled && handler.oidc != nil && handler.oidcIdentities != nil
}

func (handler *AuthHandler) hybridOIDCAvailable() bool {
	return handler.policy.LocalEnabled && handler.oidcAvailable()
}

func (handler *AuthHandler) expiredOIDCTransactionCookie() *http.Cookie {
	if handler.oidc != nil {
		return handler.oidc.ExpiredTransactionCookie()
	}
	return &http.Cookie{Name: webauth.OIDCTransactionCookieName, Path: "/api/v1/auth/oidc/callback", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode}
}

func (handler *AuthHandler) appOrigin() string {
	callback, _ := url.Parse(handler.oidc.Config().CallbackURL)
	return callback.Scheme + "://" + callback.Host
}

func (handler *AuthHandler) oidcError(response http.ResponseWriter, request *http.Request, intent webauth.OIDCIntent, code string) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Referrer-Policy", "no-referrer")
	path, parameter := "/login", "oidc_error"
	if intent != webauth.OIDCIntentLogin {
		path, parameter = "/settings", "auth"
	}
	destination := handler.appOrigin() + path + "?" + parameter + "=" + url.QueryEscape(code)
	if intent == webauth.OIDCIntentLogin {
		http.Redirect(response, request, destination, http.StatusSeeOther)
		return
	}
	handler.sessionHandoff(response, destination)
}

func (handler *AuthHandler) sessionHandoff(response http.ResponseWriter, destination string) {
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Sign in is temporarily unavailable.")
		return
	}
	nonce := base64.StdEncoding.EncodeToString(nonceBytes)
	serialized := strings.NewReplacer("<", "\\u003c", ">", "\\u003e", "&", "\\u0026").Replace(strconv.Quote(destination))
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	response.Header().Set("Referrer-Policy", "no-referrer")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("X-Frame-Options", "DENY")
	_, _ = response.Write([]byte("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>Completing sign in</title><style nonce=\"" + nonce + "\">body{font-family:sans-serif}</style><script nonce=\"" + nonce + "\">window.addEventListener(\"DOMContentLoaded\",()=>window.location.replace(" + serialized + "),{once:true});</script></head><body><p role=\"status\">Completing sign in...</p><noscript><a href=\"" + html.EscapeString(destination) + "\">Continue</a></noscript></body></html>"))
}

func secureEqual(left, right string) bool {
	leftJSON, _ := json.Marshal(left)
	rightJSON, _ := json.Marshal(right)
	leftHash := sha256.Sum256(leftJSON)
	rightHash := sha256.Sum256(rightJSON)
	return subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1 && len(left) == len(right)
}
