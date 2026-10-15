package aiworkflow

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
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
	for _, segment := range []struct {
		name  string
		index int
	}{{"tag", 2}, {"ciphertext", 3}} {
		parts := strings.Split(encrypted, ".")
		raw, err := base64.RawURLEncoding.DecodeString(parts[segment.index])
		if err != nil {
			t.Fatal(err)
		}
		raw[0] ^= 0x01
		parts[segment.index] = base64.RawURLEncoding.EncodeToString(raw)
		if _, err := codec.Decrypt(owner, strings.Join(parts, ".")); err == nil {
			t.Fatalf("tampered %s decrypted", segment.name)
		}
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

func TestDocumentExtractionOverUnixSocket(t *testing.T) {
	socketPath := testSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	requestReceived := make(chan map[string]string, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		var request map[string]string
		_ = json.NewDecoder(connection).Decode(&request)
		requestReceived <- request
		_, _ = connection.Write([]byte(`{"source":{"units":[{"id":"source-1","location":"Page 1","text":"deposit 10"}],"warnings":[]}}`))
	}()

	extractor := Extractor{SocketPath: socketPath, Timeout: time.Second}
	source, err := extractor.Extract(context.Background(), "statement.pdf", []byte("%PDF-test"), "private-password")
	if err != nil || len(source.Units) != 1 {
		t.Fatalf("socket extraction = %+v, %v", source, err)
	}
	request := <-requestReceived
	if request["extension"] != "pdf" || request["documentPassword"] != "private-password" {
		t.Fatalf("unexpected socket request: %#v", request)
	}
}

func TestDocumentExtractionSocketRejectsOversizeResponseWithoutLeakingPassword(t *testing.T) {
	socketPath := testSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		_, _ = io.Copy(io.Discard, connection)
		_, _ = connection.Write(make([]byte, MaxTextBytes+16*1024+1))
	}()

	extractor := Extractor{SocketPath: socketPath, Timeout: time.Second}
	_, err = extractor.Extract(context.Background(), "statement.pdf", []byte("%PDF-test"), "private-password")
	if err == nil || strings.Contains(err.Error(), "private-password") {
		t.Fatalf("oversize/password error = %v", err)
	}
}

func TestDocumentExtractionUsesSocketEnvironment(t *testing.T) {
	socketPath := testSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	t.Setenv("AI_EXTRACTION_SOCKET", socketPath)

	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		_, _ = io.Copy(io.Discard, connection)
		_, _ = connection.Write([]byte(`{"source":{"units":[{"id":"source-1","location":"Sheet 1","text":"value"}],"warnings":[]}}`))
	}()

	source, err := (Extractor{NodePath: filepath.Join(t.TempDir(), "missing-node")}).Extract(context.Background(), "statement.xlsx", []byte("xlsx"), "")
	if err != nil || len(source.Units) != 1 {
		t.Fatalf("environment socket extraction = %+v, %v", source, err)
	}
	if _, err := os.Stat(socketPath); err != nil {
		t.Fatalf("socket disappeared: %v", err)
	}
}

func testSocketPath(t *testing.T) string {
	t.Helper()
	directory, err := os.MkdirTemp("/tmp", "wb-extract-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	return filepath.Join(directory, "worker.sock")
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
	return &Settings{SettingsInput: SettingsInput{Provider: ProviderAnthropic, Model: "test-model", MonthlyTokenLimit: monthlyLimit, MaxOutputTokens: 256}, BaseURL: ProviderAnthropic.BaseURL(), UpdatedAt: time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)}
}

func validReviewRequest(apiKey string) ReviewRequest {
	return ReviewRequest{Period: "1y", Focus: "overall", APIKey: apiKey, Snapshot: json.RawMessage(`{
		"schemaVersion":1,"asOf":"2026-09-20T12:00:00Z","period":"1y","focus":"overall","baseCurrency":"USD",
		"sharing":{},"completeness":{},"portfolio":{"totals":{"evidenceId":"portfolio.totals"}},"allocations":{},"topAccounts":[],"cashFlow":{},"goals":[],"dataQuality":[],"methodology":[]
	}`)}
}

func validReviewJSON() string {
	return `{"headline":"Review","executiveSummary":"Summary","dataQuality":[],"strengths":[],"attentionItems":[{"id":"finding-1","category":"general","severity":"info","confidence":"high","title":"Title","explanation":"Explanation","evidenceRefs":["portfolio.totals"]}],"goalObservations":[],"questions":[],"possibleNextChecks":[],"limitations":["Explanatory analysis, not financial advice."]}`
}
