package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type featureReadAuthenticator interface {
	AuthenticateRequest(*http.Request) (webauth.Principal, error)
}

type featureReadService interface {
	Settings(context.Context, uuid.UUID) (service.SettingsRead, error)
	Instruments(context.Context, uuid.UUID) ([]service.Instrument, error)
	Instrument(context.Context, uuid.UUID, uuid.UUID) (service.InstrumentDetail, error)
	EstateWorkspace(context.Context, uuid.UUID) (service.EstateWorkspaceRead, error)
	EstateSnapshot(context.Context, uuid.UUID, uuid.UUID) (service.EstateSnapshot, error)
	AI(context.Context, uuid.UUID) (service.AIRead, error)
}

type FeatureReadHandler struct {
	auth    featureReadAuthenticator
	service featureReadService
}

func NewFeatureReadHandler(auth featureReadAuthenticator, service featureReadService) *FeatureReadHandler {
	return &FeatureReadHandler{auth: auth, service: service}
}

// RegisterFeatureReadRoutes registers the Phase 3 read-only API below /api/v1.
func RegisterFeatureReadRoutes(router chi.Router, handler *FeatureReadHandler) {
	router.Get("/settings", handler.Settings)
	router.Get("/instruments", handler.Instruments)
	router.Get("/instruments/{id}", handler.Instrument)
	router.Get("/estate", handler.EstateWorkspace)
	router.Get("/estate/snapshots/{id}", handler.EstateSnapshot)
	router.Get("/ai", handler.AI)
}

func (handler *FeatureReadHandler) Settings(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	result, err := handler.service.Settings(request.Context(), principal.UserID)
	if err != nil {
		writeFeatureReadError(response, err, "Settings are temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *FeatureReadHandler) Instruments(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	result, err := handler.service.Instruments(request.Context(), principal.UserID)
	if err != nil {
		writeFeatureReadError(response, err, "Instruments are temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"instruments": result})
}

func (handler *FeatureReadHandler) Instrument(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	instrumentID, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The instrument was not found.")
		return
	}
	result, err := handler.service.Instrument(request.Context(), principal.UserID, instrumentID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeProblem(response, http.StatusNotFound, "Not Found", "The instrument was not found.")
			return
		}
		writeFeatureReadError(response, err, "The instrument is temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *FeatureReadHandler) EstateWorkspace(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	result, err := handler.service.EstateWorkspace(request.Context(), principal.UserID)
	if err != nil {
		writeFeatureReadError(response, err, "Estate planning records are temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *FeatureReadHandler) EstateSnapshot(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	snapshotID, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The estate snapshot was not found.")
		return
	}
	result, err := handler.service.EstateSnapshot(request.Context(), principal.UserID, snapshotID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeProblem(response, http.StatusNotFound, "Not Found", "The estate snapshot was not found.")
			return
		}
		writeFeatureReadError(response, err, "The estate snapshot is temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *FeatureReadHandler) AI(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	result, err := handler.service.AI(request.Context(), principal.UserID)
	if err != nil {
		writeFeatureReadError(response, err, "AI provider metadata is temporarily unavailable.")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *FeatureReadHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return webauth.Principal{}, false
	}
	if !principal.HasScope(webauth.ScopePortfolioRead) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant portfolio:read.")
		return webauth.Principal{}, false
	}
	return principal, true
}

func writeFeatureReadError(response http.ResponseWriter, _ error, detail string) {
	writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", detail)
}
