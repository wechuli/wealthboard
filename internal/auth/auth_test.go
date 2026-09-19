package auth

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	compatibilitySecret = "test-session-secret-that-is-at-least-32-characters"
	nodeSessionFixture  = "eyJhbGciOiJIUzI1NiJ9.eyJ2ZXJzaW9uIjo3LCJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAxMjMiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6NDEwMjQ0NDgwMH0.fclHsnzN-sMlBMq_ngqqD-sR3-2VesjASTT07b9MsAY"
	nodePasswordFixture = "$2b$12$cNie8rPfk7jkSSluVZjGVO/x.ogLUzlUqYgSsd0pdB4oDTI7E4udG"
)

func TestParsePolicy(t *testing.T) {
	tests := []struct {
		value     string
		wantLocal bool
		wantOIDC  bool
		wantError bool
	}{
		{value: "", wantLocal: true},
		{value: "local", wantLocal: true},
		{value: "oidc", wantOIDC: true},
		{value: "local,oidc", wantLocal: true, wantOIDC: true},
		{value: "oidc,local", wantError: true},
		{value: "local,local", wantError: true},
		{value: "password", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			policy, err := ParsePolicy(test.value)
			if (err != nil) != test.wantError {
				t.Fatalf("ParsePolicy(%q) error = %v, wantError %t", test.value, err, test.wantError)
			}
			if err == nil && (policy.LocalEnabled != test.wantLocal || policy.OIDCEnabled != test.wantOIDC) {
				t.Fatalf("ParsePolicy(%q) = local:%t oidc:%t", test.value, policy.LocalEnabled, policy.OIDCEnabled)
			}
		})
	}
}

func TestPasswordCompatibilityWithBcryptJS(t *testing.T) {
	if !VerifyPassword(nodePasswordFixture, "correct horse battery staple") {
		t.Fatal("Go bcrypt rejected the bcryptjs fixture")
	}
	if VerifyPassword(nodePasswordFixture, "wrong password") {
		t.Fatal("wrong password was accepted")
	}

	hash, err := HashPassword("a sufficiently long password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		t.Fatalf("read bcrypt cost: %v", err)
	}
	if cost != passwordHashCost {
		t.Fatalf("bcrypt cost = %d, want %d", cost, passwordHashCost)
	}
}

func TestSessionCompatibilityWithNodeJose(t *testing.T) {
	manager, err := NewSessionManager(compatibilitySecret, true)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}

	session, err := manager.Verify(nodeSessionFixture, time.Unix(2_000_000_000, 0))
	if err != nil {
		t.Fatalf("verify Node session: %v", err)
	}
	if session.UserID.String() != "00000000-0000-0000-0000-000000000123" || session.Version != 7 {
		t.Fatalf("session = %+v", session)
	}
}

func TestSessionRoundTripAndCookieSecurity(t *testing.T) {
	manager, err := NewSessionManager(compatibilitySecret, true)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}
	issuedAt := time.Unix(2_000_000_000, 0)
	expiresAt := issuedAt.Add(time.Hour)
	want := Session{
		UserID:    uuid.MustParse("00000000-0000-0000-0000-000000000456"),
		Version:   3,
		CSRFToken: "test-csrf-token-that-is-long-enough",
	}

	token, err := manager.Sign(want, issuedAt, expiresAt)
	if err != nil {
		t.Fatalf("sign session: %v", err)
	}
	got, err := manager.Verify(token, issuedAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("verify session: %v", err)
	}
	if got != want {
		t.Fatalf("session = %+v, want %+v", got, want)
	}
	if _, err := manager.Verify(token, expiresAt); err == nil {
		t.Fatal("expected expired session to be rejected")
	}

	cookie := manager.Cookie(token, expiresAt)
	if cookie.Name != SessionCookieName || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" {
		t.Fatalf("insecure session cookie: %+v", cookie)
	}
	expired := manager.ExpiredCookie()
	if expired.MaxAge != -1 || !expired.Expires.Equal(time.Unix(0, 0).UTC()) {
		t.Fatalf("invalid expired cookie: %+v", expired)
	}
}

func TestCSRFToken(t *testing.T) {
	token, err := NewCSRFToken()
	if err != nil {
		t.Fatalf("generate CSRF token: %v", err)
	}
	if !VerifyCSRF(token, token) {
		t.Fatal("generated token did not verify")
	}
	if VerifyCSRF(token, token+"x") || VerifyCSRF("", "") {
		t.Fatal("invalid CSRF token verified")
	}
}

func TestSessionManagerRejectsShortSecret(t *testing.T) {
	if _, err := NewSessionManager("too-short", false); err == nil {
		t.Fatal("expected short session secret to fail")
	}
}

func TestTrustedOrigin(t *testing.T) {
	for _, appURL := range []string{"http://localhost:3000", "http://localhost:3000/", "https://wealthboard.example"} {
		origin, err := TrustedOrigin(appURL)
		if err != nil {
			t.Fatalf("TrustedOrigin(%q): %v", appURL, err)
		}
		if origin == "" {
			t.Fatalf("TrustedOrigin(%q) returned an empty origin", appURL)
		}
	}
	for _, appURL := range []string{"", "http://wealthboard.example", "https://wealthboard.example/app", "https://user@example.com"} {
		if _, err := TrustedOrigin(appURL); err == nil {
			t.Fatalf("TrustedOrigin(%q) unexpectedly succeeded", appURL)
		}
	}
}
