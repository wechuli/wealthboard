package oauth_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/config"
	"github.com/wechuli/wealthboard/internal/database"
	"github.com/wechuli/wealthboard/internal/database/generated"
	"github.com/wechuli/wealthboard/internal/mcpserver"
	"github.com/wechuli/wealthboard/internal/oauth"
	"github.com/wechuli/wealthboard/internal/service"
)

const (
	issuer   = "https://wealth.example.test"
	callback = "https://claude.ai/api/mcp/auth_callback"
	verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
)

func openTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close() })
	schema := "wealthboard_oauth_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.ExecContext(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop schema: %v", err)
		}
	})
	schemaURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := schemaURL.Query()
	query.Set("search_path", schema)
	schemaURL.RawQuery = query.Encode()
	db, err := database.Open(ctx, config.Database{URL: schemaURL.String(), MaxOpenConns: 10, MaxIdleConns: 2, ConnMaxLifetime: time.Minute, ConnMaxIdleTime: time.Minute, PingTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := database.MigrateUp(ctx, db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func seedUser(t *testing.T, ctx context.Context, db *sql.DB, name string, openingMinor int64) (uuid.UUID, uuid.UUID) {
	t.Helper()
	userID, categoryID, institutionID := uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,username,created_at,updated_at) VALUES ($1,$2,now(),now())`, []any{userID, name + "-" + userID.String()}},
		{`INSERT INTO user_settings (id,user_id,display_name,supported_currencies,timezone,created_at,updated_at) VALUES ($1,$2,$3,'["KES"]','Africa/Nairobi',now(),now())`, []any{uuid.New(), userID, name}},
		{`INSERT INTO institutions (id,user_id,name,normalized_name,type,created_at,updated_at) VALUES ($1,$2,$3,lower($3),'bank',now(),now())`, []any{institutionID, userID, name + " Bank"}},
		{`INSERT INTO categories (id,user_id,name,slug,asset_or_liability,created_at,updated_at) VALUES ($1,$2,'Cash',$3,'asset',now(),now())`, []any{categoryID, userID, "cash-" + categoryID.String()}},
	} {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}
	key := uuid.New()
	opened := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	accountID, err := service.NewLedgerService(db).CreateAccount(ctx, userID, service.AccountMutationInput{
		IdempotencyKey: &key, Name: name + " savings", CategoryID: categoryID, InstitutionID: &institutionID, Currency: "KES", TrackingMode: "balance",
		OpeningValueMinor: openingMinor, IsIncludedInNetWorth: true, OpenedAt: &opened,
	})
	if err != nil {
		t.Fatalf("create %s account: %v", name, err)
	}
	return userID, accountID
}

type harness struct {
	t      *testing.T
	server *httptest.Server
	oauth  *oauth.Service
}

func noRedirects() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (h harness) get(path string) *http.Response {
	h.t.Helper()
	response, err := noRedirects().Get(h.server.URL + path)
	if err != nil {
		h.t.Fatal(err)
	}
	h.t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

func (h harness) postForm(path string, form url.Values, basic ...string) (*http.Response, map[string]any) {
	h.t.Helper()
	request, _ := http.NewRequest(http.MethodPost, h.server.URL+path, strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if len(basic) == 2 {
		request.SetBasicAuth(url.QueryEscape(basic[0]), url.QueryEscape(basic[1]))
	}
	return h.do(request)
}

func (h harness) postJSON(path string, body any) (*http.Response, map[string]any) {
	h.t.Helper()
	encoded, _ := json.Marshal(body)
	request, _ := http.NewRequest(http.MethodPost, h.server.URL+path, strings.NewReader(string(encoded)))
	request.Header.Set("Content-Type", "application/json")
	return h.do(request)
}

func (h harness) do(request *http.Request) (*http.Response, map[string]any) {
	h.t.Helper()
	response, err := noRedirects().Do(request)
	if err != nil {
		h.t.Fatal(err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	decoded := map[string]any{}
	_ = json.Unmarshal(raw, &decoded)
	return response, decoded
}

func challenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (h harness) register(body map[string]any) string {
	h.t.Helper()
	response, registered := h.postJSON("/oauth/register", body)
	if response.StatusCode != http.StatusCreated {
		h.t.Fatalf("register status %d: %v", response.StatusCode, registered)
	}
	return registered["client_id"].(string)
}

// authorize runs the authorization request and returns the pending consent request ID.
func (h harness) authorize(clientID, redirect, state string) uuid.UUID {
	h.t.Helper()
	query := url.Values{
		"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {redirect}, "state": {state},
		"code_challenge": {challenge(verifier)}, "code_challenge_method": {"S256"}, "scope": {"portfolio:read"}, "resource": {issuer + "/mcp"},
	}
	response := h.get("/oauth/authorize?" + query.Encode())
	location, _ := url.Parse(response.Header.Get("Location"))
	if response.StatusCode != http.StatusFound || location == nil || location.Path != "/oauth/consent" {
		h.t.Fatalf("authorize status %d location %q", response.StatusCode, response.Header.Get("Location"))
	}
	requestID, err := uuid.Parse(location.Query().Get("request"))
	if err != nil {
		h.t.Fatal(err)
	}
	return requestID
}

func (h harness) approve(userID, requestID uuid.UUID, level, state string) string {
	h.t.Helper()
	redirect, err := h.oauth.Approve(context.Background(), userID, requestID, level)
	if err != nil {
		h.t.Fatal(err)
	}
	parsed, _ := url.Parse(redirect)
	if parsed.Query().Get("state") != state || parsed.Query().Get("iss") != issuer || !strings.HasPrefix(redirect, callback) {
		h.t.Fatalf("approval redirect = %s", redirect)
	}
	return parsed.Query().Get("code")
}

func (h harness) exchange(clientID, code string) map[string]any {
	h.t.Helper()
	response, tokens := h.postForm("/oauth/token", url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {callback}, "code_verifier": {verifier},
		"client_id": {clientID}, "resource": {issuer + "/mcp"},
	})
	if response.StatusCode != http.StatusOK || tokens["token_type"] != "Bearer" || response.Header.Get("Cache-Control") != "no-store" {
		h.t.Fatalf("token exchange %d: %v", response.StatusCode, tokens)
	}
	return tokens
}

type bearerTransport struct{ token string }

func (transport bearerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.Header.Set("Authorization", "Bearer "+transport.token)
	return http.DefaultTransport.RoundTrip(request)
}

func (h harness) session(token string) (*mcp.ClientSession, error) {
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	return client.Connect(h.t.Context(), &mcp.StreamableClientTransport{
		Endpoint: h.server.URL + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{token: token}},
	}, nil)
}

func (h harness) mcpStatus(token string) int {
	h.t.Helper()
	request, _ := http.NewRequest(http.MethodPost, h.server.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, _ := h.do(request)
	return response.StatusCode
}

func TestPostgreSQLOAuthFlowGrantsScopedRevocableAccess(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	ownerID, ownerAccount := seedUser(t, ctx, db, "owner", 150_050)
	otherID, otherAccount := seedUser(t, ctx, db, "other", 999_900)

	authorization := oauth.NewService(db, oauth.Config{Issuer: issuer})
	mux := http.NewServeMux()
	protocol := oauth.NewHandler(authorization, oauth.HandlerOptions{})
	mux.Handle("/.well-known/", protocol)
	mux.Handle("/oauth/", protocol)
	mux.Handle("/mcp", mcpserver.NewHandler(mcpserver.Readers{
		Core:     service.NewCoreReadService(service.NewSQLCoreReadRepository(db)),
		Reports:  service.NewGoalsReportsService(service.NewSQLGoalsReportsRepository(db)),
		Insights: service.NewInsightsService(service.NewSQLGoalsReportsRepository(db)),
	}, webauth.NewAPIKeyService(generated.New(db)), mcpserver.Options{RequestsPerMinute: 1000, OAuth: authorization}))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	h := harness{t: t, server: server, oauth: authorization}

	// Discovery: an unauthenticated MCP request points to the resource metadata, which names the issuer.
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/mcp", strings.NewReader(`{}`))
	unauthenticated, _ := h.do(request)
	if unauthenticated.StatusCode != http.StatusUnauthorized || !strings.Contains(unauthenticated.Header.Get("WWW-Authenticate"), `resource_metadata="`+issuer+`/.well-known/oauth-protected-resource/mcp"`) {
		t.Fatalf("unauthenticated MCP = %d %q", unauthenticated.StatusCode, unauthenticated.Header.Get("WWW-Authenticate"))
	}
	var resource map[string]any
	_ = json.NewDecoder(h.get("/.well-known/oauth-protected-resource/mcp").Body).Decode(&resource)
	if resource["resource"] != issuer+"/mcp" || resource["authorization_servers"].([]any)[0] != issuer {
		t.Fatalf("resource metadata = %v", resource)
	}
	var metadata map[string]any
	_ = json.NewDecoder(h.get("/.well-known/oauth-authorization-server").Body).Decode(&metadata)
	if metadata["issuer"] != issuer || metadata["registration_endpoint"] != issuer+"/oauth/register" || metadata["code_challenge_methods_supported"].([]any)[0] != "S256" || metadata["client_id_metadata_document_supported"] != false {
		t.Fatalf("server metadata = %v", metadata)
	}
	if h.get("/.well-known/openid-configuration").StatusCode != http.StatusNotFound {
		t.Fatal("unknown well-known path did not return 404")
	}

	// Registration rejects redirects to arbitrary HTTP hosts.
	if response, body := h.postJSON("/oauth/register", map[string]any{"redirect_uris": []string{"http://evil.example/cb"}}); response.StatusCode != http.StatusBadRequest || body["error"] != "invalid_redirect_uri" {
		t.Fatalf("bad registration = %d %v", response.StatusCode, body)
	}
	clientID := h.register(map[string]any{"redirect_uris": []string{callback}, "client_name": "Claude", "token_endpoint_auth_method": "none"})

	// Untrusted redirect targets get an error page, never a redirect.
	bad := h.get("/oauth/authorize?" + url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {"https://evil.example/cb"}}.Encode())
	if bad.StatusCode != http.StatusBadRequest || bad.Header.Get("Location") != "" {
		t.Fatalf("unregistered redirect = %d %q", bad.StatusCode, bad.Header.Get("Location"))
	}
	// Registration is open, so even a registered redirect isn't followed until the user has seen the consent page.
	for name, query := range map[string]url.Values{
		"missing PKCE":          {"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {callback}, "state": {"s0"}},
		"missing response type": {"client_id": {clientID}, "redirect_uri": {callback}, "code_challenge": {challenge(verifier)}, "code_challenge_method": {"S256"}},
	} {
		response := h.get("/oauth/authorize?" + query.Encode())
		if response.StatusCode != http.StatusBadRequest || response.Header.Get("Location") != "" {
			t.Fatalf("%s = %d %q", name, response.StatusCode, response.Header.Get("Location"))
		}
	}

	requestID := h.authorize(clientID, callback, "s1")
	consent, err := authorization.ConsentRequest(ctx, requestID)
	if err != nil || consent.ClientName != "Claude" || consent.RedirectHost != "https://claude.ai" {
		t.Fatalf("consent = %+v, %v", consent, err)
	}
	code := h.approve(ownerID, requestID, oauth.DataLevelDetailed, "s1")
	if _, err := authorization.Approve(ctx, ownerID, requestID, oauth.DataLevelDetailed); !errors.Is(err, oauth.ErrNotFound) {
		t.Fatalf("second approval error = %v", err)
	}
	if response, body := h.postForm("/oauth/token", url.Values{"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {strings.Repeat("a", 43)}, "client_id": {clientID}}); response.StatusCode != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("wrong verifier = %d %v", response.StatusCode, body)
	}
	tokens := h.exchange(clientID, code)
	access, refresh := tokens["access_token"].(string), tokens["refresh_token"].(string)

	// The token reads only the approving user's data.
	session, err := h.session(access)
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "list_accounts"})
	if err != nil || result.IsError {
		t.Fatalf("list_accounts = %+v, %v", result, err)
	}
	listed, _ := json.Marshal(result.StructuredContent)
	if !strings.Contains(string(listed), ownerAccount.String()) || strings.Contains(string(listed), otherAccount.String()) {
		t.Fatalf("accounts = %s", listed)
	}
	detailed, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "get_portfolio_summary"})
	if err != nil || detailed.IsError {
		t.Fatalf("detailed summary = %+v, %v", detailed, err)
	}
	if encoded, _ := json.Marshal(detailed.StructuredContent); !strings.Contains(string(encoded), "owner Bank") {
		t.Fatalf("detailed summary lacks the institution: %s", encoded)
	}
	foreign, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "get_account", Arguments: map[string]any{"accountId": otherAccount.String()}})
	if err != nil || !foreign.IsError {
		t.Fatalf("foreign account = %+v, %v", foreign, err)
	}
	_ = session.Close()

	apps, err := authorization.ConnectedApps(ctx, ownerID)
	if err != nil || len(apps) != 1 || apps[0].ClientName != "Claude" || apps[0].DataLevel != "detailed" || len(apps[0].RecentCalls) != 3 {
		t.Fatalf("connected apps = %+v, %v", apps, err)
	}
	outcomes := apps[0].RecentCalls[0].Tool + ":" + apps[0].RecentCalls[0].Outcome + "," + apps[0].RecentCalls[1].Tool + ":" + apps[0].RecentCalls[1].Outcome
	if outcomes != "get_account:error,get_portfolio_summary:success" || apps[0].RecentCalls[2].Tool != "list_accounts" {
		t.Fatalf("recent calls = %s", outcomes)
	}
	grantID := apps[0].ID
	if others, _ := authorization.ConnectedApps(ctx, otherID); len(others) != 0 {
		t.Fatalf("another user sees connected apps: %+v", others)
	}
	if err := authorization.RevokeConnectedApp(ctx, otherID, grantID); !errors.Is(err, oauth.ErrNotFound) {
		t.Fatalf("foreign revoke error = %v", err)
	}
	if err := authorization.ClearToolCalls(ctx, otherID, grantID); !errors.Is(err, oauth.ErrNotFound) {
		t.Fatalf("foreign clear error = %v", err)
	}
	if err := authorization.ClearToolCalls(ctx, ownerID, grantID); err != nil {
		t.Fatal(err)
	}

	// Refresh tokens rotate; presenting a used one revokes the whole grant.
	response, rotated := h.postForm("/oauth/token", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {clientID}})
	if response.StatusCode != http.StatusOK || rotated["refresh_token"] == refresh {
		t.Fatalf("refresh = %d %v", response.StatusCode, rotated)
	}
	if h.mcpStatus(rotated["access_token"].(string)) != http.StatusOK {
		t.Fatal("rotated access token was rejected")
	}
	if response, body := h.postForm("/oauth/token", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {clientID}}); response.StatusCode != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("refresh reuse = %d %v", response.StatusCode, body)
	}
	if h.mcpStatus(rotated["access_token"].(string)) != http.StatusUnauthorized || h.mcpStatus(access) != http.StatusUnauthorized {
		t.Fatal("refresh reuse did not revoke the grant")
	}
	if apps, _ := authorization.ConnectedApps(ctx, ownerID); len(apps) != 0 {
		t.Fatalf("revoked grant still listed: %+v", apps)
	}

	// Summary access exposes only aggregate tools and drops institution and instrument names.
	summaryCode := h.approve(ownerID, h.authorize(clientID, callback, "s2"), oauth.DataLevelSummary, "s2")
	summaryTokens := h.exchange(clientID, summaryCode)
	summarySession, err := h.session(summaryTokens["access_token"].(string))
	if err != nil {
		t.Fatal(err)
	}
	tools, err := summarySession.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	if strings.Join(names, ",") != "get_cash_flow_report,get_income_report,get_portfolio_summary" {
		t.Fatalf("summary tools = %v", names)
	}
	summary, err := summarySession.CallTool(t.Context(), &mcp.CallToolParams{Name: "get_portfolio_summary"})
	if err != nil || summary.IsError {
		t.Fatalf("summary = %+v, %v", summary, err)
	}
	encoded, _ := json.Marshal(summary.StructuredContent)
	if strings.Contains(string(encoded), "owner Bank") || !strings.Contains(string(encoded), `"byInstitution":[]`) || !strings.Contains(string(encoded), `"decimal":"1500.50"`) {
		t.Fatalf("summary content = %s", encoded)
	}
	_ = summarySession.Close()

	// RFC 7009: revoking the refresh token ends the grant.
	if response, _ := h.postForm("/oauth/revoke", url.Values{"token": {summaryTokens["refresh_token"].(string)}, "client_id": {clientID}}); response.StatusCode != http.StatusOK {
		t.Fatalf("revoke = %d", response.StatusCode)
	}
	if h.mcpStatus(summaryTokens["access_token"].(string)) != http.StatusUnauthorized {
		t.Fatal("revoked grant's access token still works")
	}

	// A replayed authorization code revokes what it produced.
	replayCode := h.approve(ownerID, h.authorize(clientID, callback, "s3"), oauth.DataLevelDetailed, "s3")
	replayTokens := h.exchange(clientID, replayCode)
	if response, body := h.postForm("/oauth/token", url.Values{"grant_type": {"authorization_code"}, "code": {replayCode}, "code_verifier": {verifier}, "client_id": {clientID}}); response.StatusCode != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("code replay = %d %v", response.StatusCode, body)
	}
	if h.mcpStatus(replayTokens["access_token"].(string)) != http.StatusUnauthorized {
		t.Fatal("code replay did not revoke the grant")
	}

	// Confidential clients must authenticate as registered; disabled users lose access.
	response, confidential := h.postJSON("/oauth/register", map[string]any{"redirect_uris": []string{callback}, "client_name": "Server app"})
	if response.StatusCode != http.StatusCreated || confidential["token_endpoint_auth_method"] != "client_secret_basic" || confidential["client_secret"] == "" {
		t.Fatalf("confidential registration = %v", confidential)
	}
	confidentialID, secret := confidential["client_id"].(string), confidential["client_secret"].(string)
	confidentialCode := h.approve(ownerID, h.authorize(confidentialID, callback, "s4"), oauth.DataLevelDetailed, "s4")
	if response, body := h.postForm("/oauth/token", url.Values{"grant_type": {"authorization_code"}, "code": {confidentialCode}, "code_verifier": {verifier}, "client_id": {confidentialID}}); response.StatusCode != http.StatusUnauthorized || body["error"] != "invalid_client" {
		t.Fatalf("unauthenticated confidential exchange = %d %v", response.StatusCode, body)
	}
	response, confidentialTokens := h.postForm("/oauth/token", url.Values{"grant_type": {"authorization_code"}, "code": {confidentialCode}, "code_verifier": {verifier}}, confidentialID, secret)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("confidential exchange = %d %v", response.StatusCode, confidentialTokens)
	}
	if _, err := db.ExecContext(ctx, `UPDATE users SET status = 'disabled' WHERE id = $1`, ownerID); err != nil {
		t.Fatal(err)
	}
	if h.mcpStatus(confidentialTokens["access_token"].(string)) != http.StatusUnauthorized {
		t.Fatal("a disabled user's token still works")
	}
	if response, body := h.postForm("/oauth/token", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {confidentialTokens["refresh_token"].(string)}}, confidentialID, secret); response.StatusCode != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("disabled user refresh = %d %v", response.StatusCode, body)
	}
}

func TestPostgreSQLOAuthTokensAreBoundToTheMCPResource(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	ownerID, _ := seedUser(t, ctx, db, "owner", 100)
	authorization := oauth.NewService(db, oauth.Config{Issuer: issuer})
	registered, err := authorization.Register(ctx, oauth.ClientRegistration{RedirectURIs: []string{callback}, TokenEndpointAuthMethod: "none"})
	if err != nil {
		t.Fatal(err)
	}
	start, err := authorization.StartAuthorization(ctx, oauth.AuthorizeParams{
		ResponseType: "code", ClientID: registered.ClientID, RedirectURI: callback, CodeChallenge: challenge(verifier),
		CodeChallengeMethod: "S256", Resource: "https://other.example/mcp", State: "x",
	})
	var page *oauth.PageError
	if start != "" || !errors.As(err, &page) {
		t.Fatalf("foreign resource = %q, %v", start, err)
	}
	start, err = authorization.StartAuthorization(ctx, oauth.AuthorizeParams{
		ResponseType: "code", ClientID: registered.ClientID, RedirectURI: callback, CodeChallenge: challenge(verifier), CodeChallengeMethod: "S256",
	})
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(start)
	requestID := uuid.MustParse(parsed.Query().Get("request"))
	redirect, err := authorization.Approve(ctx, ownerID, requestID, oauth.DataLevelDetailed)
	if err != nil {
		t.Fatal(err)
	}
	code := strings.Split(strings.Split(redirect, "code=")[1], "&")[0]
	tokens, err := authorization.Token(ctx, oauth.TokenRequest{GrantType: "authorization_code", Code: code, CodeVerifier: verifier, Client: oauth.ClientCredentials{ClientID: registered.ClientID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authorization.VerifyAccessToken(ctx, tokens.AccessToken); err != nil {
		t.Fatalf("token for this deployment rejected: %v", err)
	}
	// The same token presented to a deployment with another resource identifier is rejected.
	elsewhere := oauth.NewService(db, oauth.Config{Issuer: "https://other.example"})
	if _, err := elsewhere.VerifyAccessToken(ctx, tokens.AccessToken); !errors.Is(err, oauth.ErrInvalidToken) {
		t.Fatalf("token accepted for another resource: %v", err)
	}
	if _, err := authorization.Approve(ctx, ownerID, uuid.New(), "everything"); !errors.Is(err, oauth.ErrInvalidChoice) {
		t.Fatalf("invalid data level error = %v", err)
	}
}
