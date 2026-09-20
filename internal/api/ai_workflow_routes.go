package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/aiworkflow"
	webauth "github.com/wechuli/wealthboard/internal/auth"
)

const maxAIJSONBytes = aiworkflow.MaxSourceBytes + 128<<10

type aiWorkflowAuthorizer interface {
	AuthorizeScopedMutation(*http.Request, webauth.Scope) (webauth.Principal, error)
	AuthorizeSessionMutation(*http.Request) (webauth.Principal, error)
}

type aiWorkflowService interface {
	SaveSettings(context.Context, uuid.UUID, aiworkflow.SettingsInput) (*aiworkflow.Settings, error)
	SaveCredential(context.Context, uuid.UUID, string) (*aiworkflow.Settings, error)
	DeleteCredential(context.Context, uuid.UUID) error
	Disconnect(context.Context, uuid.UUID) error
	ClearUsage(context.Context, uuid.UUID) (int64, error)
	Review(context.Context, uuid.UUID, aiworkflow.ReviewRequest) (map[string]any, error)
	Convert(context.Context, uuid.UUID, aiworkflow.ConversionRequest) (aiworkflow.ConversionDraft, error)
}

type AIWorkflowHandler struct {
	auth      aiWorkflowAuthorizer
	service   aiWorkflowService
	extractor aiworkflow.Extractor
}

func NewAIWorkflowHandler(auth aiWorkflowAuthorizer, service aiWorkflowService, extractor aiworkflow.Extractor) *AIWorkflowHandler {
	return &AIWorkflowHandler{auth: auth, service: service, extractor: extractor}
}

func RegisterAIWorkflowRoutes(router chi.Router, handler *AIWorkflowHandler) {
	router.Put("/ai/settings", handler.SaveSettings)
	router.Post("/ai/credential", handler.SaveCredential)
	router.Delete("/ai/credential", handler.DeleteCredential)
	router.Delete("/ai/settings", handler.Disconnect)
	router.Post("/ai/usage/clear", handler.ClearUsage)
	router.Post("/ai/review", handler.Review)
	router.Post("/ai/import/extract", handler.Extract)
	router.Post("/ai/import/convert", handler.Convert)
}

func (handler *AIWorkflowHandler) SaveSettings(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeSession(response, request)
	if !ok {
		return
	}
	var input aiworkflow.SettingsInput
	if !decodeAIJSON(response, request, &input, 16<<10) {
		return
	}
	settings, err := handler.service.SaveSettings(request.Context(), principal.UserID, input)
	if err != nil {
		writeAIWorkflowError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, settings)
}

func (handler *AIWorkflowHandler) SaveCredential(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeSession(response, request)
	if !ok {
		return
	}
	var input struct {
		APIKey string `json:"apiKey"`
	}
	if !decodeAIJSON(response, request, &input, 8<<10) {
		return
	}
	settings, err := handler.service.SaveCredential(request.Context(), principal.UserID, input.APIKey)
	input.APIKey = ""
	if err != nil {
		writeAIWorkflowError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, settings)
}

func (handler *AIWorkflowHandler) DeleteCredential(response http.ResponseWriter, request *http.Request) {
	handler.emptyMutation(response, request, handler.service.DeleteCredential)
}

func (handler *AIWorkflowHandler) Disconnect(response http.ResponseWriter, request *http.Request) {
	handler.emptyMutation(response, request, handler.service.Disconnect)
}

func (handler *AIWorkflowHandler) ClearUsage(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeSession(response, request)
	if !ok {
		return
	}
	deleted, err := handler.service.ClearUsage(request.Context(), principal.UserID)
	if err != nil {
		writeAIWorkflowError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]int64{"deleted": deleted})
}

func (handler *AIWorkflowHandler) Review(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeInvoke(response, request)
	if !ok {
		return
	}
	var input aiworkflow.ReviewRequest
	if !decodeAIJSON(response, request, &input, 40<<10) {
		return
	}
	result, err := handler.service.Review(request.Context(), principal.UserID, input)
	input.APIKey = ""
	if err != nil {
		writeAIWorkflowError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *AIWorkflowHandler) Extract(response http.ResponseWriter, request *http.Request) {
	_, ok := handler.authorizeInvoke(response, request)
	if !ok {
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, aiworkflow.MaxSourceBytes+64<<10)
	if err := request.ParseMultipartForm(aiworkflow.MaxSourceBytes + 64<<10); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid source", "Provide a file no larger than 5 MB.")
		return
	}
	if request.MultipartForm != nil {
		defer request.MultipartForm.RemoveAll()
	}
	files := request.MultipartForm.File["file"]
	passwords := request.MultipartForm.Value["documentPassword"]
	if len(files) != 1 || len(passwords) > 1 {
		writeProblem(response, http.StatusBadRequest, "Invalid source", "Provide one source file and at most one document password.")
		return
	}
	file, err := files[0].Open()
	if err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid source", "The source file could not be read.")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, aiworkflow.MaxSourceBytes+1))
	if err != nil || len(content) > aiworkflow.MaxSourceBytes {
		writeProblem(response, http.StatusBadRequest, "Invalid source", "Provide a file no larger than 5 MB.")
		return
	}
	password := ""
	if len(passwords) == 1 {
		password = passwords[0]
	}
	source, err := handler.extractor.Extract(request.Context(), files[0].Filename, content, password)
	password = ""
	for index := range passwords {
		passwords[index] = ""
	}
	if err != nil {
		writeAIWorkflowError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"source": source})
}

func (handler *AIWorkflowHandler) Convert(response http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeInvoke(response, request)
	if !ok {
		return
	}
	var input aiworkflow.ConversionRequest
	if !decodeAIJSON(response, request, &input, maxAIJSONBytes) {
		return
	}
	draft, err := handler.service.Convert(request.Context(), principal.UserID, input)
	input.APIKey = ""
	if err != nil {
		writeAIWorkflowError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, draft)
}

func (handler *AIWorkflowHandler) emptyMutation(response http.ResponseWriter, request *http.Request, operation func(context.Context, uuid.UUID) error) {
	principal, ok := handler.authorizeSession(response, request)
	if !ok {
		return
	}
	if err := operation(request.Context(), principal.UserID); err != nil {
		writeAIWorkflowError(response, err)
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusNoContent)
}

func (handler *AIWorkflowHandler) authorizeSession(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthorizeSessionMutation(request)
	return handler.writeAuthorization(response, principal, err)
}

func (handler *AIWorkflowHandler) authorizeInvoke(response http.ResponseWriter, request *http.Request) (webauth.Principal, bool) {
	principal, err := handler.auth.AuthorizeScopedMutation(request, webauth.ScopeAIInvoke)
	return handler.writeAuthorization(response, principal, err)
}

func (handler *AIWorkflowHandler) writeAuthorization(response http.ResponseWriter, principal webauth.Principal, err error) (webauth.Principal, bool) {
	switch {
	case errors.Is(err, errMutationOrigin), errors.Is(err, errMutationScope), errors.Is(err, errMutationMethod):
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request is not allowed.")
	case err != nil:
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid mutation authentication is required.")
	default:
		return principal, true
	}
	return webauth.Principal{}, false
}

func decodeAIJSON(response http.ResponseWriter, request *http.Request, destination any, maximum int64) bool {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Content-Type must be application/json.")
		return false
	}
	request.Body = http.MaxBytesReader(response, request.Body, maximum)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide one valid JSON request body.")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeProblem(response, http.StatusBadRequest, "Invalid request", "Provide one valid JSON request body.")
		return false
	}
	return true
}

func writeAIWorkflowError(response http.ResponseWriter, err error) {
	var sourceError *aiworkflow.SourceError
	switch {
	case errors.As(err, &sourceError):
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		response.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(response).Encode(map[string]string{"error": sourceError.Message, "code": sourceError.Code})
	case errors.Is(err, aiworkflow.ErrInvalidInput), errors.Is(err, aiworkflow.ErrCredential), errors.Is(err, aiworkflow.ErrNotConfigured):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", err.Error())
	case errors.Is(err, aiworkflow.ErrRateLimited), errors.Is(err, aiworkflow.ErrBudget):
		writeProblem(response, http.StatusTooManyRequests, "AI request unavailable", err.Error())
	case errors.Is(err, context.DeadlineExceeded):
		writeProblem(response, http.StatusGatewayTimeout, "Provider timeout", "The provider did not finish in time.")
	case strings.Contains(err.Error(), "provider"):
		writeProblem(response, http.StatusBadGateway, "Provider error", "The AI provider could not complete the request.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The AI workflow could not be completed.")
	}
}
