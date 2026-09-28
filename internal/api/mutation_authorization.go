package api

import (
	"errors"
	"net/http"

	webauth "github.com/wechuli/wealthboard/internal/auth"
)

var (
	errMutationUnauthorized = errors.New("mutation authentication failed")
	errMutationOrigin       = errors.New("mutation origin is not trusted")
	errMutationScope        = errors.New("mutation scope is not granted")
	errMutationMethod       = errors.New("mutation authentication method is not allowed")
)

func (handler *AuthHandler) AuthorizePortfolioMutation(request *http.Request) (webauth.Principal, error) {
	return handler.AuthorizeScopedMutation(request, webauth.ScopePortfolioWrite)
}

func (handler *AuthHandler) AuthorizeScopedMutation(request *http.Request, scope webauth.Scope) (webauth.Principal, error) {
	if len(request.Header.Values("Authorization")) > 0 {
		principal, err := handler.AuthenticateRequest(request)
		if err != nil {
			return webauth.Principal{}, errMutationUnauthorized
		}
		if !principal.HasScope(scope) {
			return webauth.Principal{}, errMutationScope
		}
		return principal, nil
	}
	return handler.authorizeBrowserSessionMutation(request)
}

func (handler *AuthHandler) AuthorizeSessionMutation(request *http.Request) (webauth.Principal, error) {
	if len(request.Header.Values("Authorization")) > 0 {
		return webauth.Principal{}, errMutationMethod
	}
	return handler.authorizeBrowserSessionMutation(request)
}

func (handler *AuthHandler) authorizeBrowserSessionMutation(request *http.Request) (webauth.Principal, error) {
	if !handler.hasTrustedOrigin(request) {
		return webauth.Principal{}, errMutationOrigin
	}
	principal, err := handler.principal(request)
	if err != nil || !webauth.VerifyCSRF(principal.CSRFToken, request.Header.Get("X-CSRF-Token")) {
		return webauth.Principal{}, errMutationUnauthorized
	}
	return principal, nil
}
