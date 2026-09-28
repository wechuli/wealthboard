-- name: GetUserByID :one
SELECT
    id,
    username,
    password_hash,
    status,
    session_version,
    last_login_at,
    created_at,
    updated_at
FROM users
WHERE id = $1;

-- name: GetLocalLoginUser :one
SELECT
        users.id,
        users.username,
        users.password_hash,
        users.status,
        users.session_version,
        user_settings.session_timeout_minutes
FROM users
JOIN user_settings ON user_settings.user_id = users.id
WHERE users.username = $1;

-- name: UpdateUserLastLogin :exec
UPDATE users
SET last_login_at = $2,
        updated_at = $2
WHERE id = $1;

-- name: GetActiveSessionUser :one
SELECT id, username, session_version
FROM users
WHERE id = $1
    AND status = 'active'
    AND session_version = $2;

-- name: CreateLocalUser :exec
INSERT INTO users (
        id,
        username,
        password_hash,
        status,
        session_version,
        last_login_at,
        created_at,
        updated_at
) VALUES ($1, $2, $3, 'active', 1, $4, $4, $4);

-- name: CreateOIDCUser :exec
INSERT INTO users (
        id,
        username,
        password_hash,
        status,
        session_version,
        last_login_at,
        created_at,
        updated_at
) VALUES ($1, $2, NULL, 'active', 1, $3, $3, $3);

-- name: UsernameExists :one
SELECT EXISTS(SELECT 1 FROM users WHERE username = $1);

-- name: CreateOIDCIdentity :exec
INSERT INTO oidc_identities (
        id,
        user_id,
        issuer,
        subject,
        created_at,
        updated_at,
        last_login_at
) VALUES ($1, $2, $3, $4, $5, $5, $5);

-- name: GetOIDCLoginUser :one
SELECT
        users.id,
        users.username,
        users.status,
        users.session_version,
        user_settings.session_timeout_minutes,
        oidc_identities.id AS identity_id
FROM oidc_identities
JOIN users ON users.id = oidc_identities.user_id
JOIN user_settings ON user_settings.user_id = users.id
WHERE oidc_identities.issuer = $1
        AND oidc_identities.subject = $2;

-- name: UpdateOIDCLogin :exec
UPDATE oidc_identities
SET last_login_at = $2,
        updated_at = $2
WHERE id = $1;

-- name: GetAuthMethodUser :one
SELECT
        users.id,
        users.username,
        users.password_hash,
        users.status,
        users.session_version,
        user_settings.session_timeout_minutes
FROM users
JOIN user_settings ON user_settings.user_id = users.id
WHERE users.id = $1
FOR UPDATE OF users;

-- name: GetOIDCIdentity :one
SELECT id, user_id, issuer, subject, created_at, updated_at, last_login_at
FROM oidc_identities
WHERE issuer = $1
        AND subject = $2;

-- name: GetUserOIDCIdentity :one
SELECT id, user_id, issuer, subject, created_at, updated_at, last_login_at
FROM oidc_identities
WHERE user_id = $1
        AND issuer = $2;

-- name: DeleteUserOIDCIdentity :execrows
DELETE FROM oidc_identities
WHERE id = $1
        AND user_id = $2;

-- name: IncrementSessionVersion :one
UPDATE users
SET session_version = session_version + 1,
        updated_at = $3
WHERE id = $1
        AND session_version = $2
RETURNING session_version;

-- name: EnableLocalCredential :one
UPDATE users
SET username = $3,
        password_hash = $4,
        session_version = session_version + 1,
        updated_at = $5
WHERE id = $1
        AND session_version = $2
        AND password_hash IS NULL
RETURNING session_version;

-- name: RemoveLocalCredential :one
UPDATE users
SET password_hash = NULL,
        session_version = session_version + 1,
        updated_at = $3
WHERE id = $1
        AND session_version = $2
        AND password_hash IS NOT NULL
RETURNING session_version;

-- name: CreateUserSettings :exec
INSERT INTO user_settings (
        id,
        user_id,
        display_name,
        base_currency,
        supported_currencies,
        timezone,
        created_at,
        updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $7);

-- name: CreateSystemCategory :exec
INSERT INTO categories (
        id,
        user_id,
        name,
        slug,
        icon,
        display_order,
        asset_or_liability,
        is_liquid,
        is_investible,
        is_archived,
        is_system,
        created_at,
        updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, TRUE, $10, $10);

-- name: GetPasswordUser :one
SELECT
                users.id,
                users.username,
                users.password_hash,
                users.status,
                users.session_version,
                user_settings.session_timeout_minutes
FROM users
JOIN user_settings ON user_settings.user_id = users.id
WHERE users.id = $1;

-- name: ChangeUserPassword :one
UPDATE users
SET password_hash = $3,
                session_version = session_version + 1,
                updated_at = $4
WHERE id = $1
        AND session_version = $2
RETURNING session_version;

-- name: GetPasswordResetUser :one
SELECT id, password_hash
FROM users
WHERE username = $1;

-- name: ResetUserPassword :one
UPDATE users
SET password_hash = $2,
                session_version = session_version + 1,
                updated_at = $3
WHERE id = $1
RETURNING session_version;

-- name: CountActiveUsersWithoutPassword :one
SELECT count(*)
FROM users
WHERE status = 'active'
        AND password_hash IS NULL;

-- name: CountActiveUsersWithoutOIDCIdentity :one
SELECT count(*)
FROM users
WHERE users.status = 'active'
        AND NOT EXISTS (
                        SELECT 1
                        FROM oidc_identities
                        WHERE oidc_identities.user_id = users.id
                                AND oidc_identities.issuer = $1
        );