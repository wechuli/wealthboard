# Wealthboard architecture

> **Status:** This multi-user architecture is implemented. The repository ships
> one baseline schema for fresh Wealthboard databases.

Wealthboard remains a single-process Next.js application. Server Components read
SQLite through Drizzle ORM, Server Actions perform validated mutations, and
Route Handlers provide user-scoped import/export and health checks. There is no
separate API service and no external identity provider.

## Decisions

- **Runtime:** Next.js App Router on Node.js with strict TypeScript. Pages that
  contain financial data are always dynamically rendered.
- **Tenancy:** One deployment supports multiple independent users. Users do not
  belong to organizations and cannot share portfolios, financial accounts,
  goals, categories, rates, or transfers.
- **Persistence:** One WAL-mode SQLite database at `DATABASE_PATH`. Monetary
  amounts are integer minor units. Exchange rates are decimal strings and all
  financial arithmetic uses `bigint` or Decimal.js.
- **Currencies:** A client-safe ISO 4217 catalog defines discoverable currency
  metadata and fresh-user defaults. Each user's settings own the base and
  enabled set. Services reject disabled currencies, while existing referenced
  currencies are preserved during migration and restore.
- **Identity:** A dedicated `users` table stores a UUID, normalized unique
  username, bcrypt password hash, status, and session version. `user_settings`
  stores one preferences row per user and contains no credentials.
- **Signup:** `/signup` is always public and is the only application-user
  creation path. There is no signup mode, environment-created identity, default
  credential, setup user, invitation, or first-user bootstrap.
- **Authentication:** Login issues a short-lived, signed, HTTP-only,
  SameSite=Strict cookie whose subject is the immutable user ID. Session
  verification loads that user and checks status, expiry, and session version.
  Failed login and signup attempts are rate-limited in SQLite.
- **Authorization:** Every private operation derives `userId` from the verified
  session and supplies it to the owning service. Queries use both owner and
  resource ID; client input is never accepted as ownership evidence.
- **Balances:** Transactions and valuations are immutable inputs to a balance
  replay. A valuation sets the balance at that point without becoming a
  contribution; later transactions apply signed effects. Editing or deleting an
  event replays the account in the same database transaction.
- **Transfers:** A transfer writes paired signed `Transfer` transactions under a
  unique transfer group and idempotency key in one SQLite transaction.
- **History:** Daily/monthly account balances are reconstructed from opening
  balances, transactions, and valuations, then converted using the most recent
  exchange rate owned by that user and effective on each date. Every point
  carries completeness metadata and affected currency codes when conversion is
  unavailable.
- **Goals:** A linked account is the source of truth for goal progress. Unlinked
  goals retain a direct current amount. Forecasts use Decimal.js future-value
  calculations and a configurable annual return assumption. Scenario
  comparisons are pure client-side projections over immutable inputs.
  Milestones are owner-scoped source records with status derived from current
  progress and due date. Behind-plan reminders are computed on authenticated
  reads; owner-scoped dismissals suppress one goal for one user-calendar month.
- **Portability:** JSON and CSV routes operate only on the authenticated user's
  records. A per-user JSON restore replaces only that user's portfolio in one
  transaction. Export version 3 includes milestones and alert dismissals;
  version 2 remains restorable with empty values for those collections. Raw
  SQLite backup and offline restore are deployment-operator commands, never
  ordinary authenticated routes.
- **Offline:** The service worker caches only the shell and static assets.
  Financial responses and mutations remain server-only. Logout clears
  user-specific client state before another user can sign in on the device.
- **AI review:** Optional on-demand reviews use a versioned, owner-scoped,
  read-only snapshot calculated by Wealthboard. The model never receives SQL or
  mutation tools and cannot become authoritative for balances, conversions,
  performance, or goals. OpenAI, DeepSeek, and operator-approved
  OpenAI-compatible endpoints share one Chat Completions adapter. Responses must
  validate against a bounded schema and cite supplied evidence IDs.
- **AI credentials and retention:** Session-only keys stay in client component
  memory for one request. Remembered keys use AES-256-GCM with a dedicated
  deployment key and immutable `userId` associated data. Usage rows contain
  metadata only and are user-deletable; prompts, responses, portfolio values,
  and provider keys are not retained. Custom endpoints require an exact
  operator allowlist and redirects are disabled.

## Isolation boundary

- All user-owned tables carry a non-null `userId` foreign key even when
  ownership can also be reached through a parent record. This makes filtering
  explicit and supports efficient owner-first indexes.
- Service functions accept session-derived `userId` as their first ownership
  argument. Pages, actions, and handlers never perform an unscoped lookup and
  then decide in the UI whether the result belongs to the user.
- Reads, writes, archives, and deletes use `userId` and resource ID together.
  A foreign resource returns not found so its existence is not disclosed.
- Same-owner relationships are enforced with composite foreign keys where
  practical and are always validated inside the mutation transaction. This
  applies to account/category, transaction/account, valuation/account,
  goal/account, plan/goal, milestone/goal, alert-dismissal/goal, and both sides
  of a transfer.
- Owner-scoped uniqueness covers category slugs, exchange-rate pair/date,
  linked goal accounts, and idempotency keys. Private cache keys include
  `userId`; user-specific settings are not stored in a process-global singleton.
- Analytics, exports, imports, search, CSV account resolution, and balance replay
  are authorization boundaries too. No aggregate may combine multiple users.

## Database schema

| Table                     | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `users`                   | Login identity, password hash, status, and session version          |
| `user_settings`           | One user's locale, display, dashboard, and goal preferences         |
| `categories`              | One user's seeded and custom classifications                        |
| `accounts`                | One user's holdings and liabilities with replayed values            |
| `transactions`            | User-owned cash flows, returns, and paired transfers                |
| `valuation_snapshots`     | User-owned absolute valuations, separate from cash flow             |
| `exchange_rates`          | One user's effective-dated decimal exchange rates                   |
| `goals`                   | One user's targets, links, status, priority, and return assumptions |
| `goal_contribution_plans` | User-owned planned contribution amounts and frequency               |
| `goal_milestones`         | Optional owner-scoped amount and date checkpoints                   |
| `goal_alert_dismissals`   | Monthly owner-scoped suppression of derived goal reminders          |
| `login_attempts`          | Bounded rate limiting by normalized username and client key         |
| `idempotency_keys`        | User-scoped duplicate-submission protection                         |
| `ai_provider_settings`    | Owner-scoped provider, sharing defaults, limits, encrypted key      |
| `ai_usage_events`         | Owner-scoped request status, latency, model, and token metadata     |

Every table except `login_attempts` is either the identity table or is owned by
one user. Foreign keys are enabled. IDs are UUIDs. Account and category archive
operations retain history. All timestamps are UTC ISO-8601 strings.

Creating a user is one transaction that inserts the identity, base/enabled
currency settings, and a copy of the default categories. User defaults are
copied, not shared mutable rows. Signup creates no exchange rates, financial
accounts, or sample portfolio data.

## Routes and components

- `/login` — public username/password login
- `/signup` — always-public user registration
- `/` — net-worth dashboard
- `/accounts`, `/accounts/new`, `/accounts/[id]`, `/accounts/[id]/edit`
- `/transactions`, `/transactions/new`, `/transactions/[id]/edit`
- `/goals`, `/goals/new`, `/goals/[id]`, `/goals/[id]/edit`
- `/reports`, `/categories`, `/settings`
- `/api/export/*`, `/api/import/transactions`, `/api/restore/user`,
  `/api/ai/review`, `/api/health`
- `/review` — on-demand, evidence-linked AI portfolio critique
- `/offline`, `/manifest.webmanifest`, `/sw.js`

The protected layout owns the responsive sidebar, header, mobile bottom
navigation, privacy-value toggle, quick-add flow, PWA status, and toast region.
Reusable form controls and cards live in `components/ui`; business visualizations
live in `components/charts`; validated financial operations live under `lib`.
The protected layout may display the current user's identity, but it does not
own authorization decisions.

## Database lifecycle

- `db/schema.ts` defines the current schema.
- `db/migrations` contains an append-only generated migration history for fresh
  databases and upgrades of existing databases.
- Startup verifies that the latest applied migration still exists unchanged,
  then applies pending migrations before serving requests.
- Disposable pre-release databases may be deleted and recreated, but persisted
  databases must be upgraded without replacing or modifying applied migrations.
- No ownership-claim or account-bootstrap path is supported.

## Product boundaries

- `Purchase` increases a tracked holding and `Sale` decreases it. Transfer
  amounts are signed internally but entered as positive values in the UI.
- Account values are stored in their own currencies. Goal targets are compared
  after currency conversion when a linked account uses another currency.
- “Investible” and “liquid” are category properties so users can reclassify
  custom holdings without changing account history.
- Application users are independent tenants. There are no administrator roles,
  invitations, shared portfolios, or cross-user transfers. Filesystem-level
  deployment operators are outside the application authorization model.
- Every application identity originates from the public signup form. Signup is
  not configurable and no environment variable can create a user.
- Usernames are the local login identifiers. Email verification, email recovery,
  OAuth, SAML, and mandatory external services remain out of scope.
- The initial release is dark-only; semantic CSS tokens make a future light
  theme additive rather than a component rewrite.
- AI output remains explanatory, non-authoritative, and non-advisory. Reviews
  are never persisted, cannot execute financial changes, and omit unreliable
  annualized performance until deterministic cash-flow-aware metrics exist.
