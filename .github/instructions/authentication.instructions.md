---
description: "Use when implementing or reviewing signup, login, logout, password changes, password reset, session cookies, route protection, or authentication rate limiting."
name: "Wealthboard Authentication"
applyTo: "lib/auth/**/*.ts, app/login/**/*.ts, app/login/**/*.tsx, app/signup/**/*.ts, app/signup/**/*.tsx, proxy.ts, lib/bootstrap.ts, scripts/reset-password.mjs"
---

# Identity and authentication

- Application users are independent internal identities; financial accounts are portfolio records. Authentication methods are deployment policy selected by `AUTH_METHODS=local`, `AUTH_METHODS=oidc`, or `AUTH_METHODS=local,oidc`, with `local` as the backward-compatible default. Do not introduce organizations, roles, invitations, shared portfolios, or cross-user sessions.
- Use an immutable UUID as the session subject. Normalize usernames to lowercase for lookup and uniqueness, but keep display names separate from authentication.
- Derive the current `userId` only from a verified server-side session. Never trust an owner ID from a form, URL, header, cookie other than the signed session, or imported payload.
- Expose `/signup`, local password login, password changes, and local credential creation only when local authentication is enabled. In OIDC-only mode, reject crafted local actions before parsing credentials and redirect `/signup` to `/login`.
- Local signup and validated OIDC first login are the only user-provisioning paths. OIDC provisioning is login-driven JIT provisioning, never a public registration form. Do not add environment-created identities, default credentials, setup users, invitations, or claim-based account merging.
- Create the user, settings, and categories atomically during local signup or OIDC JIT provisioning, but create no exchange rates, financial accounts, goals, or sample portfolio data.
- Do not add a previous-password field, ownership claim, recovery panel, or default user to signup.
- Sign cookies with the configured secret and keep them HTTP-only, Secure in production, SameSite=Strict, path-scoped to `/`, and explicitly expiring. Verify expiry, user status, and session version on every protected request.
- Keep OIDC transaction cookies distinct from application sessions, encrypted with the dedicated transaction secret, HTTP-only, Secure in production, SameSite=Lax, narrowly path-scoped, and short-lived. Never persist or log authorization codes, PKCE verifiers, provider tokens, transaction tokens, or verified claim payloads.
- Return the same local-login failure for an unknown username, a wrong password, and a user without a local credential. Rate-limit by normalized username plus client address and never log passwords, hashes, tokens, claims, or submitted sensitive values.
- Resolve OIDC identities only by canonical `(issuer, subject)`. Never link or merge by username, display name, email, `preferred_username`, or any other mutable provider claim. Explicit linking and credential changes require fresh authentication and increment `sessionVersion`.
- Password changes and operator resets increment only the target user's session version. The reset command identifies a user by username and reads the new password from an environment variable rather than command arguments.
- Protect mutations independently of route middleware. Return not found for foreign resources and clear user-specific client state on logout.
- Test the complete mode matrix, signup for the first and subsequent local users, OIDC JIT races, identity collisions, absence of alternate user-creation paths, case-insensitive username collisions, generic login errors, protocol validation, cookie attributes, expiry/replay, disabled users, per-user invalidation, rollout guards, and concurrent isolated users.
