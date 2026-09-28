package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

type Scope string

const (
	ScopePortfolioRead  Scope = "portfolio:read"
	ScopePortfolioWrite Scope = "portfolio:write"
	ScopeImportsWrite   Scope = "imports:write"
	ScopeExportsRead    Scope = "exports:read"
	ScopeAIInvoke       Scope = "ai:invoke"
)

var allowedScopes = map[Scope]bool{
	ScopePortfolioRead: true, ScopePortfolioWrite: true, ScopeImportsWrite: true,
	ScopeExportsRead: true, ScopeAIInvoke: true,
}

type APIKeyService struct {
	queries *generated.Queries
	now     func() time.Time
}

type APIKeyMetadata struct {
	ID            uuid.UUID  `json:"id"`
	Name          string     `json:"name"`
	DisplayPrefix string     `json:"prefix"`
	Scopes        []Scope    `json:"scopes"`
	CreatedAt     time.Time  `json:"createdAt"`
	ExpiresAt     *time.Time `json:"expiresAt"`
	LastUsedAt    *time.Time `json:"lastUsedAt"`
	RevokedAt     *time.Time `json:"revokedAt"`
}

type CreatedAPIKey struct {
	APIKeyMetadata
	Token string `json:"token"`
}

func NewAPIKeyService(queries *generated.Queries) *APIKeyService {
	return &APIKeyService{queries: queries, now: time.Now}
}

func (service *APIKeyService) Create(
	ctx context.Context,
	userID uuid.UUID,
	name string,
	scopes []Scope,
	expiresAt *time.Time,
) (CreatedAPIKey, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 {
		return CreatedAPIKey{}, errors.New("API key name must contain between 1 and 80 characters")
	}
	validatedScopes, err := validateScopes(scopes)
	if err != nil {
		return CreatedAPIKey{}, err
	}
	now := service.now().UTC()
	if expiresAt != nil && !expiresAt.After(now) {
		return CreatedAPIKey{}, errors.New("API key expiry must be in the future")
	}

	keyID := uuid.New()
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return CreatedAPIKey{}, fmt.Errorf("generate API key: %w", err)
	}
	secret := base64.RawURLEncoding.EncodeToString(secretBytes)
	token := "wbk_v1_" + keyID.String() + "_" + secret
	digest := sha256.Sum256([]byte(token))
	scopeJSON, err := json.Marshal(validatedScopes)
	if err != nil {
		return CreatedAPIKey{}, fmt.Errorf("encode API key scopes: %w", err)
	}

	params := generated.CreateAPIKeyParams{
		ID:            keyID,
		UserID:        userID,
		Name:          name,
		DisplayPrefix: "wbk_v1_" + keyID.String()[:8],
		TokenHash:     digest[:],
		Scopes:        scopeJSON,
		CreatedAt:     now,
	}
	if expiresAt != nil {
		params.ExpiresAt = sql.NullTime{Time: expiresAt.UTC(), Valid: true}
	}
	if err := service.queries.CreateAPIKey(ctx, params); err != nil {
		return CreatedAPIKey{}, fmt.Errorf("store API key: %w", err)
	}
	return CreatedAPIKey{
		APIKeyMetadata: APIKeyMetadata{
			ID: keyID, Name: name, DisplayPrefix: params.DisplayPrefix,
			Scopes: validatedScopes, CreatedAt: now, ExpiresAt: timePointer(params.ExpiresAt),
		},
		Token: token,
	}, nil
}

func (service *APIKeyService) List(ctx context.Context, userID uuid.UUID) ([]APIKeyMetadata, error) {
	rows, err := service.queries.ListAPIKeys(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list API keys: %w", err)
	}
	result := make([]APIKeyMetadata, 0, len(rows))
	for _, row := range rows {
		scopes, err := decodeScopes(row.Scopes)
		if err != nil {
			return nil, err
		}
		result = append(result, APIKeyMetadata{
			ID: row.ID, Name: row.Name, DisplayPrefix: row.DisplayPrefix, Scopes: scopes,
			CreatedAt: row.CreatedAt, ExpiresAt: timePointer(row.ExpiresAt),
			LastUsedAt: timePointer(row.LastUsedAt), RevokedAt: timePointer(row.RevokedAt),
		})
	}
	return result, nil
}

func (service *APIKeyService) Revoke(ctx context.Context, userID, keyID uuid.UUID) error {
	changed, err := service.queries.RevokeAPIKey(ctx, generated.RevokeAPIKeyParams{
		ID: keyID, UserID: userID, RevokedAt: sql.NullTime{Time: service.now().UTC(), Valid: true},
	})
	if err != nil {
		return fmt.Errorf("revoke API key: %w", err)
	}
	if changed != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (service *APIKeyService) RevokeAll(ctx context.Context, userID uuid.UUID) (int64, error) {
	changed, err := service.queries.RevokeAllAPIKeys(ctx, generated.RevokeAllAPIKeysParams{
		UserID: userID, RevokedAt: sql.NullTime{Time: service.now().UTC(), Valid: true},
	})
	if err != nil {
		return 0, fmt.Errorf("revoke all API keys: %w", err)
	}
	return changed, nil
}

func (service *APIKeyService) Authenticate(ctx context.Context, authorizationValues []string) (Principal, error) {
	if len(authorizationValues) != 1 || strings.Contains(authorizationValues[0], ",") {
		return Principal{}, ErrInvalidCredentials
	}
	parts := strings.Split(authorizationValues[0], " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return Principal{}, ErrInvalidCredentials
	}
	token := parts[1]
	tokenParts := strings.SplitN(token, "_", 4)
	if len(tokenParts) != 4 || tokenParts[0] != "wbk" || tokenParts[1] != "v1" {
		return Principal{}, ErrInvalidCredentials
	}
	keyID, err := uuid.Parse(tokenParts[2])
	if err != nil {
		return Principal{}, ErrInvalidCredentials
	}
	secret, err := base64.RawURLEncoding.DecodeString(tokenParts[3])
	if err != nil || len(secret) != 32 {
		return Principal{}, ErrInvalidCredentials
	}

	key, err := service.queries.GetAPIKeyForAuthentication(ctx, keyID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Principal{}, ErrInvalidCredentials
		}
		return Principal{}, err
	}
	digest := sha256.Sum256([]byte(token))
	if len(key.TokenHash) != len(digest) || subtle.ConstantTimeCompare(key.TokenHash, digest[:]) != 1 || key.UserStatus != "active" || key.RevokedAt.Valid || (key.ExpiresAt.Valid && !key.ExpiresAt.Time.After(service.now())) {
		return Principal{}, ErrInvalidCredentials
	}
	scopes, err := decodeScopes(key.Scopes)
	if err != nil {
		return Principal{}, ErrInvalidCredentials
	}
	now := service.now().UTC()
	if err := service.queries.TouchAPIKeyLastUsed(ctx, generated.TouchAPIKeyLastUsedParams{
		ID: key.ID, LastUsedAt: sql.NullTime{Time: now, Valid: true},
		LastUsedAt_2: sql.NullTime{Time: now.Add(-5 * time.Minute), Valid: true},
	}); err != nil {
		return Principal{}, fmt.Errorf("update API key usage: %w", err)
	}
	return Principal{UserID: key.UserID, Method: "api_key", KeyID: key.ID, Scopes: scopes}, nil
}

func (principal Principal) HasScope(scope Scope) bool {
	if principal.Method == "session" {
		return true
	}
	for _, granted := range principal.Scopes {
		if granted == scope {
			return true
		}
	}
	return false
}

func validateScopes(scopes []Scope) ([]Scope, error) {
	if len(scopes) == 0 {
		scopes = []Scope{ScopePortfolioRead}
	}
	seen := make(map[Scope]bool, len(scopes))
	validated := make([]Scope, 0, len(scopes))
	for _, scope := range scopes {
		if !allowedScopes[scope] || seen[scope] {
			return nil, errors.New("API key contains an invalid or duplicate scope")
		}
		seen[scope] = true
		validated = append(validated, scope)
	}
	return validated, nil
}

func decodeScopes(value json.RawMessage) ([]Scope, error) {
	var scopes []Scope
	if err := json.Unmarshal(value, &scopes); err != nil {
		return nil, fmt.Errorf("decode API key scopes: %w", err)
	}
	return validateScopes(scopes)
}

func timePointer(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	timestamp := value.Time.UTC()
	return &timestamp
}
