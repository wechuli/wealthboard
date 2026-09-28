package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	OIDCTransactionCookieName = "wealthboard_oidc_transaction"
	OIDCReauthCookieName      = "wealthboard_oidc_reauth"
	OIDCTransactionMaxAge     = 10 * time.Minute
	OIDCReauthMaxAge          = 5 * time.Minute
	oidcDiscoveryCacheAge     = 5 * time.Minute
	oidcDiscoveryMaxBytes     = 256 << 10
	oidcTokenMaxBytes         = 256 << 10
	oidcJWKSMaxBytes          = 512 << 10
	clockTolerance            = 5 * time.Second
)

var ErrOIDCProtocol = errors.New("OIDC authentication could not be completed")

type OIDCConfig struct {
	Issuer            string
	ClientID          string
	ClientSecret      string
	ProviderName      string
	CallbackURL       string
	TransactionSecret []byte
}

type OIDCMetadata struct {
	Issuer                string
	AuthorizationEndpoint string
	TokenEndpoint         string
	JWKSURI               string
}

type OIDCIntent string

const (
	OIDCIntentLogin       OIDCIntent = "login"
	OIDCIntentLink        OIDCIntent = "link"
	OIDCIntentReauthLocal OIDCIntent = "reauth_local"
)

type OIDCTransaction struct {
	State                 string     `json:"state"`
	Nonce                 string     `json:"nonce"`
	Verifier              string     `json:"verifier"`
	Next                  string     `json:"next"`
	Intent                OIDCIntent `json:"intent"`
	LinkingUserID         string     `json:"linkingUserId,omitempty"`
	LinkingSessionVersion int        `json:"linkingSessionVersion,omitempty"`
	IssuedAt              int64      `json:"iat"`
	ExpiresAt             int64      `json:"exp"`
	TokenID               string     `json:"jti"`
}

type OIDCIdentityClaims struct {
	Issuer            string
	Subject           string
	Name              string
	PreferredUsername string
}

type oidcReauthGrant struct {
	UserID    string `json:"userId"`
	Purpose   string `json:"purpose"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	TokenID   string `json:"jti"`
}

type cachedOIDCMetadata struct {
	metadata  OIDCMetadata
	expiresAt time.Time
}

type cachedJWKS struct {
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
}

type OIDCClient struct {
	config        OIDCConfig
	httpClient    *http.Client
	secureCookies bool
	now           func() time.Time
	mu            sync.Mutex
	discovery     cachedOIDCMetadata
	jwks          map[string]cachedJWKS
}

type ReadinessRepository interface {
	CountActiveUsersWithoutOIDCIdentity(context.Context, string) (int64, error)
	CountActiveUsersWithoutPassword(context.Context) (int64, error)
}

func ParseOIDCConfig(policy Policy, getenv func(string) string) (*OIDCConfig, error) {
	if !policy.OIDCEnabled {
		return nil, nil
	}
	appURL, err := parseOIDCURL("APP_URL", getenv("APP_URL"), false)
	if err != nil {
		return nil, err
	}
	issuer, err := parseOIDCURL("OIDC_ISSUER", getenv("OIDC_ISSUER"), true)
	if err != nil {
		return nil, err
	}
	clientID, err := requiredOIDCValue("OIDC_CLIENT_ID", getenv("OIDC_CLIENT_ID"), 4096)
	if err != nil {
		return nil, err
	}
	clientSecret, err := requiredOIDCValue("OIDC_CLIENT_SECRET", getenv("OIDC_CLIENT_SECRET"), 4096)
	if err != nil {
		return nil, err
	}
	providerName, err := requiredOIDCValue("OIDC_PROVIDER_NAME", getenv("OIDC_PROVIDER_NAME"), 60)
	if err != nil || hasControlCharacter(providerName) {
		return nil, fmt.Errorf("OIDC_PROVIDER_NAME is required and must be at most 60 printable characters")
	}
	encodedSecret, err := requiredOIDCValue("OIDC_TRANSACTION_SECRET", getenv("OIDC_TRANSACTION_SECRET"), 64)
	if err != nil {
		return nil, err
	}
	transactionSecret, err := base64.StdEncoding.Strict().DecodeString(encodedSecret)
	if err != nil || len(transactionSecret) != 32 || base64.StdEncoding.EncodeToString(transactionSecret) != encodedSecret {
		return nil, errors.New("OIDC_TRANSACTION_SECRET must be a base64-encoded 32-byte value")
	}
	return &OIDCConfig{
		Issuer:            issuer,
		ClientID:          clientID,
		ClientSecret:      clientSecret,
		ProviderName:      providerName,
		CallbackURL:       appURL + "/api/v1/auth/oidc/callback",
		TransactionSecret: transactionSecret,
	}, nil
}

func parseOIDCURL(name, value string, allowPath bool) (string, error) {
	if value == "" {
		return "", fmt.Errorf("%s is required when OIDC is enabled", name)
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" {
		return "", fmt.Errorf("%s must be an absolute URL", name)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s must not contain credentials, a query, or a fragment", name)
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLocalhost(parsed.Hostname())) {
		return "", fmt.Errorf("%s must use HTTPS outside localhost development", name)
	}
	if !allowPath && parsed.EscapedPath() != "" && parsed.EscapedPath() != "/" {
		return "", fmt.Errorf("%s must not contain a path", name)
	}
	if allowPath {
		parsed.Path = strings.TrimRight(parsed.Path, "/")
		return strings.TrimRight(parsed.String(), "/"), nil
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func requiredOIDCValue(name, value string, maximum int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maximum {
		return "", fmt.Errorf("%s is required and has an invalid length", name)
	}
	return value, nil
}

func isLocalhost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func NewOIDCClient(config OIDCConfig, secureCookies bool) *OIDCClient {
	return &OIDCClient{
		config: config,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		secureCookies: secureCookies,
		now:           time.Now,
		jwks:          make(map[string]cachedJWKS),
	}
}

func CheckReadiness(ctx context.Context, policy Policy, repository ReadinessRepository, client *OIDCClient) error {
	if policy.LocalEnabled && !policy.OIDCEnabled {
		count, err := repository.CountActiveUsersWithoutPassword(ctx)
		if err != nil {
			return err
		}
		if count > 0 {
			return errors.New("active users are missing local credentials")
		}
	}
	if policy.OIDCEnabled {
		if client == nil {
			return errors.New("OIDC is enabled but not configured")
		}
		if !policy.LocalEnabled {
			count, err := repository.CountActiveUsersWithoutOIDCIdentity(ctx, client.config.Issuer)
			if err != nil {
				return err
			}
			if count > 0 {
				return errors.New("active users are missing OIDC identities")
			}
		}
		if _, err := client.Discover(ctx); err != nil && !policy.LocalEnabled {
			return err
		}
	}
	return nil
}

func (client *OIDCClient) Config() OIDCConfig {
	return client.config
}

func (client *OIDCClient) Discover(ctx context.Context) (OIDCMetadata, error) {
	client.mu.Lock()
	if client.discovery.expiresAt.After(client.now()) {
		metadata := client.discovery.metadata
		client.mu.Unlock()
		return metadata, nil
	}
	client.mu.Unlock()
	discoveryContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(discoveryContext, http.MethodGet, client.config.Issuer+"/.well-known/openid-configuration", nil)
	if err != nil {
		return OIDCMetadata{}, ErrOIDCProtocol
	}
	request.Header.Set("Accept", "application/json")
	var document struct {
		Issuer                string   `json:"issuer"`
		AuthorizationEndpoint string   `json:"authorization_endpoint"`
		TokenEndpoint         string   `json:"token_endpoint"`
		JWKSURI               string   `json:"jwks_uri"`
		Algorithms            []string `json:"id_token_signing_alg_values_supported"`
	}
	if err := client.fetchJSON(request, oidcDiscoveryMaxBytes, &document); err != nil {
		return OIDCMetadata{}, err
	}
	if document.Issuer != client.config.Issuer || !containsString(document.Algorithms, "RS256") {
		return OIDCMetadata{}, ErrOIDCProtocol
	}
	authorizationEndpoint, err := validateProviderEndpoint(document.AuthorizationEndpoint)
	if err != nil {
		return OIDCMetadata{}, err
	}
	tokenEndpoint, err := validateProviderEndpoint(document.TokenEndpoint)
	if err != nil {
		return OIDCMetadata{}, err
	}
	jwksURI, err := validateProviderEndpoint(document.JWKSURI)
	if err != nil {
		return OIDCMetadata{}, err
	}
	metadata := OIDCMetadata{
		Issuer:                document.Issuer,
		AuthorizationEndpoint: authorizationEndpoint,
		TokenEndpoint:         tokenEndpoint,
		JWKSURI:               jwksURI,
	}
	client.mu.Lock()
	client.discovery = cachedOIDCMetadata{metadata: metadata, expiresAt: client.now().Add(oidcDiscoveryCacheAge)}
	client.mu.Unlock()
	return metadata, nil
}

func validateProviderEndpoint(value string) (string, error) {
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return "", ErrOIDCProtocol
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLocalhost(parsed.Hostname())) {
		return "", ErrOIDCProtocol
	}
	return parsed.String(), nil
}

func (client *OIDCClient) AuthorizationRequest(metadata OIDCMetadata, intent OIDCIntent, next string, principal *Principal) (*url.URL, OIDCTransaction, error) {
	if intent != OIDCIntentLogin && intent != OIDCIntentLink && intent != OIDCIntentReauthLocal {
		return nil, OIDCTransaction{}, ErrOIDCProtocol
	}
	if (intent == OIDCIntentLogin) != (principal == nil) {
		return nil, OIDCTransaction{}, ErrOIDCProtocol
	}
	state, err := randomBase64URL(32)
	if err != nil {
		return nil, OIDCTransaction{}, err
	}
	nonce, err := randomBase64URL(32)
	if err != nil {
		return nil, OIDCTransaction{}, err
	}
	verifier, err := randomBase64URL(64)
	if err != nil {
		return nil, OIDCTransaction{}, err
	}
	transaction := OIDCTransaction{State: state, Nonce: nonce, Verifier: verifier, Next: SafeRelativePath(next), Intent: intent}
	if principal != nil {
		transaction.LinkingUserID = principal.UserID.String()
		transaction.LinkingSessionVersion = principal.Version
	}
	authorizationURL, err := url.Parse(metadata.AuthorizationEndpoint)
	if err != nil {
		return nil, OIDCTransaction{}, ErrOIDCProtocol
	}
	challenge := sha256.Sum256([]byte(verifier))
	query := authorizationURL.Query()
	query.Set("client_id", client.config.ClientID)
	query.Set("response_type", "code")
	query.Set("redirect_uri", client.config.CallbackURL)
	query.Set("scope", "openid profile email")
	query.Set("state", state)
	query.Set("nonce", nonce)
	query.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	query.Set("code_challenge_method", "S256")
	authorizationURL.RawQuery = query.Encode()
	return authorizationURL, transaction, nil
}

func SafeRelativePath(value string) string {
	if value == "" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.Contains(value, "\\") {
		return "/"
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Hostname() != "" || parsed.Fragment != "" {
		return "/"
	}
	return parsed.RequestURI()
}

func (client *OIDCClient) SealTransaction(transaction OIDCTransaction) (string, error) {
	now := client.now().UTC()
	transaction.IssuedAt = now.Unix()
	transaction.ExpiresAt = now.Add(OIDCTransactionMaxAge).Unix()
	transaction.TokenID = uuid.NewString()
	if err := validateTransaction(transaction, now); err != nil {
		return "", err
	}
	return client.sealJSON(transaction)
}

func (client *OIDCClient) OpenTransaction(token string) (OIDCTransaction, error) {
	var transaction OIDCTransaction
	if err := client.openJSON(token, &transaction); err != nil || validateTransaction(transaction, client.now().UTC()) != nil {
		return OIDCTransaction{}, ErrOIDCProtocol
	}
	return transaction, nil
}

func validateTransaction(transaction OIDCTransaction, now time.Time) error {
	validIntent := transaction.Intent == OIDCIntentLogin || transaction.Intent == OIDCIntentLink || transaction.Intent == OIDCIntentReauthLocal
	validLink := transaction.Intent == OIDCIntentLogin && transaction.LinkingUserID == "" && transaction.LinkingSessionVersion == 0
	if transaction.Intent != OIDCIntentLogin {
		userID, err := uuid.Parse(transaction.LinkingUserID)
		validLink = err == nil && userID != uuid.Nil && transaction.LinkingSessionVersion > 0
	}
	if !validIntent || !validLink || len(transaction.State) < 32 || len(transaction.State) > 256 || len(transaction.Nonce) < 32 || len(transaction.Nonce) > 256 || len(transaction.Verifier) < 43 || len(transaction.Verifier) > 128 || len(transaction.Next) < 1 || len(transaction.Next) > 1000 || SafeRelativePath(transaction.Next) != transaction.Next || transaction.TokenID == "" || transaction.IssuedAt > now.Add(clockTolerance).Unix() || transaction.ExpiresAt < now.Add(-clockTolerance).Unix() || transaction.ExpiresAt-transaction.IssuedAt > int64(OIDCTransactionMaxAge/time.Second) {
		return ErrOIDCProtocol
	}
	return nil
}

func (client *OIDCClient) SealReauthGrant(userID uuid.UUID) (string, error) {
	now := client.now().UTC()
	return client.sealJSON(oidcReauthGrant{
		UserID: userID.String(), Purpose: "manage_local_credential", IssuedAt: now.Unix(), ExpiresAt: now.Add(OIDCReauthMaxAge).Unix(), TokenID: uuid.NewString(),
	})
}

func (client *OIDCClient) OpenReauthGrant(token string, expectedUserID uuid.UUID) error {
	var grant oidcReauthGrant
	if err := client.openJSON(token, &grant); err != nil {
		return ErrOIDCProtocol
	}
	now := client.now().UTC()
	if grant.Purpose != "manage_local_credential" || grant.UserID != expectedUserID.String() || grant.TokenID == "" || grant.IssuedAt > now.Add(clockTolerance).Unix() || grant.ExpiresAt < now.Add(-clockTolerance).Unix() || grant.ExpiresAt-grant.IssuedAt > int64(OIDCReauthMaxAge/time.Second) {
		return ErrOIDCProtocol
	}
	return nil
}

func (client *OIDCClient) sealJSON(value any) (string, error) {
	plaintext, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(client.config.TransactionSecret)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nil, nonce, plaintext, []byte("wealthboard:oidc:v1"))
	return base64.RawURLEncoding.EncodeToString(nonce) + "." + base64.RawURLEncoding.EncodeToString(sealed), nil
}

func (client *OIDCClient) openJSON(token string, destination any) error {
	if len(token) > 8192 {
		return ErrOIDCProtocol
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return ErrOIDCProtocol
	}
	nonce, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil {
		return ErrOIDCProtocol
	}
	sealed, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return ErrOIDCProtocol
	}
	block, err := aes.NewCipher(client.config.TransactionSecret)
	if err != nil {
		return ErrOIDCProtocol
	}
	aead, err := cipher.NewGCM(block)
	if err != nil || len(nonce) != aead.NonceSize() {
		return ErrOIDCProtocol
	}
	plaintext, err := aead.Open(nil, nonce, sealed, []byte("wealthboard:oidc:v1"))
	if err != nil {
		return ErrOIDCProtocol
	}
	decoder := json.NewDecoder(strings.NewReader(string(plaintext)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return ErrOIDCProtocol
	}
	return nil
}

func (client *OIDCClient) TransactionCookie(token string) *http.Cookie {
	return client.cookie(OIDCTransactionCookieName, token, "/api/v1/auth/oidc/callback", client.now().Add(OIDCTransactionMaxAge), http.SameSiteLaxMode)
}

func (client *OIDCClient) ExpiredTransactionCookie() *http.Cookie {
	return client.expiredCookie(OIDCTransactionCookieName, "/api/v1/auth/oidc/callback", http.SameSiteLaxMode)
}

func (client *OIDCClient) ReauthCookie(token string) *http.Cookie {
	return client.cookie(OIDCReauthCookieName, token, "/api/v1/auth", client.now().Add(OIDCReauthMaxAge), http.SameSiteStrictMode)
}

func (client *OIDCClient) ExpiredReauthCookie() *http.Cookie {
	return client.expiredCookie(OIDCReauthCookieName, "/api/v1/auth", http.SameSiteStrictMode)
}

func (client *OIDCClient) cookie(name, value, path string, expires time.Time, sameSite http.SameSite) *http.Cookie {
	return &http.Cookie{Name: name, Value: value, Path: path, Expires: expires.UTC(), HttpOnly: true, Secure: client.secureCookies, SameSite: sameSite}
}

func (client *OIDCClient) expiredCookie(name, path string, sameSite http.SameSite) *http.Cookie {
	return &http.Cookie{Name: name, Path: path, Expires: time.Unix(0, 0).UTC(), MaxAge: -1, HttpOnly: true, Secure: client.secureCookies, SameSite: sameSite}
}

func (client *OIDCClient) ExchangeCode(ctx context.Context, metadata OIDCMetadata, code, verifier string) (string, error) {
	if code == "" || len(code) > 4096 || len(verifier) < 43 || len(verifier) > 128 {
		return "", ErrOIDCProtocol
	}
	body := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {client.config.ClientID},
		"client_secret": {client.config.ClientSecret},
		"redirect_uri":  {client.config.CallbackURL},
		"code":          {code},
		"code_verifier": {verifier},
	}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, metadata.TokenEndpoint, strings.NewReader(body))
	if err != nil {
		return "", ErrOIDCProtocol
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var response struct {
		IDToken string `json:"id_token"`
	}
	if err := client.fetchJSON(request, oidcTokenMaxBytes, &response); err != nil || response.IDToken == "" || len(response.IDToken) > 200000 {
		return "", ErrOIDCProtocol
	}
	return response.IDToken, nil
}

func (client *OIDCClient) VerifyIDToken(ctx context.Context, metadata OIDCMetadata, rawToken, expectedNonce string) (OIDCIdentityClaims, error) {
	unverified := jwt.MapClaims{}
	parsed, _, err := new(jwt.Parser).ParseUnverified(rawToken, unverified)
	if err != nil || parsed.Method.Alg() != "RS256" {
		return OIDCIdentityClaims{}, ErrOIDCProtocol
	}
	keyID, _ := parsed.Header["kid"].(string)
	if keyID == "" {
		return OIDCIdentityClaims{}, ErrOIDCProtocol
	}
	keys, err := client.getJWKS(ctx, metadata.JWKSURI, false)
	if err != nil {
		return OIDCIdentityClaims{}, err
	}
	if keys[keyID] == nil {
		keys, err = client.getJWKS(ctx, metadata.JWKSURI, true)
		if err != nil || keys[keyID] == nil {
			return OIDCIdentityClaims{}, ErrOIDCProtocol
		}
	}
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(rawToken, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodRS256 {
			return nil, ErrOIDCProtocol
		}
		keyID, _ := token.Header["kid"].(string)
		key := keys[keyID]
		if key == nil {
			return nil, ErrOIDCProtocol
		}
		return key, nil
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(client.config.Issuer), jwt.WithAudience(client.config.ClientID), jwt.WithExpirationRequired(), jwt.WithLeeway(clockTolerance), jwt.WithTimeFunc(client.now))
	if err != nil || !token.Valid {
		return OIDCIdentityClaims{}, ErrOIDCProtocol
	}
	subject, ok := claims["sub"].(string)
	nonce, nonceOK := claims["nonce"].(string)
	if !ok || !validOIDCSubject(subject) || !nonceOK || !constantTimeEqual(nonce, expectedNonce) {
		return OIDCIdentityClaims{}, ErrOIDCProtocol
	}
	name, _ := claims["name"].(string)
	preferredUsername, _ := claims["preferred_username"].(string)
	return OIDCIdentityClaims{Issuer: client.config.Issuer, Subject: subject, Name: name, PreferredUsername: preferredUsername}, nil
}

func (client *OIDCClient) getJWKS(ctx context.Context, uri string, force bool) (map[string]*rsa.PublicKey, error) {
	client.mu.Lock()
	if cached := client.jwks[uri]; !force && cached.expiresAt.After(client.now()) {
		client.mu.Unlock()
		return cached.keys, nil
	}
	client.mu.Unlock()
	jwksContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(jwksContext, http.MethodGet, uri, nil)
	if err != nil {
		return nil, ErrOIDCProtocol
	}
	request.Header.Set("Accept", "application/json")
	var document struct {
		Keys []struct {
			KeyID     string `json:"kid"`
			KeyType   string `json:"kty"`
			Use       string `json:"use"`
			Algorithm string `json:"alg"`
			Modulus   string `json:"n"`
			Exponent  string `json:"e"`
		} `json:"keys"`
	}
	if err := client.fetchJSON(request, oidcJWKSMaxBytes, &document); err != nil {
		return nil, err
	}
	keys := make(map[string]*rsa.PublicKey)
	for _, jwk := range document.Keys {
		if jwk.KeyID == "" || jwk.KeyType != "RSA" || jwk.Algorithm != "RS256" || (jwk.Use != "" && jwk.Use != "sig") {
			continue
		}
		modulus, modulusErr := base64.RawURLEncoding.Strict().DecodeString(jwk.Modulus)
		exponentBytes, exponentErr := base64.RawURLEncoding.Strict().DecodeString(jwk.Exponent)
		if modulusErr != nil || exponentErr != nil || len(modulus) < 256 || len(exponentBytes) == 0 || len(exponentBytes) > 4 {
			continue
		}
		var exponentBuffer [4]byte
		copy(exponentBuffer[4-len(exponentBytes):], exponentBytes)
		exponent := int(binary.BigEndian.Uint32(exponentBuffer[:]))
		if exponent < 3 || exponent%2 == 0 {
			continue
		}
		keys[jwk.KeyID] = &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: exponent}
	}
	if len(keys) == 0 {
		return nil, ErrOIDCProtocol
	}
	client.mu.Lock()
	client.jwks[uri] = cachedJWKS{keys: keys, expiresAt: client.now().Add(oidcDiscoveryCacheAge)}
	client.mu.Unlock()
	return keys, nil
}

func (client *OIDCClient) fetchJSON(request *http.Request, maximumBytes int64, destination any) error {
	response, err := client.httpClient.Do(request)
	if err != nil {
		return ErrOIDCProtocol
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 || response.ContentLength > maximumBytes {
		return ErrOIDCProtocol
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
		return ErrOIDCProtocol
	}
	limited := io.LimitReader(response.Body, maximumBytes+1)
	payload, err := io.ReadAll(limited)
	if err != nil || int64(len(payload)) > maximumBytes {
		return ErrOIDCProtocol
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	if err := decoder.Decode(destination); err != nil {
		return ErrOIDCProtocol
	}
	return nil
}

func randomBase64URL(size int) (string, error) {
	random := make([]byte, size)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(random), nil
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func constantTimeEqual(left, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1 && len(left) == len(right)
}

func validOIDCSubject(subject string) bool {
	return subject != "" && len(subject) <= 512 && strings.TrimSpace(subject) == subject && !hasControlCharacter(subject)
}

func hasControlCharacter(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}
