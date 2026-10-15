package aiworkflow

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	anthropicsdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"github.com/google/uuid"
)

func TestReviewFlowReturnsStructuredOutputAndFinalizesUsage(t *testing.T) {
	g := genkit.Init(t.Context())
	defineFakeAnthropicModel(g, func(_ context.Context, request *ai.ModelRequest, config anthropicsdk.MessageNewParams) (*ai.ModelResponse, error) {
		if config.MaxTokens != 256 {
			t.Errorf("max tokens = %d, want 256", config.MaxTokens)
		}
		if request.Output == nil || request.Output.Schema == nil {
			t.Error("review request carried no output schema")
		}
		return fakeResponse(validReviewJSON(), 20, 10), nil
	})
	repository := newMemoryRepository()
	user := uuid.New()
	repository.settings[user] = testSettings(100_000)
	service := NewService(repository, nil, DefineFlows(g))
	service.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }

	result, err := service.Review(t.Context(), user, validReviewRequest("session-secret"))
	if err != nil {
		t.Fatal(err)
	}
	review := result["review"].(Review)
	if review.SchemaVersion != 1 || review.Headline != "Review" || review.AttentionItems[0].EvidenceRefs[0] != "portfolio.totals" {
		t.Fatalf("unexpected review: %#v", review)
	}
	provider := result["provider"].(map[string]string)
	if provider["name"] != "anthropic" || provider["host"] != "api.anthropic.com" || provider["model"] != "test-model" {
		t.Fatalf("unexpected provider metadata: %#v", provider)
	}
	if len(repository.events[user]) != 1 || repository.events[user][0].Status != "success" || repository.events[user][0].ChargedTokens != 30 {
		t.Fatalf("usage not finalized: %+v", repository.events[user])
	}

	bad := validReviewRequest("session-secret")
	bad.Snapshot = append(bad.Snapshot[:len(bad.Snapshot)-1], []byte(`,"unexpected":true}`)...)
	if _, err := service.Review(t.Context(), user, bad); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown request field was accepted: %v", err)
	}
}

func TestReviewFlowRejectsOutputOutsideTheSchemaAndStillChargesUsage(t *testing.T) {
	for name, output := range map[string]string{
		"unknown field":     strings.Replace(validReviewJSON(), `"headline":"Review"`, `"headline":"Review","secret":"leak"`, 1),
		"invalid enum":      strings.Replace(validReviewJSON(), `"severity":"info"`, `"severity":"urgent"`, 1),
		"unknown evidence":  strings.Replace(validReviewJSON(), `"portfolio.totals"`, `"invented.evidence"`, 1),
		"missing narrative": strings.Replace(validReviewJSON(), `"executiveSummary":"Summary"`, `"executiveSummary":"  "`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			g := genkit.Init(t.Context())
			defineFakeAnthropicModel(g, func(context.Context, *ai.ModelRequest, anthropicsdk.MessageNewParams) (*ai.ModelResponse, error) {
				return fakeResponse(output, 20, 10), nil
			})
			repository := newMemoryRepository()
			user := uuid.New()
			repository.settings[user] = testSettings(100_000)
			service := NewService(repository, nil, DefineFlows(g))
			if _, err := service.Review(t.Context(), user, validReviewRequest("session-secret")); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("invalid output error = %v", err)
			}
			event := repository.events[user][0]
			if event.Status != "error" || event.ChargedTokens != 30 {
				t.Fatalf("invalid output usage = %+v", event)
			}
		})
	}
}

func TestConversionFlowReturnsDraftWithoutCommitSurface(t *testing.T) {
	g := genkit.Init(t.Context())
	defineFakeAnthropicModel(g, func(_ context.Context, request *ai.ModelRequest, _ anthropicsdk.MessageNewParams) (*ai.ModelResponse, error) {
		if !strings.Contains(request.Messages[len(request.Messages)-1].Text(), "txn-1,deposit") {
			t.Error("conversion prompt omitted the source sections")
		}
		return fakeResponse(`{"records":[{"collection":"transactions","sourceIds":["source-1"],"fields":[{"name":"external_id","value":"txn-1"},{"name":"type","value":"deposit"},{"name":"amount","value":"10.00"},{"name":"date","value":"2026-09-01"},{"name":"notes","value":""}]}],"exclusions":[],"issues":[]}`, 40, 20), nil
	})
	repository := newMemoryRepository()
	user := uuid.New()
	settings := testSettings(100_000)
	repository.settings[user] = settings
	service := NewService(repository, nil, DefineFlows(g))
	service.now = func() time.Time { return settings.UpdatedAt }
	draft, err := service.Convert(t.Context(), user, ConversionRequest{
		Source:            Source{Units: []SourceUnit{{ID: "source-1", Location: "Row 1", Text: "txn-1,deposit,10.00,2026-09-01"}}, Warnings: []string{}},
		ConfigurationHash: configurationHash(*settings, "balance", "USD"), Consent: true, APIKey: "session-secret", TrackingMode: "balance", Currency: "USD",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(draft.Content, "wealthboard-account-history") || !strings.Contains(draft.Content, "txn-1") || !strings.Contains(draft.Content, `"notes": null`) {
		t.Fatalf("unexpected draft: %s", draft.Content)
	}
	if repository.events[user][0].ChargedTokens != 60 {
		t.Fatalf("conversion usage = %+v", repository.events[user][0])
	}
}

func TestEachUserReviewRunsWithOnlyTheirOwnStoredCredential(t *testing.T) {
	key := make([]byte, 32)
	codec, err := NewCredentialCodec(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	g := genkit.Init(t.Context())
	var mu sync.Mutex
	seenKeys := []string{}
	defineFakeAnthropicModel(g, func(ctx context.Context, _ *ai.ModelRequest, _ anthropicsdk.MessageNewParams) (*ai.ModelResponse, error) {
		apiKey, err := providerKey(ctx, ProviderAnthropic)
		if err != nil {
			return nil, err
		}
		mu.Lock()
		seenKeys = append(seenKeys, apiKey)
		mu.Unlock()
		return fakeResponse(validReviewJSON(), 5, 5), nil
	})
	repository := newMemoryRepository()
	service := NewService(repository, codec, DefineFlows(g))
	alice, bob, carol := uuid.New(), uuid.New(), uuid.New()
	for user, apiKey := range map[uuid.UUID]string{alice: "alice-provider-key", bob: "bob-provider-key"} {
		repository.settings[user] = testSettings(100_000)
		if _, err := service.SaveCredential(t.Context(), user, apiKey); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := service.Review(t.Context(), alice, validReviewRequest("")); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Review(t.Context(), bob, validReviewRequest("")); err != nil {
		t.Fatal(err)
	}
	if strings.Join(seenKeys, ",") != "alice-provider-key,bob-provider-key" {
		t.Fatalf("provider keys = %v", seenKeys)
	}
	if _, err := service.Review(t.Context(), carol, validReviewRequest("")); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("unconfigured user error = %v", err)
	}
	if len(repository.events[carol]) != 0 || len(repository.events[alice]) != 1 || len(repository.events[bob]) != 1 {
		t.Fatalf("usage crossed users: %+v", repository.events)
	}
}

func TestSaveSettingsAcceptsOnlySupportedProvidersAndModelIdentifiers(t *testing.T) {
	repository := newMemoryRepository()
	service := NewService(repository, nil, nil)
	user := uuid.New()
	valid := SettingsInput{Provider: ProviderAnthropic, Model: " claude-sonnet-5 ", MonthlyTokenLimit: 100_000, MaxOutputTokens: 1200}
	settings, err := service.SaveSettings(t.Context(), user, valid)
	if err != nil {
		t.Fatal(err)
	}
	if settings.Model != "claude-sonnet-5" {
		t.Fatalf("saved model = %q", settings.Model)
	}
	for name, input := range map[string]SettingsInput{
		"custom provider": {Provider: "custom", Model: "model", MonthlyTokenLimit: 100_000, MaxOutputTokens: 1200},
		"slash in model":  {Provider: ProviderOpenAI, Model: "anthropic/claude-sonnet-5", MonthlyTokenLimit: 100_000, MaxOutputTokens: 1200},
		"empty model":     {Provider: ProviderDeepSeek, Model: "  ", MonthlyTokenLimit: 100_000, MaxOutputTokens: 1200},
		"output budget":   {Provider: ProviderOpenAI, Model: "gpt-5.5", MonthlyTokenLimit: 10_000, MaxOutputTokens: 20_000},
	} {
		if _, err := service.SaveSettings(t.Context(), user, input); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("%s: error = %v", name, err)
		}
	}
	for _, model := range []string{"gpt-5.4-mini", "deepseek-v4-flash", "claude-haiku-4-5-20251001", "ft:gpt-5.4-mini:acme::abc123"} {
		if !modelPattern.MatchString(model) {
			t.Errorf("model %q rejected", model)
		}
	}
}

func TestProviderPluginsSendEachUsersKeyAndRequestStructuredOutput(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "operator-openai-key")
	t.Setenv("OPENAI_ORG_ID", "operator-org")
	t.Setenv("DEEPSEEK_API_KEY", "operator-deepseek-key")
	t.Setenv("ANTHROPIC_API_KEY", "operator-anthropic-key")
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "operator-anthropic-token")
	server := newFakeProviderServer(t)
	flows := DefineFlows(NewGenkit(t.Context(), server.options()))

	tests := []struct {
		provider Provider
		model    string
		check    func(*testing.T, capturedRequest)
	}{
		{ProviderOpenAI, "gpt-5.5", func(t *testing.T, request capturedRequest) {
			if request.path != "/openai/chat/completions" || request.header.Get("OpenAI-Organization") != "" {
				t.Fatalf("OpenAI request = %s, org %q", request.path, request.header.Get("OpenAI-Organization"))
			}
			format := request.body["response_format"].(map[string]any)
			schema := format["json_schema"].(map[string]any)
			if format["type"] != "json_schema" || schema["strict"] != true || request.body["max_completion_tokens"] != float64(512) || request.body["store"] != false {
				t.Fatalf("OpenAI structured output request = %v", request.body)
			}
		}},
		{ProviderDeepSeek, "deepseek-v4-flash", func(t *testing.T, request capturedRequest) {
			format := request.body["response_format"].(map[string]any)
			if request.path != "/deepseek/chat/completions" || format["type"] != "json_object" || request.body["max_tokens"] != float64(512) {
				t.Fatalf("DeepSeek request = %s %v", request.path, request.body)
			}
			if !strings.Contains(fmt.Sprint(request.body["messages"]), "evidenceRefs") {
				t.Fatal("DeepSeek prompt omitted the output schema")
			}
		}},
		{ProviderAnthropic, "claude-sonnet-5", func(t *testing.T, request capturedRequest) {
			outputConfig := request.body["output_config"].(map[string]any)
			format := outputConfig["format"].(map[string]any)
			if request.path != "/v1/messages" || format["type"] != "json_schema" || request.body["max_tokens"] != float64(512) || request.header.Get("Authorization") != "" {
				t.Fatalf("Anthropic request = %s %v auth=%q", request.path, request.body, request.header.Get("Authorization"))
			}
		}},
	}
	for _, test := range tests {
		t.Run(string(test.provider), func(t *testing.T) {
			var wg sync.WaitGroup
			for _, user := range []string{"alice", "bob"} {
				wg.Add(1)
				go func() {
					defer wg.Done()
					apiKey := user + "-" + string(test.provider) + "-key"
					review, usage, err := flows.Review(t.Context(), apiKey, ModelSelection{Provider: test.provider, Model: test.model, MaxOutputTokens: 512}, fmt.Sprintf(`{"owner":%q}`, user))
					if err != nil {
						t.Errorf("%s review: %v", user, err)
						return
					}
					if review.Headline != "Review" || usage.InputTokens == nil || *usage.InputTokens != 12 || *usage.OutputTokens != 8 {
						t.Errorf("%s review = %+v usage = %+v", user, review, usage)
					}
				}()
			}
			wg.Wait()
			requests := server.take()
			if len(requests) != 2 {
				t.Fatalf("requests = %d", len(requests))
			}
			for _, request := range requests {
				owner := "alice"
				if strings.Contains(request.raw, `\"owner\":\"bob\"`) {
					owner = "bob"
				}
				if got, want := request.key(test.provider), owner+"-"+string(test.provider)+"-key"; got != want {
					t.Fatalf("%s request carried key %q, want %q", owner, got, want)
				}
				if strings.Contains(request.raw, "-key") || strings.Contains(fmt.Sprint(request.header), "operator-") {
					t.Fatalf("credential material leaked into request: %s %v", request.raw, request.header)
				}
				if request.body["model"] != test.model {
					t.Fatalf("model = %v", request.body["model"])
				}
				test.check(t, request)
			}
		})
	}
}

func TestProviderRequestsFailClosedWithoutTheUsersKey(t *testing.T) {
	server := newFakeProviderServer(t)
	g := NewGenkit(t.Context(), server.options())
	for _, provider := range []Provider{ProviderOpenAI, ProviderDeepSeek, ProviderAnthropic} {
		_, err := genkit.Generate(t.Context(), g, ai.WithModelName(string(provider)+"/chosen-model"), ai.WithConfig(modelConfig(ModelSelection{Provider: provider, MaxOutputTokens: 256})), ai.WithPrompt("hello"))
		if err == nil {
			t.Fatalf("%s request without a user key succeeded", provider)
		}
		ctx := withProviderKey(t.Context(), ProviderOpenAI, "openai-only-key")
		if provider != ProviderOpenAI {
			if _, err := genkit.Generate(ctx, g, ai.WithModelName(string(provider)+"/chosen-model"), ai.WithConfig(modelConfig(ModelSelection{Provider: provider, MaxOutputTokens: 256})), ai.WithPrompt("hello")); err == nil {
				t.Fatalf("OpenAI key was sent to %s", provider)
			}
		}
	}
	if requests := server.take(); len(requests) != 0 {
		t.Fatalf("requests without the matching key reached the provider: %d", len(requests))
	}
}

func TestProviderErrorsAreClassifiedWithoutLeakingResponseBodies(t *testing.T) {
	for status, want := range map[int]error{
		http.StatusUnauthorized:        ErrProviderCredential,
		http.StatusNotFound:            ErrProviderModel,
		http.StatusTooManyRequests:     ErrProviderRateLimited,
		http.StatusInternalServerError: ErrProvider,
	} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := newFakeProviderServer(t)
			server.status = status
			flows := DefineFlows(NewGenkit(t.Context(), server.options()))
			for _, provider := range []Provider{ProviderOpenAI, ProviderDeepSeek, ProviderAnthropic} {
				_, _, err := flows.Review(t.Context(), "user-key", ModelSelection{Provider: provider, Model: "chosen-model", MaxOutputTokens: 256}, `{}`)
				if !errors.Is(err, want) {
					t.Fatalf("%s error = %v, want %v", provider, err, want)
				}
				if strings.Contains(err.Error(), "sk-leaked") || strings.Contains(err.Error(), "127.0.0.1") {
					t.Fatalf("%s error leaked provider details: %v", provider, err)
				}
			}
		})
	}
}

func TestProviderTimeoutIsReportedAsDeadline(t *testing.T) {
	server := newFakeProviderServer(t)
	server.delay = time.Second
	flows := DefineFlows(NewGenkit(t.Context(), server.options()))
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	_, _, err := flows.Review(ctx, "user-key", ModelSelection{Provider: ProviderOpenAI, Model: "chosen-model", MaxOutputTokens: 256}, `{}`)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout error = %v", err)
	}
}

func TestDefaultProviderClientRejectsPrivateAddressesAndRedirects(t *testing.T) {
	server := newFakeProviderServer(t)
	options := server.options()
	options.HTTPClient = nil
	flows := DefineFlows(NewGenkit(t.Context(), options))
	if _, _, err := flows.Review(t.Context(), "user-key", ModelSelection{Provider: ProviderOpenAI, Model: "chosen-model", MaxOutputTokens: 256}, `{}`); !errors.Is(err, ErrProvider) {
		t.Fatalf("private address error = %v", err)
	}
	if requests := server.take(); len(requests) != 0 {
		t.Fatalf("private provider endpoint was reached %d times", len(requests))
	}

	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("redirect target must not be reached")
	}))
	defer target.Close()
	redirector := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusTemporaryRedirect))
	defer redirector.Close()
	client := newProviderHTTPClient()
	client.Transport = redirector.Client().Transport
	redirected := DefineFlows(NewGenkit(t.Context(), GenkitOptions{HTTPClient: client, BaseURLs: map[Provider]string{ProviderOpenAI: redirector.URL}}))
	if _, _, err := redirected.Review(t.Context(), "user-key", ModelSelection{Provider: ProviderOpenAI, Model: "chosen-model", MaxOutputTokens: 256}, `{}`); !errors.Is(err, ErrProvider) {
		t.Fatalf("redirect error = %v", err)
	}
}

func defineFakeAnthropicModel(g *genkit.Genkit, respond func(context.Context, *ai.ModelRequest, anthropicsdk.MessageNewParams) (*ai.ModelResponse, error)) {
	genkit.DefineModelAction(g, "anthropic/test-model", &ai.ModelOptions{
		Supports: &ai.ModelSupports{Multiturn: true, SystemRole: true, Output: []string{"text", "json"}, Constrained: ai.ConstrainedSupportAll},
	}, func(ctx context.Context, request *ai.ModelRequest, config anthropicsdk.MessageNewParams, _ ai.ModelStreamCallback) (*ai.ModelResponse, error) {
		return respond(ctx, request, config)
	})
}

func fakeResponse(text string, input, output int) *ai.ModelResponse {
	return &ai.ModelResponse{
		FinishReason: ai.FinishReasonStop,
		Message:      ai.NewModelTextMessage(text),
		Usage:        &ai.GenerationUsage{InputTokens: input, OutputTokens: output},
	}
}

type capturedRequest struct {
	path   string
	header http.Header
	raw    string
	body   map[string]any
}

func (request capturedRequest) key(provider Provider) string {
	if provider == ProviderAnthropic {
		return request.header.Get("X-Api-Key")
	}
	return strings.TrimPrefix(request.header.Get("Authorization"), "Bearer ")
}

type fakeProviderServer struct {
	*httptest.Server
	mu       sync.Mutex
	requests []capturedRequest
	status   int
	delay    time.Duration
}

func newFakeProviderServer(t *testing.T) *fakeProviderServer {
	t.Helper()
	server := &fakeProviderServer{status: http.StatusOK}
	server.Server = httptest.NewServer(http.HandlerFunc(server.handle))
	t.Cleanup(server.Close)
	return server
}

func (server *fakeProviderServer) options() GenkitOptions {
	return GenkitOptions{HTTPClient: server.Client(), BaseURLs: map[Provider]string{
		ProviderOpenAI:    server.URL + "/openai",
		ProviderDeepSeek:  server.URL + "/deepseek",
		ProviderAnthropic: server.URL,
	}}
}

func (server *fakeProviderServer) take() []capturedRequest {
	server.mu.Lock()
	defer server.mu.Unlock()
	requests := server.requests
	server.requests = nil
	return requests
}

func (server *fakeProviderServer) handle(response http.ResponseWriter, request *http.Request) {
	raw, _ := io.ReadAll(request.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	server.mu.Lock()
	server.requests = append(server.requests, capturedRequest{path: request.URL.Path, header: request.Header.Clone(), raw: string(raw), body: body})
	server.mu.Unlock()
	if server.delay > 0 {
		select {
		case <-time.After(server.delay):
		case <-request.Context().Done():
			return
		}
	}
	response.Header().Set("Content-Type", "application/json")
	if server.status != http.StatusOK {
		response.WriteHeader(server.status)
		_, _ = response.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Incorrect API key provided: sk-leaked***"}}`))
		return
	}
	if request.URL.Path == "/v1/messages" {
		fmt.Fprintf(response, `{"id":"msg_1","type":"message","role":"assistant","model":"chosen-model","content":[{"type":"text","text":%q}],"stop_reason":"end_turn","usage":{"input_tokens":12,"output_tokens":8}}`, validReviewJSON())
		return
	}
	fmt.Fprintf(response, `{"id":"chat_1","object":"chat.completion","created":1,"model":"chosen-model","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":%q}}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}`, validReviewJSON())
}

func TestConversionDraftAlwaysHasArraysAndOnlyImportableFields(t *testing.T) {
	source := Source{Units: []SourceUnit{{ID: "source-1", Location: "Page 1", Text: "Deposit 10.00"}}, Warnings: []string{}}
	clean, err := buildDraft(Extraction{Records: []ExtractionRecord{{
		Collection: "transactions",
		SourceIDs:  []string{"source-1"},
		Fields:     []ExtractionField{{Name: "amount", Value: "10.00"}},
	}}}, source, "balance")
	if err != nil {
		t.Fatal(err)
	}
	cleanJSON, err := json.Marshal(clean)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(cleanJSON), `"exclusions":[],"issues":[]`) {
		t.Fatalf("draft without issues or exclusions must return empty arrays: %s", cleanJSON)
	}

	draft, err := buildDraft(Extraction{Records: []ExtractionRecord{{
		Collection: "transactions",
		SourceIDs:  []string{"source-1"},
		Fields: []ExtractionField{
			{Name: "type", Value: "deposit"},
			{Name: "amount", Value: "10.00"},
			{Name: "date", Value: "2026-10-01"},
			{Name: "source", Value: "statement"},
		},
	}}}, source, "balance")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(draft)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "null") {
		t.Fatalf("draft response contains null: %s", encoded)
	}
	if strings.Contains(draft.Content, `"source"`) {
		t.Fatalf("draft kept a field the import rejects: %s", draft.Content)
	}
	if len(draft.Issues) != 1 || !strings.Contains(draft.Issues[0], `Removed field "source" from 1 transactions record(s)`) {
		t.Fatalf("issues = %q", draft.Issues)
	}
	var envelope struct {
		Transactions []map[string]any `json:"transactions"`
	}
	if err := json.Unmarshal([]byte(draft.Content), &envelope); err != nil || len(envelope.Transactions) != 1 || envelope.Transactions[0]["amount"] != "10.00" {
		t.Fatalf("draft content = %s, %v", draft.Content, err)
	}
}

func TestConversionPromptListsTheFieldsEachCollectionAccepts(t *testing.T) {
	balance := conversionPrompt("balance", "KES", nil)
	if !strings.Contains(balance, "- transactions: external_id, type, amount, date, description, notes") || strings.Contains(balance, "position_events") {
		t.Fatalf("balance prompt = %s", balance)
	}
	positions := conversionPrompt("positions", "USD", nil)
	for _, collection := range []string{"instruments", "position_events", "cash_transactions", "prices"} {
		if !strings.Contains(positions, "- "+collection+": external_id") {
			t.Fatalf("positions prompt omits %s: %s", collection, positions)
		}
	}
}
