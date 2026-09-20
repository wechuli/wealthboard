package api

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/aiworkflow"
	webauth "github.com/wechuli/wealthboard/internal/auth"
)

func TestRegisterAIWorkflowRoutesNeverReturnsCredentialMaterial(t *testing.T) {
	userID := uuid.New()
	router := chi.NewRouter()
	handler := NewAIWorkflowHandler(
		fakeAIWorkflowAuthorizer{principal: webauth.Principal{UserID: userID}},
		&fakeAIWorkflowService{settings: &aiworkflow.Settings{
			SettingsInput: aiworkflow.SettingsInput{
				Provider:          aiworkflow.ProviderOpenAI,
				BaseURL:           "https://api.openai.com/v1",
				Model:             "gpt-test",
				MonthlyTokenLimit: 100_000,
				MaxOutputTokens:   1200,
			},
			HasStoredAPIKey: true,
			EncryptedAPIKey: "v1.private-ciphertext",
			UpdatedAt:       time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC),
		}},
		aiworkflow.Extractor{},
	)
	RegisterAIWorkflowRoutes(router, handler)

	request := httptest.NewRequest(http.MethodPost, "/ai/credential", strings.NewReader(`{"apiKey":"session-secret-key"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "session-secret-key") || strings.Contains(response.Body.String(), "private-ciphertext") {
		t.Fatalf("credential material leaked: %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"hasStoredApiKey":true`) {
		t.Fatalf("credential state missing: %s", response.Body.String())
	}
}

type fakeAIWorkflowAuthorizer struct {
	principal webauth.Principal
	err       error
}

func (authorizer fakeAIWorkflowAuthorizer) AuthorizeScopedMutation(_ *http.Request, scope webauth.Scope) (webauth.Principal, error) {
	if authorizer.err == nil && !authorizer.principal.HasScope(scope) {
		return webauth.Principal{}, errMutationScope
	}
	return authorizer.principal, authorizer.err
}

func (authorizer fakeAIWorkflowAuthorizer) AuthorizeSessionMutation(*http.Request) (webauth.Principal, error) {
	if authorizer.err == nil && authorizer.principal.Method == "api_key" {
		return webauth.Principal{}, errMutationMethod
	}
	return authorizer.principal, authorizer.err
}

func TestAIWorkflowAuthorizationContracts(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		body      string
		principal webauth.Principal
		want      int
	}{
		{name: "session credential", path: "/ai/credential", body: `{"apiKey":"session-secret-key"}`, principal: webauth.Principal{UserID: uuid.New(), Method: "session"}, want: http.StatusOK},
		{name: "API key credential denied", path: "/ai/credential", body: `{"apiKey":"api-key-secret"}`, principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeAIInvoke}}, want: http.StatusForbidden},
		{name: "AI invoke scope", path: "/ai/review", body: `{"period":"1y","focus":"overall","snapshot":{}}`, principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeAIInvoke}}, want: http.StatusOK},
		{name: "wrong invoke scope", path: "/ai/review", body: `{"period":"1y","focus":"overall","snapshot":{}}`, principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}, want: http.StatusForbidden},
		{name: "convert AI invoke scope", path: "/ai/import/convert", body: `{"source":{"units":[],"warnings":[]},"configurationHash":"hash","consent":true,"trackingMode":"balance","currency":"USD"}`, principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeAIInvoke}}, want: http.StatusOK},
		{name: "convert wrong scope", path: "/ai/import/convert", body: `{"source":{"units":[],"warnings":[]},"configurationHash":"hash","consent":true,"trackingMode":"balance","currency":"USD"}`, principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeImportsWrite}}, want: http.StatusForbidden},
		{name: "session invoke", path: "/ai/review", body: `{"period":"1y","focus":"overall","snapshot":{}}`, principal: webauth.Principal{UserID: uuid.New(), Method: "session"}, want: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := chi.NewRouter()
			RegisterAIWorkflowRoutes(router, NewAIWorkflowHandler(fakeAIWorkflowAuthorizer{principal: test.principal}, &fakeAIWorkflowService{settings: &aiworkflow.Settings{}}, aiworkflow.Extractor{}))
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestAIWorkflowExtractRequiresAIInvokeScope(t *testing.T) {
	tests := []struct {
		name      string
		principal webauth.Principal
		want      int
	}{
		{name: "AI invoke scope", principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeAIInvoke}}, want: http.StatusOK},
		{name: "wrong scope", principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopeImportsWrite}}, want: http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := chi.NewRouter()
			RegisterAIWorkflowRoutes(router, NewAIWorkflowHandler(fakeAIWorkflowAuthorizer{principal: test.principal}, &fakeAIWorkflowService{}, aiworkflow.Extractor{}))
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			file, err := writer.CreateFormFile("file", "activity.csv")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = file.Write([]byte("id,amount\na,10\n"))
			_ = writer.Close()
			request := httptest.NewRequest(http.MethodPost, "/ai/import/extract", body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

type fakeAIWorkflowService struct {
	settings *aiworkflow.Settings
}

func (service *fakeAIWorkflowService) SaveSettings(context.Context, uuid.UUID, aiworkflow.SettingsInput) (*aiworkflow.Settings, error) {
	return service.settings, nil
}

func (service *fakeAIWorkflowService) SaveCredential(context.Context, uuid.UUID, string) (*aiworkflow.Settings, error) {
	return service.settings, nil
}

func (*fakeAIWorkflowService) DeleteCredential(context.Context, uuid.UUID) error { return nil }
func (*fakeAIWorkflowService) Disconnect(context.Context, uuid.UUID) error       { return nil }
func (*fakeAIWorkflowService) ClearUsage(context.Context, uuid.UUID) (int64, error) {
	return 0, nil
}
func (*fakeAIWorkflowService) Review(context.Context, uuid.UUID, aiworkflow.ReviewRequest) (map[string]any, error) {
	return map[string]any{}, nil
}
func (*fakeAIWorkflowService) Convert(context.Context, uuid.UUID, aiworkflow.ConversionRequest) (aiworkflow.ConversionDraft, error) {
	return aiworkflow.ConversionDraft{}, nil
}
