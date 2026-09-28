---
title: Go authentication and API keys
description: Configure local and OIDC authentication, reset passwords, and use personal API keys with the Go API.
---

# Go authentication and API keys

The Go service supports `local`, `oidc`, and `local,oidc` authentication modes.
`AUTH_METHODS` defaults to `local`; when set, use exactly one of those values.

## Deployment secrets

Set a unique `SESSION_SECRET` containing at least 32 characters. OIDC deployments also require `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME`, and a base64-encoded 32-byte `OIDC_TRANSACTION_SECRET`.

Use HTTPS outside localhost development. Keep all secrets outside source control, images, logs, and command arguments.

OIDC-only readiness fails when an active user lacks an identity for the configured issuer or when provider discovery fails. Local-only readiness fails when an active user lacks a local password. Hybrid mode remains ready during a provider outage because local login remains available.

The callback is `${APP_URL}/api/v1/auth/oidc/callback`. Authentication readiness
is evaluated at `/api/health/ready`, not as a pre-listen startup gate.

## Browser requests

Login and signup require an `Origin` exactly matching `APP_URL`. On successful
authentication, the server sets an HTTP-only session cookie and returns a
`csrfToken`. `GET /api/v1/session` also returns that token for browser bootstrap.
Authenticated browser mutations send it as `X-CSRF-Token` alongside the trusted
origin. The Vite API client handles this automatically.

The public HTML/JavaScript shell contains no private portfolio data. Each
private API handler validates the session or supported API-key principal
independently of client-side route protection.

## Password reset

The operator reset command is available only when local authentication is enabled. It invalidates the target user's existing browser sessions by incrementing the session version.

```sh
NEW_USER_PASSWORD='replacement-password' \
DATABASE_URL='postgres://wealthboard:password@localhost:5433/wealthboard?sslmode=disable' \
go run ./cmd/wealthboard reset-password --username alice
```

Do not place the replacement password in command arguments.

## Personal API keys

API-key management requires a browser session. Creating and revoking keys also
require the exact trusted `Origin` and the session's `X-CSRF-Token`; listing is
a session-authenticated GET. API keys cannot create, list, or revoke API keys,
manage passwords or OIDC methods, or perform a user restore.

The management endpoints are `GET`/`POST /api/v1/api-keys`,
`DELETE /api/v1/api-keys/{id}`, and `POST /api/v1/api-keys/revoke-all`.

Creation returns the complete token once. Store it immediately; later listings contain only metadata and the non-secret prefix. New keys default to `portfolio:read` when scopes are omitted.

Available scopes are:

- `portfolio:read`
- `portfolio:write`
- `imports:write`
- `exports:read`
- `ai:invoke`

External clients send the token in the Authorization header:

```sh
curl --fail-with-body \
  -H 'Authorization: Bearer wbk_v1_<key-id>_<secret>' \
  https://wealthboard.example/api/v1/auth/principal
```

The API never accepts keys in URLs, cookies, or request bodies. If an Authorization header is present but invalid, the server does not fall back to a browser cookie. Revocation is immediate, expired keys are rejected, and disabled users cannot authenticate with their keys.

PostgreSQL stores only a SHA-256 token hash and metadata, not the usable secret.
API-key revocation is separate from password changes and browser session-version
invalidation. User exports exclude key records; deployment-wide backups include
their hashes and metadata.

The complete HTTP contract is maintained in
[`api/openapi.yaml`](https://github.com/wechuliprojects/wealthboard/blob/main/api/openapi.yaml).
