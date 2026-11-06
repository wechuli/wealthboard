// Package oauth is Wealthboard's OAuth 2.1 authorization server for the read-only
// MCP endpoint. Clients register themselves (RFC 7591), users approve access on a
// consent page, and access tokens are opaque, hashed, short-lived, and bound to
// the MCP resource.
package oauth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	ScopePortfolioRead  = "portfolio:read"
	ScopePortfolioWrite = "portfolio:write"
	DataLevelDetailed   = "detailed"
	DataLevelSummary    = "summary"

	requestLifetime      = 10 * time.Minute
	codeLifetime         = 5 * time.Minute
	accessTokenLifetime  = time.Hour
	refreshTokenLifetime = 30 * 24 * time.Hour
	unusedClientLifetime = 24 * time.Hour
	toolCallRetention    = 90 * 24 * time.Hour
	lastUsedResolution   = 5 * time.Minute
	recentCallLimit      = 20
	maxStateLength       = 1000
)

var (
	ErrNotFound      = errors.New("OAuth resource not found")
	ErrInvalidToken  = errors.New("invalid access token")
	ErrInvalidChoice = errors.New("choose detailed or summary access; changes need detailed access and an application that asked for them")
)

// Error is an OAuth protocol error (RFC 6749 section 5.2) that is safe to return.
type Error struct {
	Status      int    `json:"-"`
	Code        string `json:"error"`
	Description string `json:"error_description,omitempty"`
}

func (err *Error) Error() string { return err.Code + ": " + err.Description }

func protocolError(status int, code, description string) *Error {
	return &Error{Status: status, Code: code, Description: description}
}

type Config struct {
	// Issuer is the deployment origin from APP_URL, for example https://wealth.example.com.
	Issuer string
	Logger *slog.Logger
	Now    func() time.Time
}

type Service struct {
	db     *sql.DB
	issuer string
	logger *slog.Logger
	now    func() time.Time
}

func NewService(db *sql.DB, config Config) *Service {
	if config.Logger == nil {
		config.Logger = slog.New(slog.DiscardHandler)
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &Service{db: db, issuer: strings.TrimRight(config.Issuer, "/"), logger: config.Logger, now: config.Now}
}

func (service *Service) Issuer() string { return service.issuer }

// Resource is the canonical MCP resource every token is bound to (RFC 8707).
func (service *Service) Resource() string { return service.issuer + "/mcp" }

// ResourceMetadataURL is the protected resource metadata document for /mcp (RFC 9728).
func (service *Service) ResourceMetadataURL() string {
	return service.issuer + "/.well-known/oauth-protected-resource/mcp"
}

func (service *Service) timestamp() time.Time { return service.now().UTC() }

func (service *Service) resourceMatches(value string) bool {
	return value == "" || strings.TrimRight(value, "/") == service.Resource()
}

// ---- client registration ---------------------------------------------------------------------------------------

type ClientRegistration struct {
	RedirectURIs            []string `json:"redirect_uris"`
	ClientName              string   `json:"client_name"`
	ClientURI               string   `json:"client_uri"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
}

type RegisteredClient struct {
	ClientID                string   `json:"client_id"`
	ClientSecret            string   `json:"client_secret,omitempty"`
	ClientIDIssuedAt        int64    `json:"client_id_issued_at"`
	ClientSecretExpiresAt   *int64   `json:"client_secret_expires_at,omitempty"`
	ClientName              string   `json:"client_name"`
	ClientURI               string   `json:"client_uri,omitempty"`
	RedirectURIs            []string `json:"redirect_uris"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	Scope                   string   `json:"scope"`
}

func (service *Service) Register(ctx context.Context, input ClientRegistration) (RegisteredClient, error) {
	if len(input.RedirectURIs) == 0 || len(input.RedirectURIs) > maxRedirectURIs {
		return RegisteredClient{}, protocolError(400, "invalid_redirect_uri", fmt.Sprintf("register between 1 and %d redirect URIs", maxRedirectURIs))
	}
	redirects := make([]string, 0, len(input.RedirectURIs))
	for _, redirect := range input.RedirectURIs {
		if !validateRedirectURI(redirect) {
			return RegisteredClient{}, protocolError(400, "invalid_redirect_uri", "redirect URIs must use HTTPS, an HTTP loopback address, or an app-specific scheme, without fragments")
		}
		if !slices.Contains(redirects, redirect) {
			redirects = append(redirects, redirect)
		}
	}
	grantTypes := input.GrantTypes
	if len(grantTypes) == 0 {
		grantTypes = []string{"authorization_code", "refresh_token"}
	}
	for _, grantType := range grantTypes {
		if grantType != "authorization_code" && grantType != "refresh_token" {
			return RegisteredClient{}, protocolError(400, "invalid_client_metadata", "only the authorization_code and refresh_token grant types are supported")
		}
	}
	responseTypes := input.ResponseTypes
	if len(responseTypes) == 0 {
		responseTypes = []string{"code"}
	}
	if len(responseTypes) != 1 || responseTypes[0] != "code" {
		return RegisteredClient{}, protocolError(400, "invalid_client_metadata", "only the code response type is supported")
	}
	method := input.TokenEndpointAuthMethod
	if method == "" {
		method = "client_secret_basic"
	}
	if method != "none" && method != "client_secret_post" && method != "client_secret_basic" {
		return RegisteredClient{}, protocolError(400, "invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post, or client_secret_basic")
	}
	name := cleanText(input.ClientName, 100)
	if name == "" {
		name = "Unnamed application"
	}
	clientURI := ""
	if input.ClientURI != "" {
		parsed, err := url.Parse(input.ClientURI)
		if err == nil && parsed.Scheme == "https" && parsed.Host != "" && len(input.ClientURI) <= maxRedirectURILength {
			clientURI = input.ClientURI
		}
	}
	now := service.timestamp()
	result := RegisteredClient{
		ClientID: randomToken(clientIDPrefix, 18), ClientIDIssuedAt: now.Unix(), ClientName: name, ClientURI: clientURI,
		RedirectURIs: redirects, GrantTypes: grantTypes, ResponseTypes: responseTypes, TokenEndpointAuthMethod: method, Scope: ScopePortfolioRead + " " + ScopePortfolioWrite,
	}
	var secretHash []byte
	if method != "none" {
		result.ClientSecret = randomToken(clientSecretPrefix, 32)
		never := int64(0)
		result.ClientSecretExpiresAt = &never
		secretHash = hashToken(result.ClientSecret)
	}
	encoded, _ := json.Marshal(redirects)
	if _, err := service.db.ExecContext(ctx, `
DELETE FROM oauth_clients client
WHERE client.created_at < $1
  AND NOT EXISTS (SELECT 1 FROM oauth_grants grant_row WHERE grant_row.client_id = client.id)`, now.Add(-unusedClientLifetime)); err != nil {
		return RegisteredClient{}, fmt.Errorf("prune unused OAuth clients: %w", err)
	}
	if _, err := service.db.ExecContext(ctx, `
INSERT INTO oauth_clients (id, client_id, client_secret_hash, client_name, client_uri, redirect_uris, token_endpoint_auth_method, created_at)
VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8)`, uuid.New(), result.ClientID, secretHash, name, clientURI, encoded, method, now); err != nil {
		return RegisteredClient{}, fmt.Errorf("register OAuth client: %w", err)
	}
	return result, nil
}

type client struct {
	id           uuid.UUID
	clientID     string
	secretHash   []byte
	name         string
	uri          string
	redirectURIs []string
	authMethod   string
}

func loadClient(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, clientID string) (client, error) {
	var result client
	var uri sql.NullString
	var redirects []byte
	err := queryer.QueryRowContext(ctx, `
SELECT id, client_id, client_secret_hash, client_name, client_uri, redirect_uris, token_endpoint_auth_method
FROM oauth_clients WHERE client_id = $1`, clientID).Scan(&result.id, &result.clientID, &result.secretHash, &result.name, &uri, &redirects, &result.authMethod)
	if errors.Is(err, sql.ErrNoRows) {
		return client{}, ErrNotFound
	}
	if err != nil {
		return client{}, fmt.Errorf("load OAuth client: %w", err)
	}
	result.uri = uri.String
	if err := json.Unmarshal(redirects, &result.redirectURIs); err != nil {
		return client{}, fmt.Errorf("decode OAuth client redirect URIs: %w", err)
	}
	return result, nil
}

// ---- authorization requests and consent ------------------------------------------------------------------------

type AuthorizeParams struct {
	ResponseType        string
	ClientID            string
	RedirectURI         string
	CodeChallenge       string
	CodeChallengeMethod string
	State               string
	Scope               string
	Resource            string
}

// PageError is an authorization failure that must not be redirected, because the
// client or its redirect URI could not be trusted.
type PageError struct{ Message string }

func (err *PageError) Error() string { return err.Message }

// StartAuthorization validates an authorization request and stores it for the
// consent page, returning that page's URL. Every validation failure is a
// [PageError]: clients register without authentication, so redirecting to one
// before the user has seen the consent screen would make this an open redirect.
func (service *Service) StartAuthorization(ctx context.Context, params AuthorizeParams) (string, error) {
	registered, err := loadClient(ctx, service.db, params.ClientID)
	if errors.Is(err, ErrNotFound) {
		return "", &PageError{"This application isn't registered with Wealthboard. Reconnect it from the application."}
	}
	if err != nil {
		return "", err
	}
	redirect := params.RedirectURI
	if redirect == "" {
		if len(registered.redirectURIs) != 1 {
			return "", &PageError{"The application didn't say where to return after sign-in."}
		}
		redirect = registered.redirectURIs[0]
	}
	if !slices.ContainsFunc(registered.redirectURIs, func(candidate string) bool { return redirectMatches(candidate, redirect) }) {
		return "", &PageError{"The application asked to return to an address it didn't register."}
	}
	if len(params.State) > maxStateLength {
		return "", &PageError{"The application sent a state value that is too long."}
	}
	if params.ResponseType != "code" {
		return "", &PageError{"The application asked for an unsupported response type; Wealthboard only issues authorization codes."}
	}
	if params.CodeChallengeMethod != "S256" || !codeChallengePattern.MatchString(params.CodeChallenge) {
		return "", &PageError{"The application didn't use PKCE with the S256 method, which Wealthboard requires."}
	}
	scope, ok := normalizeScope(params.Scope)
	if !ok {
		return "", &PageError{"The application asked for access Wealthboard doesn't offer; the scopes are portfolio:read and portfolio:write."}
	}
	if !service.resourceMatches(params.Resource) {
		return "", &PageError{"The application asked for access to a different server than " + service.Resource() + "."}
	}
	now := service.timestamp()
	id := uuid.New()
	if _, err := service.db.ExecContext(ctx, `DELETE FROM oauth_authorization_requests WHERE expires_at < $1`, now); err != nil {
		return "", fmt.Errorf("prune OAuth requests: %w", err)
	}
	if _, err := service.db.ExecContext(ctx, `
INSERT INTO oauth_authorization_requests (id, client_id, redirect_uri, state, code_challenge, scope, resource, created_at, expires_at)
VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9)`, id, registered.id, redirect, params.State, params.CodeChallenge, scope, service.Resource(), now, now.Add(requestLifetime)); err != nil {
		return "", fmt.Errorf("store OAuth request: %w", err)
	}
	return service.issuer + "/oauth/consent?request=" + id.String(), nil
}

// normalizeScope returns the canonical scope list for a request. Read access is
// always included; portfolio:write is kept only when asked for; offline_access is
// accepted as a no-op because refresh tokens are always issued.
func normalizeScope(value string) (string, bool) {
	write := false
	for _, scope := range strings.Fields(value) {
		switch scope {
		case ScopePortfolioRead, "offline_access":
		case ScopePortfolioWrite:
			write = true
		default:
			return "", false
		}
	}
	if write {
		return ScopePortfolioRead + " " + ScopePortfolioWrite, true
	}
	return ScopePortfolioRead, true
}

// grantedScope narrows the requested scope to what the user approved.
func grantedScope(requested, dataLevel string, allowChanges bool) (string, error) {
	if !allowChanges {
		return ScopePortfolioRead, nil
	}
	if dataLevel != DataLevelDetailed || !slices.Contains(strings.Fields(requested), ScopePortfolioWrite) {
		return "", ErrInvalidChoice
	}
	return ScopePortfolioRead + " " + ScopePortfolioWrite, nil
}

type ConsentRequest struct {
	ID           uuid.UUID `json:"id"`
	ClientName   string    `json:"clientName"`
	ClientURI    string    `json:"clientUri,omitempty"`
	RedirectHost string    `json:"redirectHost"`
	Scopes       []string  `json:"scopes"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

func (service *Service) ConsentRequest(ctx context.Context, requestID uuid.UUID) (ConsentRequest, error) {
	var result ConsentRequest
	var redirect, scope string
	var clientURI sql.NullString
	err := service.db.QueryRowContext(ctx, `
SELECT request.id, client.client_name, client.client_uri, request.redirect_uri, request.scope, request.expires_at
FROM oauth_authorization_requests request
JOIN oauth_clients client ON client.id = request.client_id
WHERE request.id = $1 AND request.expires_at > $2`, requestID, service.timestamp()).Scan(&result.ID, &result.ClientName, &clientURI, &redirect, &scope, &result.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ConsentRequest{}, ErrNotFound
	}
	if err != nil {
		return ConsentRequest{}, fmt.Errorf("load OAuth request: %w", err)
	}
	result.ClientURI, result.RedirectHost, result.Scopes = clientURI.String, redirectDisplay(redirect), strings.Fields(scope)
	return result, nil
}

type pendingRequest struct {
	clientID      uuid.UUID
	redirectURI   string
	state         sql.NullString
	codeChallenge string
	scope         string
	resource      string
}

// takeRequest removes a pending request so it can be decided only once.
func takeRequest(ctx context.Context, tx *sql.Tx, requestID uuid.UUID, now time.Time) (pendingRequest, error) {
	var request pendingRequest
	err := tx.QueryRowContext(ctx, `
DELETE FROM oauth_authorization_requests WHERE id = $1 AND expires_at > $2
RETURNING client_id, redirect_uri, state, code_challenge, scope, resource`, requestID, now).Scan(
		&request.clientID, &request.redirectURI, &request.state, &request.codeChallenge, &request.scope, &request.resource)
	if errors.Is(err, sql.ErrNoRows) {
		return pendingRequest{}, ErrNotFound
	}
	if err != nil {
		return pendingRequest{}, fmt.Errorf("take OAuth request: %w", err)
	}
	return request, nil
}

// Approve records the user's consent and returns the client redirect carrying a
// single-use authorization code. Changes are granted only when the user allows
// them, the client asked for them, and access is detailed. Approving a client
// again replaces the user's earlier grant for it.
func (service *Service) Approve(ctx context.Context, userID, requestID uuid.UUID, dataLevel string, allowChanges bool) (string, error) {
	if dataLevel != DataLevelDetailed && dataLevel != DataLevelSummary {
		return "", ErrInvalidChoice
	}
	now := service.timestamp()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin OAuth approval: %w", err)
	}
	defer tx.Rollback()
	request, err := takeRequest(ctx, tx, requestID, now)
	if err != nil {
		return "", err
	}
	scope, err := grantedScope(request.scope, dataLevel, allowChanges)
	if err != nil {
		// The request stays pending so the user can choose again.
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE oauth_grants SET revoked_at = $3 WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`, userID, request.clientID, now); err != nil {
		return "", fmt.Errorf("replace earlier OAuth grant: %w", err)
	}
	grantID := uuid.New()
	if _, err := tx.ExecContext(ctx, `
INSERT INTO oauth_grants (id, user_id, client_id, redirect_uri, scope, data_level, resource, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, grantID, userID, request.clientID, request.redirectURI, scope, dataLevel, request.resource, now); err != nil {
		return "", fmt.Errorf("create OAuth grant: %w", err)
	}
	code := randomToken("", 32)
	if _, err := tx.ExecContext(ctx, `
INSERT INTO oauth_authorization_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at)
VALUES ($1, $2, $3, $4, $5)`, hashToken(code), grantID, request.redirectURI, request.codeChallenge, now.Add(codeLifetime)); err != nil {
		return "", fmt.Errorf("create OAuth code: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit OAuth approval: %w", err)
	}
	return withQuery(request.redirectURI, url.Values{"code": {code}, "state": {request.state.String}, "iss": {service.issuer}}), nil
}

// Deny discards the request and returns the client redirect carrying access_denied.
func (service *Service) Deny(ctx context.Context, requestID uuid.UUID) (string, error) {
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin OAuth denial: %w", err)
	}
	defer tx.Rollback()
	request, err := takeRequest(ctx, tx, requestID, service.timestamp())
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit OAuth denial: %w", err)
	}
	return withQuery(request.redirectURI, url.Values{"error": {"access_denied"}, "error_description": {"The user declined access."}, "state": {request.state.String}, "iss": {service.issuer}}), nil
}

// ---- token endpoint --------------------------------------------------------------------------------------------

type ClientCredentials struct {
	ClientID     string
	ClientSecret string
	// Basic is true when the credentials came from an HTTP Basic Authorization header.
	Basic bool
}

type TokenRequest struct {
	GrantType    string
	Code         string
	RedirectURI  string
	CodeVerifier string
	RefreshToken string
	Resource     string
	Scope        string
	Client       ClientCredentials
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

var errInvalidClient = protocolError(401, "invalid_client", "client authentication failed")

func (service *Service) authenticateClient(ctx context.Context, credentials ClientCredentials) (client, error) {
	if credentials.ClientID == "" {
		return client{}, errInvalidClient
	}
	registered, err := loadClient(ctx, service.db, credentials.ClientID)
	if errors.Is(err, ErrNotFound) {
		return client{}, errInvalidClient
	}
	if err != nil {
		return client{}, err
	}
	switch registered.authMethod {
	case "none":
		if credentials.ClientSecret != "" || credentials.Basic {
			return client{}, errInvalidClient
		}
	case "client_secret_basic", "client_secret_post":
		if credentials.Basic != (registered.authMethod == "client_secret_basic") || !sameHash(registered.secretHash, credentials.ClientSecret) {
			return client{}, errInvalidClient
		}
	default:
		return client{}, errInvalidClient
	}
	return registered, nil
}

func (service *Service) Token(ctx context.Context, request TokenRequest) (TokenResponse, error) {
	registered, err := service.authenticateClient(ctx, request.Client)
	if err != nil {
		return TokenResponse{}, err
	}
	if !service.resourceMatches(request.Resource) {
		return TokenResponse{}, protocolError(400, "invalid_target", "the resource must be "+service.Resource())
	}
	switch request.GrantType {
	case "authorization_code":
		return service.exchangeCode(ctx, registered, request)
	case "refresh_token":
		return service.refresh(ctx, registered, request)
	default:
		return TokenResponse{}, protocolError(400, "unsupported_grant_type", "use authorization_code or refresh_token")
	}
}

var errInvalidGrant = protocolError(400, "invalid_grant", "the authorization code or refresh token is invalid, expired, or already used")

func (service *Service) exchangeCode(ctx context.Context, registered client, request TokenRequest) (TokenResponse, error) {
	if request.Code == "" {
		return TokenResponse{}, protocolError(400, "invalid_request", "code is required")
	}
	now := service.timestamp()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return TokenResponse{}, fmt.Errorf("begin OAuth code exchange: %w", err)
	}
	defer tx.Rollback()
	var grantID, clientID uuid.UUID
	var redirect, challenge, status, scope string
	var expiresAt time.Time
	var usedAt, revokedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
SELECT code.grant_id, grant_row.client_id, code.redirect_uri, code.code_challenge, code.expires_at, code.used_at, grant_row.revoked_at, account.status, grant_row.scope
FROM oauth_authorization_codes code
JOIN oauth_grants grant_row ON grant_row.id = code.grant_id
JOIN users account ON account.id = grant_row.user_id
WHERE code.code_hash = $1
FOR UPDATE OF code`, hashToken(request.Code)).Scan(&grantID, &clientID, &redirect, &challenge, &expiresAt, &usedAt, &revokedAt, &status, &scope)
	if errors.Is(err, sql.ErrNoRows) {
		return TokenResponse{}, errInvalidGrant
	}
	if err != nil {
		return TokenResponse{}, fmt.Errorf("load OAuth code: %w", err)
	}
	if clientID != registered.id {
		return TokenResponse{}, errInvalidGrant
	}
	if usedAt.Valid {
		// A replayed code may have been stolen: revoke everything it produced.
		if err := revokeGrant(ctx, tx, grantID, now); err != nil {
			return TokenResponse{}, err
		}
		if err := tx.Commit(); err != nil {
			return TokenResponse{}, fmt.Errorf("commit OAuth code replay revocation: %w", err)
		}
		return TokenResponse{}, errInvalidGrant
	}
	if !expiresAt.After(now) || revokedAt.Valid || status != "active" {
		return TokenResponse{}, errInvalidGrant
	}
	if request.RedirectURI != "" && request.RedirectURI != redirect {
		return TokenResponse{}, errInvalidGrant
	}
	if !verifyPKCE(challenge, request.CodeVerifier) {
		return TokenResponse{}, protocolError(400, "invalid_grant", "the PKCE code verifier does not match")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE oauth_authorization_codes SET used_at = $2 WHERE code_hash = $1`, hashToken(request.Code), now); err != nil {
		return TokenResponse{}, fmt.Errorf("use OAuth code: %w", err)
	}
	response, err := issueTokens(ctx, tx, grantID, scope, now)
	if err != nil {
		return TokenResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return TokenResponse{}, fmt.Errorf("commit OAuth code exchange: %w", err)
	}
	return response, nil
}

func (service *Service) refresh(ctx context.Context, registered client, request TokenRequest) (TokenResponse, error) {
	if request.RefreshToken == "" {
		return TokenResponse{}, protocolError(400, "invalid_request", "refresh_token is required")
	}
	requestedScope, ok := normalizeScope(request.Scope)
	if !ok {
		return TokenResponse{}, protocolError(400, "invalid_scope", "the scopes are portfolio:read and portfolio:write")
	}
	now := service.timestamp()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return TokenResponse{}, fmt.Errorf("begin OAuth refresh: %w", err)
	}
	defer tx.Rollback()
	var grantID, clientID uuid.UUID
	var expiresAt time.Time
	var usedAt, tokenRevokedAt, grantRevokedAt sql.NullTime
	var status, scope string
	err = tx.QueryRowContext(ctx, `
SELECT token.grant_id, grant_row.client_id, token.expires_at, token.used_at, token.revoked_at, grant_row.revoked_at, account.status, grant_row.scope
FROM oauth_tokens token
JOIN oauth_grants grant_row ON grant_row.id = token.grant_id
JOIN users account ON account.id = grant_row.user_id
WHERE token.token_hash = $1 AND token.kind = 'refresh'
FOR UPDATE OF token, grant_row`, hashToken(request.RefreshToken)).Scan(&grantID, &clientID, &expiresAt, &usedAt, &tokenRevokedAt, &grantRevokedAt, &status, &scope)
	if errors.Is(err, sql.ErrNoRows) {
		return TokenResponse{}, errInvalidGrant
	}
	if err != nil {
		return TokenResponse{}, fmt.Errorf("load OAuth refresh token: %w", err)
	}
	if clientID != registered.id {
		return TokenResponse{}, errInvalidGrant
	}
	if usedAt.Valid && !grantRevokedAt.Valid {
		// Refresh tokens rotate on every use, so a reused one may have been stolen.
		if err := revokeGrant(ctx, tx, grantID, now); err != nil {
			return TokenResponse{}, err
		}
		if err := tx.Commit(); err != nil {
			return TokenResponse{}, fmt.Errorf("commit OAuth refresh reuse revocation: %w", err)
		}
		service.logger.WarnContext(ctx, "OAuth refresh token reused; grant revoked", "grant", grantID)
		return TokenResponse{}, errInvalidGrant
	}
	if usedAt.Valid || tokenRevokedAt.Valid || grantRevokedAt.Valid || !expiresAt.After(now) || status != "active" {
		return TokenResponse{}, errInvalidGrant
	}
	if request.Scope != "" {
		for _, wanted := range strings.Fields(requestedScope) {
			if !slices.Contains(strings.Fields(scope), wanted) {
				return TokenResponse{}, protocolError(400, "invalid_scope", "a refresh can't add access the user didn't approve")
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE oauth_tokens SET used_at = $2 WHERE token_hash = $1`, hashToken(request.RefreshToken), now); err != nil {
		return TokenResponse{}, fmt.Errorf("rotate OAuth refresh token: %w", err)
	}
	response, err := issueTokens(ctx, tx, grantID, scope, now)
	if err != nil {
		return TokenResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return TokenResponse{}, fmt.Errorf("commit OAuth refresh: %w", err)
	}
	return response, nil
}

func issueTokens(ctx context.Context, tx *sql.Tx, grantID uuid.UUID, scope string, now time.Time) (TokenResponse, error) {
	if _, err := tx.ExecContext(ctx, `DELETE FROM oauth_tokens WHERE grant_id = $1 AND expires_at < $2`, grantID, now.Add(-24*time.Hour)); err != nil {
		return TokenResponse{}, fmt.Errorf("prune OAuth tokens: %w", err)
	}
	access, refresh := randomToken(accessTokenPrefix, 32), randomToken(refreshTokenPrefix, 32)
	if _, err := tx.ExecContext(ctx, `
INSERT INTO oauth_tokens (token_hash, grant_id, kind, created_at, expires_at)
VALUES ($1, $3, 'access', $4, $5), ($2, $3, 'refresh', $4, $6)`, hashToken(access), hashToken(refresh), grantID, now, now.Add(accessTokenLifetime), now.Add(refreshTokenLifetime)); err != nil {
		return TokenResponse{}, fmt.Errorf("issue OAuth tokens: %w", err)
	}
	return TokenResponse{AccessToken: access, TokenType: "Bearer", ExpiresIn: int(accessTokenLifetime.Seconds()), RefreshToken: refresh, Scope: scope}, nil
}

func revokeGrant(ctx context.Context, tx *sql.Tx, grantID uuid.UUID, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1`, grantID, now); err != nil {
		return fmt.Errorf("revoke OAuth grant: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, $2) WHERE grant_id = $1`, grantID, now); err != nil {
		return fmt.Errorf("revoke OAuth grant tokens: %w", err)
	}
	return nil
}

// Revoke implements RFC 7009. Unknown tokens and tokens of other clients are
// ignored; revoking a refresh token ends the whole grant.
func (service *Service) Revoke(ctx context.Context, credentials ClientCredentials, token string) error {
	registered, err := service.authenticateClient(ctx, credentials)
	if err != nil {
		return err
	}
	now := service.timestamp()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin OAuth revocation: %w", err)
	}
	defer tx.Rollback()
	var grantID, clientID uuid.UUID
	var kind string
	err = tx.QueryRowContext(ctx, `
SELECT token.grant_id, grant_row.client_id, token.kind
FROM oauth_tokens token JOIN oauth_grants grant_row ON grant_row.id = token.grant_id
WHERE token.token_hash = $1`, hashToken(token)).Scan(&grantID, &clientID, &kind)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && clientID != registered.id) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load OAuth token for revocation: %w", err)
	}
	if kind == "refresh" {
		err = revokeGrant(ctx, tx, grantID, now)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, $2) WHERE token_hash = $1`, hashToken(token), now)
	}
	if err != nil {
		return fmt.Errorf("revoke OAuth token: %w", err)
	}
	return tx.Commit()
}

// ---- access tokens ---------------------------------------------------------------------------------------------

type AccessGrant struct {
	GrantID   uuid.UUID
	UserID    uuid.UUID
	Scopes    []string
	DataLevel string
	ExpiresAt time.Time
}

// VerifyAccessToken resolves an access token for the MCP resource. Revoked or
// expired tokens, revoked grants, disabled users, and tokens issued for another
// resource are rejected with ErrInvalidToken.
func (service *Service) VerifyAccessToken(ctx context.Context, token string) (AccessGrant, error) {
	if !IsAccessToken(token) {
		return AccessGrant{}, ErrInvalidToken
	}
	now := service.timestamp()
	var grant AccessGrant
	var scope, resource string
	var lastUsed sql.NullTime
	err := service.db.QueryRowContext(ctx, `
SELECT grant_row.id, grant_row.user_id, grant_row.scope, grant_row.data_level, grant_row.resource, grant_row.last_used_at, token.expires_at
FROM oauth_tokens token
JOIN oauth_grants grant_row ON grant_row.id = token.grant_id
JOIN users account ON account.id = grant_row.user_id
WHERE token.token_hash = $1 AND token.kind = 'access' AND token.revoked_at IS NULL AND token.expires_at > $2
  AND grant_row.revoked_at IS NULL AND account.status = 'active'`, hashToken(token), now).Scan(
		&grant.GrantID, &grant.UserID, &scope, &grant.DataLevel, &resource, &lastUsed, &grant.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AccessGrant{}, ErrInvalidToken
	}
	if err != nil {
		return AccessGrant{}, fmt.Errorf("verify OAuth access token: %w", err)
	}
	if resource != service.Resource() {
		return AccessGrant{}, ErrInvalidToken
	}
	if !lastUsed.Valid || now.Sub(lastUsed.Time) >= lastUsedResolution {
		if _, err := service.db.ExecContext(ctx, `UPDATE oauth_grants SET last_used_at = $2 WHERE id = $1`, grant.GrantID, now); err != nil {
			return AccessGrant{}, fmt.Errorf("record OAuth grant use: %w", err)
		}
	}
	grant.Scopes = strings.Fields(scope)
	return grant, nil
}

// ---- connected apps --------------------------------------------------------------------------------------------

type ToolCall struct {
	Tool    string    `json:"tool"`
	Outcome string    `json:"outcome"`
	At      time.Time `json:"at"`
}

type ConnectedApp struct {
	ID           uuid.UUID  `json:"id"`
	ClientName   string     `json:"clientName"`
	ClientURI    string     `json:"clientUri,omitempty"`
	RedirectHost string     `json:"redirectHost"`
	Scopes       []string   `json:"scopes"`
	DataLevel    string     `json:"dataLevel"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastUsedAt   *time.Time `json:"lastUsedAt"`
	RecentCalls  []ToolCall `json:"recentCalls"`
}

// ConnectedApps lists the user's grants that still hold a usable token.
func (service *Service) ConnectedApps(ctx context.Context, userID uuid.UUID) ([]ConnectedApp, error) {
	now := service.timestamp()
	rows, err := service.db.QueryContext(ctx, `
SELECT grant_row.id, client.client_name, client.client_uri, grant_row.redirect_uri, grant_row.scope, grant_row.data_level, grant_row.created_at, grant_row.last_used_at
FROM oauth_grants grant_row
JOIN oauth_clients client ON client.id = grant_row.client_id
WHERE grant_row.user_id = $1 AND grant_row.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM oauth_tokens token
    WHERE token.grant_id = grant_row.id AND token.revoked_at IS NULL AND token.used_at IS NULL AND token.expires_at > $2
  )
ORDER BY grant_row.created_at DESC, grant_row.id`, userID, now)
	if err != nil {
		return nil, fmt.Errorf("list connected apps: %w", err)
	}
	defer rows.Close()
	apps := []ConnectedApp{}
	for rows.Next() {
		var app ConnectedApp
		var clientURI sql.NullString
		var redirect, scope string
		var lastUsed sql.NullTime
		if err := rows.Scan(&app.ID, &app.ClientName, &clientURI, &redirect, &scope, &app.DataLevel, &app.CreatedAt, &lastUsed); err != nil {
			return nil, fmt.Errorf("scan connected app: %w", err)
		}
		app.ClientURI, app.RedirectHost, app.Scopes, app.RecentCalls = clientURI.String, redirectDisplay(redirect), strings.Fields(scope), []ToolCall{}
		app.CreatedAt = app.CreatedAt.UTC()
		if lastUsed.Valid {
			value := lastUsed.Time.UTC()
			app.LastUsedAt = &value
		}
		apps = append(apps, app)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate connected apps: %w", err)
	}
	for index := range apps {
		calls, err := service.db.QueryContext(ctx, `
SELECT tool, outcome, created_at FROM oauth_tool_calls
WHERE grant_id = $1 AND user_id = $2 ORDER BY created_at DESC, id LIMIT $3`, apps[index].ID, userID, recentCallLimit)
		if err != nil {
			return nil, fmt.Errorf("list connected app calls: %w", err)
		}
		for calls.Next() {
			var call ToolCall
			if err := calls.Scan(&call.Tool, &call.Outcome, &call.At); err != nil {
				calls.Close()
				return nil, fmt.Errorf("scan connected app call: %w", err)
			}
			call.At = call.At.UTC()
			apps[index].RecentCalls = append(apps[index].RecentCalls, call)
		}
		if err := calls.Close(); err != nil {
			return nil, fmt.Errorf("close connected app calls: %w", err)
		}
	}
	return apps, nil
}

func (service *Service) RevokeConnectedApp(ctx context.Context, userID, grantID uuid.UUID) error {
	now := service.timestamp()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin connected app revocation: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE oauth_grants SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, grantID, userID, now)
	if err != nil {
		return fmt.Errorf("revoke connected app: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return ErrNotFound
	}
	if err := revokeGrant(ctx, tx, grantID, now); err != nil {
		return err
	}
	return tx.Commit()
}

func (service *Service) ClearToolCalls(ctx context.Context, userID, grantID uuid.UUID) error {
	var exists bool
	if err := service.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM oauth_grants WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL)`, grantID, userID).Scan(&exists); err != nil {
		return fmt.Errorf("check connected app: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := service.db.ExecContext(ctx, `DELETE FROM oauth_tool_calls WHERE grant_id = $1 AND user_id = $2`, grantID, userID); err != nil {
		return fmt.Errorf("clear connected app calls: %w", err)
	}
	return nil
}

// RecordToolCall keeps only the tool name, outcome, and time; never arguments or results.
func (service *Service) RecordToolCall(ctx context.Context, grantID, userID uuid.UUID, tool, outcome string) error {
	now := service.timestamp()
	if _, err := service.db.ExecContext(ctx, `DELETE FROM oauth_tool_calls WHERE grant_id = $1 AND created_at < $2`, grantID, now.Add(-toolCallRetention)); err != nil {
		return fmt.Errorf("prune OAuth tool calls: %w", err)
	}
	if _, err := service.db.ExecContext(ctx, `
INSERT INTO oauth_tool_calls (id, grant_id, user_id, tool, outcome, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		uuid.New(), grantID, userID, cleanText(tool, 100), outcome, now); err != nil {
		return fmt.Errorf("record OAuth tool call: %w", err)
	}
	return nil
}
