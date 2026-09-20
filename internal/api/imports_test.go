package api

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakeImportAuthenticator struct {
	principal webauth.Principal
	err       error
}

func (fake fakeImportAuthenticator) AuthenticateRequest(*http.Request) (webauth.Principal, error) {
	return fake.principal, fake.err
}

type fakeAccountHistoryImporter struct {
	previewUser, previewAccount uuid.UUID
	previewContent              []byte
	previewFormat               service.ImportFormat
	commitHash                  string
	err                         error
}

func (fake *fakeAccountHistoryImporter) Preview(_ context.Context, userID, accountID uuid.UUID, content []byte, format service.ImportFormat) (service.AccountHistoryImportResult, error) {
	fake.previewUser, fake.previewAccount, fake.previewContent, fake.previewFormat = userID, accountID, content, format
	return service.AccountHistoryImportResult{Hash: "preview"}, fake.err
}

func (fake *fakeAccountHistoryImporter) Commit(_ context.Context, userID, accountID uuid.UUID, content []byte, format service.ImportFormat, hash string) (service.AccountHistoryImportResult, error) {
	fake.previewUser, fake.previewAccount, fake.previewContent, fake.previewFormat, fake.commitHash = userID, accountID, content, format, hash
	return service.AccountHistoryImportResult{}, fake.err
}

type fakeInvestmentHistoryImporter struct{ err error }

func (fake *fakeInvestmentHistoryImporter) Preview(context.Context, uuid.UUID, uuid.UUID, []byte, service.ImportFormat) (service.InvestmentHistoryImportResult, error) {
	return service.InvestmentHistoryImportResult{}, fake.err
}
func (fake *fakeInvestmentHistoryImporter) Commit(context.Context, uuid.UUID, uuid.UUID, []byte, service.ImportFormat, string) (service.InvestmentHistoryImportResult, error) {
	return service.InvestmentHistoryImportResult{}, fake.err
}

func TestImportRoutesAcceptRawJSONAndMultipartCommit(t *testing.T) {
	ownerID, accountID := uuid.New(), uuid.New()
	accounts := &fakeAccountHistoryImporter{}
	router := importTestRouter(fakeImportAuthenticator{principal: webauth.Principal{UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}}, accounts, &fakeInvestmentHistoryImporter{})

	preview := httptest.NewRequest(http.MethodPost, "/accounts/"+accountID.String()+"/history-import/preview", strings.NewReader(`{"format":"wealthboard-account-history"}`))
	preview.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, preview)
	if response.Code != http.StatusOK || accounts.previewUser != ownerID || accounts.previewAccount != accountID || accounts.previewFormat != service.ImportFormatJSON {
		t.Fatalf("preview = status %d user %s account %s format %s", response.Code, accounts.previewUser, accounts.previewAccount, accounts.previewFormat)
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	file, err := writer.CreateFormFile("file", "history.csv")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("external_id,type,amount,date,description,notes\nrow-1,deposit,1,2026-09-19,,\n"))
	_ = writer.WriteField("hash", strings.Repeat("a", 64))
	_ = writer.Close()
	commit := httptest.NewRequest(http.MethodPost, "/accounts/"+accountID.String()+"/history-import/commit", body)
	commit.Header.Set("Content-Type", writer.FormDataContentType())
	response = httptest.NewRecorder()
	router.ServeHTTP(response, commit)
	if response.Code != http.StatusOK || accounts.previewFormat != service.ImportFormatCSV || accounts.commitHash != strings.Repeat("a", 64) {
		t.Fatalf("commit = status %d format %s hash %q", response.Code, accounts.previewFormat, accounts.commitHash)
	}
}

func TestImportRoutesRequireWriteScopeAndBrowserCSRF(t *testing.T) {
	accountID := uuid.New()
	tests := []struct {
		name      string
		principal webauth.Principal
		headers   map[string]string
		want      int
	}{
		{name: "write scope", principal: webauth.Principal{UserID: uuid.New(), Method: "api_key"}, want: http.StatusForbidden},
		{name: "origin", principal: webauth.Principal{UserID: uuid.New(), Method: "session", CSRFToken: "token", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}, want: http.StatusForbidden},
		{name: "csrf", principal: webauth.Principal{UserID: uuid.New(), Method: "session", CSRFToken: "token", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}, headers: map[string]string{"Origin": "https://wealth.test"}, want: http.StatusUnauthorized},
		{name: "allowed", principal: webauth.Principal{UserID: uuid.New(), Method: "session", CSRFToken: "token", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}, headers: map[string]string{"Origin": "https://wealth.test", "X-CSRF-Token": "token"}, want: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := importTestRouter(fakeImportAuthenticator{principal: test.principal}, &fakeAccountHistoryImporter{}, &fakeInvestmentHistoryImporter{})
			request := httptest.NewRequest(http.MethodPost, "/accounts/"+accountID.String()+"/investment-import/preview", strings.NewReader(`{"format":"wealthboard-investment-history"}`))
			request.Header.Set("Content-Type", "application/json")
			for key, value := range test.headers {
				request.Header.Set(key, value)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d", response.Code, test.want)
			}
		})
	}
}

func TestImportRoutesEnforceBodyLimitHashAndErrorMapping(t *testing.T) {
	accountID := uuid.New()
	auth := fakeImportAuthenticator{principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}}
	accounts := &fakeAccountHistoryImporter{}
	router := importTestRouter(auth, accounts, &fakeInvestmentHistoryImporter{})

	large := httptest.NewRequest(http.MethodPost, "/accounts/"+accountID.String()+"/history-import/preview", bytes.NewReader(make([]byte, service.ImportMaxBytes+1)))
	large.Header.Set("Content-Type", "text/csv")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, large)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("large body status = %d", response.Code)
	}

	commit := httptest.NewRequest(http.MethodPost, "/accounts/"+accountID.String()+"/history-import/commit", strings.NewReader("x"))
	commit.Header.Set("Content-Type", "text/csv")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, commit)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("missing hash status = %d", response.Code)
	}

	accounts.err = service.ErrImportConflict
	conflict := httptest.NewRequest(http.MethodPost, "/accounts/"+accountID.String()+"/history-import/commit", strings.NewReader("x"))
	conflict.Header.Set("Content-Type", "text/csv")
	conflict.Header.Set("X-Preview-Hash", strings.Repeat("a", 64))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, conflict)
	if response.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d", response.Code)
	}

	accounts.err = errors.New("database")
	failure := httptest.NewRequest(http.MethodPost, "/accounts/"+accountID.String()+"/history-import/preview", strings.NewReader("x"))
	failure.Header.Set("Content-Type", "text/csv")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, failure)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("database error status = %d", response.Code)
	}
}

func importTestRouter(auth RequestAuthenticator, accounts accountHistoryImporter, investments investmentHistoryImporter) http.Handler {
	router := chi.NewRouter()
	RegisterImportRoutes(router, NewImportHandler(auth, accounts, investments, "https://wealth.test"))
	return router
}
