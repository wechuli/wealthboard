---
title: Go authentication and API keys
description: Configure local and OIDC authentication, reset passwords, and use personal API keys with the Go API.
---

# Go authentication and API keys

The replacement Go service supports `local`, `oidc`, and `local,oidc` authentication modes. Set `AUTH_METHODS` to exactly one of those values.

## Deployment secrets

Set a unique `SESSION_SECRET` containing at least 32 characters. OIDC deployments also require `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME`, and a base64-encoded 32-byte `OIDC_TRANSACTION_SECRET`.

Use HTTPS outside localhost development. Keep all secrets outside source control, images, logs, and command arguments.

OIDC-only readiness fails when an active user lacks an identity for the configured issuer or when provider discovery fails. Local-only readiness fails when an active user lacks a local password. Hybrid mode remains ready during a provider outage because local login remains available.

## Password reset

The operator reset command is available only when local authentication is enabled. It invalidates the target user's existing browser sessions by incrementing the session version.

```sh
NEW_USER_PASSWORD='replacement-password' \
DATABASE_URL='postgres://wealthboard:password@localhost:5433/wealthboard?sslmode=disable' \
go run ./cmd/wealthboard reset-password --username alice
```

Do not place the replacement password in command arguments.

## Personal API keys

API-key management requires a browser session, the exact trusted `Origin`, and the session's `X-CSRF-Token`. API keys cannot create, list, or revoke API keys and cannot manage passwords or OIDC methods.

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

The complete HTTP contract is maintained in `api/openapi.yaml`.
