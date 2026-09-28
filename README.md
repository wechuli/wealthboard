# Wealthboard

Wealthboard is a self-hosted, multi-user wealth and goals tracker. Each user has
an independent portfolio, settings, categories, exchange rates, reports, and
portable exports. The current application is a Go HTTP service backed by
PostgreSQL and serves a Vite/React web client. Authentication can remain fully
local or use one operator-configured OpenID Connect provider.

See the [product guide](https://wechuliprojects.github.io/wealthboard/) for
annotated desktop and mobile walkthroughs built from fictional portfolio data.

## Features

- Deployment-selected local, OpenID Connect, or hybrid authentication
- Versioned Go API with owner-scoped, revocable personal API keys
- Strict owner-scoped accounts, transactions, valuations, goals, analytics,
  rates, imports, exports, restores, caches, and idempotency keys
- Accounts and liabilities with custom categories, archives, filters, and
  base-currency values
- Position-tracked investment accounts with broker cash, fractional units,
  effective prices, conversion, reconciliation, imports, and corporate actions
- Per-user base currency and enabled ISO currency catalog, including East
  African and common international currencies
- Deposits, withdrawals, income, fees, gains/losses, valuations, and atomic
  paired transfers
- Net-worth history, portfolio analytics, and linked-goal forecasting
- Non-persistent goal scenario comparisons, milestones, and dismissible
  behind-plan dashboard reminders
- Private beneficiary and estate-distribution planning with printable,
  privacy-controlled as-of summaries
- Per-user JSON portability and account/transaction CSV export
- Operator-only PostgreSQL custom-format backup and maintenance-mode restore
- Installable PWA shell with explicit offline safety
- Browser-local System, Light, and Dark appearance themes
- Optional on-demand, evidence-linked AI portfolio review with private BYOK
- Non-root Docker image, Docker Compose, and Kubernetes examples

Money is stored as integer minor units in PostgreSQL `bigint` columns. Exchange
rates are effective-dated exact `numeric` values serialized as decimal strings,
and authoritative server calculations use checked integers and exact
`math/big` arithmetic.

## Product guide

The user and operator guide is published at https://wechuliprojects.github.io/wealthboard/. It covers first setup,
accounts, position-tracked investments, activity, goals, reports, estate
planning, portability, deployment, authentication, backups, and troubleshooting
with fictional product screenshots.

Documentation source lives under `docs/` and is built with VitePress:

```bash
npm ci
npm run docs:dev
DOCS_BASE=/wealthboard/ npm run docs:build
npm run docs:preview
```

Regenerate product screenshots from a disposable database with:

```bash
npm run docs:capture
```

The capture workflow creates only fictional data and writes the reviewed images
to `docs/public/images/screenshots/`.

### Estate planning

Open `/estate` to maintain private beneficiaries, describe how each active asset
is held, allocate primary and contingent percentages, cover unallocated property
through residual beneficiaries, and review recorded liabilities separately.
Percentages use exact basis points and indicative values follow the same
effective-dated currency rules as reports.

The Summary view creates immutable, hashed Estate Planning Summary snapshots.
Its print/Save as PDF controls exclude exact values, contacts, account/document
references, and notes until you deliberately include them; the global privacy
toggle can still mask all values. These documents are planning worksheets, not
legally executed wills, and do not grant beneficiary access or transfer assets.

## Requirements

- Go 1.27 or newer
- Node.js 24 and npm for building the Vite client and documentation
- PostgreSQL 17 and matching `pg_dump`/`pg_restore` tools for operator recovery

## Local development

```bash
make postgres-up
npm ci
make web-install
make build
DATABASE_URL='postgres://wealthboard:wealthboard@localhost:5433/wealthboard?sslmode=disable' \
SESSION_SECRET="$(openssl rand -hex 32)" \
APP_URL=http://localhost:3000 \
AUTH_METHODS=local \
./bin/wealthboard serve
```

`serve` applies pending PostgreSQL migrations before listening on
<http://localhost:3000>. Keep `SESSION_SECRET` stable and at least 32
characters; the command above generates a disposable development secret.
The Go binary reads process environment variables, not `.env` files.
`.env.example` documents the available settings; export them or supply them
through your process manager. Compose reads `.env` for its own interpolation.

The root npm dependencies support documentation, browser tests, and direct-install
document extraction. The separate `web/` dependencies build and test the client.

The default `AUTH_METHODS=local` mode preserves the original workflow. Open
`/signup` to create local users. Signup atomically creates the internal identity,
selected base/enabled currency settings, and default categories; it does not
create exchange rates, financial accounts, goals, or sample data. OIDC-only
deployments have no local signup or password-login path and provision internal
users only after a validated provider login.

### Vite hot reload

Build the client once so `web/dist` exists, then export `DATABASE_URL` and a
stable `SESSION_SECRET` in the Go terminal and run:

```bash
PORT=3100 APP_URL=http://127.0.0.1:5173 AUTH_METHODS=local make go-run
```

In a second terminal:

```bash
make web-dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to
`http://127.0.0.1:3100`, and `APP_URL` must match the browser origin for mutation
origin checks. The Go listener still serves the last built client; it does not
provide Vite hot reload. Do not start another server on an occupied port.

### Optional fictional demo data

Demo data is never loaded by signup. Target one existing user explicitly:

```bash
make seed-demo DEMO_DATA=true TARGET_USERNAME=alice
```

Both `DEMO_DATA=true` and an explicit existing username are required. The
command never creates an identity or seeds every user; deterministic IDs and
conflict handling make repeat runs safe for the same target.

## Environment variables

| Variable                       | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Required PostgreSQL connection URL                                        |
| `SESSION_SECRET`               | HMAC session secret; at least 32 characters                               |
| `APP_URL`                      | Canonical deployment URL used for origin validation                       |
| `NODE_ENV`                     | Set `production` to require secure session cookies                        |
| `PORT`                         | Go HTTP listener port; default `3000`                                     |
| `TRUST_PROXY_HEADERS`          | Legacy setting; ignored by Go, which uses the socket peer IP for rate limits |
| `AUTH_METHODS`                 | `local`, `oidc`, or `local,oidc`; default `local`                         |
| `OIDC_ISSUER`                  | Exact provider issuer when OIDC is enabled                                |
| `OIDC_CLIENT_ID`               | Confidential OIDC client ID                                               |
| `OIDC_CLIENT_SECRET`           | Confidential OIDC client secret                                           |
| `OIDC_PROVIDER_NAME`           | Login-button provider label; 1-60 characters                              |
| `OIDC_TRANSACTION_SECRET`      | Dedicated base64-encoded 32-byte OIDC transaction key                     |
| `TZ`                           | Default timezone for new users; default `Africa/Nairobi`                  |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Optional base64 32-byte key for remembered AI provider API keys           |
| `AI_ALLOWED_ENDPOINTS`         | Comma-separated exact custom OpenAI-compatible base URLs                  |
| `AI_EXTRACTION_SOCKET`         | Optional Unix socket for the isolated document parser                     |
| `AI_EXTRACTION_SCRIPT`         | Local Node parser script; default `scripts/extract-import-source-cli.mjs` |
| `WEB_DIST_PATH`                | Built Vite assets; default `web/dist`                                     |

There is no initial-user password or environment-created identity.

## Authentication modes and OIDC

`AUTH_METHODS` is deployment policy and is read at startup:

| Value        | Login and account creation behavior                              |
| ------------ | ---------------------------------------------------------------- |
| `local`      | Username/password login and public local signup only             |
| `oidc`       | Only `Continue with <provider>`; `/signup` redirects to `/login` |
| `local,oidc` | Local login/signup plus explicit OIDC login and linking          |

OIDC uses Authorization Code flow, PKCE S256, state, nonce, discovery, and
RS256 ID-token verification through Go's `github.com/golang-jwt/jwt/v5`.
The exact callback is
`${APP_URL}/api/v1/auth/oidc/callback`; register that URI with the provider. Use an
HTTPS `APP_URL` and issuer in production. Plain HTTP is accepted only for an
explicit localhost address. Issuer URLs may contain a path, such as a Keycloak
realm, but not credentials, a query, or a fragment.

Generate independent secrets:

```bash
openssl rand -hex 32       # SESSION_SECRET
openssl rand -base64 32    # OIDC_TRANSACTION_SECRET
```

Do not reuse either value as `OIDC_CLIENT_SECRET`. OIDC transaction state is
encrypted in a short-lived, callback-scoped, HTTP-only `SameSite=Lax` cookie.
Provider tokens, authorization codes, PKCE verifiers, and claim payloads are
never stored in PostgreSQL, exports, browser storage, analytics, or logs. A
successful callback issues the ordinary Wealthboard session containing only the
internal user UUID, session version, issue/expiry times, and a per-session CSRF
token, not provider credentials.

### Keycloak example

Create a confidential Keycloak client with standard Authorization Code flow,
client authentication enabled, PKCE method S256, and this exact valid redirect
URI:

```text
https://wealthboard.example.com/api/v1/auth/oidc/callback
```

Assign only intended users or groups to the client. Wealthboard accepts every
identity the configured client permits; provider-side assignment is the default
admission policy. Configure only the realm issuer, not Keycloak endpoint paths:

```dotenv
APP_URL=https://wealthboard.example.com
AUTH_METHODS=local,oidc
OIDC_ISSUER=https://id.example.com/realms/wealthboard
OIDC_CLIENT_ID=wealthboard
OIDC_CLIENT_SECRET=replace-with-keycloak-client-secret
OIDC_PROVIDER_NAME=Company SSO
OIDC_TRANSACTION_SECRET=replace-with-openssl-base64-output
```

Wealthboard discovers Keycloak's authorization, token, and JWKS endpoints from
`${OIDC_ISSUER}/.well-known/openid-configuration`. Scopes are `openid profile
email`; only issuer, opaque subject, nonce, audience, and token validity are
authentication evidence. Email and display claims never link or merge users.

### Rollout and rollback

Existing installations start in `local`. To adopt OIDC without duplicate
portfolios:

1. Configure `local,oidc`, restart, and verify readiness.
2. Existing local users link the provider explicitly under **Settings >
   Authentication methods** after confirming their password.
3. Confirm every active user has a link, then change to `oidc` and restart.

Readiness refuses OIDC-only mode while any active user lacks a link for
the configured issuer. It likewise refuses local-only mode while any active user
lacks a password. Disable users deliberately or complete their migration first.
Password hashes and identity links remain dormant when their method is disabled,
so rollback does not require recreating credentials. Hybrid mode remains ready
and local login remains usable during a temporary provider outage; OIDC-only
login and readiness require valid discovery. Invalid startup configuration fails
before listening, but authentication readiness is evaluated by the health
endpoint, not as a startup gate. Check `/api/health/ready` before routing traffic.

Go rate limiting uses the socket peer IP (`RemoteAddr`). `X-Forwarded-For`,
`X-Real-IP`, and the legacy `TRUST_PROXY_HEADERS` toggle do not change that
identity. Direct clients cannot spoof it through headers, but clients behind
the same reverse proxy can share its rate-limit bucket. Account for this when
configuring ingress-side throttling; enabling the legacy toggle does not
provide per-client rate limiting behind a proxy.

Generate a dedicated AI credential key only when users should be able to save
provider keys:

```bash
openssl rand -base64 32
```

Do not reuse `SESSION_SECRET`. The value must be canonical base64 for exactly 32
bytes. Without it, users can still submit a session-only provider key for one
request. OpenAI and DeepSeek use fixed built-in endpoints; custom endpoints
must exactly match a normalized URL in `AI_ALLOWED_ENDPOINTS`. Every provider
hostname is resolved again before use, and private, loopback, link-local,
multicast, and other local ranges are rejected even if allowlisted. Redirects
and environment HTTP proxies are disabled. Keep the encryption key stable;
changing it makes remembered keys undecryptable until users replace them.

## Password changes and operator reset

Users with a local credential change it under **Settings > Password** when local
authentication is enabled. Hybrid users explicitly link/unlink OIDC or enable
and remove local login under **Settings > Authentication methods**. Every method
change increments that user's session version and invalidates other sessions.

There is no email reset flow. An operator can reset one user by normalized
username; the password is read from the environment rather than command
arguments:

```bash
NEW_USER_PASSWORD='a-new-password-with-12-characters' \
DATABASE_URL='postgres://wealthboard:wealthboard@localhost:5433/wealthboard?sslmode=disable' \
./bin/wealthboard reset-password --username alice
```

The reset command works only when local authentication is enabled and only for a
user who already has a local credential. It never creates a password for an
OIDC-only user.

For Docker Compose:

```bash
docker compose exec \
  -e NEW_USER_PASSWORD='a-new-password-with-12-characters' \
  wealthboard /app/wealthboard reset-password --username alice
```

## API authentication

The browser uses the signed session cookie. Authenticated browser mutations
require the exact `Origin` from `APP_URL` and the session's `X-CSRF-Token`;
login/signup require the trusted origin before a session exists. The client
retrieves its session and CSRF token from `/api/v1/session`.

External clients may use personal API keys in `Authorization: Bearer <token>`.
Keys are owner-scoped, show their full secret only at creation, and default to
`portfolio:read`. Other explicit scopes are `portfolio:write`, `imports:write`,
`exports:read`, and `ai:invoke`. They do not grant credential management or
user-restore access. Password resets invalidate browser sessions, not API keys;
revoke keys separately when needed.

See [Go authentication and API keys](docs/reference/go-authentication.md) and
the [OpenAPI contract](api/openapi.yaml) for endpoints and request formats.

## Database migrations

The Go service embeds the append-only PostgreSQL migrations under
`db/postgres/migrations`. `serve` runs pending migrations at startup; operators
can run or inspect them separately with `make migrate` and
`make migrate-status`. Never edit an applied migration.

PostgreSQL is a fresh-start boundary. There is no SQLite-to-PostgreSQL importer,
dual-write mode, or supported in-place conversion. The legacy Next.js, Drizzle,
and SQLite runtime was removed after the
[cutover checklist](docs/admin/cutover.md) passed. Historical Drizzle migrations
remain under `docs/archive` as non-executable provenance.

## Operator commands

The Go binary owns runtime and database operations:

```bash
./bin/wealthboard serve
./bin/wealthboard migrate
./bin/wealthboard migrate-status
NEW_USER_PASSWORD='replacement-password' ./bin/wealthboard reset-password --username alice
./bin/wealthboard backup --file /secure/wealthboard.dump
./bin/wealthboard restore --file /secure/wealthboard.dump --confirm-maintenance
DEMO_DATA=true ./bin/wealthboard seed-demo --username alice
./bin/wealthboard healthcheck
```

`make migrate`, `make migrate-status`, `make backup`, `make restore`, and
`make seed-demo` are source-tree wrappers around these commands. Backup and
restore require compatible PostgreSQL client tools on the operator host; they
are intentionally absent from the distroless application image.

## Container deployment

The application image is a non-root distroless Go runtime serving the built
Vite assets. Compose and Kubernetes enforce a read-only application filesystem.
The image contains neither PostgreSQL client tools nor Node.js.
Supply an external `DATABASE_URL` and run operator backups from a trusted host
or admin job with matching PostgreSQL tools. The Compose stack builds the
separate, network-disabled `extraction-worker` target for PDF/XLSX/DOCX.

## Kubernetes deployment

Edit the image, hostname, auth mode/provider values, storage classes, and
resource limits in `deploy/kubernetes.yaml`, then create secrets separately:

```bash
kubectl create secret generic wealthboard-secrets \
  --from-literal=session-secret="$(openssl rand -hex 32)" \
  --from-literal=oidc-client-secret='replace-with-provider-secret' \
  --from-literal=oidc-transaction-secret="$(openssl rand -base64 32)"
kubectl apply -f deploy/kubernetes.yaml
```

Create the separate `wealthboard-database` secret with its `database-url` key.
The manifest deploys two rolling application replicas with a pod-local
extraction sidecar, but no PostgreSQL server, database volume, or backup
controller. Operate PostgreSQL, point the egress policy at its actual
namespace/labels, schedule and retain backups outside the application pods, and
test restores. TLS must terminate at
the configured `APP_URL`; the ingress must overwrite rather than append
client-supplied forwarding headers. The example egress policy allows only DNS
and the selected PostgreSQL pods. Add narrowly scoped provider egress before
enabling OIDC or AI; those integrations cannot use the default policy unchanged.

## AI portfolio review

Portfolio Review is optional, read-only, and generated only on request. Configure
OpenAI, DeepSeek, or an operator-approved OpenAI-compatible endpoint under
**Settings → AI portfolio review**, then open **Review**. The integration uses the
provider's supported HTTP API through the Go AI workflow.

Wealthboard calculates a bounded, versioned snapshot before contacting a model.
By default it contains ratios, concentration, goal trajectory, and data-quality
warnings with pseudonymous account and goal labels. Exact aggregate amounts and
names are separate per-request opt-ins. Notes, account references, transaction
descriptions, raw activity rows, and the current cash-flow-naive annualized return
figures are never sent.

Generated reviews are not stored. The database retains only owner-scoped usage
metadata such as provider host, model, status, latency, and token counts; users
can clear that history or disconnect the provider. Prompts, responses, API keys,
and portfolio values are not written to usage records. A one-minute cooldown,
UTC calendar-month token limit, response-token bound, redirect blocking, strict response
validation, and evidence-reference checks apply to every request.

AI reviews and import conversion use a two-minute provider request timeout with
automatic retries disabled. The monthly token limit accepts 10,000 to
100,000,000 tokens; existing saved limits are not increased automatically.

Provider keys entered for one request are not persisted. Remembered keys are
encrypted with AES-256-GCM and bound to the owning user. They are excluded from
per-user exports, but deployment-wide PostgreSQL backups contain encrypted
credential rows and must remain access-restricted. AI output is explanatory and
is not financial advice.

UTF-8 CSV/TSV/JSON/TXT extraction runs in Go. PDF/XLSX/DOCX extraction uses
`AI_EXTRACTION_SOCKET` when set. Compose runs the bundled worker without a
network; Kubernetes runs it as a bounded sidecar sharing only the pod-local
Unix socket with the application. Without a socket, a direct installation falls
back to `node` plus `AI_EXTRACTION_SCRIPT`. The distroless application image has
no Node fallback.

## Per-user import, export, and restore

Settings provides:

- A complete JSON export of the authenticated user's settings and portfolio
- Account and transaction CSV exports
- A validated JSON restore that replaces only the authenticated user's
  portfolio in one transaction

Each active balance-tracked account provides an **Import** action for strict Account History
Import v1 CSV or JSON files. The import page publishes templates, a JSON Schema,
field and balance-direction rules, and an optional currency-aware prompt that can
be copied into an external AI service to transform a provider statement. The
manual prompt workflow runs entirely in the browser; Wealthboard does not send the prompt,
statement, or generated file to an AI provider. Use only an AI provider you
trust, then preview and validate the generated file in Wealthboard before
confirming the import.

The separate **Convert with AI** mode supports CSV, TSV, JSON, TXT, XLSX,
text-based PDF, and DOCX. Wealthboard extracts text locally in the self-hosted
application, lets you select/redact sections, and requests explicit consent
before sending only approved text to your configured provider/model. It reuses
your encrypted remembered key or accepts a session-only key. Review and correct
the generated JSON draft, then use the existing preview and confirmation flow.
No conversion automatically posts financial records.

Sources are limited to 5 MB and extracted content to 64 KB/1,000 sections.
Password-protected PDFs accept an optional one-time password for local extraction;
it is cleared after each attempt and never stored or sent to the AI provider.
Scanned documents, image input, legacy DOC/XLS, encrypted Office files/archives,
and external document references are unsupported. Original files are never sent to the model;
provider-side retention policies still apply to approved text. See
[AI-assisted import](docs/reference/ai-import.md) for limits and provider requirements.

Position-tracked investment accounts instead use strict Investment History v1
JSON or dedicated holdings, trades, cash, and price CSV templates. Preview
shows instrument resolution, before/after quantities, projected cash/value,
date range, net change, duplicate/conflict outcomes, oversells, and detailed
missing or stale price/rate ranges. Confirmation commits the complete
interdependent sequence atomically. Optional JSON event groups represent one
dividend plus its same-date reinvestment buys.

Exports contain no credentials, AI provider settings or usage, login attempts,
session data, idempotency records, or another user's rows. Restore downloads a pre-restore user export,
validates the archive, rejects owner fields and invalid relationships, remaps
record IDs, and rolls back completely on failure. Current exports use version 8
and include transaction external IDs, institutions, goal milestones, reminder
dismissals, estate plans, retained estate summaries, instruments, ordered
position events, prices, reconciliations, grouped cash links, conversion
provenance, and freshness settings. Versions 2 through 8 remain restorable;
version 7 position data upgrades deterministically, legacy institution names are
normalized, legacy transactions receive null external IDs, and pre-v6 archives
restore with an empty estate plan and no inferred positions.

Account History Import v1 CSV uses this exact header:

```csv
external_id,type,amount,date,description,notes
```

The selected account supplies ownership and currency; import files contain no
account or user fields. Every row requires a stable, case-sensitive
`external_id`. Supported types are
`deposit`, `withdrawal`, `interest`, `dividend`, `capital_gain`,
`capital_loss`, `fee`, `purchase`, `sale`, `manual_adjustment`,
`liability_payment`, and `liability_increase`. Amount is a decimal string in the
selected account currency and date is `YYYY-MM-DD`. Opening balances and
transfers use their dedicated workflows. Files are previewed without writes;
identical external IDs are skipped, conflicts are never overwritten, and all
currently valid rows commit atomically before one balance replay.

## Deployment-wide PostgreSQL backup and restore

A database archive contains every user's password hash, identity mappings,
personal API-key hashes and metadata, encrypted remembered AI keys, and
financial records. It is never available through an authenticated HTTP route.

Create a consistent operator backup:

```bash
mkdir -p backups
make backup BACKUP_FILE="$PWD/backups/wealthboard-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

The explicit destination directory must already exist and the file must not.
The command uses `pg_dump --format=custom`, omits ownership/privileges, verifies
a nonempty regular file, and sets mode `0600`.

Restore is destructive and requires maintenance mode: stop every application
replica and other writer, then run:

```bash
make restore RESTORE_FILE="$PWD/backups/wealthboard-20260920T120000Z.dump"
```

The command validates the custom archive, creates a timestamped
`wealthboard-pre-restore-*.dump` beside it, and only then runs a clean,
single-transaction restore. It validates readiness and foreign keys afterward
and retains the safety dump on success or failure. Start Wealthboard only after
the command completes successfully, and test recovery regularly in a disposable
database. The maintenance flag acknowledges that you stopped writers; it does
not stop them for you. A failed post-restore validation leaves the safety dump
available for operator recovery, not an automatic rollback.

## PWA and offline behavior

Production registers the service worker. It precaches only the standalone
offline page, manifest, and application icons. Failed navigation shows that
offline page; API requests are never intercepted, authenticated financial
responses are never cached, and no background-sync handler queues mutations.
Previously viewed dashboards and records are therefore not guaranteed to work
offline. The client displays connection state, blocks forms marked as financial
mutations while `navigator.onLine` is false, and offers Reload when a replacement
worker is waiting. It provides no mutation queue or in-app install prompt; use
the browser's install action where available and retry writes only after
connectivity returns.

## Verification

Install both npm dependency sets first. For migration/integration checks, set
`DATABASE_URL` to a disposable PostgreSQL test database, never a production
database. Those Make targets pass it as `TEST_DATABASE_URL`; the test role needs
schema-creation privileges and `CREATEDB` for native backup/restore tests.
Install matching `pg_dump` and `pg_restore` on the test host.

```bash
npm ci
npm --prefix web ci
make generate
make lint
make typecheck
make test
make migrate-check
make go-test-integration
make security
npx playwright install chromium
make test-e2e-go
make build
npm run docs:build
```

Go integration tests create disposable PostgreSQL schemas or databases and
exercise two-user isolation and portability attacks. Without
`TEST_DATABASE_URL`, database-backed cases in ordinary `go test` runs are
skipped. Playwright owns a separate disposable PostgreSQL Compose project,
builds Go/Vite, starts mock providers, and verifies layouts at 360, 390, 768,
1024, and 1440 px. Docker must be running for browser tests and screenshot
capture; do not run them against a real portfolio database.

## Security considerations

- Use a unique, high-entropy `SESSION_SECRET` and strong user passwords.
- Keep `OIDC_CLIENT_SECRET` and `OIDC_TRANSACTION_SECRET` in deployment secret
  storage, never an image or committed manifest.
- Production session cookies are Secure, HTTP-only, SameSite=Strict, and
  explicitly expiring. OIDC transaction cookies are separate, callback-scoped,
  Secure, HTTP-only, SameSite=Lax, and expire within ten minutes.
- Restrict PostgreSQL access and filesystem access to backups and exports.
- Never publish raw backups or user exports to public object storage.
- Keep TLS, PostgreSQL, Go, Node.js build tooling, the base image, and dependencies updated.
- Users are independent; Wealthboard has no roles, organizations, invitations,
  shared portfolios, or cross-user transfers.
- Database errors are logged by class or name without submitted secrets.

## License

See [LICENSE](LICENSE).
