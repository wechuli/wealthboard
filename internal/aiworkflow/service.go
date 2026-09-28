package aiworkflow

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	repository  Repository
	credentials *CredentialCodec
	endpoints   *EndpointPolicy
	transport   Transport
	now         func() time.Time
}

func NewService(repository Repository, credentials *CredentialCodec, endpoints *EndpointPolicy, transport Transport) *Service {
	return &Service{repository: repository, credentials: credentials, endpoints: endpoints, transport: transport, now: time.Now}
}

func (service *Service) SaveSettings(ctx context.Context, userID uuid.UUID, input SettingsInput) (*Settings, error) {
	input.Model = strings.TrimSpace(input.Model)
	if input.Model == "" || len(input.Model) > 200 || strings.ContainsAny(input.Model, "\x00\n\r\t") {
		return nil, fmt.Errorf("%w: enter a valid provider model identifier", ErrInvalidInput)
	}
	if input.MonthlyTokenLimit < 10_000 || input.MonthlyTokenLimit > 100_000_000 || input.MaxOutputTokens < 256 || input.MaxOutputTokens > input.MonthlyTokenLimit {
		return nil, fmt.Errorf("%w: invalid AI token limits", ErrInvalidInput)
	}
	baseURL, err := service.endpoints.Resolve(ctx, input.Provider, input.BaseURL)
	if err != nil {
		return nil, err
	}
	input.BaseURL = baseURL
	return service.repository.SaveSettings(ctx, userID, input)
}

func (service *Service) SaveCredential(ctx context.Context, userID uuid.UUID, apiKey string) (*Settings, error) {
	if service.credentials == nil {
		return nil, errors.New("remembering AI credentials requires AI_CREDENTIAL_ENCRYPTION_KEY")
	}
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	if settings == nil {
		return nil, ErrNotConfigured
	}
	encrypted, err := service.credentials.Encrypt(userID, apiKey)
	if err != nil {
		return nil, err
	}
	if err := service.repository.SaveCredential(ctx, userID, encrypted, CredentialHint(apiKey)); err != nil {
		return nil, err
	}
	settings.EncryptedAPIKey = encrypted
	settings.HasStoredAPIKey = true
	hint := CredentialHint(apiKey)
	settings.APIKeyHint = &hint
	return settings, nil
}

func (service *Service) DeleteCredential(ctx context.Context, userID uuid.UUID) error {
	return service.repository.DeleteCredential(ctx, userID)
}

func (service *Service) Disconnect(ctx context.Context, userID uuid.UUID) error {
	return service.repository.DeleteSettings(ctx, userID)
}

func (service *Service) ClearUsage(ctx context.Context, userID uuid.UUID) (int64, error) {
	return service.repository.ClearUsage(ctx, userID)
}

func (service *Service) Review(ctx context.Context, userID uuid.UUID, request ReviewRequest) (map[string]any, error) {
	if err := validateReviewRequest(request); err != nil {
		return nil, err
	}
	settings, apiKey, err := service.providerRequest(ctx, userID, request.APIKey)
	if err != nil {
		return nil, err
	}
	snapshot := strings.TrimSpace(string(request.Snapshot))
	estimatedTokens := (len(snapshot)+3)/4 + settings.MaxOutputTokens
	reservation, err := service.repository.ReserveUsage(ctx, userID, estimatedTokens, "portfolio_review", service.now().UTC())
	if err != nil {
		return nil, err
	}
	started := time.Now()
	result, callErr := service.transport.Call(ctx, ProviderCall{
		Provider:        settings.Provider,
		BaseURL:         settings.BaseURL,
		APIKey:          apiKey,
		Model:           settings.Model,
		MaxOutputTokens: settings.MaxOutputTokens,
		Prompt:          reviewPrompt(request),
	})
	var review Review
	if callErr == nil {
		review, callErr = decodeReview(result.Content, request.Snapshot)
	}
	completion := completionFor(result, callErr, started, false)
	if err := service.repository.CompleteUsage(ctx, userID, reservation.ID, completion, service.now().UTC()); err != nil {
		return nil, err
	}
	if callErr != nil {
		return nil, callErr
	}
	parsedURL, _ := url.Parse(settings.BaseURL)
	return map[string]any{
		"review":      review,
		"snapshot":    json.RawMessage(request.Snapshot),
		"provider":    map[string]string{"name": string(settings.Provider), "host": parsedURL.Host, "model": settings.Model},
		"usage":       map[string]*int{"inputTokens": result.InputTokens, "outputTokens": result.OutputTokens},
		"generatedAt": service.now().UTC(),
	}, nil
}

func (service *Service) Convert(ctx context.Context, userID uuid.UUID, request ConversionRequest) (ConversionDraft, error) {
	if err := validateConversionRequest(request); err != nil {
		return ConversionDraft{}, err
	}
	settings, apiKey, err := service.providerRequest(ctx, userID, request.APIKey)
	if err != nil {
		return ConversionDraft{}, err
	}
	if request.ConfigurationHash != configurationHash(*settings, request.TrackingMode, request.Currency) {
		return ConversionDraft{}, fmt.Errorf("%w: AI settings or destination changed", ErrInvalidInput)
	}
	promptBytes, _ := json.Marshal(request.Source.Units)
	reservation, err := service.repository.ReserveUsage(ctx, userID, len(promptBytes)+settings.MaxOutputTokens, "import_conversion", service.now().UTC())
	if err != nil {
		return ConversionDraft{}, err
	}
	started := time.Now()
	result, callErr := service.transport.Call(ctx, ProviderCall{
		Provider:        settings.Provider,
		BaseURL:         settings.BaseURL,
		APIKey:          apiKey,
		Model:           settings.Model,
		MaxOutputTokens: settings.MaxOutputTokens,
		Prompt:          conversionPrompt(request),
	})
	var draft ConversionDraft
	if callErr == nil {
		var extraction Extraction
		extraction, callErr = decodeExtraction(result.Content)
		if callErr == nil {
			draft, callErr = buildDraft(extraction, request.Source, request.TrackingMode)
		}
	}
	completion := completionFor(result, callErr, started, true)
	if err := service.repository.CompleteUsage(ctx, userID, reservation.ID, completion, service.now().UTC()); err != nil {
		return ConversionDraft{}, err
	}
	if callErr != nil {
		return ConversionDraft{}, callErr
	}
	return draft, nil
}

func (service *Service) ConfigurationHash(ctx context.Context, userID uuid.UUID, trackingMode, currency string) (string, error) {
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil || settings == nil {
		if err == nil {
			err = ErrNotConfigured
		}
		return "", err
	}
	return configurationHash(*settings, trackingMode, currency), nil
}

func (service *Service) providerRequest(ctx context.Context, userID uuid.UUID, sessionKey string) (*Settings, string, error) {
	settings, err := service.repository.GetSettings(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	if settings == nil {
		return nil, "", ErrNotConfigured
	}
	if service.endpoints != nil {
		settings.BaseURL, err = service.endpoints.Resolve(ctx, settings.Provider, settings.BaseURL)
		if err != nil {
			return nil, "", err
		}
	}
	key := strings.TrimSpace(sessionKey)
	if key == "" && settings.EncryptedAPIKey != "" && service.credentials != nil {
		key, err = service.credentials.Decrypt(userID, settings.EncryptedAPIKey)
		if err != nil {
			return nil, "", err
		}
	}
	if len(key) < 8 || len(key) > 4096 {
		return nil, "", ErrCredential
	}
	return settings, key, nil
}

func completionFor(result ProviderResult, callErr error, started time.Time, retain bool) CompleteUsage {
	latency := int(time.Since(started).Milliseconds())
	if callErr == nil {
		return CompleteUsage{Status: "success", InputTokens: result.InputTokens, OutputTokens: result.OutputTokens, LatencyMS: latency}
	}
	return CompleteUsage{Status: "error", InputTokens: result.InputTokens, OutputTokens: result.OutputTokens, LatencyMS: latency, ErrorCode: providerErrorCode(callErr), RetainReservationOnError: retain}
}

func providerErrorCode(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "provider_timeout"
	}
	return "provider_unavailable"
}

func configurationHash(settings Settings, trackingMode, currency string) string {
	value, _ := json.Marshal([]any{settings.Provider, settings.BaseURL, settings.Model, settings.MaxOutputTokens, settings.UpdatedAt.UTC().Format(time.RFC3339Nano), trackingMode, currency})
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}
