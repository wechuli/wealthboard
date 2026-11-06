-- +goose Up
-- OAuth 2.1 authorization for the read-only MCP endpoint. Clients register
-- themselves (RFC 7591) and are not owned by a user; every grant, code, token,
-- and call-log row belongs to exactly one user through its grant. Secrets are
-- stored only as SHA-256 hashes.
CREATE TABLE oauth_clients (
    id UUID PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_secret_hash BYTEA,
    client_name TEXT NOT NULL,
    client_uri TEXT,
    redirect_uris JSONB NOT NULL,
    token_endpoint_auth_method TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT oauth_clients_client_id_unique UNIQUE (client_id),
    CONSTRAINT oauth_clients_auth_method_check CHECK (
        token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')
    ),
    CONSTRAINT oauth_clients_secret_check CHECK (
        (token_endpoint_auth_method = 'none') = (client_secret_hash IS NULL)
    ),
    CONSTRAINT oauth_clients_redirect_uris_check CHECK (jsonb_typeof(redirect_uris) = 'array')
);

CREATE TABLE oauth_authorization_requests (
    id UUID PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    state TEXT,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX oauth_authorization_requests_expires_idx ON oauth_authorization_requests (expires_at);

CREATE TABLE oauth_grants (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    data_level TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT oauth_grants_data_level_check CHECK (data_level IN ('detailed', 'summary'))
);
CREATE INDEX oauth_grants_user_idx ON oauth_grants (user_id, created_at DESC);
CREATE INDEX oauth_grants_client_idx ON oauth_grants (client_id);

CREATE TABLE oauth_authorization_codes (
    code_hash BYTEA PRIMARY KEY,
    grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);
CREATE INDEX oauth_authorization_codes_grant_idx ON oauth_authorization_codes (grant_id);

CREATE TABLE oauth_tokens (
    token_hash BYTEA PRIMARY KEY,
    grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT oauth_tokens_kind_check CHECK (kind IN ('access', 'refresh'))
);
CREATE INDEX oauth_tokens_grant_idx ON oauth_tokens (grant_id);
CREATE INDEX oauth_tokens_expires_idx ON oauth_tokens (expires_at);

CREATE TABLE oauth_tool_calls (
    id UUID PRIMARY KEY,
    grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT oauth_tool_calls_outcome_check CHECK (outcome IN ('success', 'error'))
);
CREATE INDEX oauth_tool_calls_grant_idx ON oauth_tool_calls (grant_id, created_at DESC);

-- +goose Down
DROP TABLE oauth_tool_calls;
DROP TABLE oauth_tokens;
DROP TABLE oauth_authorization_codes;
DROP TABLE oauth_grants;
DROP TABLE oauth_authorization_requests;
DROP TABLE oauth_clients;
