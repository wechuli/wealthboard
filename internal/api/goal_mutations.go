package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type goalMutationAuthorizer interface {
	AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error)
}

type goalMutationService interface {
	CreateGoal(context.Context, uuid.UUID, service.GoalMutationInput) (service.GoalMutationResult, error)
	UpdateGoal(context.Context, uuid.UUID, uuid.UUID, service.GoalMutationInput) error
	SetGoalStatus(context.Context, uuid.UUID, uuid.UUID, string) error
	DeleteGoal(context.Context, uuid.UUID, uuid.UUID) error
	CreateMilestone(context.Context, uuid.UUID, uuid.UUID, service.GoalMilestoneInput) (uuid.UUID, error)
	DeleteMilestone(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
	DismissAlert(context.Context, uuid.UUID, uuid.UUID) error
}

type GoalMutationHandler struct {
	auth    goalMutationAuthorizer
	service goalMutationService
}

type goalWriteRequest struct {
	IdempotencyKey      *string     `json:"idempotencyKey"`
	Name                string      `json:"name"`
	Description         *string     `json:"description"`
	TargetAmount        string      `json:"targetAmount"`
	CurrentAmount       string      `json:"currentAmount"`
	Currency            string      `json:"currency"`
	TargetDate          string      `json:"targetDate"`
	LinkedAccountID     *string     `json:"linkedAccountId"`
	Icon                string      `json:"icon"`
	Status              string      `json:"status"`
	Priority            int         `json:"priority"`
	AssumedAnnualReturn json.Number `json:"assumedAnnualReturn"`
	PlannedContribution string      `json:"plannedContribution"`
	Frequency           string      `json:"frequency"`
	PlanStartDate       string      `json:"planStartDate"`
	PlanEndDate         string      `json:"planEndDate"`
}

func NewGoalMutationHandler(auth goalMutationAuthorizer, mutations goalMutationService) *GoalMutationHandler {
	return &GoalMutationHandler{auth: auth, service: mutations}
}

func RegisterGoalMutationRoutes(router chi.Router, handler *GoalMutationHandler) {
	router.Post("/goals", handler.CreateGoal)
	router.Put("/goals/{id}", handler.UpdateGoal)
	router.Patch("/goals/{id}/status", handler.SetGoalStatus)
	router.Delete("/goals/{id}", handler.DeleteGoal)
	router.Post("/goals/{id}/milestones", handler.CreateMilestone)
	router.Delete("/goals/{id}/milestones/{milestoneId}", handler.DeleteMilestone)
	router.Post("/goals/{id}/alerts/dismiss", handler.DismissAlert)
}

func (handler *GoalMutationHandler) CreateGoal(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return
	}
	var body goalWriteRequest
	if !decodeMutationInput(response, request, &body) {
		return
	}
	input, err := body.input(request.Header.Get("Idempotency-Key"))
	if err != nil {
		writeGoalMutationError(response, err)
		return
	}
	result, err := handler.service.CreateGoal(request.Context(), principal.UserID, input)
	if err != nil {
		writeGoalMutationError(response, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	writeJSON(response, status, result)
}

func (handler *GoalMutationHandler) UpdateGoal(response http.ResponseWriter, request *http.Request) {
	principal, goalID, ok := handler.authorizeGoal(response, request)
	if !ok {
		return
	}
	var body goalWriteRequest
	if !decodeMutationInput(response, request, &body) {
		return
	}
	input, err := body.input("")
	if err != nil {
		writeGoalMutationError(response, err)
		return
	}
	input.IdempotencyKey = nil
	if err := handler.service.UpdateGoal(request.Context(), principal.UserID, goalID, input); err != nil {
		writeGoalMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "updated"})
}

func (handler *GoalMutationHandler) SetGoalStatus(response http.ResponseWriter, request *http.Request) {
	principal, goalID, ok := handler.authorizeGoal(response, request)
	if !ok {
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if !decodeMutationInput(response, request, &body) {
		return
	}
	if err := handler.service.SetGoalStatus(request.Context(), principal.UserID, goalID, body.Status); err != nil {
		writeGoalMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "updated"})
}

func (handler *GoalMutationHandler) DeleteGoal(response http.ResponseWriter, request *http.Request) {
	principal, goalID, ok := handler.authorizeGoal(response, request)
	if !ok {
		return
	}
	if err := handler.service.DeleteGoal(request.Context(), principal.UserID, goalID); err != nil {
		writeGoalMutationError(response, err)
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusNoContent)
}

func (handler *GoalMutationHandler) CreateMilestone(response http.ResponseWriter, request *http.Request) {
	principal, goalID, ok := handler.authorizeGoal(response, request)
	if !ok {
		return
	}
	var input service.GoalMilestoneInput
	if !decodeMutationInput(response, request, &input) {
		return
	}
	milestoneID, err := handler.service.CreateMilestone(request.Context(), principal.UserID, goalID, input)
	if err != nil {
		writeGoalMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, map[string]string{"id": milestoneID.String()})
}

func (handler *GoalMutationHandler) DeleteMilestone(response http.ResponseWriter, request *http.Request) {
	principal, goalID, ok := handler.authorizeGoal(response, request)
	if !ok {
		return
	}
	milestoneID, err := uuid.Parse(chi.URLParam(request, "milestoneId"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The milestone was not found.")
		return
	}
	if err := handler.service.DeleteMilestone(request.Context(), principal.UserID, goalID, milestoneID); err != nil {
		writeGoalMutationError(response, err)
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusNoContent)
}

func (handler *GoalMutationHandler) DismissAlert(response http.ResponseWriter, request *http.Request) {
	principal, goalID, ok := handler.authorizeGoal(response, request)
	if !ok {
		return
	}
	if err := handler.service.DismissAlert(request.Context(), principal.UserID, goalID); err != nil {
		writeGoalMutationError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "dismissed"})
}

func (handler *GoalMutationHandler) authorize(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
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

func (handler *GoalMutationHandler) authorizeGoal(response http.ResponseWriter, request *http.Request) (webauth.Principal, uuid.UUID, bool) {
	principal, ok := handler.authorize(response, request)
	if !ok {
		return webauth.Principal{}, uuid.Nil, false
	}
	goalID, err := uuid.Parse(chi.URLParam(request, "id"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The goal was not found.")
		return webauth.Principal{}, uuid.Nil, false
	}
	return principal, goalID, true
}

func (body goalWriteRequest) input(headerKey string) (service.GoalMutationInput, error) {
	var bodyKey *uuid.UUID
	if body.IdempotencyKey != nil && strings.TrimSpace(*body.IdempotencyKey) != "" {
		parsed, err := uuid.Parse(strings.TrimSpace(*body.IdempotencyKey))
		if err != nil {
			return service.GoalMutationInput{}, fmtGoalValidation("idempotency key must be a UUID")
		}
		bodyKey = &parsed
	}
	if strings.TrimSpace(headerKey) != "" {
		parsed, err := uuid.Parse(strings.TrimSpace(headerKey))
		if err != nil {
			return service.GoalMutationInput{}, fmtGoalValidation("Idempotency-Key must be a UUID")
		}
		if bodyKey != nil && *bodyKey != parsed {
			return service.GoalMutationInput{}, fmtGoalValidation("body and header idempotency keys must match")
		}
		bodyKey = &parsed
	}
	var linkedAccountID *uuid.UUID
	if body.LinkedAccountID != nil && strings.TrimSpace(*body.LinkedAccountID) != "" {
		parsed, err := uuid.Parse(strings.TrimSpace(*body.LinkedAccountID))
		if err != nil {
			return service.GoalMutationInput{}, fmtGoalValidation("linked account ID must be a UUID")
		}
		linkedAccountID = &parsed
	}
	icon, status, frequency := body.Icon, body.Status, body.Frequency
	if icon == "" {
		icon = "Target"
	}
	if status == "" {
		status = "active"
	}
	if frequency == "" {
		frequency = "monthly"
	}
	return service.GoalMutationInput{
		IdempotencyKey: bodyKey, Name: body.Name, Description: body.Description,
		TargetAmount: body.TargetAmount, CurrentAmount: body.CurrentAmount, Currency: body.Currency,
		TargetDate: body.TargetDate, LinkedAccountID: linkedAccountID, Icon: icon, Status: status,
		Priority: body.Priority, AssumedAnnualReturn: body.AssumedAnnualReturn.String(),
		PlannedContribution: body.PlannedContribution, Frequency: frequency,
		PlanStartDate: body.PlanStartDate, PlanEndDate: body.PlanEndDate,
	}, nil
}

func fmtGoalValidation(detail string) error {
	return errors.Join(service.ErrGoalMutationValidation, errors.New(detail))
}

func writeGoalMutationError(response http.ResponseWriter, err error) {
	detail := goalMutationErrorDetail(err)
	switch {
	case errors.Is(err, service.ErrGoalMutationValidation):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", detail)
	case errors.Is(err, service.ErrGoalMutationConflict):
		writeProblem(response, http.StatusConflict, "Conflict", detail)
	case errors.Is(err, service.ErrGoalMutationNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The goal change could not be completed.")
	}
}

func goalMutationErrorDetail(err error) string {
	detail := err.Error()
	if index := strings.LastIndex(detail, ": "); index >= 0 {
		detail = detail[index+2:]
	}
	return detail
}
