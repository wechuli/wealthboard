package api

import (
	"context"
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

func (authorizer fakeAIWorkflowAuthorizer) AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error) {
	return authorizer.principal, authorizer.err
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
