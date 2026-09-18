# Wealthboard migration brief: React/Vite frontend and Go API

## Instructions to the implementation agent

You are migrating the existing repository at `https://github.com/wechuli/wealthboard` from a single-process Next.js App Router application to a client-rendered React/Vite application backed by an explicit Go HTTP API.

This is a compatibility-preserving migration of a mature financial application. It is not a greenfield rewrite. Read the repository instructions, `SPEC.md`, `docs/ARCHITECTURE.md`, the existing services, schema, migrations, and nearby tests before changing behavior. The product and financial invariants in those files remain authoritative except where this brief explicitly replaces the runtime architecture.

Work on a dedicated branch such as `feat/go-vite-architecture`. Use small, reviewable commits. Maintain a running migration checklist in the pull request or a checked-in migration document. Do not delete the Next.js implementation until the replacement passes the required parity, isolation, migration, and end-to-end tests.

When the repository has changed since this brief was written, inspect the latest `main` branch and adapt the file inventory while preserving the decisions and acceptance criteria below.

## Objective

Replace the production Next.js/Node.js server with:

- A client-side React application built by Vite.
- A Go HTTP API using `github.com/go-chi/chi/v5` and ordinary `net/http` middleware.
- `sqlc` for typed database access.
- Goose for append-only SQLite migrations.
- The existing SQLite database and existing persisted user data.
- A versioned JSON API used by both the browser application and external clients.
- Personal API keys that let a user query their own portfolio without using the frontend.
- A production image with no Node.js runtime. Node may exist only in the frontend build stage.

The resulting production request path is:

```text
Browser or API client
        |
        v
Ingress / TLS
        |
        v
Go process (Chi)
  |-- /api/v1/*       JSON API
  |-- /api/health/*   probes
  `-- /*              embedded Vite files and SPA fallback
        |
        v
SQLite
```

React must never execute on the server. There must be no React Server Components, Server Actions, Next.js image optimizer, Node production process, or server-side JavaScript request handler.

## Existing product that must be preserved

The current application is a self-hosted, multi-user wealth and goals tracker. Preserve its implemented behavior, including:

- Local, OIDC-only, and hybrid authentication selected by deployment configuration.
- Independent users with strict owner isolation and no organizations, teams, invitations, shared portfolios, or cross-user transfers.
- Balance-tracked and position-tracked financial accounts.
- Categories, institutions, transactions, valuations, transfers, goals, milestones, exchange rates, investment instruments, position events, prices, reconciliations, analytics, imports, exports, restores, AI review, and estate planning.
- PWA and offline-safe behavior without caching authenticated financial responses or queuing financial mutations.
- User-level JSON portability and CSV exports.
- Operator-only SQLite backup and offline restore.
- Current local-password and OIDC linking/unlinking rules.
- Existing responsive layouts and visual design at 360, 390, 768, 1024, and 1440 pixels.

The current schema contains at least these tables and they must retain their data and semantics:

```text
users
oidc_identities
user_settings
categories
institutions
accounts
investment_instruments
account_conversions
position_events
security_prices
position_reconciliations
transactions
valuation_snapshots
exchange_rates
goals
goal_contribution_plans
goal_milestones
goal_alert_dismissals
beneficiaries
estate_plans
estate_account_directives
estate_allocations
estate_residuary_allocations
estate_plan_snapshots
login_attempts
idempotency_keys
ai_provider_settings
ai_usage_events
```

Inventory `app/`, `app/api/`, `lib/services/`, `lib/auth/`, `scripts/`, and the full test suite before implementation. Every existing Server Action and route handler must be mapped to a Go endpoint, a Go operator command, or an explicitly documented removal approved by the owner.

## Non-negotiable domain invariants

### Ownership and authorization

- Derive the application user ID only from a verified browser session or verified API key.
- Never accept `userId`, owner ID, username, or account ownership from URL parameters, request bodies, imports, or arbitrary headers as authorization evidence.
- Every private query must include the owner predicate in SQL, normally `WHERE user_id = ? AND id = ?`.
- Return `404` for a foreign resource rather than revealing that it exists.
- Validate related resources belong to the same user inside the same database transaction.
- Every authorization-sensitive test must use at least two users and include a negative cross-user assertion.

### Financial correctness

- Store money as integer minor units. Use Go `int64` internally only after validating the persisted and requested value fits the supported range.
- Serialize minor-unit values in JSON as decimal strings to avoid JavaScript precision loss.
- Store exchange rates, quantities, unit prices, and ratios as canonical decimal strings.
- Never use `float32` or `float64` for authoritative financial arithmetic.
- Use a reviewed arbitrary-precision decimal implementation or `math/big` for decimal calculations. Centralize rounding rules and reproduce the existing Decimal.js behavior, including half-up rounding when converting to minor units.
- Preserve effective-dated exchange-rate selection. Historical calculations may not silently use the current rate.
- Preserve transaction sign behavior, balance replay ordering, and valuation semantics. A valuation sets an absolute balance and is not a contribution.
- Editing or deleting a transaction or valuation must replay the affected balance.
- Transfers must create both sides atomically with the existing transfer group and idempotency semantics, without changing net worth.
- Opening balances and transfers must remain reserved workflows rather than ordinary transaction types.
- Position quantities are replayed from ordered events. Reject every mutation, correction, restore, or import that produces a negative position.
- Grouped position/cash events and corporate actions must commit atomically.
- Imported external IDs remain case-sensitive and scoped to the owning user and account. Identical events may be skipped; conflicts must never overwrite data.
- Preserve current archive behavior and foreign-key restrictions.

### Dates, privacy, and secrets

- Store timestamps in UTC and display dates in the user's configured timezone.
- Preserve value-hiding behavior throughout the frontend, including charts, tooltips, tables, print views, and cached client state.
- Do not log passwords, hashes, sessions, API keys, OIDC codes/tokens/claims, remembered AI keys, request bodies containing financial data, exports, backups, or document contents.
- Database errors returned to clients must be normalized and must not expose SQL or internal paths.

## Target repository layout

Use a layout close to the following. Adjust names when repository conventions justify it, but keep the boundaries:

```text
cmd/
  wealthboard/
    main.go
internal/
  api/
    router.go
    handlers/
    middleware/
    problem/
  auth/
  config/
  database/
    generated/          # sqlc output; never hand edit
  domain/
  service/
  importworker/
  portability/
  static/
db/
  migrations/           # Goose SQL migrations
  queries/              # sqlc named queries
  schema.sql             # sqlc schema input/current schema
web/
  src/
    api/
    auth/
    components/
    features/
    pages/
    routes/
  public/
  package.json
  vite.config.ts
api/
  openapi.yaml
sqlc.yaml
go.mod
Dockerfile
```

Keep business rules in Go services. HTTP handlers should authenticate, decode and validate input, call a service, and encode a response. Handlers must not reproduce financial calculations or issue ad hoc SQL. Generated sqlc code is the only ordinary database access layer; carefully reviewed custom SQL may live in `db/queries`.

## Go backend decisions

### HTTP server

- Use Chi v5 and the standard library HTTP server.
- Configure explicit read-header, read, write, idle, and graceful-shutdown timeouts.
- Add request IDs, structured logs, panic recovery, body-size limits, content-type checks, and route-specific rate limits.
- Do not use Chi's deprecated `RealIP` middleware. Trust forwarded client information only from explicitly configured ingress proxy addresses and only after the ingress overwrites client-supplied forwarding headers.
- Do not expose `pprof`, debug routes, migration operations, raw database backup, or restore on the public router.
- Use a stable error format based on `application/problem+json`. Expected validation failures must include safe field errors; internal errors receive an opaque request ID.
- Use `/api/v1` for product API endpoints. Keep `/api/health/live` and `/api/health/ready` for operational probes.
- Return JSON from the API even when the caller is the React application. Redirects are appropriate only during browser OIDC flows.

### Database

- Continue using SQLite in WAL mode with foreign keys enabled and a configured busy timeout.
- Prefer `database/sql` with a maintained SQLite driver that works in the final minimal container. A pure-Go driver is preferred unless compatibility testing shows a concrete reason to use CGO.
- Configure connection counts deliberately for SQLite. Do not allow an unbounded write pool.
- Use sqlc-generated queries and explicit transactions.
- Run `PRAGMA foreign_key_check` in migration tests and operator diagnostics.
- Preserve the existing database path and volume contract unless a documented compatibility alias is provided.

### Migrations and existing databases

Goose becomes the migration authority after cutover, but existing production databases must be adopted without data loss.

Implement and test both paths:

1. **Fresh database:** Goose applies a reviewed baseline schema and all later migrations.
2. **Existing Wealthboard database:** an explicit adoption procedure verifies the known Drizzle migration history and expected schema before recording the Goose baseline as applied. It must not rerun `CREATE TABLE` statements against existing tables.

Rules:

- Preserve the existing Drizzle SQL migrations and metadata under an archival path for provenance. Do not rewrite or delete applied history.
- Generate a reviewed `schema.sql` that reflects the current schema exactly before adding new tables.
- Refuse automatic adoption when the database is non-empty but does not match a known schema/migration state.
- Back up the database before first Goose adoption.
- Perform adoption and the first Goose migration transactionally where SQLite permits.
- Add only backward-compatible schema changes during the migration. The old application should still be able to read the database until cutover is accepted.
- Test upgrade from a copy at every supported historical migration state, or at minimum every state currently covered by the repository migration tests.
- Validate row counts, important aggregates, migration version, foreign keys, and representative exports after migration.
- Never use `CREATE TABLE IF NOT EXISTS` as a substitute for verifying schema compatibility.

### Commands

The Go binary should provide explicit operator subcommands rather than shell scripts in the runtime image:

```text
wealthboard serve
wealthboard migrate
wealthboard migrate-status
wealthboard migrate-adopt
wealthboard backup
wealthboard restore --file <path> --confirm-offline
wealthboard reset-password --username <name>   # new password from stdin or env, never argv
wealthboard seed-demo --username <name>
```

`serve` may run safe pending migrations at startup only after migration/adoption behavior is fully tested. Destructive restore remains offline and must refuse to run while the server is active.

## Authentication

### Browser sessions

Preserve local, OIDC-only, and hybrid deployment modes and all current readiness protections.

- Keep the cookie name compatible where practical.
- Use a signed, expiring, HTTP-only, Secure-in-production, `SameSite=Strict`, path `/` browser session.
- Verify user status and `session_version` on every authenticated request.
- Password and authentication-method changes increment `session_version` and invalidate other sessions.
- Continue to normalize usernames only for lookup and uniqueness.
- Return the same login error for unknown users, wrong passwords, and accounts without a local credential.
- Preserve current password-hash compatibility so existing users can sign in without resetting passwords. Rehash on successful login if the selected Go password implementation requires an upgrade.
- Preserve exact `(issuer, subject)` OIDC identity resolution. Never merge users by email, username, display name, or other mutable claim.
- Preserve Authorization Code flow, PKCE S256, state, nonce, exact issuer and audience validation, bounded discovery/token/JWKS operations, and RS256 verification.
- Do not store provider access tokens, authorization codes, PKCE verifiers, or claim payloads.
- Maintain current rollout checks that prevent an auth-mode change from stranding active users.

For cookie-authenticated state-changing requests, require a valid trusted `Origin` and a session-bound CSRF token supplied in a custom header. `SameSite` cookies are an additional control, not the only CSRF check. API-key requests are not subject to browser CSRF checks because credentials are sent explicitly in the Authorization header.

### Personal API keys

Implement personal API keys as a first-class authentication method for external scripts and integrations.

#### Key lifecycle

- A user creates, lists, and revokes their own keys from the authenticated Settings UI.
- Key creation and revocation require a browser session. API keys may never create, rotate, list, or revoke API keys.
- Display the complete secret exactly once at creation. Subsequent listings show only name, prefix, scopes, creation time, expiry, last-used time, and revocation state.
- Support an optional expiry. Encourage expiry in the UI; allow no-expiry only as a deliberate selection.
- Revocation takes effect immediately.
- Incrementing a user's session version does not silently revoke API keys; provide an explicit “revoke all API keys” operation for password compromise or account lockdown.
- Disabling a user invalidates both sessions and API keys.

#### Token format and storage

Use a recognizable versioned format with a non-secret lookup identifier and at least 256 bits of random secret material, for example:

```text
wbk_v1_<key-id>_<base64url-random-secret>
```

Generate randomness with `crypto/rand`. Store only:

- Key ID.
- Owning user ID.
- User-selected name.
- Non-secret display prefix.
- SHA-256 hash of the complete presented token, or an equivalently reviewed keyed hash.
- Scopes.
- Created, expiry, last-used, and revoked timestamps.

Because the secret is uniformly random and high entropy, a fast cryptographic hash is appropriate; password hashing is unnecessary. Compare hashes in constant time. Never store or log the plaintext token. Never accept API keys in URLs, query strings, cookies, or request bodies.

Add an `api_keys` table with a user foreign key, unique lookup identifier, unique token hash, explicit scope representation, and indexes needed for authentication and per-user listing. Keep the representation simple and auditable; if scopes are stored as JSON/text, parse using a strict allowlist and reject unknown values.

#### Request authentication

External clients send:

```http
Authorization: Bearer wbk_v1_...
```

Authentication behavior:

- If an Authorization header is present, authenticate it as an API key and do not fall back to a browser cookie when it is invalid.
- If no Authorization header is present, use the browser session cookie.
- Reject requests that attempt ambiguous or multiple Authorization credentials.
- Attach an internal principal containing `userID`, authentication method, key ID where applicable, and granted scopes.
- Update `last_used_at` asynchronously or at a bounded interval so every API call does not create a database write.
- Rate-limit API clients by key ID and endpoint class. Never rate-limit solely by a spoofable forwarding header.

#### Initial scopes

Implement these explicit scopes:

```text
portfolio:read    Read accounts, transactions, positions, goals, reports,
                  settings needed to interpret values, and other portfolio data.
portfolio:write   Create and update ordinary portfolio records.
imports:write     Preview and commit supported imports.
exports:read      Download the owning user's supported exports.
ai:invoke         Invoke an already configured AI review/conversion operation.
```

Rules:

- New keys default to `portfolio:read` only.
- `portfolio:write` does not automatically grant import, export, or AI scopes.
- A key's effective access is the intersection of its scopes and the user's normal ownership permissions.
- API keys can never change passwords, link/unlink OIDC, enable/remove local credentials, manage remembered AI credentials, manage API keys, operate deployment backups/restores, or access another user.
- Destructive portfolio endpoints require `portfolio:write` and the same explicit confirmation or idempotency protections used by the UI.
- Document every endpoint's required scope in OpenAPI.

#### API-key endpoints

Provide browser-session-only management endpoints:

```text
GET    /api/v1/api-keys
POST   /api/v1/api-keys
DELETE /api/v1/api-keys/{id}
POST   /api/v1/api-keys/revoke-all
```

The creation response may contain the one-time plaintext secret. All other responses must never contain it or its hash.

## API design

Create and maintain `api/openapi.yaml` using OpenAPI 3.1. Treat it as the HTTP contract. Generate TypeScript API types for the frontend during development/build and verify generation produces no uncommitted drift. Do not generate domain/business logic.

At minimum, map current features to versioned resources resembling:

```text
/api/v1/auth/*
/api/v1/session
/api/v1/api-keys
/api/v1/settings
/api/v1/categories
/api/v1/institutions
/api/v1/accounts
/api/v1/accounts/{id}/transactions
/api/v1/accounts/{id}/valuations
/api/v1/accounts/{id}/positions
/api/v1/accounts/{id}/prices
/api/v1/accounts/{id}/reconciliations
/api/v1/accounts/{id}/imports/*
/api/v1/transfers
/api/v1/instruments
/api/v1/goals
/api/v1/reports/*
/api/v1/estate/*
/api/v1/ai/*
/api/v1/exports/*
/api/v1/restore/user
```

The exact routes should follow a written inventory of existing pages, Server Actions, route handlers, and service functions. Avoid RPC-shaped endpoints when a clear resource exists, but preserve atomic domain commands such as transfer, account conversion, stock split, merger, spinoff, dividend reinvestment, preview/commit import, and user restore.

API rules:

- Use UUID resource IDs exactly as the existing application does.
- Use ISO `YYYY-MM-DD` strings for financial dates and RFC 3339 UTC strings for timestamps.
- Use strings for minor units and arbitrary-precision decimals in JSON.
- Use cursor pagination for potentially large activity/event collections.
- Accept a standard `Idempotency-Key` header for supported mutations. Preserve compatibility with existing stored idempotency records and reject reuse with a different payload.
- Enforce strict JSON decoding, reject unknown fields on mutation requests, and cap body sizes by route.
- Require explicit multipart limits for document imports. Do not buffer an unbounded upload in memory.
- Set `Cache-Control: no-store` on authenticated financial and authentication responses.
- Do not enable permissive CORS. Same-origin browser access requires no CORS. If cross-origin API use is later needed, add an exact operator-controlled allowlist.

## Frontend migration

Move the existing React UI into `web/` and build it with Vite.

- Retain React, React Hook Form, Zod for client-side UX validation, Recharts, Radix primitives, Lucide icons, existing CSS tokens, privacy controls, and responsive behavior where practical.
- Use a maintained client-side router such as React Router.
- Use a small explicit API client generated or typed from OpenAPI. Centralize credentials, CSRF headers, error decoding, request cancellation, and logout handling.
- A frontend Zod check improves user feedback but is not authoritative. Go must independently validate every request.
- Replace Server Component data reads with API queries.
- Replace Server Actions with API mutations.
- Do not put `userId` into mutation bodies for authorization.
- Clear all user-specific query caches and in-memory state on logout and before rendering a different user's session.
- Preserve accessible labels, keyboard interaction, focus handling, pending states, field errors, destructive confirmations, and mobile layouts.
- Preserve the PWA shell but never cache `/api/`, authenticated documents, exports, OIDC responses, or financial mutations. Do not queue mutations for background replay.
- Serve images as ordinary reviewed static assets. Do not introduce a runtime image optimizer.

The Go server should embed `web/dist` using `go:embed` or serve it from a read-only directory. For non-API routes that are not static assets, return the SPA entry document. Never apply SPA fallback to `/api/*`; unknown API paths must return JSON `404`.

## Import and document-processing boundary

The current application parses CSV, TSV, JSON, XLSX, text PDFs, and DOCX, and optionally sends user-approved extracted text to an AI provider. This is a high-risk input boundary.

Do not block the main migration by carelessly rewriting every parser. Choose and document one of these safe implementations:

1. Port parsing to reviewed Go libraries and keep it in a separately constrained worker process; or
2. Temporarily retain a minimal Node extraction worker containing only the required parsers, with no HTTP ingress, no SQLite access, no application secrets, no Kubernetes token, a read-only filesystem, strict CPU/memory/time/file limits, and tightly restricted egress.

The Go API owns authentication, upload limits, consent, job creation, result validation, and database commits. The parser receives only the uploaded bytes and one-time document password where applicable. It returns bounded extracted text/sections. Original documents and passwords must not be persisted or sent to AI providers. Preserve the existing 5 MB source and 64 KB/1,000-section extraction limits unless the specification is deliberately revised.

AI provider calls must retain fixed/allowlisted endpoints, redirect blocking, bounded timeouts, no automatic retries, token budgets, strict response validation, and owner-scoped usage records. API keys with `ai:invoke` may invoke configured operations but may not retrieve remembered provider credentials.

## Static assets and production container

Use a multi-stage build:

1. Node build stage installs exact frontend dependencies and runs the Vite build.
2. Go build stage runs sqlc drift checks/tests and builds the application.
3. Final image contains the Go executable, required CA certificates/timezone data, and no Node runtime, npm, compiler, package manager, shell, curl, or wget where the selected minimal base permits this.

Run as an explicit non-root UID/GID with:

- Read-only root filesystem.
- Writable mounts only for `/data`, `/backups`, and a bounded temporary directory if required.
- `allowPrivilegeEscalation: false`.
- All Linux capabilities dropped.
- Runtime-default seccomp.
- `automountServiceAccountToken: false`.
- One replica and `Recreate` while SQLite uses a ReadWriteOnce volume.

Pin production images by immutable digest in deployment configuration. Add default-deny ingress and egress policies. Permit only DNS, configured OIDC endpoints, configured AI endpoints, and any explicitly required internal services. Block link-local metadata addresses.

## Migration phases

### Phase 0: establish a safe baseline

- Patch the current Next.js and React versions before exposing the old application.
- Run the full existing suite and record the passing baseline.
- Inventory pages, actions, route handlers, services, tables, environment variables, migrations, scripts, and observable user workflows.
- Create representative fictional golden fixtures and exports from the current implementation.
- Document known current failures rather than silently encoding them as new behavior.

### Phase 1: Go foundation and database adoption

- Add the Go module, configuration loader, structured logging, graceful server, health routes, Goose, sqlc, SQLite configuration, and operator commands.
- Produce the exact baseline schema and database adoption procedure.
- Add the `api_keys` migration.
- Verify fresh database creation and upgrade of copied existing databases.
- Add deterministic Go unit tests for money, transaction effects, balance replay, exchange-rate selection/conversion, date handling, goal calculations, and position replay using parity fixtures from TypeScript.

### Phase 2: authentication and API keys

- Implement local signup/login/logout, session verification, rate limiting, password changes/reset, mode policy, and CSRF.
- Implement OIDC discovery/login/callback/link/unlink with existing semantics.
- Implement API-key creation, one-time display, authentication, scopes, expiry, last-used metadata, and revocation.
- Add two-user and two-key isolation tests, including invalid, expired, revoked, disabled-user, missing-scope, and foreign-resource cases.

### Phase 3: read API and React shell

- Implement current-user, settings, categories, institutions, accounts, dashboard, goals, reports, estate, investment, and activity read endpoints.
- Set up Vite, client routing, generated API types, session bootstrap, privacy state, theme, app shell, and error boundaries.
- Port read-only pages and compare them with existing screenshots and golden API results.

### Phase 4: ordinary mutations

- Port settings, category, institution, account, transaction, valuation, goal, milestone, exchange-rate, instrument, price, and reconciliation mutations.
- Preserve idempotency, atomicity, owner checks, archive restrictions, and balance/position replay.
- Port transfers and account conversion only after their parity tests pass.

### Phase 5: advanced workflows

- Port corporate actions, investment imports, account-history imports, portability, estate snapshots, AI review, AI conversion, password-protected document extraction, user restore, operator backup/restore, PWA behavior, and offline safeguards.
- Run compatibility tests using existing export versions 2 through 8 and current import templates.

### Phase 6: cutover

- Run both implementations against separate copies of the same fictional database and compare API/domain results, exports, balances, positions, goals, reports, and snapshots.
- Run the new application against a production database copy and perform migration, foreign-key, aggregate, authentication, export, backup, and restore checks.
- Update `SPEC.md`, `docs/ARCHITECTURE.md`, README, deployment examples, environment documentation, operations, security documentation, and product guide.
- Remove the production Next.js server and old server-only code only after all acceptance criteria pass.
- Retain relevant historical migrations and migration documentation.

## Testing requirements

### Go tests

- Unit tests for every financial rule and rounding boundary.
- Service tests using disposable SQLite databases.
- Transaction rollback and idempotency tests.
- Fresh migration, existing-database adoption, upgrade, downgrade policy, and foreign-key tests.
- Authentication mode matrix and OIDC protocol tests using a deterministic local provider.
- API-key hashing, scope, expiry, revocation, last-used throttling, and no-secret-logging tests.
- At least two users for every private direct-resource path.
- Fuzz tests for strict request decoding, money/decimal parsers, import parsers, and token parsing where useful.

### Frontend tests

- Component tests for forms, privacy masking, charts, import previews, key creation/revocation, and auth-mode rendering.
- Assert the API-key secret disappears after leaving the one-time creation screen.
- Ensure logout clears browser query state and service-worker/client caches.
- Preserve responsive checks at 360, 390, 768, 1024, and 1440 pixels.

### End-to-end tests

- First and subsequent local signup.
- Local, OIDC-only, and hybrid login flows.
- Two simultaneous users with cross-user direct URL/API denial.
- Full account, transaction, transfer, valuation, goal, investment, estate, import/export, AI, restore, and backup workflows.
- API calls using read-only and write keys.
- Missing-scope denial and immediate revocation.
- PWA update and offline mutation blocking.
- Upgrade from an existing database copy followed by rollback from its pre-migration backup.

Do not weaken assertions, add arbitrary sleeps, disable security tests, or increase global timeouts merely to obtain a green suite.

## Required developer commands

Provide a simple `Makefile`, `Taskfile`, or documented equivalent covering at least:

```text
make generate       # sqlc + OpenAPI TypeScript generation and drift check
make lint           # Go and frontend lint
make typecheck      # frontend TypeScript
make test           # Go and frontend unit/component tests
make test-e2e       # Playwright against the Go server
make build          # Vite build + Go production binary
make migrate-check  # fresh and upgrade migration verification
make security       # govulncheck + supported dependency/image checks
```

CI must fail on generated-code drift, formatting failures, Go vet/static analysis failures, TypeScript errors, test failures, migration failures, and applicable critical vulnerabilities. Pin third-party CI actions to immutable commit SHAs.

## Acceptance criteria

The migration is complete only when all of the following are true:

1. Production runs one Go HTTP process and no Node.js runtime.
2. React is built by Vite and runs only in the browser.
3. All current supported user workflows have either parity tests or an explicitly approved behavioral change.
4. Existing SQLite databases upgrade without losing or changing financial data.
5. Fresh installations work from an empty database.
6. Every private SQL query and mutation is owner-scoped.
7. Existing local users and OIDC identities remain usable after cutover.
8. Browser sessions use secure cookies and state-changing cookie requests enforce Origin and CSRF protection.
9. Users can create scoped personal API keys, see the secret once, query their own data with `Authorization: Bearer`, and revoke access immediately.
10. API keys cannot manage authentication methods, other API keys, backups, restores, remembered AI credentials, or another user's data.
11. Money, rates, quantities, balances, transfers, valuations, positions, goals, imports, exports, and estate snapshots match the established behavior on golden fixtures.
12. The service worker never caches authenticated API responses or replays financial writes.
13. The runtime container is non-root, read-only apart from required volumes, has no service-account token, and contains no Node, npm, shell, curl, wget, or compiler where supported by the chosen minimal image.
14. Health probes, backup, offline restore, migration status, password reset, and demo seeding have documented Go implementations.
15. Documentation and deployment manifests describe the new architecture accurately.
16. The complete Go, frontend, migration, security, and Playwright verification suite passes.

## Deliverables

- Go API and operator CLI.
- Vite React frontend preserving the existing interface.
- sqlc schema, queries, generated code, and configuration.
- Goose baseline, adoption mechanism, and subsequent migrations.
- OpenAPI 3.1 document and generated frontend API types.
- Personal API-key Settings UI and external API documentation with `curl` examples.
- Updated Dockerfile, Compose file, Kubernetes manifest, NetworkPolicies, and health probes.
- Updated README, specification, architecture, authentication, deployment, backup/restore, security, and troubleshooting documentation.
- Migration/parity test fixtures and reports.
- A pull request describing the old risk surface, the new trust boundaries, database compatibility, API-key threat model, validation performed, and any remaining limitations.

## Constraints for the implementation agent

- Do not replace SQLite with PostgreSQL.
- Do not introduce GraphQL, a generic ORM, a service mesh, microservices, or an event bus.
- Do not add organizations, roles, invitations, shared portfolios, default users, setup credentials, or account recovery flows.
- Do not expose raw database backup or restore through the user API.
- Do not weaken current OIDC validation, owner scoping, import validation, or financial arithmetic.
- Do not use floating-point values for authoritative money or rates.
- Do not store API-key plaintext or expose it after creation.
- Do not run Vite's development or preview server in production.
- Do not keep a Next.js or Node server as a compatibility proxy after cutover.
- Do not delete the old implementation until parity and migration acceptance gates pass.
- When uncertain about existing behavior, treat current services, tests, `SPEC.md`, and `docs/ARCHITECTURE.md` as evidence and preserve the safer interpretation.

