# Worthboard architecture

Worthboard is a single-process Next.js application. Server Components read SQLite
through Drizzle ORM, Server Actions perform validated mutations, and Route
Handlers provide file-oriented imports, exports, backups, and health checks.
There is no separate API service.

## Decisions

- **Runtime:** Next.js App Router on Node.js with strict TypeScript. Pages that
  contain financial data are always dynamically rendered.
- **Persistence:** One WAL-mode SQLite database at `DATABASE_PATH`. Monetary
  amounts are integer minor units. Exchange rates are decimal strings and all
  financial arithmetic uses `bigint` or Decimal.js.
- **Authentication:** A single settings row contains the bcrypt password hash.
  Login issues a short-lived, signed, HTTP-only, SameSite=Strict session cookie.
  Middleware protects application routes; every mutation independently verifies
  the session. Failed logins are rate-limited in SQLite.
- **Balances:** Transactions and valuations are immutable inputs to a balance
  replay. A valuation sets the balance at that point without becoming a
  contribution; later transactions apply signed effects. Editing or deleting an
  event replays the account in the same database transaction.
- **Transfers:** A transfer writes paired signed `Transfer` transactions under a
  unique transfer group and idempotency key in one SQLite transaction.
- **History:** Daily/monthly account balances are reconstructed from opening
  balances, transactions, and valuations, then converted using the most recent
  exchange rate effective on each date.
- **Goals:** A linked account is the source of truth for goal progress. Unlinked
  goals retain a direct current amount. Forecasts use Decimal.js future-value
  calculations and a configurable annual return assumption.
- **Backups:** Backup uses SQLite's online backup operation. Restore validates an
  uploaded SQLite file and required tables, creates a pre-restore backup, swaps
  the database, and reopens the connection.
- **Offline:** The service worker caches only the shell and static assets.
  Financial mutations remain server-only and are disabled by the offline UI.

## Database schema

| Table | Purpose |
| --- | --- |
| `user_settings` | Single user, password hash, locale and product preferences |
| `categories` | Seeded and custom asset/liability classifications |
| `accounts` | Flexible holdings and liabilities with a replayed current value |
| `transactions` | Contributions, income, expenses, gains, and paired transfers |
| `valuation_snapshots` | Absolute manual valuations, separate from cash flow |
| `exchange_rates` | Effective-dated manually entered decimal exchange rates |
| `goals` | Targets, links, status, priority, and return assumptions |
| `goal_contribution_plans` | Planned contribution amount and frequency |
| `login_attempts` | Persistent, bounded login rate limiting |
| `idempotency_keys` | Duplicate-submission and transfer protection |

Foreign keys are enabled. Account archive and category archive operations retain
history. All timestamps are UTC ISO-8601 strings.

## Routes and components

- `/login` — public single-user login
- `/` — net-worth dashboard
- `/accounts`, `/accounts/new`, `/accounts/[id]`, `/accounts/[id]/edit`
- `/transactions`, `/transactions/new`, `/transactions/[id]/edit`
- `/goals`, `/goals/new`, `/goals/[id]`, `/goals/[id]/edit`
- `/reports`, `/categories`, `/settings`
- `/api/export/*`, `/api/import/transactions`, `/api/backup`,
  `/api/restore`, `/api/health`
- `/offline`, `/manifest.webmanifest`, `/sw.js`

The protected layout owns the responsive sidebar, header, mobile bottom
navigation, privacy-value toggle, quick-add flow, PWA status, and toast region.
Reusable form controls and cards live in `components/ui`; business visualizations
live in `components/charts`; validated financial operations live under `lib`.

## Implementation phases

1. Scaffold and theme foundations.
2. Schema, migrations, bootstrap data, and decimal-safe calculation services.
3. Authentication and route protection.
4. Accounts, categories, transactions, valuations, and transfer workflows.
5. Dashboard, goals, projections, and reports.
6. Import/export, backup/restore, settings, and password management.
7. PWA, Docker, Kubernetes, documentation, and automated tests.
8. Lint, strict typecheck, unit/component/E2E tests, build, and acceptance review.

## Pragmatic v1 interpretations

- `Purchase` increases a tracked holding and `Sale` decreases it. Transfer
  amounts are signed internally but entered as positive values in the UI.
- Account values are stored in their own currencies. Goal targets are compared
  after currency conversion when a linked account uses another currency.
- “Investible” and “liquid” are category properties so users can reclassify
  custom holdings without changing account history.
- The initial release is dark-only; semantic CSS tokens make a future light
  theme additive rather than a component rewrite.
