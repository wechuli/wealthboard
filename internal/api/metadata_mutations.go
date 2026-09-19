package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type metadataMutationAuthorizer interface {
	AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error)
}

type metadataMutationService interface {
	UpdateSettings(context.Context, uuid.UUID, service.SettingsInput) error
	CreateCategory(context.Context, uuid.UUID, service.CategoryInput) (service.Category, error)
	UpdateCategory(context.Context, uuid.UUID, uuid.UUID, service.CategoryInput) error
	ArchiveCategory(context.Context, uuid.UUID, uuid.UUID, bool) error
	ReorderCategory(context.Context, uuid.UUID, uuid.UUID, string) error
	CreateInstitution(context.Context, uuid.UUID, service.InstitutionInput) (service.Institution, error)
	UpdateInstitution(context.Context, uuid.UUID, uuid.UUID, service.InstitutionInput) error
	ArchiveInstitution(context.Context, uuid.UUID, uuid.UUID, bool) error
	CreateExchangeRate(context.Context, uuid.UUID, service.ExchangeRateInput) (service.ExchangeRate, error)
	DeleteExchangeRate(context.Context, uuid.UUID, uuid.UUID) error
}

type MetadataMutationHandler struct {
	auth    metadataMutationAuthorizer
	service metadataMutationService
}

func NewMetadataMutationHandler(auth metadataMutationAuthorizer, mutations metadataMutationService) *MetadataMutationHandler {
	return &MetadataMutationHandler{auth: auth, service: mutations}
}

func RegisterMetadataMutationRoutes(router chi.Router, handler *MetadataMutationHandler) {
	router.Put("/settings", handler.UpdateSettings)
	router.Post("/categories", handler.CreateCategory)
	router.Put("/categories/{id}", handler.UpdateCategory)
	router.Patch("/categories/{id}/archive", handler.ArchiveCategory)
	router.Post("/categories/{id}/reorder", handler.ReorderCategory)
	router.Post("/institutions", handler.CreateInstitution)
	router.Put("/institutions/{id}", handler.UpdateInstitution)
	router.Patch("/institutions/{id}/archive", handler.ArchiveInstitution)
	router.Post("/exchange-rates", handler.CreateExchangeRate)
	router.Delete("/exchange-rates/{id}", handler.DeleteExchangeRate)
}

func (handler *MetadataMutationHandler) UpdateSettings(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.SettingsInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	if err := handler.service.UpdateSettings(request.Context(), principal.UserID, input); err != nil {
		writeMetadataMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "updated"})
}

func (handler *MetadataMutationHandler) CreateCategory(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.CategoryInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	created, err := handler.service.CreateCategory(request.Context(), principal.UserID, input)
	if err != nil {
		writeMetadataMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, created)
}

func (handler *MetadataMutationHandler) UpdateCategory(response http.ResponseWriter, request *http.Request) {
	handler.categoryMutation(response, request, func(ctx context.Context, userID, categoryID uuid.UUID) error {
		var input service.CategoryInput
		if !decodeMutationInput(response, request, &input) {
			return errResponseWritten
		}
		return handler.service.UpdateCategory(ctx, userID, categoryID, input)
	})
}

func (handler *MetadataMutationHandler) ArchiveCategory(response http.ResponseWriter, request *http.Request) {
	handler.categoryMutation(response, request, func(ctx context.Context, userID, categoryID uuid.UUID) error {
		var input struct {
			Archived bool `json:"archived"`
		}
		if !decodeMutationInput(response, request, &input) {
			return errResponseWritten
		}
		return handler.service.ArchiveCategory(ctx, userID, categoryID, input.Archived)
	})
}

func (handler *MetadataMutationHandler) ReorderCategory(response http.ResponseWriter, request *http.Request) {
	handler.categoryMutation(response, request, func(ctx context.Context, userID, categoryID uuid.UUID) error {
		var input struct {
			Direction string `json:"direction"`
		}
		if !decodeMutationInput(response, request, &input) {
			return errResponseWritten
		}
		return handler.service.ReorderCategory(ctx, userID, categoryID, input.Direction)
	})
}

func (handler *MetadataMutationHandler) categoryMutation(response http.ResponseWriter, request *http.Request, mutate func(context.Context, uuid.UUID, uuid.UUID) error) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	categoryID, ok := metadataResourceID(response, request, "category")
	if !ok {
		return
	}
	if err := mutate(request.Context(), principal.UserID, categoryID); err != nil {
		if !errors.Is(err, errResponseWritten) {
			writeMetadataMutationError(response, err)
		}
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "updated"})
}

func (handler *MetadataMutationHandler) CreateInstitution(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.InstitutionInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	created, err := handler.service.CreateInstitution(request.Context(), principal.UserID, input)
	if err != nil {
		writeMetadataMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, created)
}

func (handler *MetadataMutationHandler) UpdateInstitution(response http.ResponseWriter, request *http.Request) {
	handler.institutionMutation(response, request, func(ctx context.Context, userID, institutionID uuid.UUID) error {
		var input service.InstitutionInput
		if !decodeMutationInput(response, request, &input) {
			return errResponseWritten
		}
		return handler.service.UpdateInstitution(ctx, userID, institutionID, input)
	})
}

func (handler *MetadataMutationHandler) ArchiveInstitution(response http.ResponseWriter, request *http.Request) {
	handler.institutionMutation(response, request, func(ctx context.Context, userID, institutionID uuid.UUID) error {
		var input struct {
			Archived bool `json:"archived"`
		}
		if !decodeMutationInput(response, request, &input) {
			return errResponseWritten
		}
		return handler.service.ArchiveInstitution(ctx, userID, institutionID, input.Archived)
	})
}

func (handler *MetadataMutationHandler) institutionMutation(response http.ResponseWriter, request *http.Request, mutate func(context.Context, uuid.UUID, uuid.UUID) error) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	institutionID, ok := metadataResourceID(response, request, "institution")
	if !ok {
		return
	}
	if err := mutate(request.Context(), principal.UserID, institutionID); err != nil {
		if !errors.Is(err, errResponseWritten) {
			writeMetadataMutationError(response, err)
		}
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "updated"})
}

func (handler *MetadataMutationHandler) CreateExchangeRate(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.ExchangeRateInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	created, err := handler.service.CreateExchangeRate(request.Context(), principal.UserID, input)
	if err != nil {
		writeMetadataMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, created)
}

func (handler *MetadataMutationHandler) DeleteExchangeRate(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	rateID, ok := metadataResourceID(response, request, "exchange rate")
	if !ok {
		return
	}
	if err := handler.service.DeleteExchangeRate(request.Context(), principal.UserID, rateID); err != nil {
		writeMetadataMutationError(response, err)
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusNoContent)
}

func (handler *MetadataMutationHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthorizePortfolioMutation(request)
	switch {
	case errors.Is(err, errMutationOrigin):
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
	case errors.Is(err, errMutationScope):
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant portfolio:write.")
	case err != nil:
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid mutation authentication is required.")
	default:
		return principal, true
	}
	return webauth.Principal{}, false
}

var errResponseWritten = errors.New("response already written")

func decodeMutationInput(response http.ResponseWriter, request *http.Request, destination any) bool {
	if err := decodeJSON(response, request, destination); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide a valid JSON request body.")
		return false
	}
	return true
}

func metadataResourceID(response http.ResponseWriter, request *http.Request, resource string) (uuid.UUID, bool) {
	resourceID, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The "+resource+" was not found.")
		return uuid.Nil, false
	}
	return resourceID, true
}

func writeMetadataMutationError(response http.ResponseWriter, err error) {
	var metadataErr *service.MetadataError
	if !errors.As(err, &metadataErr) {
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The metadata change could not be completed.")
		return
	}
	switch metadataErr.Kind {
	case service.MetadataValidation:
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", metadataErr.Detail)
	case service.MetadataConflict:
		writeProblem(response, http.StatusConflict, "Conflict", metadataErr.Detail)
	case service.MetadataNotFound:
		writeProblem(response, http.StatusNotFound, "Not Found", metadataErr.Detail)
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The metadata change could not be completed.")
	}
}
