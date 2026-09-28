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

type estateMutationAuthorizer interface {
	AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error)
}

type estateMutationService interface {
	UpdatePlan(context.Context, uuid.UUID, service.EstatePlanInput) (service.EstatePlan, error)
	CreateBeneficiary(context.Context, uuid.UUID, service.BeneficiaryInput) (service.EstateMutationResult, error)
	UpdateBeneficiary(context.Context, uuid.UUID, uuid.UUID, service.BeneficiaryInput) error
	SetBeneficiaryArchived(context.Context, uuid.UUID, uuid.UUID, bool) error
	UpsertDirective(context.Context, uuid.UUID, uuid.UUID, service.EstateDirectiveInput) (service.EstateMutationResult, error)
	UpsertAllocation(context.Context, uuid.UUID, uuid.UUID, service.EstateAllocationInput) (service.EstateMutationResult, error)
	DeleteAllocation(context.Context, uuid.UUID, uuid.UUID) error
	UpsertResiduaryAllocation(context.Context, uuid.UUID, service.EstateAllocationInput) (service.EstateMutationResult, error)
	DeleteResiduaryAllocation(context.Context, uuid.UUID, uuid.UUID) error
	CreateSnapshot(context.Context, uuid.UUID) (service.EstateSnapshotResult, error)
	DeleteSnapshot(context.Context, uuid.UUID, uuid.UUID) error
}

type EstateMutationHandler struct {
	auth    estateMutationAuthorizer
	service estateMutationService
}

func NewEstateMutationHandler(auth estateMutationAuthorizer, mutations estateMutationService) *EstateMutationHandler {
	return &EstateMutationHandler{auth: auth, service: mutations}
}

func RegisterEstateMutationRoutes(router chi.Router, handler *EstateMutationHandler) {
	router.Put("/estate/plan", handler.UpdatePlan)
	router.Post("/estate/beneficiaries", handler.CreateBeneficiary)
	router.Put("/estate/beneficiaries/{id}", handler.UpdateBeneficiary)
	router.Patch("/estate/beneficiaries/{id}/archive", handler.ArchiveBeneficiary)
	router.Put("/estate/directives/{id}", handler.UpsertDirective)
	router.Put("/estate/allocations/{id}", handler.UpsertAllocation)
	router.Delete("/estate/allocations/{id}", handler.DeleteAllocation)
	router.Put("/estate/residuary", handler.UpsertResiduary)
	router.Delete("/estate/residuary/{id}", handler.DeleteResiduary)
	router.Post("/estate/snapshots", handler.CreateSnapshot)
	router.Delete("/estate/snapshots/{id}", handler.DeleteSnapshot)
}

func NewEstateMutationRoutes(auth estateMutationAuthorizer, mutations estateMutationService) http.Handler {
	router := chi.NewRouter()
	RegisterEstateMutationRoutes(router, NewEstateMutationHandler(auth, mutations))
	return router
}

func (handler *EstateMutationHandler) UpdatePlan(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.EstatePlanInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	result, err := handler.service.UpdatePlan(request.Context(), principal.UserID, input)
	if err != nil {
		writeEstateMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *EstateMutationHandler) CreateBeneficiary(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.BeneficiaryInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	result, err := handler.service.CreateBeneficiary(request.Context(), principal.UserID, input)
	if err != nil {
		writeEstateMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, result)
}

func (handler *EstateMutationHandler) UpdateBeneficiary(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := estateResourceID(response, request)
	if !ok {
		return
	}
	var input service.BeneficiaryInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	if err := handler.service.UpdateBeneficiary(request.Context(), principal.UserID, id, input); err != nil {
		writeEstateMutationError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *EstateMutationHandler) ArchiveBeneficiary(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := estateResourceID(response, request)
	if !ok {
		return
	}
	var input struct {
		Archived bool `json:"archived"`
	}
	if !decodeMutationInput(response, request, &input) {
		return
	}
	if err := handler.service.SetBeneficiaryArchived(request.Context(), principal.UserID, id, input.Archived); err != nil {
		writeEstateMutationError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *EstateMutationHandler) UpsertDirective(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := estateResourceID(response, request)
	if !ok {
		return
	}
	var input service.EstateDirectiveInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	result, err := handler.service.UpsertDirective(request.Context(), principal.UserID, id, input)
	if err != nil {
		writeEstateMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *EstateMutationHandler) UpsertAllocation(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := estateResourceID(response, request)
	if !ok {
		return
	}
	var input service.EstateAllocationInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	result, err := handler.service.UpsertAllocation(request.Context(), principal.UserID, id, input)
	if err != nil {
		writeEstateMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *EstateMutationHandler) DeleteAllocation(response http.ResponseWriter, request *http.Request) {
	handler.delete(response, request, handler.service.DeleteAllocation)
}

func (handler *EstateMutationHandler) UpsertResiduary(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var input service.EstateAllocationInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	result, err := handler.service.UpsertResiduaryAllocation(request.Context(), principal.UserID, input)
	if err != nil {
		writeEstateMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *EstateMutationHandler) DeleteResiduary(response http.ResponseWriter, request *http.Request) {
	handler.delete(response, request, handler.service.DeleteResiduaryAllocation)
}

func (handler *EstateMutationHandler) CreateSnapshot(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	result, err := handler.service.CreateSnapshot(request.Context(), principal.UserID)
	if err != nil {
		writeEstateMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, result)
}

func (handler *EstateMutationHandler) DeleteSnapshot(response http.ResponseWriter, request *http.Request) {
	handler.delete(response, request, handler.service.DeleteSnapshot)
}

func (handler *EstateMutationHandler) delete(response http.ResponseWriter, request *http.Request, remove func(context.Context, uuid.UUID, uuid.UUID) error) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	id, ok := estateResourceID(response, request)
	if !ok {
		return
	}
	if err := remove(request.Context(), principal.UserID, id); err != nil {
		writeEstateMutationError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *EstateMutationHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthorizePortfolioMutation(request)
	if err != nil {
		writeMutationAuthorizationError(response, err)
		return webauth.Principal{}, false
	}
	return principal, true
}

func estateResourceID(response http.ResponseWriter, request *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The estate resource was not found.")
		return uuid.Nil, false
	}
	return id, true
}

func writeEstateMutationError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrEstateNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
	case errors.Is(err, service.ErrEstateValidation):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "The estate planning change is invalid.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The estate planning change could not be completed.")
	}
}
