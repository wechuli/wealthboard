package api

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type portabilityAuthorizer interface {
	AuthenticateRequest(*http.Request) (webauth.Principal, error)
	AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error)
	AuthorizeSessionMutation(*http.Request) (webauth.Principal, error)
}

type portabilityService interface {
	ExportJSON(context.Context, uuid.UUID) ([]byte, error)
	TransactionsCSV(context.Context, uuid.UUID) ([]byte, error)
	AccountsCSV(context.Context, uuid.UUID) ([]byte, error)
	RestoreJSON(context.Context, uuid.UUID, []byte) (service.RestoreSummary, error)
}

type PortabilityHandler struct {
	auth    portabilityAuthorizer
	service portabilityService
}

func NewPortabilityHandler(auth portabilityAuthorizer, portability portabilityService) *PortabilityHandler {
	return &PortabilityHandler{auth: auth, service: portability}
}

func RegisterPortabilityRoutes(router chi.Router, handler *PortabilityHandler) {
	router.Get("/exports/user", handler.ExportJSON)
	router.Get("/exports/transactions.csv", handler.TransactionsCSV)
	router.Get("/exports/accounts.csv", handler.AccountsCSV)
	router.Post("/restore/user", handler.Restore)
}

func NewPortabilityRoutes(auth portabilityAuthorizer, portability portabilityService) http.Handler {
	router := chi.NewRouter()
	RegisterPortabilityRoutes(router, NewPortabilityHandler(auth, portability))
	return router
}

func (handler *PortabilityHandler) ExportJSON(response http.ResponseWriter, request *http.Request) {
	handler.export(response, request, "application/json", "wealthboard-export.json", handler.service.ExportJSON)
}

func (handler *PortabilityHandler) TransactionsCSV(response http.ResponseWriter, request *http.Request) {
	handler.export(response, request, "text/csv; charset=utf-8", "wealthboard-transactions.csv", handler.service.TransactionsCSV)
}

func (handler *PortabilityHandler) AccountsCSV(response http.ResponseWriter, request *http.Request) {
	handler.export(response, request, "text/csv; charset=utf-8", "wealthboard-accounts.csv", handler.service.AccountsCSV)
}

func (handler *PortabilityHandler) export(response http.ResponseWriter, request *http.Request, contentType, filename string, export func(context.Context, uuid.UUID) ([]byte, error)) {
	principal, err := handler.auth.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return
	}
	if !principal.HasScope(webauth.ScopeExportsRead) {
		writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant exports:read.")
		return
	}
	data, err := export(request.Context(), principal.UserID)
	if err != nil {
		writePortabilityError(response, err)
		return
	}
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(data)
}

func (handler *PortabilityHandler) Restore(response http.ResponseWriter, request *http.Request) {
	principal, err := handler.auth.AuthorizeSessionMutation(request)
	if err != nil {
		writeMutationAuthorizationError(response, err)
		return
	}
	data, err := readRestoreArchive(response, request)
	if err != nil {
		writePortabilityError(response, err)
		return
	}
	result, err := handler.service.RestoreJSON(request.Context(), principal.UserID, data)
	if err != nil {
		writePortabilityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func readRestoreArchive(response http.ResponseWriter, request *http.Request) ([]byte, error) {
	request.Body = http.MaxBytesReader(response, request.Body, service.MaxUserArchiveBytes+1024*1024)
	mediaType, _, _ := mime.ParseMediaType(request.Header.Get("Content-Type"))
	var reader io.Reader = request.Body
	if strings.HasPrefix(mediaType, "multipart/") {
		if err := request.ParseMultipartForm(service.MaxUserArchiveBytes); err != nil {
			return nil, service.ErrPortabilityTooLarge
		}
		file, _, err := request.FormFile("file")
		if err != nil {
			return nil, service.ErrPortabilityValidation
		}
		defer file.Close()
		reader = file
	}
	data, err := io.ReadAll(io.LimitReader(reader, service.MaxUserArchiveBytes+1))
	if err != nil {
		return nil, service.ErrPortabilityValidation
	}
	if len(data) > service.MaxUserArchiveBytes {
		return nil, service.ErrPortabilityTooLarge
	}
	return data, nil
}

func writePortabilityError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrPortabilityTooLarge):
		writeProblem(response, http.StatusRequestEntityTooLarge, "Archive too large", "The archive must not exceed 25 MB.")
	case errors.Is(err, service.ErrPortabilityValidation):
		writeProblem(response, http.StatusUnprocessableEntity, "Validation failed", "The archive is invalid or contains inconsistent relationships.")
	case errors.Is(err, service.ErrPortabilityNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested resource does not exist.")
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The portability operation could not be completed.")
	}
}

func writeMutationAuthorizationError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errMutationOrigin):
		writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
	case errors.Is(err, errMutationScope), errors.Is(err, errMutationMethod):
		writeProblem(response, http.StatusForbidden, "Forbidden", "A browser session is required.")
	default:
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid mutation authentication is required.")
	}
}
