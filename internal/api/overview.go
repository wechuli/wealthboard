package api

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type overviewService interface {
	Get(context.Context, uuid.UUID) (service.Overview, error)
}

type OverviewHandler struct {
	auth    *AuthHandler
	service overviewService
}

func NewOverviewHandler(auth *AuthHandler, service overviewService) *OverviewHandler {
	return &OverviewHandler{auth: auth, service: service}
}

func (handler *OverviewHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	principal, err := handler.auth.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return
	}
	if !principal.HasScope(webauth.ScopePortfolioRead) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant portfolio:read.")
		return
	}
	overview, err := handler.service.Get(request.Context(), principal.UserID)
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The overview is temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, overview)
}
