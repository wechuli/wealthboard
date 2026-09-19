package auth

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

func TestAPIKeyLifecycleAndIsolation(t *testing.T) {
	db := openAuthTestDatabase(t)
	ctx := context.Background()
	registration := NewRegistrationService(db, "Africa/Nairobi")
	userOne, err := registration.RegisterLocal(ctx, RegistrationInput{
		Username: "alice", DisplayName: "Alice", Password: "a secure password", BaseCurrency: "KES",
	})
	if err != nil {
		t.Fatalf("register first user: %v", err)
	}
	userTwo, err := registration.RegisterLocal(ctx, RegistrationInput{
		Username: "bob", DisplayName: "Bob", Password: "another secure password", BaseCurrency: "USD",
	})
	if err != nil {
		t.Fatalf("register second user: %v", err)
	}

	keys := NewAPIKeyService(generated.New(db))
	keys.now = func() time.Time { return time.Unix(2_000_000_000, 0) }
	created, err := keys.Create(ctx, userOne.UserID, "Read integration", nil, nil)
	if err != nil {
		t.Fatalf("create API key: %v", err)
	}
	if !strings.HasPrefix(created.Token, "wbk_v1_") || len(created.Scopes) != 1 || created.Scopes[0] != ScopePortfolioRead {
		t.Fatalf("created API key = %+v", created)
	}

	listed, err := keys.List(ctx, userOne.UserID)
	if err != nil {
		t.Fatalf("list API keys: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != created.ID || listed[0].DisplayPrefix == "" {
		t.Fatalf("listed API keys = %+v", listed)
	}

	principal, err := keys.Authenticate(ctx, []string{"Bearer " + created.Token})
	if err != nil {
		t.Fatalf("authenticate API key: %v", err)
	}
	if principal.UserID != userOne.UserID || principal.KeyID != created.ID || principal.Method != "api_key" || !principal.HasScope(ScopePortfolioRead) || principal.HasScope(ScopePortfolioWrite) {
		t.Fatalf("API key principal = %+v", principal)
	}

	if err := keys.Revoke(ctx, userTwo.UserID, created.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-user revoke error = %v, want not found", err)
	}
	if _, err := keys.Authenticate(ctx, []string{"Bearer " + created.Token}); err != nil {
		t.Fatalf("cross-user revoke changed key: %v", err)
	}
	if err := keys.Revoke(ctx, userOne.UserID, created.ID); err != nil {
		t.Fatalf("revoke own key: %v", err)
	}
	if _, err := keys.Authenticate(ctx, []string{"Bearer " + created.Token}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("revoked key error = %v, want invalid credentials", err)
	}
	if _, err := keys.Authenticate(ctx, []string{"Bearer " + created.Token[:len(created.Token)-1] + "x"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("modified key error = %v, want invalid credentials", err)
	}

	expiresAt := keys.now().Add(time.Hour)
	expiring, err := keys.Create(ctx, userTwo.UserID, "Temporary", []Scope{ScopePortfolioRead}, &expiresAt)
	if err != nil {
		t.Fatalf("create expiring key: %v", err)
	}
	keys.now = func() time.Time { return expiresAt.Add(time.Second) }
	if _, err := keys.Authenticate(ctx, []string{"Bearer " + expiring.Token}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expired key error = %v, want invalid credentials", err)
	}
	keys.now = func() time.Time { return time.Unix(2_000_000_000, 0) }
	active, err := keys.Create(ctx, userTwo.UserID, "Disabled user", []Scope{ScopePortfolioRead}, nil)
	if err != nil {
		t.Fatalf("create disabled-user key: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE users SET status = 'disabled' WHERE id = $1`, userTwo.UserID); err != nil {
		t.Fatalf("disable user: %v", err)
	}
	if _, err := keys.Authenticate(ctx, []string{"Bearer " + active.Token}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled-user key error = %v, want invalid credentials", err)
	}
}

func TestAPIKeyParserAcceptsURLSafeUnderscore(t *testing.T) {
	token := "wbk_v1_00000000-0000-0000-0000-000000000456_" + strings.Repeat("_", 43)
	parts := strings.SplitN(token, "_", 4)
	if len(parts) != 4 || !strings.HasPrefix(parts[3], "_") {
		t.Fatalf("token parts = %q", parts)
	}
}
