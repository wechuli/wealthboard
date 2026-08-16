# Wealthboard

Wealthboard is a self-hosted, multi-user wealth and goals tracker. Each user has
an independent portfolio, settings, categories, exchange rates, reports, and
portable exports. The Next.js application reads SQLite directly and requires no
separate backend or financial integration. Authentication can remain fully
local or use one operator-configured OpenID Connect provider.

See the [product guide](https://wechuliprojects.github.io/wealthboard/) for
annotated desktop and mobile walkthroughs built from fictional portfolio data.

## Features

- Deployment-selected local, OpenID Connect, or hybrid authentication
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
- Operator-only full SQLite backup and offline restore
- Installable PWA shell with explicit offline safety
- Non-root Docker image, Docker Compose, and Kubernetes examples

Money is stored as integer minor units. Exchange rates are effective-dated
decimal strings, and calculations use `bigint` or Decimal.js.

## Product guide

The user and operator guide is published at
<https://wechuliprojects.github.io/wealthboard/>. It covers first setup,
accounts, position-tracked investments, activity, goals, reports, estate
planning, portability, deployment, authentication, backups, and troubleshooting
with fictional product screenshots.

Documentation source lives under `docs/` and is built with VitePress:

```bash
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

- Node.js 22 or newer
- npm
- A persistent local filesystem for SQLite

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Set `SESSION_SECRET` to at least 32 random characters before starting. The
development command applies pending migrations, then starts Next.js at
<http://localhost:3000>.

The default `AUTH_METHODS=local` mode preserves the original workflow. Open
`/signup` to create local users. Signup atomically creates the internal identity,
selected base/enabled currency settings, and default categories; it does not
create exchange rates, financial accounts, goals, or sample data. OIDC-only
deployments have no local signup or password-login path and provision internal
users only after a validated provider login.

### Optional fictional demo data

Demo data is never loaded by signup. Target one existing user explicitly:

```bash
DEMO_DATA=true TARGET_USERNAME=alice npm run db:seed:demo
```

The command never creates an identity or seeds every user.

## Environment variables

| Variable                       | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `DATABASE_PATH`                | Persistent SQLite file; default `./data/wealthboard.db`         |
| `SESSION_SECRET`               | HMAC session secret; at least 32 characters                     |
| `APP_URL`                      | Canonical deployment URL used for origin validation             |
| `TRUST_PROXY_HEADERS`          | Trust one ingress-overwritten client IP header; default `false` |
| `AUTH_METHODS`                 | `local`, `oidc`, or `local,oidc`; default `local`               |
| `OIDC_ISSUER`                  | Exact provider issuer when OIDC is enabled                      |
| `OIDC_CLIENT_ID`               | Confidential OIDC client ID                                     |
| `OIDC_CLIENT_SECRET`           | Confidential OIDC client secret                                 |
| `OIDC_PROVIDER_NAME`           | Login-button provider label; 1-60 characters                    |
| `OIDC_TRANSACTION_SECRET`      | Dedicated base64-encoded 32-byte OIDC transaction key           |
| `TZ`                           | Default timezone for new users; default `Africa/Nairobi`        |
| `BACKUP_PATH`                  | Operator backup directory; default `./backups`                  |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Optional base64 32-byte key for remembered AI provider API keys |
| `AI_ALLOWED_ENDPOINTS`         | Optional comma-separated exact custom OpenAI-compatible URLs    |

There is no initial-user password or environment-created identity.

## Authentication modes and OIDC

`AUTH_METHODS` is deployment policy and is read at startup:

| Value        | Login and account creation behavior                              |
| ------------ | ---------------------------------------------------------------- |
| `local`      | Username/password login and public local signup only             |
| `oidc`       | Only `Continue with <provider>`; `/signup` redirects to `/login` |
| `local,oidc` | Local login/signup plus explicit OIDC login and linking          |

OIDC uses Authorization Code flow, PKCE S256, state, nonce, discovery, and
RS256 ID-token verification through `jose`. The exact callback is
`${APP_URL}/api/auth/oidc/callback`; register that URI with the provider. Use an
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
never stored in SQLite, exports, browser storage, analytics, or logs. A
successful callback issues the ordinary Wealthboard session containing only the
internal user UUID, session version, and expiry.

### Keycloak example

Create a confidential Keycloak client with standard Authorization Code flow,
client authentication enabled, PKCE method S256, and this exact valid redirect
URI:

```text
https://wealthboard.example.com/api/auth/oidc/callback
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

Startup/readiness refuses OIDC-only mode while any active user lacks a link for
the configured issuer. It likewise refuses local-only mode while any active user
lacks a password. Disable users deliberately or complete their migration first.
Password hashes and identity links remain dormant when their method is disabled,
so rollback does not require recreating credentials. Hybrid mode remains ready
and local login remains usable during a temporary provider outage; OIDC-only
login and readiness are unavailable until discovery succeeds.

Rate limiting ignores forwarding headers by default. This prevents a direct
client from choosing its own limit key, but direct clients share one
conservative bucket. Set `TRUST_PROXY_HEADERS=true` only behind one trusted
ingress that strips client-supplied `X-Forwarded-For` and `X-Real-IP` values and
writes exactly one client IP. Forwarding chains and malformed addresses fall
into shared fail-closed buckets.

Generate a dedicated AI credential key only when users should be able to save
provider keys:

```bash
openssl rand -base64 32
```

Do not reuse `SESSION_SECRET`. Without this variable, users can still enter a
session-only API key on the Portfolio Review page. OpenAI and DeepSeek use fixed
built-in endpoints; custom endpoints are rejected unless their exact normalized
URL appears in `AI_ALLOWED_ENDPOINTS`. An operator can explicitly allow a local
endpoint, for example `http://ollama:11434/v1`, but ordinary users cannot select
arbitrary internal hosts. Keep the encryption key stable across restarts and
restores; rotating it currently requires users to delete and save their provider
credentials again.

## Password changes and operator reset

Users with a local credential change it under **Settings > Password** when local
authentication is enabled. Hybrid users explicitly link/unlink OIDC or enable
and remove local login under **Settings > Authentication methods**. Every method
change increments that user's session version and invalidates other sessions.

There is no email reset flow. An operator can reset one user by normalized
username; the password is read from the environment rather than command
arguments:

```bash
TARGET_USERNAME=alice \
NEW_USER_PASSWORD='a-new-password-with-12-characters' \
npm run password:reset
```

The reset command works only when local authentication is enabled and only for a
user who already has a local credential. It never creates a password for an
OIDC-only user.

For Docker Compose:

```bash
docker compose exec \
  -e TARGET_USERNAME=alice \
  -e NEW_USER_PASSWORD='a-new-password-with-12-characters' \
  wealthboard npm run password:reset
```

## Database migrations

`db/schema.ts` is the schema source of truth. Generated migrations under
`db/migrations` form an append-only history that supports both fresh databases
and upgrades of existing databases.

```bash
npm run db:generate
npm run db:migrate
```

After changing the schema, generate and review a new migration. Never delete,
rename, or edit a migration that may already have been applied. The migration
runner verifies the latest applied migration before executing pending SQL and
stops with a migration-history error if files were replaced or modified.

If that check fails, restore the original migration files from the application
version that created the database, then generate a new migration. A disposable
development database can instead be backed up if needed, deleted, and recreated;
do not manually change its migration ledger.

## Docker deployment

Create `.env` with `SESSION_SECRET`, `APP_URL`, `AUTH_METHODS`, and any required
OIDC values, then run:

```bash
docker compose up -d --build
docker compose ps
```

Compose mounts `/data` for SQLite and `/backups` for operator backups. Both
volumes survive image replacement. The container runs as UID/GID 1001, applies
migrations on startup, and exposes `/api/health/live` and
`/api/health/ready`. The legacy `/api/health` path has readiness semantics.

To update:

```bash
npm run backup
docker compose up -d --build
```

Terminate TLS in a trusted reverse proxy and do not mount the SQLite volume
read-write into multiple application replicas.

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

The OIDC keys may be omitted while `AUTH_METHODS=local`. The example uses one
replica with a `Recreate` strategy, ReadWriteOnce PVCs, separate startup,
readiness, and liveness probes, an Ingress, resource bounds, and a non-root
security context. TLS must terminate at the configured `APP_URL`, and the proxy
must preserve the original host and scheme. The example enables trusted proxy
headers for its single ingress; that ingress must overwrite rather than append
client-supplied forwarding headers.

## AI portfolio review

Portfolio Review is optional, read-only, and generated only on request. Configure
OpenAI, DeepSeek, or an operator-approved OpenAI-compatible endpoint under
**Settings → AI portfolio review**, then open **Review**. The integration uses the
provider's Chat Completions API through the official OpenAI Node client.

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

Provider keys entered on the Review page remain in browser component memory for
that request and are cleared after success. Remembered keys are encrypted with
AES-256-GCM and bound to the owning user. They are excluded from per-user exports,
but deployment-wide SQLite backups contain the encrypted credential rows and must
remain access-restricted. AI output is explanatory and is not financial advice.

## Per-user import, export, and restore

Settings provides:

- A complete JSON export of the authenticated user's settings and portfolio
- Account and transaction CSV exports
- A validated JSON restore that replaces only the authenticated user's
  portfolio in one transaction

Each active account provides an **Import** action for strict Account History
Import v1 CSV or JSON files. The import page publishes templates, a JSON Schema,
field and balance-direction rules, and an optional currency-aware prompt that can
be copied into an external AI service to transform a provider statement. The
prompt runs entirely in the browser; Wealthboard does not send the prompt,
statement, or generated file to an AI provider. Use only an AI provider you
trust, then preview and validate the generated file in Wealthboard before
confirming the import.

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

## Deployment-wide backup and offline restore

A raw SQLite file contains every user's password hash and financial records. It
is never available through an authenticated HTTP route.

Create a consistent operator backup:

```bash
npm run backup
```

`BACKUP_PATH` must be persistent and access-restricted. To restore, stop the
application first, then run:

```bash
CONFIRM_OFFLINE_RESTORE=true \
RESTORE_FILE=/backups/wealthboard-2026-08-02T10-00-00Z.db \
npm run backup:restore
```

Start Wealthboard afterward so pending migrations run. Test backups regularly
and retain an external copy before destructive maintenance.

## PWA and offline behavior

Use the browser install action or Wealthboard's **Install app** prompt. On iOS,
use **Share → Add to Home Screen**.

Production registers the service worker; development automatically unregisters
Wealthboard workers and clears Wealthboard caches so stale development chunks
cannot hydrate against newer server HTML. The production worker precaches only
the offline shell and static assets. Application chunks and icons are
network-first with cached offline fallback, which prevents an older bundle from
overriding a deployed update. It does not cache authenticated financial
responses or queue mutations. Financial submits are blocked while offline, and
logout clears Wealthboard client state before a different user signs in on the
same device.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Automated tests use disposable SQLite files, exercise two-user isolation and
portability attacks, and verify
layouts at 360, 390, 768, 1024, and 1440 px.

## Security considerations

- Use a unique, high-entropy `SESSION_SECRET` and strong user passwords.
- Keep `OIDC_CLIENT_SECRET` and `OIDC_TRANSACTION_SECRET` in deployment secret
  storage, never an image or committed manifest.
- Production session cookies are Secure, HTTP-only, SameSite=Strict, and
  explicitly expiring. OIDC transaction cookies are separate, callback-scoped,
  Secure, HTTP-only, SameSite=Lax, and expire within ten minutes.
- Restrict filesystem access to SQLite databases, backups, and exports.
- Never publish raw backups or user exports to public object storage.
- Keep TLS, the host, Node.js, the base image, and dependencies updated.
- Users are independent; Wealthboard has no roles, organizations, invitations,
  shared portfolios, or cross-user transfers.
- Database errors are logged by class or name without submitted secrets.

## License

See [LICENSE](LICENSE).
