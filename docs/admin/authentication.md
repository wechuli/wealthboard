---
title: Authentication
description: Choose local, OIDC, or hybrid authentication and migrate without duplicating portfolios.
---

# Authentication

`AUTH_METHODS` is deployment policy, read at startup.

| Value        | User experience                                                   |
| ------------ | ----------------------------------------------------------------- |
| `local`      | Username/password login and public local signup                   |
| `oidc`       | Provider login only; local signup and password login are disabled |
| `local,oidc` | Both methods; existing users can explicitly link the provider     |

The default is `local`.

## Local authentication

Local users choose a username, display name, base currency, and password. Signup
creates identity settings and categories, but no financial data.

An operator can reset an existing local password when local authentication is
enabled:

```bash
TARGET_USERNAME=alice \
NEW_USER_PASSWORD='choose-a-strong-temporary-password' \
npm run password:reset
```

Do not place the password in shell history on a shared machine. The reset
increments the user's session version and invalidates earlier sessions.

## OIDC configuration

When OIDC is enabled, configure:

- `APP_URL`
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_PROVIDER_NAME`
- `OIDC_TRANSACTION_SECRET` as a base64-encoded 32-byte key

The exact callback is:

```text
${APP_URL}/api/auth/oidc/callback
```

Wealthboard uses discovery, Authorization Code flow, PKCE S256, state, nonce,
RS256 verification, and remote JWKS rotation. It does not retain provider access
tokens, refresh tokens, ID tokens, authorization codes, or claim payloads.

See the detailed [OIDC provider configuration](../example/oidc_configuration)
for Keycloak-compatible setup and protocol verification.

## First provider login

A validated provider identity is resolved only by exact issuer and opaque
subject. If no mapping exists, Wealthboard provisions a new internal user with
settings and categories.

Email, display name, and username are never used to merge portfolios.

## Migrate existing local users safely

To move from local to provider-only authentication without duplicate portfolios:

1. Keep `AUTH_METHODS=local` while configuring the provider.
2. Change to `AUTH_METHODS=local,oidc` and restart.
3. Each existing user signs in with the local password.
4. In **Settings → Authentication methods**, confirm the password and link the
   provider.
5. Verify provider login returns to the same portfolio.
6. Repeat for every active user.
7. Change to `AUTH_METHODS=oidc` only after readiness confirms no user will be
   stranded.

::: danger Do not test provider login first for an existing user
The first unlinked provider login creates a separate internal user by design.
Claim-based merging is prohibited because it can enable account takeover.
:::

## Hybrid method management

Linking OIDC requires fresh local-password confirmation. Enabling or removing a
local credential for an OIDC user requires fresh provider reauthentication.
Users cannot remove the last usable method under the active deployment policy.

Every security-sensitive method change increments session version and
invalidates other Wealthboard sessions.

## Reverse proxy considerations

- Terminate TLS before traffic reaches Wealthboard.
- Set `APP_URL` to the exact browser-visible origin.
- Enable `TRUST_PROXY_HEADERS` only when a trusted ingress overwrites client-IP
  headers and direct access is blocked.
- Do not forward user-controlled `X-Forwarded-For` values unchanged.
