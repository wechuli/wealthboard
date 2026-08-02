---
description: "Use when implementing or reviewing signup, login, logout, password changes, password reset, session cookies, route protection, authentication rate limiting, legacy identity claiming, or the singleton-to-multi-user identity migration."
name: "Worthboard Authentication"
applyTo: "lib/auth/**/*.ts, app/login/**/*.ts, app/login/**/*.tsx, app/signup/**/*.ts, app/signup/**/*.tsx, proxy.ts, lib/bootstrap.ts, scripts/reset-password.mjs"
---
# Identity and authentication

- Application users are independent local identities; financial accounts are portfolio records. Do not introduce organizations, roles, invitations, shared portfolios, or cross-user sessions.
- Use an immutable UUID as the session subject. Normalize usernames to lowercase for lookup and uniqueness, but keep display names separate from authentication.
- Derive the current `userId` only from a verified server-side session. Never trust an owner ID from a form, URL, header, cookie other than the signed session, or imported payload.
- Keep `/signup` publicly available at all times. It is the only user-creation path; do not add a signup mode, environment-created identity, default credential, setup user, invitation, or first-user bootstrap.
- Create the user, settings, categories, and exchange rates atomically during signup, but create no financial accounts or sample portfolio data.
- Preserve the existing password hash and data as a temporary single-use legacy claim. Its owner must verify the previous password and choose a username through signup; never create or name that user automatically.
- Sign cookies with the configured secret and keep them HTTP-only, Secure in production, SameSite=Strict, path-scoped to `/`, and explicitly expiring. Verify expiry, user status, and session version on every protected request.
- Return the same login failure for an unknown username and a wrong password. Rate-limit by normalized username plus client address and never log passwords, hashes, tokens, or submitted sensitive values.
- Password changes and operator resets increment only the target user's session version. The reset command identifies a user by username and reads the new password from an environment variable rather than command arguments.
- Protect mutations independently of route middleware. Return not found for foreign resources and clear user-specific client state on logout.
- Test signup for the first and subsequent users, absence of alternate user-creation paths, case-insensitive username collisions, generic login errors, cookie attributes, expiry, disabled users, per-user invalidation, concurrent users, and legacy claiming through signup.