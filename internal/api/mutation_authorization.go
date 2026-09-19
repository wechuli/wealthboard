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
)

func (handler *AuthHandler) AuthorizePortfolioMutation(request *http.Request) (webauth.Principal, error) {
	if len(request.Header.Values("Authorization")) > 0 {
		principal, err := handler.AuthenticateRequest(request)
		if err != nil {
			return webauth.Principal{}, errMutationUnauthorized
		}
		if !principal.HasScope(webauth.ScopePortfolioWrite) {
			return webauth.Principal{}, errMutationScope
		}
		return principal, nil
	}
	if !handler.hasTrustedOrigin(request) {
		return webauth.Principal{}, errMutationOrigin
	}
	principal, err := handler.principal(request)
	if err != nil || !webauth.VerifyCSRF(principal.CSRFToken, request.Header.Get("X-CSRF-Token")) {
		return webauth.Principal{}, errMutationUnauthorized
	}
	if !principal.HasScope(webauth.ScopePortfolioWrite) {
		return webauth.Principal{}, errMutationScope
	}
	return principal, nil
}
