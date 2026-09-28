-- name: CreateAPIKey :exec
INSERT INTO api_keys (
    id,
    user_id,
    name,
    display_prefix,
    token_hash,
    scopes,
    created_at,
    expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ListAPIKeys :many
SELECT id, name, display_prefix, scopes, created_at, expires_at, last_used_at, revoked_at
FROM api_keys
WHERE user_id = $1
ORDER BY created_at DESC, id DESC;

-- name: GetAPIKeyForAuthentication :one
SELECT
    api_keys.id,
    api_keys.user_id,
    api_keys.token_hash,
    api_keys.scopes,
    api_keys.expires_at,
    api_keys.revoked_at,
    users.status AS user_status
FROM api_keys
JOIN users ON users.id = api_keys.user_id
WHERE api_keys.id = $1;

-- name: RevokeAPIKey :execrows
UPDATE api_keys
SET revoked_at = $3
WHERE id = $1
  AND user_id = $2
  AND revoked_at IS NULL;

-- name: RevokeAllAPIKeys :execrows
UPDATE api_keys
SET revoked_at = $2
WHERE user_id = $1
  AND revoked_at IS NULL;

-- name: TouchAPIKeyLastUsed :exec
UPDATE api_keys
SET last_used_at = $2
WHERE id = $1
  AND (last_used_at IS NULL OR last_used_at < $3);