# Worthboard

Worthboard is a polished, self-hosted personal wealth and goals tracker for one
person. It keeps manual accounts, investments, property, vehicles, cash, and
liabilities in one simple dashboard, separates contributions from investment
growth, supports KES/USD conversion, and forecasts linked financial goals.

It is intentionally not a budgeting system, trading platform, bank integration,
or multi-user product. The Next.js application reads one SQLite database
directly; no separate backend or cloud service is required.

> **Migration status:** The running application is still single-user. The
> approved target for self-service signup and multiple isolated users is defined
> in [SPEC.md](SPEC.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Do not
> expose the current release as a multi-user service until that migration and
> its cross-user isolation tests are complete. In the target architecture,
> `/signup` is always available and is the only user-creation path; the
> `INITIAL_ADMIN_PASSWORD` instructions below apply only to the current runtime
> and will be removed with the migration.

> **Screenshot placeholder:** add desktop dashboard, account detail, goal
> projection, and 390 px mobile screenshots here after deployment branding is
> finalized.

## Features

- Secure single-user login, expiring signed cookies, persistent rate limiting,
  password rotation, and environment-based password recovery
- Accounts and liabilities with custom categories, classifications, card/table
  views, filters, sorting, archives, and base-currency values
- Deposits, withdrawals, interest, dividends, fees, gains/losses, adjustments,
  liability changes, and idempotent paired transfers
- Absolute valuation snapshots that remain separate from cash contributions
- Daily/monthly reconstructed net-worth history and rich Recharts analytics
- Linked goals with required contributions, tracking status, and future-value
  forecasts
- JSON/CSV export, transaction CSV import, online SQLite backup, and validated
  restore with an automatic pre-restore backup
- Installable PWA shell with install/update prompts and explicit offline safety
- Non-root Docker image, Docker Compose, and Kubernetes examples

Financial values are integer minor units. Exchange rates are stored as decimal
strings, and calculations use `bigint` or Decimal.js rather than JavaScript
floating-point arithmetic. See [the architecture notes](docs/ARCHITECTURE.md).

## Requirements

- Node.js 22 or newer (Node.js 24 is used by the container)
- npm
- A persistent local filesystem for SQLite

## Local development

1. Install dependencies and create your environment file:

   ```bash
   npm install
   cp .env.example .env
   ```

2. Set strong values in `.env`. `SESSION_SECRET` must contain at least 32
   characters and `INITIAL_ADMIN_PASSWORD` must contain at least 10.

3. Start the application:

   ```bash
   npm run dev
   ```

   `dev` applies pending migrations before starting Next.js. Open
   <http://localhost:3000>.

The first request creates the one user and stores only a bcrypt hash of
`INITIAL_ADMIN_PASSWORD`. Changing that environment variable later does not
change an initialized account.

### Optional fictional demo data

Demo values are never loaded by default. On a new migrated database, explicitly
opt in:

```bash
DEMO_DATA=true npm run db:seed:demo
```

The seed is idempotent and uses the fictional accounts and car goal described in
the product specification.

## Environment variables

| Variable                 | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `DATABASE_PATH`          | Persistent SQLite file, default `./data/worthboard.db` |
| `SESSION_SECRET`         | HMAC session secret, at least 32 characters            |
| `INITIAL_ADMIN_PASSWORD` | First-launch password; never stored in plaintext       |
| `APP_URL`                | Canonical deployment URL                               |
| `TZ`                     | Server/default timezone, default `Africa/Nairobi`      |
| `BACKUP_PATH`            | Persistent backup directory, default `./backups`       |

The temporary product name is centralized in `lib/constants.ts`; the displayed
application name can also be changed from Settings.

## First login and password reset

Sign in with `INITIAL_ADMIN_PASSWORD`, then change the password under
**Settings → Password**. Password changes increment the session version and sign
out other sessions.

If the password is lost, stop the app process and run this against the same
database:

```bash
NEW_ADMIN_PASSWORD='a-new-strong-password' npm run password:reset
```

The command reads the password from the environment so it does not appear in
source or command arguments. It writes a bcrypt hash and invalidates every
existing session. There is no email reset flow.

For Docker Compose, run the same utility inside the application container:

```bash
docker compose exec -e NEW_ADMIN_PASSWORD='a-new-strong-password' \
  worthboard npm run password:reset
```

## Database migrations

Drizzle schema source is in `db/schema.ts`; generated migrations are committed
under `db/migrations`.

```bash
npm run db:generate  # after intentionally changing the schema
npm run db:migrate   # apply pending migrations
```

Back up production before applying an upgrade. Migrations are forward-only; do
not edit a migration that has already run.

## Docker deployment

Create `.env` with strong secrets, then:

```bash
docker compose up -d --build
docker compose ps
```

Compose mounts named volumes at:

- `/data` for `worthboard.db`
- `/backups` for downloaded and pre-restore backups

Both survive image replacement and application upgrades. The container runs as
UID/GID 1001, drops privilege escalation, applies migrations on startup, and
checks `/api/health`.

To update:

```bash
docker compose pull
docker compose up -d --build
```

Never place secrets in the image or Compose file. Put TLS in a trusted reverse
proxy and expose Worthboard only over HTTPS outside a private network.

## Kubernetes deployment

Edit the image, host, storage classes, and resource sizes in
`deploy/kubernetes.yaml`. Create the required Secret separately:

```bash
kubectl create secret generic worthboard-secrets \
  --from-literal=session-secret="$(openssl rand -hex 32)" \
  --from-literal=initial-admin-password='replace-with-a-strong-password'
kubectl apply -f deploy/kubernetes.yaml
```

The example includes a `Recreate` single-replica Deployment, Service, two
PersistentVolumeClaims, Ingress, probes, resource bounds, and a non-root
SecurityContext. SQLite must not be mounted read-write by multiple replicas.

## Backup and restore

**Settings → Backup, restore & export** can download a consistent SQLite backup.
Server-side copies are also retained in `BACKUP_PATH`.

Restore accepts only a SQLite file that:

1. has a valid SQLite header,
2. passes `PRAGMA integrity_check`,
3. contains all required Worthboard tables, and
4. contains the single-user settings row.

Worthboard creates a `pre-restore-*.db` online backup before replacing current
data. Restore is destructive and may invalidate the current session if the
restored password/session version differs. Keep external, tested copies of the
backup directory.

## Import and export

- JSON export contains application data but deliberately omits the password
  hash and login-attempt records.
- Account and transaction CSV exports preserve integer `*_minor` fields.
- Full SQLite backup preserves every setting, including authentication state.

Transaction import expects UTF-8 CSV with this header:

```csv
account_id,account_name,type,amount,currency,date,description,notes
```

Use either `account_id` or the exact `account_name`. `type` is one of:
`deposit`, `withdrawal`, `interest`, `dividend`, `capital_gain`,
`capital_loss`, `fee`, `purchase`, `sale`, `manual_adjustment`,
`liability_payment`, or `liability_increase`. Amount is a major-unit decimal,
date is `YYYY-MM-DD`, and currency must match the account. Opening balances and
transfers use their dedicated UI workflows. The entire file is validated before
any rows are inserted.

## PWA installation and offline behavior

Open Worthboard in a supported browser and use its install action, or the
in-app **Install app** prompt. On iOS, use **Share → Add to Home Screen**.

The service worker caches the offline shell and versioned static assets. It does
not cache authenticated financial pages or queue mutations. When disconnected,
Worthboard clearly reports that fresh data requires the server and disables
financial submit controls. Reconnect before recording any change.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

The Playwright suite creates and removes only `data/e2e.db`, exercises the full
single-user workflow, and checks layouts at 360, 390, 768, 1024, and 1440 px.

## Security considerations

- Use a unique, high-entropy `SESSION_SECRET` and admin password.
- Terminate TLS before Worthboard; production cookies are `Secure`, HTTP-only,
  and SameSite=Strict.
- Restrict filesystem access to the database and backups. A SQLite backup
  contains the password hash and all financial data.
- Do not publish exports or backups to public object storage.
- Keep the host, Node.js runtime, base image, and dependencies updated.
- The app is intentionally single-user. Do not expose it as a shared household
  or team service.
- Database errors are logged by class/name without passwords or submitted
  sensitive values.

## License

See [LICENSE](LICENSE).
