package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

const importRequestOverhead = 1 << 20

type accountHistoryImporter interface {
	Preview(context.Context, uuid.UUID, uuid.UUID, []byte, service.ImportFormat) (service.AccountHistoryImportResult, error)
	Commit(context.Context, uuid.UUID, uuid.UUID, []byte, service.ImportFormat, string) (service.AccountHistoryImportResult, error)
}

type investmentHistoryImporter interface {
	Preview(context.Context, uuid.UUID, uuid.UUID, []byte, service.ImportFormat) (service.InvestmentHistoryImportResult, error)
	Commit(context.Context, uuid.UUID, uuid.UUID, []byte, service.ImportFormat, string) (service.InvestmentHistoryImportResult, error)
}

type ImportHandler struct {
	authenticator RequestAuthenticator
	accounts      accountHistoryImporter
	investments   investmentHistoryImporter
	trustedOrigin string
}

func NewImportHandler(authenticator RequestAuthenticator, accounts accountHistoryImporter, investments investmentHistoryImporter, trustedOrigin string) *ImportHandler {
	return &ImportHandler{authenticator: authenticator, accounts: accounts, investments: investments, trustedOrigin: trustedOrigin}
}

func RegisterImportRoutes(router chi.Router, handler *ImportHandler) {
	router.Post("/accounts/{accountID}/history-import/preview", handler.PreviewAccountHistory)
	router.Post("/accounts/{accountID}/history-import/commit", handler.CommitAccountHistory)
	router.Post("/accounts/{accountID}/investment-import/preview", handler.PreviewInvestmentHistory)
	router.Post("/accounts/{accountID}/investment-import/commit", handler.CommitInvestmentHistory)
}

func (handler *ImportHandler) PreviewAccountHistory(response http.ResponseWriter, request *http.Request) {
	principal, accountID, content, format, _, ok := handler.authorizeAndRead(response, request, false)
	if !ok {
		return
	}
	result, err := handler.accounts.Preview(request.Context(), principal.UserID, accountID, content, format)
	handler.writeResult(response, result, err)
}

func (handler *ImportHandler) CommitAccountHistory(response http.ResponseWriter, request *http.Request) {
	principal, accountID, content, format, hash, ok := handler.authorizeAndRead(response, request, true)
	if !ok {
		return
	}
	result, err := handler.accounts.Commit(request.Context(), principal.UserID, accountID, content, format, hash)
	handler.writeResult(response, result, err)
}

func (handler *ImportHandler) PreviewInvestmentHistory(response http.ResponseWriter, request *http.Request) {
	principal, accountID, content, format, _, ok := handler.authorizeAndRead(response, request, false)
	if !ok {
		return
	}
	result, err := handler.investments.Preview(request.Context(), principal.UserID, accountID, content, format)
	handler.writeResult(response, result, err)
}

func (handler *ImportHandler) CommitInvestmentHistory(response http.ResponseWriter, request *http.Request) {
	principal, accountID, content, format, hash, ok := handler.authorizeAndRead(response, request, true)
	if !ok {
		return
	}
	result, err := handler.investments.Commit(request.Context(), principal.UserID, accountID, content, format, hash)
	handler.writeResult(response, result, err)
}

func (handler *ImportHandler) authorizeAndRead(response http.ResponseWriter, request *http.Request, requireHash bool) (webauth.Principal, uuid.UUID, []byte, service.ImportFormat, string, bool) {
	principal, err := handler.authenticator.AuthenticateRequest(request)
	if err != nil {
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return webauth.Principal{}, uuid.Nil, nil, "", "", false
	}
	switch principal.Method {
	case "api_key":
		if !principal.HasScope(webauth.ScopeImportsWrite) {
			writeProblem(response, http.StatusForbidden, "Forbidden", "The credential does not grant imports:write.")
			return webauth.Principal{}, uuid.Nil, nil, "", "", false
		}
	case "session":
		if request.Header.Get("Origin") != handler.trustedOrigin {
			writeProblem(response, http.StatusForbidden, "Forbidden", "The request origin is not allowed.")
			return webauth.Principal{}, uuid.Nil, nil, "", "", false
		}
		if !webauth.VerifyCSRF(principal.CSRFToken, request.Header.Get("X-CSRF-Token")) {
			writeProblem(response, http.StatusUnauthorized, "Unauthorized", "A valid browser session and CSRF token are required.")
			return webauth.Principal{}, uuid.Nil, nil, "", "", false
		}
	default:
		writeProblem(response, http.StatusUnauthorized, "Unauthorized", "Valid authentication is required.")
		return webauth.Principal{}, uuid.Nil, nil, "", "", false
	}
	accountID, err := uuid.Parse(chi.URLParam(request, "accountID"))
	if err != nil {
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested account does not exist.")
		return webauth.Principal{}, uuid.Nil, nil, "", "", false
	}
	content, format, hash, err := readImportRequest(response, request)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errImportTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeProblem(response, status, "Invalid import", err.Error())
		return webauth.Principal{}, uuid.Nil, nil, "", "", false
	}
	if requireHash && hash == "" {
		writeProblem(response, http.StatusBadRequest, "Preview required", "Preview the same import content before committing it.")
		return webauth.Principal{}, uuid.Nil, nil, "", "", false
	}
	return principal, accountID, content, format, hash, true
}

var errImportTooLarge = errors.New("the import is limited to 5 MB")

func readImportRequest(response http.ResponseWriter, request *http.Request) ([]byte, service.ImportFormat, string, error) {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil {
		return nil, "", "", errors.New("provide a CSV, JSON, or multipart import body")
	}
	if mediaType == "multipart/form-data" {
		request.Body = http.MaxBytesReader(response, request.Body, service.ImportMaxBytes+importRequestOverhead)
		if err := request.ParseMultipartForm(service.ImportMaxBytes + importRequestOverhead); err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				return nil, "", "", errImportTooLarge
			}
			return nil, "", "", errors.New("the multipart import is malformed")
		}
		file, header, err := request.FormFile("file")
		if err != nil {
			return nil, "", "", errors.New("choose an import file")
		}
		defer file.Close()
		content, err := io.ReadAll(io.LimitReader(file, service.ImportMaxBytes+1))
		if err != nil {
			return nil, "", "", errors.New("the import file could not be read")
		}
		if len(content) > service.ImportMaxBytes {
			return nil, "", "", errImportTooLarge
		}
		format, err := importFormatForName(header.Filename)
		if err != nil {
			if value := request.FormValue("format"); value != "" {
				format, err = parseImportFormat(value)
			}
		}
		return content, format, request.FormValue("hash"), err
	}
	format := service.ImportFormat("")
	switch mediaType {
	case "application/json":
		format = service.ImportFormatJSON
	case "text/csv", "application/csv":
		format = service.ImportFormatCSV
	default:
		return nil, "", "", errors.New("Content-Type must be application/json, text/csv, or multipart/form-data")
	}
	request.Body = http.MaxBytesReader(response, request.Body, service.ImportMaxBytes)
	content, err := io.ReadAll(request.Body)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return nil, "", "", errImportTooLarge
		}
		return nil, "", "", errors.New("the import body could not be read")
	}
	return content, format, request.Header.Get("X-Preview-Hash"), nil
}

func importFormatForName(name string) (service.ImportFormat, error) {
	return parseImportFormat(strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), "."))
}

func parseImportFormat(value string) (service.ImportFormat, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "csv":
		return service.ImportFormatCSV, nil
	case "json":
		return service.ImportFormatJSON, nil
	default:
		return "", fmt.Errorf("choose a .csv or .json file")
	}
}

func (handler *ImportHandler) writeResult(response http.ResponseWriter, result any, err error) {
	response.Header().Set("Cache-Control", "no-store")
	switch {
	case err == nil:
		writeJSON(response, http.StatusOK, result)
	case errors.Is(err, service.ErrImportNotFound):
		writeProblem(response, http.StatusNotFound, "Not Found", "The requested account does not exist.")
	case errors.Is(err, service.ErrImportConflict):
		writeProblem(response, http.StatusConflict, "Import conflict", err.Error())
	case errors.Is(err, service.ErrImportValidation), errors.Is(err, service.ErrInvestmentMutationValidation), errors.Is(err, service.ErrInvestmentMutationConflict), errors.Is(err, service.ErrLedgerValidation):
		writeProblem(response, http.StatusUnprocessableEntity, "Invalid import", err.Error())
	default:
		writeProblem(response, http.StatusServiceUnavailable, "Service unavailable", "The import could not be completed.")
	}
}
