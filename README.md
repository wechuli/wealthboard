# Wealthboard

Wealthboard is a self-hosted, multi-user wealth and goals tracker. Each user has
an independent portfolio, settings, categories, exchange rates, reports, and
portable exports. The Next.js application reads SQLite directly and requires no
separate backend, cloud identity provider, or financial integration.

> **Screenshot placeholder:** add desktop dashboard, account detail, goal
> projection, signup, and 390 px mobile screenshots after deployment branding
> is finalized.

## Features

- Public self-service signup with local username/password authentication
- Strict owner-scoped accounts, transactions, valuations, goals, analytics,
  rates, imports, exports, restores, caches, and idempotency keys
- Accounts and liabilities with custom categories, archives, filters, and
  base-currency values
- Per-user base currency and enabled ISO currency catalog, including East
  African and common international currencies
- Deposits, withdrawals, income, fees, gains/losses, valuations, and atomic
  paired transfers
- Net-worth history, portfolio analytics, and linked-goal forecasting
- Non-persistent goal scenario comparisons, milestones, and dismissible
  behind-plan dashboard reminders
- Per-user JSON portability and account/transaction CSV export
- Operator-only full SQLite backup and offline restore
- Installable PWA shell with explicit offline safety
- Non-root Docker image, Docker Compose, and Kubernetes examples

Money is stored as integer minor units. Exchange rates are effective-dated
decimal strings, and calculations use `bigint` or Decimal.js.

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

Open `/signup` to create the first user. Signup remains available for every
subsequent user and is the only application-user creation path. It atomically
creates the identity, selected base/enabled currency settings, and default
categories; it does not create exchange rates, financial accounts, or sample
data.

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
| `TZ`                           | Default timezone for new users; default `Africa/Nairobi`        |
| `BACKUP_PATH`                  | Operator backup directory; default `./backups`                  |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Optional base64 32-byte key for remembered AI provider API keys |
| `AI_ALLOWED_ENDPOINTS`         | Optional comma-separated exact custom OpenAI-compatible URLs    |

There is no initial-user password or environment-created identity.

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

Users change their password under **Settings → Password**. This increments only
that user's session version and invalidates their other sessions.

There is no email reset flow. An operator can reset one user by normalized
username; the password is read from the environment rather than command
arguments:

```bash
TARGET_USERNAME=alice \
NEW_USER_PASSWORD='a-new-password-with-12-characters' \
npm run password:reset
```

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

Create `.env` with `SESSION_SECRET` and `APP_URL`, then run:

```bash
docker compose up -d --build
docker compose ps
```

Compose mounts `/data` for SQLite and `/backups` for operator backups. Both
volumes survive image replacement. The container runs as UID/GID 1001, applies
migrations on startup, and exposes `/api/health`.

To update:

```bash
npm run backup
docker compose up -d --build
```

Terminate TLS in a trusted reverse proxy and do not mount the SQLite volume
read-write into multiple application replicas.

## Kubernetes deployment

Edit the image, hostname, storage classes, and resource limits in
`deploy/kubernetes.yaml`, then create the session secret separately:

```bash
kubectl create secret generic wealthboard-secrets \
  --from-literal=session-secret="$(openssl rand -hex 32)"
kubectl apply -f deploy/kubernetes.yaml
```

The example uses one replica with a `Recreate` strategy, ReadWriteOnce PVCs,
probes, an Ingress, resource bounds, and a non-root security context.

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

Exports contain no credentials, AI provider settings or usage, login attempts,
session data, idempotency records, or another user's rows. Restore downloads a pre-restore user export,
validates the archive, rejects owner fields and invalid relationships, remaps
record IDs, and rolls back completely on failure. Current exports use version 5
and include transaction external IDs, institutions, goal milestones, and
reminder dismissals. Versions 2 through 4 remain restorable; legacy institution
names are normalized and legacy transactions receive null external IDs.

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

The service worker caches only the offline shell and static assets. It does not
cache authenticated financial responses or queue mutations. Financial submits
are blocked while offline, and logout clears Wealthboard client state before a
different user signs in on the same device.

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
- Production cookies are Secure, HTTP-only, SameSite=Strict, and explicitly
  expiring.
- Restrict filesystem access to SQLite databases, backups, and exports.
- Never publish raw backups or user exports to public object storage.
- Keep TLS, the host, Node.js, the base image, and dependencies updated.
- Users are independent; Wealthboard has no roles, organizations, invitations,
  shared portfolios, or cross-user transfers.
- Database errors are logged by class or name without submitted secrets.

## License

See [LICENSE](LICENSE).
