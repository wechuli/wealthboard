package aiworkflow

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCredentialEncryptionBindsCiphertextToUserAndRejectsTampering(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	codec, err := NewCredentialCodec(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	owner := uuid.New()
	other := uuid.New()
	encrypted, err := codec.Encrypt(owner, "sk-test-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encrypted, "secret") {
		t.Fatal("ciphertext exposed the credential")
	}
	decrypted, err := codec.Decrypt(owner, encrypted)
	if err != nil || decrypted != "sk-test-secret-value" {
		t.Fatalf("owner decrypt = %q, %v", decrypted, err)
	}
	if _, err := codec.Decrypt(other, encrypted); err == nil {
		t.Fatal("cross-user decryption succeeded")
	}
	parts := strings.Split(encrypted, ".")
	parts[3] = parts[3][:len(parts[3])-1] + "A"
	if _, err := codec.Decrypt(owner, strings.Join(parts, ".")); err == nil {
		t.Fatal("tampered ciphertext decrypted")
	}
}

func TestEndpointPolicyRequiresAllowlistAndRejectsPrivateAddresses(t *testing.T) {
	resolver := staticResolver{addresses: map[string][]net.IPAddr{
		"allowed.example": {{IP: net.ParseIP("93.184.216.34")}},
		"private.example": {{IP: net.ParseIP("10.0.0.4")}},
		"link.example":    {{IP: net.ParseIP("169.254.169.254")}},
	}}
	policy, err := NewEndpointPolicy([]string{"https://allowed.example/v1", "https://private.example/v1", "https://link.example/v1"}, resolver)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := policy.Resolve(context.Background(), ProviderCustom, "https://not-allowed.example/v1"); err == nil {
		t.Fatal("unapproved endpoint was allowed")
	}
	if _, err := policy.Resolve(context.Background(), ProviderCustom, "https://private.example/v1"); err == nil {
		t.Fatal("private endpoint was allowed")
	}
	if _, err := policy.Resolve(context.Background(), ProviderCustom, "https://link.example/v1"); err == nil {
		t.Fatal("link-local endpoint was allowed")
	}
	if resolved, err := policy.Resolve(context.Background(), ProviderCustom, "https://allowed.example/v1/"); err != nil || resolved != "https://allowed.example/v1" {
		t.Fatalf("approved endpoint = %q, %v", resolved, err)
	}
}

func TestHTTPTransportUsesMockProviderAndRejectsRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		response.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(response, `{"choices":[{"finish_reason":"stop","message":{"content":%q}}],"usage":{"prompt_tokens":12,"completion_tokens":8}}`, validReviewJSON())
	}))
	defer server.Close()

	result, err := NewHTTPTransport(server.Client().Transport, time.Second).Call(context.Background(), ProviderCall{
		Provider: ProviderCustom, BaseURL: server.URL, APIKey: "secret-key", Model: "model", MaxOutputTokens: 256, Prompt: "review",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.InputTokens == nil || *result.InputTokens != 12 || result.OutputTokens == nil || *result.OutputTokens != 8 {
		t.Fatalf("unexpected usage: %+v", result)
	}

	redirectTarget := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("redirect target must not be reached")
	}))
	defer redirectTarget.Close()
	redirector := httptest.NewServer(http.RedirectHandler(redirectTarget.URL, http.StatusFound))
	defer redirector.Close()
	_, err = NewHTTPTransport(redirector.Client().Transport, time.Second).Call(context.Background(), ProviderCall{
		Provider: ProviderCustom, BaseURL: redirector.URL, APIKey: "secret-key", Model: "model", MaxOutputTokens: 256, Prompt: "review",
	})
	if err == nil || !strings.Contains(err.Error(), "redirect") {
		t.Fatalf("redirect error = %v", err)
	}
}

func TestHTTPTransportParsesOpenAIResponsesOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		response.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(response, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":%q}]}],"usage":{"input_tokens":7,"output_tokens":5}}`, validReviewJSON())
	}))
	defer server.Close()

	result, err := NewHTTPTransport(server.Client().Transport, time.Second).Call(context.Background(), ProviderCall{
		Provider: ProviderOpenAI, BaseURL: server.URL, APIKey: "secret-key", Model: "model", MaxOutputTokens: 256, Prompt: "review",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.InputTokens == nil || *result.InputTokens != 7 || !strings.Contains(string(result.Content), `"headline":"Review"`) {
		t.Fatalf("unexpected Responses result: %+v", result)
	}
}

func TestHTTPTransportTimeoutIsBounded(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		<-release
	}))
	defer server.Close()
	_, err := NewHTTPTransport(server.Client().Transport, 20*time.Millisecond).Call(context.Background(), ProviderCall{
		Provider: ProviderCustom, BaseURL: server.URL, APIKey: "secret-key", Model: "model", MaxOutputTokens: 256, Prompt: "review",
	})
	close(release)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout error = %v", err)
	}
}

func TestHTTPTransportDefaultBlocksPrivateAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("private provider endpoint must not be reached")
	}))
	defer server.Close()
	_, err := NewHTTPTransport(nil, time.Second).Call(context.Background(), ProviderCall{
		Provider: ProviderCustom, BaseURL: server.URL, APIKey: "secret-key", Model: "model", MaxOutputTokens: 256, Prompt: "review",
	})
	if err == nil || !strings.Contains(err.Error(), "private or local") {
		t.Fatalf("private dial error = %v", err)
	}
}

func TestPerUserRateLimitAndMonthlyBudget(t *testing.T) {
	repository := newMemoryRepository()
	now := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	user := uuid.New()
	other := uuid.New()
	repository.settings[user] = testSettings(100_000)
	repository.settings[other] = testSettings(100_000)
	for range 10 {
		if _, err := repository.ReserveUsage(context.Background(), user, 100, "portfolio_review", now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repository.ReserveUsage(context.Background(), user, 100, "portfolio_review", now); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("rate limit error = %v", err)
	}
	if _, err := repository.ReserveUsage(context.Background(), other, 100, "portfolio_review", now); err != nil {
		t.Fatalf("other user was rate limited: %v", err)
	}

	budgetUser := uuid.New()
	repository.settings[budgetUser] = testSettings(10_000)
	if _, err := repository.ReserveUsage(context.Background(), budgetUser, 9_000, "portfolio_review", now); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.ReserveUsage(context.Background(), budgetUser, 1_001, "portfolio_review", now.Add(2*time.Minute)); !errors.Is(err, ErrBudget) {
		t.Fatalf("budget error = %v", err)
	}
}

func TestReviewStrictSchemaAndUsageFinalization(t *testing.T) {
	repository := newMemoryRepository()
	user := uuid.New()
	settings := testSettings(100_000)
	settings.EncryptedAPIKey = ""
	repository.settings[user] = settings
	transport := &staticTransport{result: ProviderResult{Content: json.RawMessage(validReviewJSON()), InputTokens: intPointer(20), OutputTokens: intPointer(10)}}
	service := NewService(repository, nil, nil, transport)
	service.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	result, err := service.Review(context.Background(), user, validReviewRequest("session-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if result["review"].(Review).Headline != "Review" {
		t.Fatalf("unexpected review: %#v", result["review"])
	}
	if len(repository.events[user]) != 1 || repository.events[user][0].Status != "success" || repository.events[user][0].ChargedTokens != 30 {
		t.Fatalf("usage not finalized: %+v", repository.events[user])
	}

	bad := validReviewRequest("session-secret")
	bad.Snapshot = append(bad.Snapshot[:len(bad.Snapshot)-1], []byte(`,"unexpected":true}`)...)
	if _, err := service.Review(context.Background(), user, bad); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown request field was accepted: %v", err)
	}

	transport.result.Content = json.RawMessage(strings.Replace(validReviewJSON(), `"headline":"Review"`, `"headline":"Review","secret":"leak"`, 1))
	if _, err := service.Review(context.Background(), user, validReviewRequest("session-secret")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown result field was accepted: %v", err)
	}
}

func TestConversionReturnsDraftWithoutCommitSurface(t *testing.T) {
	repository := newMemoryRepository()
	user := uuid.New()
	settings := testSettings(100_000)
	repository.settings[user] = settings
	service := NewService(repository, nil, nil, &staticTransport{result: ProviderResult{Content: json.RawMessage(`{
		"schemaVersion":1,"sourceCurrency":"USD","records":[{"collection":"transactions","sourceIds":["source-1"],"fields":[{"name":"external_id","value":"txn-1"},{"name":"type","value":"deposit"},{"name":"amount","value":"10.00"},{"name":"date","value":"2026-09-01"}]}],"exclusions":[],"issues":[]
	}`)}})
	service.now = func() time.Time { return settings.UpdatedAt }
	draft, err := service.Convert(context.Background(), user, ConversionRequest{
		Source:            Source{Units: []SourceUnit{{ID: "source-1", Location: "Row 1", Text: "txn-1,deposit,10.00,2026-09-01"}}, Warnings: []string{}},
		ConfigurationHash: configurationHash(*settings, "balance", "USD"), Consent: true, APIKey: "session-secret", TrackingMode: "balance", Currency: "USD",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(draft.Content, "wealthboard-account-history") || !strings.Contains(draft.Content, "txn-1") {
		t.Fatalf("unexpected draft: %s", draft.Content)
	}
}

func TestTextExtractionLimitsAndPasswordPrivacy(t *testing.T) {
	extractor := Extractor{}
	source, err := extractor.Extract(context.Background(), "activity.csv", []byte("id,amount\na,10\n"), "")
	if err != nil || len(source.Units) != 2 {
		t.Fatalf("CSV extraction = %+v, %v", source, err)
	}
	if _, err := extractor.Extract(context.Background(), "activity.txt", make([]byte, MaxSourceBytes+1), "private-password"); err == nil || strings.Contains(err.Error(), "private-password") {
		t.Fatalf("oversize/password error = %v", err)
	}
	tooMany := strings.Repeat("value\n", MaxSourceUnits+1)
	if _, err := extractor.Extract(context.Background(), "activity.txt", []byte(tooMany), ""); err == nil || !strings.Contains(err.Error(), "1,000") {
		t.Fatalf("section limit error = %v", err)
	}
	if _, err := extractor.Extract(context.Background(), "activity.csv", []byte("a,b"), "private-password"); err == nil || strings.Contains(err.Error(), "private-password") {
		t.Fatalf("password privacy error = %v", err)
	}
}

type staticResolver struct {
	addresses map[string][]net.IPAddr
}

func (resolver staticResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	addresses := resolver.addresses[host]
	if len(addresses) == 0 {
		return nil, errors.New("not found")
	}
	return addresses, nil
}

type staticTransport struct {
	result ProviderResult
	err    error
}

func (transport *staticTransport) Call(context.Context, ProviderCall) (ProviderResult, error) {
	return transport.result, transport.err
}

type memoryRepository struct {
	mu       sync.Mutex
	settings map[uuid.UUID]*Settings
	events   map[uuid.UUID][]UsageEvent
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{settings: map[uuid.UUID]*Settings{}, events: map[uuid.UUID][]UsageEvent{}}
}

func (repository *memoryRepository) GetSettings(_ context.Context, userID uuid.UUID) (*Settings, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	settings := repository.settings[userID]
	if settings == nil {
		return nil, nil
	}
	copy := *settings
	return &copy, nil
}

func (repository *memoryRepository) SaveSettings(_ context.Context, userID uuid.UUID, input SettingsInput) (*Settings, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	settings := &Settings{SettingsInput: input, UpdatedAt: time.Now().UTC()}
	if existing := repository.settings[userID]; existing != nil {
		settings.EncryptedAPIKey, settings.HasStoredAPIKey, settings.APIKeyHint = existing.EncryptedAPIKey, existing.HasStoredAPIKey, existing.APIKeyHint
	}
	repository.settings[userID] = settings
	copy := *settings
	return &copy, nil
}

func (repository *memoryRepository) SaveCredential(_ context.Context, userID uuid.UUID, encrypted, hint string) error {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	settings := repository.settings[userID]
	if settings == nil {
		return ErrNotConfigured
	}
	settings.EncryptedAPIKey, settings.HasStoredAPIKey, settings.APIKeyHint = encrypted, true, &hint
	return nil
}

func (repository *memoryRepository) DeleteCredential(_ context.Context, userID uuid.UUID) error {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	settings := repository.settings[userID]
	if settings == nil {
		return ErrNotConfigured
	}
	settings.EncryptedAPIKey, settings.HasStoredAPIKey, settings.APIKeyHint = "", false, nil
	return nil
}

func (repository *memoryRepository) DeleteSettings(_ context.Context, userID uuid.UUID) error {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	if repository.settings[userID] == nil {
		return ErrNotConfigured
	}
	delete(repository.settings, userID)
	return nil
}

func (repository *memoryRepository) ClearUsage(_ context.Context, userID uuid.UUID) (int64, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	count := int64(len(repository.events[userID]))
	delete(repository.events, userID)
	return count, nil
}

func (repository *memoryRepository) ReserveUsage(_ context.Context, userID uuid.UUID, tokens int, requestType string, now time.Time) (Reservation, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	settings := repository.settings[userID]
	if settings == nil {
		return Reservation{}, ErrNotConfigured
	}
	recent, used := 0, 0
	for _, event := range repository.events[userID] {
		if event.CreatedAt.After(now.Add(-time.Minute)) && (event.Status == "started" || event.Status == "success" || event.Status == "error") {
			recent++
		}
		if event.BillingMonth == now.Format("2006-01") {
			used += event.ChargedTokens
		}
	}
	if recent >= 10 {
		return Reservation{}, ErrRateLimited
	}
	if used+tokens > settings.MonthlyTokenLimit {
		return Reservation{}, ErrBudget
	}
	id := uuid.New()
	repository.events[userID] = append(repository.events[userID], UsageEvent{ID: id, UserID: userID, Status: "started", RequestType: requestType, BillingMonth: now.Format("2006-01"), ChargedTokens: tokens, CreatedAt: now, UpdatedAt: now})
	return Reservation{ID: id, ReservedTokens: tokens}, nil
}

func (repository *memoryRepository) CompleteUsage(_ context.Context, userID, eventID uuid.UUID, completion CompleteUsage, now time.Time) error {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	for index := range repository.events[userID] {
		event := &repository.events[userID][index]
		if event.ID != eventID || event.Status != "started" {
			continue
		}
		event.Status, event.InputTokens, event.OutputTokens, event.UpdatedAt = completion.Status, completion.InputTokens, completion.OutputTokens, now
		if completion.InputTokens != nil && completion.OutputTokens != nil {
			event.ChargedTokens = *completion.InputTokens + *completion.OutputTokens
		} else if completion.Status == "error" && !completion.RetainReservationOnError {
			event.ChargedTokens = 0
		}
		return nil
	}
	return errors.New("reservation not found")
}

func testSettings(monthlyLimit int) *Settings {
	return &Settings{SettingsInput: SettingsInput{Provider: ProviderCustom, BaseURL: "https://provider.example/v1", Model: "test-model", MonthlyTokenLimit: monthlyLimit, MaxOutputTokens: 256}, UpdatedAt: time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)}
}

func validReviewRequest(apiKey string) ReviewRequest {
	return ReviewRequest{Period: "1y", Focus: "overall", APIKey: apiKey, Snapshot: json.RawMessage(`{
		"schemaVersion":1,"asOf":"2026-09-20T12:00:00Z","period":"1y","focus":"overall","baseCurrency":"USD",
		"sharing":{},"completeness":{},"portfolio":{"totals":{"evidenceId":"portfolio.totals"}},"allocations":{},"topAccounts":[],"cashFlow":{},"goals":[],"dataQuality":[],"methodology":[]
	}`)}
}

func validReviewJSON() string {
	return `{"schemaVersion":1,"headline":"Review","executiveSummary":"Summary","dataQuality":[],"strengths":[],"attentionItems":[{"id":"finding-1","category":"general","severity":"info","confidence":"high","title":"Title","explanation":"Explanation","evidenceRefs":["portfolio.totals"]}],"goalObservations":[],"questions":[],"possibleNextChecks":[],"limitations":["Explanatory analysis, not financial advice."]}`
}
