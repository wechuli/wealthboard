package oauth

import (
	"encoding/json"
	"errors"
	"html/template"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/oauthex"

	"github.com/wechuli/wealthboard/internal/ratelimit"
)

const (
	maxFormBytes         = 16 << 10
	maxRegistrationBytes = 32 << 10
)

// Paths the application router must send to [Handler].
var Paths = []string{"/.well-known/*", "/oauth/authorize", "/oauth/token", "/oauth/register", "/oauth/revoke"}

// HandlerOptions sets request limits. Wealthboard rate-limits by socket peer
// address, which behind a reverse proxy is the proxy's, so per-address limits are
// a high backstop and the everyday limits are keyed by OAuth client.
type HandlerOptions struct {
	Now func() time.Time
	// RegistrationsPerHour limits client registration per peer address.
	RegistrationsPerHour int
	// ClientRequestsPerMinute limits authorization, token, and revocation requests per client.
	ClientRequestsPerMinute int
	// AddressRequestsPerMinute is the per-peer-address backstop for those endpoints.
	AddressRequestsPerMinute int
}

type Handler struct {
	service       *Service
	mux           *http.ServeMux
	registrations *ratelimit.Window
	clients       *ratelimit.Window
	addresses     *ratelimit.Window
}

func NewHandler(service *Service, options HandlerOptions) *Handler {
	if options.RegistrationsPerHour <= 0 {
		options.RegistrationsPerHour = 60
	}
	if options.ClientRequestsPerMinute <= 0 {
		options.ClientRequestsPerMinute = 120
	}
	if options.AddressRequestsPerMinute <= 0 {
		options.AddressRequestsPerMinute = 3000
	}
	handler := &Handler{
		service:       service,
		mux:           http.NewServeMux(),
		registrations: ratelimit.New(options.RegistrationsPerHour, time.Hour, options.Now),
		clients:       ratelimit.New(options.ClientRequestsPerMinute, time.Minute, options.Now),
		addresses:     ratelimit.New(options.AddressRequestsPerMinute, time.Minute, options.Now),
	}
	resource := auth.ProtectedResourceMetadataHandler(&oauthex.ProtectedResourceMetadata{
		Resource:               service.Resource(),
		AuthorizationServers:   []string{service.Issuer()},
		ScopesSupported:        []string{ScopePortfolioRead, ScopePortfolioWrite},
		BearerMethodsSupported: []string{"header"},
		ResourceName:           "Wealthboard",
	})
	handler.mux.Handle("/.well-known/oauth-protected-resource", resource)
	handler.mux.Handle("/.well-known/oauth-protected-resource/mcp", resource)
	handler.mux.HandleFunc("/.well-known/oauth-authorization-server", handler.metadata)
	handler.mux.HandleFunc("/.well-known/", func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "not_found"})
	})
	handler.mux.HandleFunc("/oauth/authorize", handler.authorize)
	handler.mux.HandleFunc("/oauth/token", handler.cors(handler.token))
	handler.mux.HandleFunc("/oauth/register", handler.cors(handler.register))
	handler.mux.HandleFunc("/oauth/revoke", handler.cors(handler.revoke))
	return handler
}

func (handler *Handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	handler.mux.ServeHTTP(response, request)
}

func clientIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return request.RemoteAddr
	}
	return host
}

func tooManyRequests(response http.ResponseWriter, wait time.Duration, page bool) {
	response.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	if page {
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		response.WriteHeader(http.StatusTooManyRequests)
		_ = errorPage.Execute(response, "Too many connection attempts. Wait a minute, then try again.")
		return
	}
	writeJSON(response, http.StatusTooManyRequests, &Error{Code: "invalid_request", Description: "too many requests; retry later"})
}

// limited applies the per-address backstop, then the per-client limit. Unknown or
// missing client IDs share one bucket so they can't bypass the client limit.
func (handler *Handler) limited(response http.ResponseWriter, request *http.Request, clientID string, page bool) bool {
	if allowed, wait := handler.addresses.Allow(clientIP(request)); !allowed {
		tooManyRequests(response, wait, page)
		return true
	}
	key := "client:" + clientID
	if len(clientID) > 64 || !strings.HasPrefix(clientID, clientIDPrefix) {
		key = "client:unknown"
	}
	if allowed, wait := handler.clients.Allow(key); !allowed {
		tooManyRequests(response, wait, page)
		return true
	}
	return false
}

// cors lets browser-based MCP clients call the token, registration, and revocation
// endpoints. They never use cookies, so any origin is safe.
func (handler *Handler) cors(next http.HandlerFunc) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Access-Control-Allow-Origin", "*")
		response.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		response.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		if request.Method != http.MethodPost {
			response.Header().Set("Allow", "POST, OPTIONS")
			writeJSON(response, http.StatusMethodNotAllowed, &Error{Code: "invalid_request", Description: "use POST"})
			return
		}
		next(response, request)
	}
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Pragma", "no-cache")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, err error) {
	var protocol *Error
	if errors.As(err, &protocol) {
		if protocol.Code == "invalid_client" {
			response.Header().Set("WWW-Authenticate", `Basic realm="wealthboard"`)
		}
		writeJSON(response, protocol.Status, protocol)
		return
	}
	writeJSON(response, http.StatusInternalServerError, &Error{Code: "server_error", Description: "the request could not be completed"})
}

type serverMetadata struct {
	Issuer                                   string   `json:"issuer"`
	AuthorizationEndpoint                    string   `json:"authorization_endpoint"`
	TokenEndpoint                            string   `json:"token_endpoint"`
	RegistrationEndpoint                     string   `json:"registration_endpoint"`
	RevocationEndpoint                       string   `json:"revocation_endpoint"`
	ScopesSupported                          []string `json:"scopes_supported"`
	ResponseTypesSupported                   []string `json:"response_types_supported"`
	ResponseModesSupported                   []string `json:"response_modes_supported"`
	GrantTypesSupported                      []string `json:"grant_types_supported"`
	TokenEndpointAuthMethodsSupported        []string `json:"token_endpoint_auth_methods_supported"`
	RevocationEndpointAuthMethodsSupported   []string `json:"revocation_endpoint_auth_methods_supported"`
	CodeChallengeMethodsSupported            []string `json:"code_challenge_methods_supported"`
	AuthorizationResponseIssParameterSupport bool     `json:"authorization_response_iss_parameter_supported"`
	ClientIDMetadataDocumentSupported        bool     `json:"client_id_metadata_document_supported"`
	ServiceDocumentation                     string   `json:"service_documentation,omitempty"`
	ProtectedResources                       []string `json:"protected_resources,omitempty"`
}

func (handler *Handler) metadata(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Access-Control-Allow-Origin", "*")
	if request.Method == http.MethodOptions {
		response.WriteHeader(http.StatusNoContent)
		return
	}
	issuer := handler.service.Issuer()
	methods := []string{"none", "client_secret_basic", "client_secret_post"}
	writeJSON(response, http.StatusOK, serverMetadata{
		Issuer: issuer, AuthorizationEndpoint: issuer + "/oauth/authorize", TokenEndpoint: issuer + "/oauth/token",
		RegistrationEndpoint: issuer + "/oauth/register", RevocationEndpoint: issuer + "/oauth/revoke",
		ScopesSupported: []string{ScopePortfolioRead, ScopePortfolioWrite}, ResponseTypesSupported: []string{"code"}, ResponseModesSupported: []string{"query"},
		GrantTypesSupported: []string{"authorization_code", "refresh_token"}, TokenEndpointAuthMethodsSupported: methods,
		RevocationEndpointAuthMethodsSupported: methods, CodeChallengeMethodsSupported: []string{"S256"},
		AuthorizationResponseIssParameterSupport: true, ClientIDMetadataDocumentSupported: false,
		ProtectedResources: []string{handler.service.Resource()},
	})
}

var errorPage = template.Must(template.New("error").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Can't connect this application · Wealthboard</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2328}h1{font-size:1.25rem}</style>
</head><body><h1>Can't connect this application</h1><p>{{.}}</p><p>Nothing was shared with it. Close this page and try connecting again from the application.</p></body></html>`))

func (handler *Handler) authorize(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodPost {
		response.Header().Set("Allow", "GET, POST")
		http.Error(response, "use GET", http.StatusMethodNotAllowed)
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxFormBytes)
	if err := request.ParseForm(); err != nil {
		renderErrorPage(response, "The request couldn't be read.")
		return
	}
	form := request.Form
	if handler.limited(response, request, form.Get("client_id"), true) {
		return
	}
	target, err := handler.service.StartAuthorization(request.Context(), AuthorizeParams{
		ResponseType: form.Get("response_type"), ClientID: form.Get("client_id"), RedirectURI: form.Get("redirect_uri"),
		CodeChallenge: form.Get("code_challenge"), CodeChallengeMethod: form.Get("code_challenge_method"),
		State: form.Get("state"), Scope: form.Get("scope"), Resource: form.Get("resource"),
	})
	var page *PageError
	if errors.As(err, &page) {
		renderErrorPage(response, page.Message)
		return
	}
	if err != nil {
		handler.service.logger.ErrorContext(request.Context(), "OAuth authorization request failed", "error", err)
		renderErrorPage(response, "Wealthboard couldn't start the connection. Try again later.")
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(response, request, target, http.StatusFound)
}

func renderErrorPage(response http.ResponseWriter, message string) {
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	response.WriteHeader(http.StatusBadRequest)
	_ = errorPage.Execute(response, message)
}

// readForm parses an application/x-www-form-urlencoded body and the client's
// credentials from either HTTP Basic authentication or the body.
func readForm(response http.ResponseWriter, request *http.Request) (url.Values, ClientCredentials, error) {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/x-www-form-urlencoded" {
		return nil, ClientCredentials{}, protocolError(400, "invalid_request", "send an application/x-www-form-urlencoded body")
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxFormBytes)
	if err := request.ParseForm(); err != nil {
		return nil, ClientCredentials{}, protocolError(400, "invalid_request", "the request body could not be read")
	}
	form := request.PostForm
	credentials := ClientCredentials{ClientID: form.Get("client_id"), ClientSecret: form.Get("client_secret")}
	if len(request.Header.Values("Authorization")) > 0 {
		id, secret, ok := request.BasicAuth()
		if !ok || form.Get("client_secret") != "" {
			return nil, ClientCredentials{}, errInvalidClient
		}
		decodedID, idErr := url.QueryUnescape(id)
		decodedSecret, secretErr := url.QueryUnescape(secret)
		if idErr != nil || secretErr != nil || (credentials.ClientID != "" && credentials.ClientID != decodedID) {
			return nil, ClientCredentials{}, errInvalidClient
		}
		credentials = ClientCredentials{ClientID: decodedID, ClientSecret: decodedSecret, Basic: true}
	}
	return form, credentials, nil
}

func (handler *Handler) token(response http.ResponseWriter, request *http.Request) {
	form, credentials, err := readForm(response, request)
	if err != nil {
		writeError(response, err)
		return
	}
	if handler.limited(response, request, credentials.ClientID, false) {
		return
	}
	tokens, err := handler.service.Token(request.Context(), TokenRequest{
		GrantType: form.Get("grant_type"), Code: form.Get("code"), RedirectURI: form.Get("redirect_uri"),
		CodeVerifier: form.Get("code_verifier"), RefreshToken: form.Get("refresh_token"), Resource: form.Get("resource"),
		Scope: form.Get("scope"), Client: credentials,
	})
	if err != nil {
		var protocol *Error
		if !errors.As(err, &protocol) {
			handler.service.logger.ErrorContext(request.Context(), "OAuth token request failed", "error", err)
		}
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, tokens)
}

func (handler *Handler) register(response http.ResponseWriter, request *http.Request) {
	if allowed, wait := handler.registrations.Allow(clientIP(request)); !allowed {
		tooManyRequests(response, wait, false)
		return
	}
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(response, protocolError(400, "invalid_client_metadata", "send client metadata as JSON"))
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxRegistrationBytes)
	var input ClientRegistration
	if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
		writeError(response, protocolError(400, "invalid_client_metadata", "client metadata must be a JSON object"))
		return
	}
	registered, err := handler.service.Register(request.Context(), input)
	if err != nil {
		var protocol *Error
		if !errors.As(err, &protocol) {
			handler.service.logger.ErrorContext(request.Context(), "OAuth client registration failed", "error", err)
		}
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, registered)
}

func (handler *Handler) revoke(response http.ResponseWriter, request *http.Request) {
	form, credentials, err := readForm(response, request)
	if err != nil {
		writeError(response, err)
		return
	}
	if handler.limited(response, request, credentials.ClientID, false) {
		return
	}
	if form.Get("token") == "" {
		writeError(response, protocolError(400, "invalid_request", "token is required"))
		return
	}
	if err := handler.service.Revoke(request.Context(), credentials, form.Get("token")); err != nil {
		var protocol *Error
		if !errors.As(err, &protocol) {
			handler.service.logger.ErrorContext(request.Context(), "OAuth revocation failed", "error", err)
		}
		writeError(response, err)
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)
}
