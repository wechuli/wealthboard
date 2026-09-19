package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type fakeReadinessRepository struct {
	missingPasswords int64
	missingOIDC      int64
}

func (repository fakeReadinessRepository) CountActiveUsersWithoutPassword(context.Context) (int64, error) {
	return repository.missingPasswords, nil
}

func (repository fakeReadinessRepository) CountActiveUsersWithoutOIDCIdentity(context.Context, string) (int64, error) {
	return repository.missingOIDC, nil
}

func TestParseOIDCConfig(t *testing.T) {
	secret := base64.StdEncoding.EncodeToString(make([]byte, 32))
	environment := map[string]string{
		"APP_URL":                 "http://localhost:3000",
		"OIDC_ISSUER":             "https://identity.example/realms/wealth/",
		"OIDC_CLIENT_ID":          "wealthboard",
		"OIDC_CLIENT_SECRET":      "client-secret",
		"OIDC_PROVIDER_NAME":      "Company SSO",
		"OIDC_TRANSACTION_SECRET": secret,
	}
	config, err := ParseOIDCConfig(Policy{OIDCEnabled: true}, func(name string) string { return environment[name] })
	if err != nil {
		t.Fatalf("parse OIDC config: %v", err)
	}
	if config.Issuer != "https://identity.example/realms/wealth" || config.CallbackURL != "http://localhost:3000/api/v1/auth/oidc/callback" || len(config.TransactionSecret) != 32 {
		t.Fatalf("config = %+v", config)
	}

	for name, value := range map[string]string{
		"insecure issuer": "http://identity.example",
		"issuer query":    "https://identity.example/realm?tenant=one",
	} {
		t.Run(name, func(t *testing.T) {
			invalid := map[string]string{}
			for key, configured := range environment {
				invalid[key] = configured
			}
			invalid["OIDC_ISSUER"] = value
			if _, err := ParseOIDCConfig(Policy{OIDCEnabled: true}, func(key string) string { return invalid[key] }); err == nil {
				t.Fatal("expected invalid issuer to fail")
			}
		})
	}

	environment["OIDC_ISSUER"] = "https://identity.example"
	environment["OIDC_TRANSACTION_SECRET"] = base64.StdEncoding.EncodeToString(make([]byte, 31))
	if _, err := ParseOIDCConfig(Policy{OIDCEnabled: true}, func(name string) string { return environment[name] }); err == nil {
		t.Fatal("expected a non-32-byte transaction secret to fail")
	}
	if config, err := ParseOIDCConfig(Policy{LocalEnabled: true}, func(string) string { return "" }); err != nil || config != nil {
		t.Fatalf("local-only config = %+v, %v", config, err)
	}
}

func TestOIDCProtocolFlow(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	now := time.Unix(2_000_000_000, 0).UTC()
	var discoveryRequests atomic.Int32
	var jwksRequests atomic.Int32
	var tokenVerifier string
	var expectedNonce string
	currentPrivateKey := privateKey
	currentKeyID := "test-key"
	var provider *httptest.Server
	provider = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			discoveryRequests.Add(1)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"issuer": provider.URL, "authorization_endpoint": provider.URL + "/authorize", "token_endpoint": provider.URL + "/token", "jwks_uri": provider.URL + "/jwks", "id_token_signing_alg_values_supported": []string{"RS256"},
			})
		case "/token":
			if err := request.ParseForm(); err != nil {
				t.Errorf("parse token form: %v", err)
			}
			tokenVerifier = request.Form.Get("code_verifier")
			token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
				"iss": provider.URL, "aud": "wealthboard", "sub": "subject-123", "nonce": expectedNonce, "name": "Alice", "exp": now.Add(time.Hour).Unix(), "iat": now.Unix(),
			})
			token.Header["kid"] = currentKeyID
			signed, signErr := token.SignedString(currentPrivateKey)
			if signErr != nil {
				t.Errorf("sign token: %v", signErr)
			}
			_ = json.NewEncoder(response).Encode(map[string]string{"id_token": signed, "access_token": "must-not-escape"})
		case "/jwks":
			jwksRequests.Add(1)
			_ = json.NewEncoder(response).Encode(map[string]any{"keys": []map[string]string{{
				"kid": currentKeyID, "kty": "RSA", "use": "sig", "alg": "RS256", "n": base64.RawURLEncoding.EncodeToString(currentPrivateKey.N.Bytes()), "e": encodeExponent(currentPrivateKey.E),
			}}})
		default:
			http.NotFound(response, request)
		}
	}))
	defer provider.Close()

	client := NewOIDCClient(OIDCConfig{
		Issuer: provider.URL, ClientID: "wealthboard", ClientSecret: "secret", ProviderName: "Test", CallbackURL: "http://localhost:3000/api/v1/auth/oidc/callback", TransactionSecret: make([]byte, 32),
	}, true)
	client.now = func() time.Time { return now }
	metadata, err := client.Discover(context.Background())
	if err != nil {
		t.Fatalf("discover provider: %v", err)
	}
	if _, err := client.Discover(context.Background()); err != nil || discoveryRequests.Load() != 1 {
		t.Fatalf("cached discovery requests = %d, error = %v", discoveryRequests.Load(), err)
	}
	authorizationURL, transaction, err := client.AuthorizationRequest(metadata, OIDCIntentLogin, "/accounts?period=1y", nil)
	if err != nil {
		t.Fatalf("create authorization request: %v", err)
	}
	expectedNonce = transaction.Nonce
	query := authorizationURL.Query()
	if query.Get("response_type") != "code" || query.Get("code_challenge_method") != "S256" || query.Get("scope") != "openid profile email" || query.Get("state") != transaction.State {
		t.Fatalf("authorization query = %v", query)
	}

	sealed, err := client.SealTransaction(transaction)
	if err != nil {
		t.Fatalf("seal transaction: %v", err)
	}
	opened, err := client.OpenTransaction(sealed)
	if err != nil || opened.Verifier != transaction.Verifier || opened.Next != "/accounts?period=1y" {
		t.Fatalf("opened transaction = %+v, error = %v", opened, err)
	}
	if _, err := client.OpenTransaction(sealed + "tampered"); err == nil {
		t.Fatal("tampered transaction was accepted")
	}
	cookie := client.TransactionCookie(sealed)
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/v1/auth/oidc/callback" {
		t.Fatalf("transaction cookie = %+v", cookie)
	}

	idToken, err := client.ExchangeCode(context.Background(), metadata, "authorization-code", transaction.Verifier)
	if err != nil {
		t.Fatalf("exchange code: %v", err)
	}
	if tokenVerifier != transaction.Verifier {
		t.Fatalf("token verifier = %q", tokenVerifier)
	}
	claims, err := client.VerifyIDToken(context.Background(), metadata, idToken, transaction.Nonce)
	if err != nil {
		t.Fatalf("verify ID token: %v", err)
	}
	if claims.Issuer != provider.URL || claims.Subject != "subject-123" || claims.Name != "Alice" {
		t.Fatalf("verified claims = %+v", claims)
	}
	if _, err := client.VerifyIDToken(context.Background(), metadata, idToken, "wrong-nonce"); err == nil {
		t.Fatal("wrong nonce was accepted")
	}
	rotatedKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rotated key: %v", err)
	}
	currentPrivateKey, currentKeyID = rotatedKey, "rotated-key"
	rotatedToken := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss": provider.URL, "aud": "wealthboard", "sub": "subject-123", "nonce": transaction.Nonce, "exp": now.Add(time.Hour).Unix(),
	})
	rotatedToken.Header["kid"] = currentKeyID
	rotatedSigned, err := rotatedToken.SignedString(rotatedKey)
	if err != nil {
		t.Fatalf("sign rotated token: %v", err)
	}
	if _, err := client.VerifyIDToken(context.Background(), metadata, rotatedSigned, transaction.Nonce); err != nil {
		t.Fatalf("verify rotated key: %v", err)
	}
	if jwksRequests.Load() != 2 {
		t.Fatalf("JWKS requests = %d, want 2 after rotation", jwksRequests.Load())
	}
	currentPrivateKey, currentKeyID = privateKey, "test-key"
	for name, changedClaims := range map[string]jwt.MapClaims{
		"wrong issuer":   {"iss": provider.URL + "/other", "aud": "wealthboard", "sub": "subject-123", "nonce": transaction.Nonce, "exp": now.Add(time.Hour).Unix()},
		"wrong audience": {"iss": provider.URL, "aud": "other-client", "sub": "subject-123", "nonce": transaction.Nonce, "exp": now.Add(time.Hour).Unix()},
	} {
		t.Run(name, func(t *testing.T) {
			token := jwt.NewWithClaims(jwt.SigningMethodRS256, changedClaims)
			token.Header["kid"] = "test-key"
			signed, err := token.SignedString(privateKey)
			if err != nil {
				t.Fatalf("sign token: %v", err)
			}
			if _, err := client.VerifyIDToken(context.Background(), metadata, signed, transaction.Nonce); err == nil {
				t.Fatal("invalid ID token was accepted")
			}
		})
	}
	hmacToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss": provider.URL, "aud": "wealthboard", "sub": "subject-123", "nonce": transaction.Nonce, "exp": now.Add(time.Hour).Unix(),
	})
	hmacToken.Header["kid"] = "test-key"
	hmacSigned, err := hmacToken.SignedString([]byte("not-an-rsa-key"))
	if err != nil {
		t.Fatalf("sign HMAC token: %v", err)
	}
	if _, err := client.VerifyIDToken(context.Background(), metadata, hmacSigned, transaction.Nonce); err == nil {
		t.Fatal("non-RS256 ID token was accepted")
	}
}

func TestOIDCRejectsMetadataIssuerMismatchAndUnsafeNext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"issuer": "https://different.example", "authorization_endpoint": "https://different.example/auth", "token_endpoint": "https://different.example/token", "jwks_uri": "https://different.example/jwks", "id_token_signing_alg_values_supported": []string{"RS256"},
		})
	}))
	defer server.Close()
	client := NewOIDCClient(OIDCConfig{Issuer: server.URL, TransactionSecret: make([]byte, 32)}, false)
	if _, err := client.Discover(context.Background()); err == nil {
		t.Fatal("issuer mismatch was accepted")
	}
	for _, unsafe := range []string{"", "https://evil.example", "//evil.example", `/safe\\evil`, "/safe#fragment"} {
		if got := SafeRelativePath(unsafe); got != "/" {
			t.Errorf("SafeRelativePath(%q) = %q", unsafe, got)
		}
	}
}

func TestOIDCReadinessModeBehavior(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(response, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	client := NewOIDCClient(OIDCConfig{Issuer: server.URL, TransactionSecret: make([]byte, 32)}, false)
	repository := fakeReadinessRepository{}

	if err := CheckReadiness(context.Background(), Policy{LocalEnabled: true, OIDCEnabled: true}, repository, client); err != nil {
		t.Fatalf("hybrid readiness failed: %v", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("hybrid readiness provider requests = %d", requests.Load())
	}
	if err := CheckReadiness(context.Background(), Policy{OIDCEnabled: true}, repository, client); err == nil {
		t.Fatal("OIDC-only readiness ignored provider failure")
	}
	if requests.Load() != 2 {
		t.Fatalf("OIDC-only readiness provider requests = %d", requests.Load())
	}
	if err := CheckReadiness(context.Background(), Policy{LocalEnabled: true}, fakeReadinessRepository{missingPasswords: 1}, nil); err == nil {
		t.Fatal("local-only readiness ignored a passwordless active user")
	}
	if err := CheckReadiness(context.Background(), Policy{OIDCEnabled: true}, fakeReadinessRepository{missingOIDC: 1}, client); err == nil {
		t.Fatal("OIDC-only readiness ignored an unlinked active user")
	}
}

func encodeExponent(exponent int) string {
	buffer := make([]byte, 4)
	binary.BigEndian.PutUint32(buffer, uint32(exponent))
	return base64.RawURLEncoding.EncodeToString([]byte(strings.TrimLeft(string(buffer), "\x00")))
}

func TestOIDCTransactionExpires(t *testing.T) {
	client := NewOIDCClient(OIDCConfig{TransactionSecret: make([]byte, 32)}, false)
	issuedAt := time.Unix(2_000_000_000, 0).UTC()
	client.now = func() time.Time { return issuedAt }
	sealed, err := client.SealTransaction(OIDCTransaction{
		State: strings.Repeat("s", 43), Nonce: strings.Repeat("n", 43), Verifier: strings.Repeat("v", 86), Next: "/", Intent: OIDCIntentLogin,
	})
	if err != nil {
		t.Fatalf("seal transaction: %v", err)
	}
	client.now = func() time.Time { return issuedAt.Add(OIDCTransactionMaxAge + clockTolerance + time.Second) }
	if _, err := client.OpenTransaction(sealed); err == nil {
		t.Fatal("expired transaction was accepted")
	}
}

func TestSafeRelativePathPreservesQuery(t *testing.T) {
	parsed, err := url.Parse(SafeRelativePath("/goals?view=active"))
	if err != nil || parsed.Path != "/goals" || parsed.Query().Get("view") != "active" {
		t.Fatalf("safe path = %v, %v", parsed, err)
	}
}
