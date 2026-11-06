package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/oauth"
)

type oauthConsentService interface {
	ConsentRequest(context.Context, uuid.UUID) (oauth.ConsentRequest, error)
	Approve(context.Context, uuid.UUID, uuid.UUID, string, bool) (string, error)
	Deny(context.Context, uuid.UUID) (string, error)
	ConnectedApps(context.Context, uuid.UUID) ([]oauth.ConnectedApp, error)
	RevokeConnectedApp(context.Context, uuid.UUID, uuid.UUID) error
	ClearToolCalls(context.Context, uuid.UUID, uuid.UUID) error
}

// ConnectedAppsHandler serves the consent page and Connected apps settings. Every
// route needs a browser session; API keys and OAuth tokens can't approve access or
// manage connections.
type ConnectedAppsHandler struct {
	auth    *AuthHandler
	service oauthConsentService
}

func NewConnectedAppsHandler(auth *AuthHandler, service oauthConsentService) *ConnectedAppsHandler {
	return &ConnectedAppsHandler{auth: auth, service: service}
}

func RegisterConnectedAppsRoutes(router chi.Router, handler *ConnectedAppsHandler) {
	router.Get("/oauth/requests/{id}", handler.ConsentRequest)
	router.Post("/oauth/requests/{id}/approve", handler.Approve)
	router.Post("/oauth/requests/{id}/deny", handler.Deny)
	router.Get("/connected-apps", handler.List)
	router.Delete("/connected-apps/{id}", handler.Revoke)
	router.Delete("/connected-apps/{id}/calls", handler.ClearCalls)
}

func (handler *ConnectedAppsHandler) sessionUser(response http.ResponseWriter, request *http.Request) (uuid.UUID, bool) {
	principal, err := handler.auth.principal(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid browser session is required.")
		return uuid.Nil, false
	}
	return principal.UserID, true
}

func (handler *ConnectedAppsHandler) sessionMutation(response http.ResponseWriter, request *http.Request) (uuid.UUID, bool) {
	principal, err := handler.auth.AuthorizeSessionMutation(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid browser session, trusted origin, and CSRF token are required.")
		return uuid.Nil, false
	}
	return principal.UserID, true
}

func pathID(response http.ResponseWriter, request *http.Request, resource string) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The "+resource+" was not found.")
		return uuid.Nil, false
	}
	return id, true
}

func (handler *ConnectedAppsHandler) writeError(response http.ResponseWriter, _ *http.Request, err error, resource string) {
	switch {
	case errors.Is(err, oauth.ErrNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The "+resource+" was not found or has expired.")
	case errors.Is(err, oauth.ErrInvalidChoice):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "Choose detailed or summary access. Changes need detailed access and an application that asked for them.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "Connected apps are temporarily unavailable.")
	}
}

func (handler *ConnectedAppsHandler) ConsentRequest(response http.ResponseWriter, request *http.Request) {
	if _, ok := handler.sessionUser(response, request); !ok {
		return
	}
	id, ok := pathID(response, request, "connection request")
	if !ok {
		return
	}
	consent, err := handler.service.ConsentRequest(request.Context(), id)
	if err != nil {
		handler.writeError(response, request, err, "connection request")
		return
	}
	writeJSON(response, http.StatusOK, consent)
}

func (handler *ConnectedAppsHandler) Approve(response http.ResponseWriter, request *http.Request) {
	userID, ok := handler.sessionMutation(response, request)
	if !ok {
		return
	}
	id, ok := pathID(response, request, "connection request")
	if !ok {
		return
	}
	var input struct {
		DataLevel    string `json:"dataLevel"`
		AllowChanges bool   `json:"allowChanges"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide a valid JSON request body.")
		return
	}
	redirect, err := handler.service.Approve(request.Context(), userID, id, input.DataLevel, input.AllowChanges)
	if err != nil {
		handler.writeError(response, request, err, "connection request")
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"redirectTo": redirect})
}

func (handler *ConnectedAppsHandler) Deny(response http.ResponseWriter, request *http.Request) {
	if _, ok := handler.sessionMutation(response, request); !ok {
		return
	}
	id, ok := pathID(response, request, "connection request")
	if !ok {
		return
	}
	redirect, err := handler.service.Deny(request.Context(), id)
	if err != nil {
		handler.writeError(response, request, err, "connection request")
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"redirectTo": redirect})
}

func (handler *ConnectedAppsHandler) List(response http.ResponseWriter, request *http.Request) {
	userID, ok := handler.sessionUser(response, request)
	if !ok {
		return
	}
	apps, err := handler.service.ConnectedApps(request.Context(), userID)
	if err != nil {
		handler.writeError(response, request, err, "connected app")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"apps": apps})
}

func (handler *ConnectedAppsHandler) Revoke(response http.ResponseWriter, request *http.Request) {
	userID, ok := handler.sessionMutation(response, request)
	if !ok {
		return
	}
	id, ok := pathID(response, request, "connected app")
	if !ok {
		return
	}
	if err := handler.service.RevokeConnectedApp(request.Context(), userID, id); err != nil {
		handler.writeError(response, request, err, "connected app")
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusNoContent)
}

func (handler *ConnectedAppsHandler) ClearCalls(response http.ResponseWriter, request *http.Request) {
	userID, ok := handler.sessionMutation(response, request)
	if !ok {
		return
	}
	id, ok := pathID(response, request, "connected app")
	if !ok {
		return
	}
	if err := handler.service.ClearToolCalls(request.Context(), userID, id); err != nil {
		handler.writeError(response, request, err, "connected app")
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusNoContent)
}
