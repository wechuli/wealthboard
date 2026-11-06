# Wealthboard architecture

> **Status:** The Go/Vite/PostgreSQL runtime is implemented, with the limitations
> called out below and in the user guides. The repository ships
> append-only Goose migrations for fresh and existing PostgreSQL databases.
> Sections explicitly marked "Planned" describe future work and are not runtime
> guarantees.

Wealthboard is a Go HTTP service backed by PostgreSQL. It exposes the versioned
JSON API and serves a compiled Vite/React single-page client. One optional OIDC
provider may authenticate internal users.

PostgreSQL is a fresh-start boundary, not an in-place SQLite migration. The
repository intentionally has no SQLite importer or dual-write path. The Phase 6
cutover removed the legacy Next.js, Drizzle, and SQLite runtime. Frozen parity
fixtures and archived migration history remain as non-executable evidence.

## Decisions

- **Runtime:** Go 1.27 HTTP API and a strict-TypeScript Vite/React client.
- **Tenancy:** One deployment supports multiple independent users. Users do not
  belong to organizations and cannot share portfolios, financial accounts,
  goals, categories, rates, or transfers.
- **Persistence:** PostgreSQL at required `DATABASE_URL`. Monetary
  amounts are integer minor units in `bigint` columns. Exchange rates use exact
  `numeric` columns and decimal strings at the API boundary. All
  authoritative financial arithmetic uses checked integers plus `math/big`
  integer and rational helpers.
- **Currencies:** A client-safe ISO 4217 catalog defines discoverable currency
  metadata and fresh-user defaults. Each user's settings own the base and
  enabled set. Services reject disabled currencies, while existing referenced
  currencies are preserved during migration and restore.
- **Identity:** A dedicated `users` table stores a UUID, normalized unique
  internal handle, nullable bcrypt password hash, status, and session version.
  `oidc_identities` maps one canonical issuer/opaque subject to one internal
  UUID. `user_settings` stores preferences and contains no credentials.
- **Authentication policy:** `AUTH_METHODS` selects local, OIDC-only, or hybrid
  authentication at startup. Local remains the default. `/signup` exists only
  when local is enabled; validated first OIDC login is the only other
  provisioning path. Neither path creates portfolio data.
- **Authentication:** Local or OIDC login issues the same short-lived, signed, HTTP-only,
  SameSite=Strict cookie whose subject is the immutable user ID. Session
  verification loads that user and checks status, expiry, and session version.
  Failed login/signup and bounded OIDC start/callback traffic are rate-limited
  in PostgreSQL using the socket peer IP, not forwarding headers. The legacy
  `TRUST_PROXY_HEADERS` setting has no effect in Go.
- **Browser request protection:** Login/signup require the exact trusted origin.
  Authenticated browser mutations also require the session's `X-CSRF-Token`.
  `/api/v1/session` supplies the browser's session identity and CSRF token.
- **API keys:** External clients use owner-scoped bearer keys with explicit
  `portfolio:read`, `portfolio:write`, `imports:write`, or `exports:read`
  scopes. Only the token hash and metadata are retained. Browser
  sessions alone may manage keys, credentials, and user restores; sensitive
  browser mutations additionally require origin and CSRF checks. Revocation
  and expiry are checked independently of browser session version.
- **OIDC protocol:** Go `net/http`, standard-library cryptography, and
  `github.com/golang-jwt/jwt/v5` perform exact-issuer discovery,
  Authorization Code + PKCE S256, state/nonce validation, bounded token exchange,
  cached remote JWKS, and RS256 verification. The callback is
  `${APP_URL}/api/v1/auth/oidc/callback`. Encrypted AES-256-GCM transaction and
  reauthentication cookies are distinct from the application session. No
  provider code, token, verifier, or claim payload is retained.
- **Method management:** Hybrid links are explicit and require fresh local
  password confirmation. Local credential enable/remove operations require an
  exact linked-identity reauthentication. Identity claims never trigger merging,
  and successful changes increment session version.
- **Readiness:** Health checks reject mode changes that strand active
  users. OIDC-only also requires valid discovery. Hybrid remains ready through a
  temporary provider outage so local login continues to work. Configuration and
  migration failures stop startup; authentication readiness is checked on
  `/api/health/ready`, not before the listener starts.
- **Authorization:** Every private operation derives `userId` from the verified
  session or API-key principal and supplies it to the owning service. Queries
  use both owner and resource ID; client input is never accepted as ownership
  evidence.
- **Institutions:** Each user owns a private directory of financial providers.
  Accounts may link one institution through a composite owner foreign key or
  remain self-custodied. Names are normalized for per-user uniqueness; archived
  institutions retain existing links but cannot receive new ones.
- **Balances:** Transactions and valuations are source inputs to a balance
  replay. A valuation sets the balance at that point without becoming a
  contribution; later transactions apply signed effects. Editing or deleting an
  event replays the account in the same database transaction.
- **Transfers:** A transfer writes paired signed `Transfer` transactions under a
  unique transfer group and idempotency key in one PostgreSQL transaction.
- **History:** Daily/monthly account balances are reconstructed from opening
  balances, transactions, and valuations, then converted using the most recent
  exchange rate owned by that user and effective on each date. Every point
  carries completeness metadata and affected currency codes when conversion is
  unavailable.
- **Exchange-rate management:** Settings groups observations by unordered
  currency pair. Creation inserts a directional pair/date and conflicts with an
  existing same-direction observation on that date; it also rejects an existing
  reverse-direction pair. UI corrections use separate delete/create requests,
  so they are not atomic. Rate writes do not rebuild cached position-account
  balances. Go chart/report calculations select effective-dated direct or
  inverse rates dynamically and never look ahead. The settings summary instead
  shows the newest observation, including future dates, and warns when it is
  more than 30 days old; this display is not proof of historical rate coverage.
- **Goals:** A linked account is the source of truth for goal progress. Unlinked
  goals retain a direct current amount. The current read path uses the linked
  account's cached value; cross-currency links are marked incomplete rather
  than converted, and position-price completeness is not fully propagated.
  Projections and non-persistent scenario comparisons are calculated in Go via
  `/api/v1/goals/{id}/scenarios`, not as authoritative browser calculations.
  Active, same-owner asset-account linking is validated inside goal mutations.
  Milestones are owner-scoped source records with status derived from current
  progress and due date. Behind-plan reminders are computed on authenticated
  reads; owner-scoped dismissals suppress one goal for one user-calendar month.
- **Estate planning:** `internal/service/estate_mutations.go` owns one private plan
  per user, beneficiaries, account directives, primary/contingent basis-point
  allocations, residue, and retained SHA-256 snapshots. Live valuation remains
  incomplete; foreign-currency values are not converted into complete totals.
  Live review checks are currently derived in the client. Snapshot creation
  uses cached values, stores empty review items, and marks mathematical
  completeness without those checks; that flag is not a validation guarantee.
  It never changes account ownership,
  balances, sessions, or institution-held designations. Liabilities remain a
  separate estimate rather than inheritable allocations.
- **Estate documents:** The print surface renders a retained snapshot, not live
  mutable data. Its as-of date is the generation date in the user's timezone,
  not an arbitrary historical replay date. Exact values, contacts, references,
  and notes are print opt-ins, and global privacy masks rendered values. These
  controls do not redact retained/downloaded JSON. Restore validates the stored
  content hash; ordinary snapshot reads do not recompute it. The hash proves
  neither financial completeness nor legal validity.
  The document identifies itself as planning information rather than a legal
  will. No death trigger, executor access, notification, custody, or transfer
  automation exists.
- **Portability:** JSON and CSV routes operate only on the authenticated user's
  records. A per-user JSON restore replaces only that user's portfolio in one
  transaction. Export version 8 includes investment history, grouped cash,
  account conversions, freshness settings, and retained estate snapshot hashes.
  Versions 2 through 8 remain restorable through deterministic compatibility
  upgrades; pre-v6 archives restore no estate data or inferred positions.
  Account history import uses stateless account-scoped preview and atomic commit
  routes with a strict CSV/JSON v1 contract and SHA-256 confirmation. Raw
  PostgreSQL custom-format backup and maintenance-mode restore are
  deployment-operator commands, never ordinary authenticated routes.
- **Offline and updates:** Production registers a service worker that precaches
  only the offline page, manifest, and icons. Failed navigation falls back to
  the offline page. `/api` is never intercepted, authenticated data is never
  cached, and mutations are never queued. The client exposes connection state,
  blocks marked financial forms while offline, and reports a waiting update.
  Offline portfolio reads are not a runtime guarantee.
- **No built-in AI:** Wealthboard calls no AI provider and stores no AI keys.
  The in-app portfolio review (migration 00006) and bring-your-own-key import
  conversion (migration 00008 drops `ai_provider_settings` and
  `ai_usage_events` and the `ai:invoke` API key scope) were removed. Assistants
  connect through MCP below; statement conversion is a copyable prompt the user
  runs in their own AI chat.
- **AI assistant connections (MCP):** `internal/mcpserver` serves a
  stateless Streamable HTTP endpoint at `/mcp` with the official Go MCP SDK.
  The SDK's bearer middleware verifies a personal API key through
  `webauth.APIKeyService` (or an OAuth token), a small middleware requires
  `portfolio:read`, and cookies are never read;
  tool handlers take `userId` only from the verified token. Tools call
  `CoreReadService`, `GoalsReportsService`, and `InsightsService` and map their
  results to MCP-specific output types with string IDs and
  `{minor, decimal, currency}` money from `domain.FormatMinorUnits`, so
  account references, notes, and import external IDs never leave the server.
  A per-key or per-grant fixed-window limiter (`internal/ratelimit`) runs in
  each process. Each request is served by one of three server instances:
  Summary (aggregate tools only), Detailed read-only, or Detailed with the
  `record_transaction` and `record_valuation` write tools when the token
  carries `portfolio:write`. Write tools parse decimal strings exactly with
  `domain.ParseDecimalAmount` and call `LedgerService.CreateTransaction` and
  `CreateValuation`, so ledger validation, idempotency, and balance replay are
  shared with the REST API.
- **MCP OAuth:** `internal/oauth` is the authorization server for `/mcp`, with
  `APP_URL` as issuer and `APP_URL/mcp` as the only resource. It serves RFC 9728
  and RFC 8414 metadata, Dynamic Client Registration, the authorization-code
  flow with `S256` PKCE, rotating refresh tokens, and RFC 7009 revocation from
  `/.well-known/*` and `/oauth/*`. `/oauth/authorize` stores a ten-minute
  request and redirects to the client app's `/oauth/consent` route, which uses
  the normal session and `ConnectedAppsHandler` (`/api/v1/oauth/requests/*`,
  `/api/v1/connected-apps*`) to approve or decline. Migration 00007 adds
  `oauth_clients`, `oauth_authorization_requests`, `oauth_grants`,
  `oauth_authorization_codes`, `oauth_tokens`, and `oauth_tool_calls`; clients
  are not user-owned, and everything else belongs to a user through its grant.
  Codes and tokens are stored as SHA-256 hashes, and `/mcp` verifies `wbo_at_`
  tokens through `oauth.Service.VerifyAccessToken`. Client ID Metadata
  Documents are not supported, to avoid outbound fetches of client-chosen URLs.
## Runtime and cutover boundary

The supported production request path is browser or API client to the Go/Chi
process, then PostgreSQL. Go serves `/api/v1/*`, health probes, compiled Vite
assets, and the SPA fallback. There is no production Next.js process, React
server rendering, Server Action, Node.js API handler, or SQLite database.

Production has no JavaScript runtime, and the server never parses untrusted
document formats: imports accept only the strict CSV and JSON formats.

Phase 6 acceptance and removal evidence is recorded in
`docs/admin/cutover-evidence.md`.

## Implementation layout

- `cmd/wealthboard` wires the HTTP service and operator commands.
- `internal/api` owns Chi routes, HTTP validation, authentication checks, and
  `application/problem+json` responses.
- `internal/auth` owns local/OIDC authentication, browser sessions, CSRF,
  personal API keys, and PostgreSQL-backed rate limiting.
- `internal/service` owns persistence, business operations, and the current
  exact financial arithmetic/replay helpers. `internal/domain` currently
  contains shared currency metadata and validation.
- `db/postgres/migrations` is the embedded Goose history and sqlc schema input.
  `db/postgres/queries` generates accessors in `internal/database/generated`;
  service transactions also contain explicit `database/sql` queries.
- `internal/operator` invokes PostgreSQL backup/restore tools, and
  `internal/static` serves the built client from `WEB_DIST_PATH`.
- `api/openapi.yaml` defines the HTTP contract and generates
  `web/src/api/schema.ts`. `web/src/api` handles browser requests through
  `openapi-fetch`; React routes, components, and presentation helpers live
  under `web/src`. The client uses React Router 8 (`react-router`), TanStack
  Query for user-scoped server state, `radix-ui` primitives, `cmdk` for the
  command palette, and d3-based chart components in
  `web/src/components/charts`. Its "Quiet Ledger" design system is described in
  `web/docs/design-direction.md`, with tokens in `web/src/styles/tokens.css`.

The Go binary does not load `.env` files or embed the Vite assets into the
executable. Direct installations must provide process environment variables
and the built asset directory. The container packages both the binary and assets.

## Position-account architecture

Go owns position source records, valuation, conversion, imports, advanced
actions, and portability. Downstream goal/estate completeness still has the
limitations described above; those consumers do not yet satisfy every
cross-feature requirement in `SPEC.md`.

- Existing accounts retain `balance` tracking, where transactions and absolute
  valuation snapshots replay to one monetary value. An opt-in `positions`
  tracking mode represents an investment account containing a cash
  subledger and one or more long-only instruments. A tracking mode cannot be
  toggled after financial activity; conversion requires an explicit as-of
  workflow that archives the source effective on the conversion date, creates
  a linked replacement, and preserves the earlier account history without
  inferring units.
- Position-account value at a date is derived from replayed cash plus each
  replayed instrument quantity multiplied by its latest effective-dated price,
  with effective-dated currency conversion when the quote and account
  currencies differ. `accounts.currentValueMinor` remains a rebuildable cache
  for existing goals, estate planning, dashboards, and reports.
- Owner-scoped instruments, immutable position events, and effective-dated
  security prices are the source records. Current quantities are projections,
  not independently editable authoritative balances. Same-owner relationships
  use composite foreign keys and every lookup, aggregate, import, and cache key
  includes `userId`.
- Quantities and unit prices use canonical decimal strings and exact
  `math/big` rational arithmetic so
  fractional units and sub-minor-unit quotes remain exact. Gross amounts, fee
  amounts, cash effects, and derived account values remain integer minor units
  with their currencies retained; an applied settlement rate is a canonical
  decimal string. Rounding occurs only at a documented monetary boundary.
- A buy atomically increases quantity and decreases account cash by settlement
  amount plus fees. A sale decreases quantity and increases cash by proceeds
  less fees. Cross-currency trades retain the actual account-currency cash
  effect and applied settlement rate rather than substituting a later market
  rate. Dividends and interest increase cash, fees reduce cash, and a
  reinvestment is a grouped income event plus buy committed atomically.
  Existing `Purchase` and `Sale` retain their current balance-account meanings
  and are not reinterpreted as trades.
- In-kind transfers write paired owner-scoped `transfer_out` and `transfer_in`
  events. Selected corporate actions use explicit split, spin-off, and merger
  source records with positive ratios and related-instrument relationships.
  Every grouped edit or deletion replays all affected accounts in one PostgreSQL
  transaction. Same-date events use an explicit per-account sequence before
  timestamp and ID tie-breakers.
  Mutations and restores validate recorded spin-off and merger entitlements
  against the earlier source quantity. Incompatible historical changes are
  rejected atomically; dependent actions must be removed and recorded again.
  Restore validation replays each account independently.
- Position accounts use price snapshots rather than account valuations to
  change market value. An optional owner/account-scoped broker reconciliation
  may retain its observation date and reported cash/total, but it cannot
  overwrite instrument quantities, prices, or derived values. Retaining or
  deleting it changes no financial source record. Missing prices or exchange
  rates make affected current and historical totals incomplete; stale prices
  remain visible with their as-of date and provenance. Stock, ETF, and fund
  freshness thresholds are user-configurable. Detailed issues carry the
  affected range, instrument, currency, last price, source, and provenance where
  the account, chart/report, or import read model supplies them. Goal and estate
  consumers do not yet propagate the same completeness information.
  Snapshot and import-preview price selection share a split-date cutoff:
  quotes before the latest recorded split cannot value split-adjusted holdings.
- Account History Import v1 remains unchanged. Position accounts receive a
  separate versioned investment-history contract for instruments, opening
  holdings, trades, cash activity, and prices. Identical external IDs are
  skipped, conflicts fail, and interdependent investment activity commits only
  when the complete remaining event sequence is valid. Each account mode
  rejects the other mode's format before parsing financial rows.
  Imported prices rebuild every affected same-owner account cache inside the
  import transaction, including accounts other than the import target.
- User portability version 8 adds conversion provenance, grouped cash links,
  explicit event ordering, selected corporate actions, and freshness settings
  to the version 7 position collections. Version 7 upgrades deterministically;
  versions 2 through 6 restore as balance-mode accounts with empty position
  collections. Every relationship and group ID is owner-validated and remapped.
- Movement attribution uses a deterministic position bridge separating
  external cash, income, fees, adjustments, internal trade cash, quantity,
  price, and currency movement. Annualized position returns remain explicitly
  unavailable until validated cash-flow-aware TWR methodology is implemented.
- Privacy mode masks quantities, unit prices, cash, reference cost basis, and
  derived values. Instrument names and symbols remain visible for account
  identification; raw identifiers and private notes follow their existing
  explicit inclusion controls.
- The first supported instruments are long-only stocks, ETFs, and directly
  priced funds. Tax-lot accounting, tax-grade realized gains, bonds quoted as a
  percentage of par, options, shorts, margin, derivatives, multi-leg trades,
  automatic trading, and mandatory market-data providers remain outside the
  initial extension.

## Statement conversion with an AI chat

Imports accept only the strict Account History Import v1 and Investment History
v1 formats. To convert a bank or brokerage statement, the import page offers a
copyable prompt (`web/src/features/imports/ai-prompts.ts`) that the user pastes
with the statement into an AI chat they choose. The prompt states the exact
headers, field rules, currency precision, and the derived external ID rule; a
unit test keeps it in sync with the import templates. Wealthboard never sends
the prompt or the statement anywhere. The returned file goes through the normal
preview and hash-checked commit, so AI output never bypasses deterministic
validation.

## Isolation boundary

- All user-owned tables carry a non-null `userId` foreign key even when
  ownership can also be reached through a parent record. This makes filtering
  explicit and supports efficient owner-first indexes.
- Service functions accept verified-principal-derived `userId` as their ownership
  argument. API handlers and client pages never perform an unscoped lookup and
  then decide in the UI whether the result belongs to the user.
- Reads, writes, archives, and deletes use `userId` and resource ID together.
  A foreign resource returns not found so its existence is not disclosed.
- Same-owner relationships are enforced with composite foreign keys where
  practical and are always validated inside the mutation transaction. This
  applies to account/category, account/institution, transaction/account, valuation/account,
  goal/account, plan/goal, milestone/goal, alert-dismissal/goal,
  estate-plan/directive/account/beneficiary/allocation/snapshot, and both sides
  of a transfer.
- Owner-scoped uniqueness covers category slugs, exchange-rate pair/date,
  linked goal accounts, and idempotency keys. Private cache keys include
  `userId`; user-specific settings are not stored in a process-global singleton.
- Analytics, exports, imports, search, CSV account resolution, and balance replay
  are authorization boundaries too. No aggregate may combine multiple users.

## Database schema

| Table                          | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `users`                        | Login identity, password hash, status, and session version                |
| `oidc_identities`              | Internal-user mapping for one canonical issuer and opaque subject         |
| `api_keys`                     | Owner-scoped token hashes, scopes, expiry, usage, and revocation metadata  |
| `user_settings`                | One user's locale, display, dashboard, and goal preferences               |
| `categories`                   | One user's seeded and custom classifications                              |
| `institutions`                 | One user's financial-provider directory and reference details             |
| `accounts`                     | One user's holdings and liabilities with replayed values                  |
| `investment_instruments`       | Owner-scoped security identifiers and quote currencies                    |
| `account_conversions`          | Source/replacement provenance for balance-to-position conversion          |
| `position_events`              | Ordered instrument quantity events and grouped investment activity        |
| `security_prices`              | Effective-dated instrument prices and source metadata                     |
| `position_reconciliations`     | Broker observations that do not overwrite calculated account values       |
| `transactions`                 | User-owned cash flows, returns, transfers, and account-scoped source IDs  |
| `valuation_snapshots`          | User-owned absolute valuations, separate from cash flow                   |
| `exchange_rates`               | One user's effective-dated decimal exchange rates                         |
| `goals`                        | One user's targets, links, status, priority, and return assumptions       |
| `goal_contribution_plans`      | User-owned planned contribution amounts and frequency                     |
| `goal_milestones`              | Optional owner-scoped amount and date checkpoints                         |
| `goal_alert_dismissals`        | Monthly owner-scoped suppression of derived goal reminders                |
| `beneficiaries`                | Private people, organizations, and trusts referenced by one user's plan   |
| `estate_plans`                 | One user's current estate-plan metadata                                   |
| `estate_account_directives`    | Estate inclusion, ownership share, transfer context, and method per asset |
| `estate_allocations`           | Primary or contingent beneficiary basis-point shares per asset            |
| `estate_residuary_allocations` | Primary or contingent shares of otherwise unallocated property            |
| `estate_plan_snapshots`        | Immutable versioned summary JSON with as-of date and SHA-256 hash         |
| `login_attempts`               | Bounded rate limiting by normalized username and client key               |
| `idempotency_keys`             | User-scoped duplicate-submission protection                               |

Every application table except `login_attempts` is either the identity table or
is owned by one user. Goose separately maintains `goose_db_version`.
Foreign keys enforce relationships. Resource IDs are UUIDs. Account and category archive
operations retain source records. Timestamps are stored in PostgreSQL and
serialized in UTC.

Goose migrations under `db/postgres/migrations` are the append-only schema
authority. SQL files under `db/postgres/queries` feed sqlc generation. Legacy
Drizzle migrations are archived under `docs/archive/drizzle-migrations` as
provenance only and are not applied to PostgreSQL.

Archived accounts are excluded from current and historical totals, activity,
comparisons, live estate views, goal progress, ordinary CSV reports, and
selectors. Their cached values are frozen until restore. Explicit archive
management under Settings exposes names and lifecycle controls only; full JSON
backups retain the source records. Permanent deletion requires an archived,
owner-scoped account and exact-name confirmation. It clears goal links and
conversion provenance before cascading account records, and rejects deletion
while a cash or position transfer has records in another account. Shared
instruments and prices, goals, and immutable estate snapshots are retained.

Creating a user is one transaction that inserts the identity, base/enabled
currency settings, and a copy of the default categories. User defaults are
copied, not shared mutable rows. Signup creates no exchange rates, financial
accounts, goals, or sample portfolio data. The same applies to OIDC JIT.

## Routes and components

- `/sign-in` — renders only deployment-enabled login methods
- `/sign-up` — public local registration only when local authentication is enabled
- `/api/v1/auth/oidc/{start,callback}` — public only when OIDC is enabled
- `/api/v1/auth/config` — public deployment-enabled authentication methods
- `/api/v1/session`, `/api/v1/auth/principal`, `/api/v1/api-keys`
- `/` — Home: net worth, allocation, flows, recent activity, goals, and
  attention items
- `/accounts` (`?show=archived` for archived-account recovery), `/accounts/new`,
  `/accounts/[id]`, `/accounts/[id]/import`; account detail opens its edit,
  trade, conversion, reconciliation, and corporate-action sheets from query
  parameters
- `/instruments/[id]` — one instrument's prices and holdings across accounts
- `/activity` — the cross-account ledger
- `/goals`, `/goals/[id]`
- `/insights/{net-worth,allocation,income,compare}`
- `/settings/{profile,currencies,preferences,categories,institutions,instruments,security,api-keys,connected-apps,data}`
- `/estate`, `/estate/{beneficiaries,distribution,summary}`, and
  `/estate/snapshots/[id]` — private estate planning and retained print views
- `/api/v1/exports/*`, `/api/v1/accounts/[id]/history-import/{preview,commit}`, `/api/v1/restore/user`,
  `/api/v1/accounts/[id]/investment-import/{preview,commit}`,
  `/api/v1/estate/snapshots/[id]`, `/api/health/{live,ready}`
- `/mcp` — MCP endpoint for AI assistants, authenticated with `portfolio:read`
  API keys or OAuth access tokens; write tools need `portfolio:write` too;
  removed when `MCP_ENABLED=false`
- `/.well-known/oauth-{protected-resource,authorization-server}` and
  `/oauth/{authorize,token,register,revoke}` — the MCP authorization server
- `/oauth/consent` — the client-app page where a signed-in user approves an
  assistant; `/settings/connected-apps` lists and disconnects them
- Earlier client paths such as `/login`, `/signup`, `/transactions`, `/reports`,
  `/categories`, `/institutions`, `/instruments`, `/accounts/archived`,
  `/accounts/[id]/edit`, `/goals/new`, and `/labs/*` redirect to their new
  locations. The retired `/review` page redirects to the home page, and
  `/settings/ai` to Connected apps.
- `/offline.html`, `/manifest.webmanifest`, `/sw.js`

The protected layout owns the responsive sidebar, header, mobile bottom
navigation, command palette, privacy-value toggle, quick-add flow, PWA status,
and toast region.
Reusable form controls, cards, and visualizations live in `web/src/components`;
authoritative validation and financial operations live in Go's `internal/api`,
`internal/service`, and `internal/domain`, not browser helpers.
The protected layout may display the current user's identity, but it does not
own authorization decisions.

## Database lifecycle

- `db/postgres/migrations` contains the embedded append-only migration history for fresh
  databases and upgrades of existing databases.
- Startup applies pending migrations before serving requests; readiness checks
  the expected schema version. A session-level PostgreSQL advisory lock
  serializes migrations across replicas and operator `migrate` commands.
- Disposable pre-release databases may be deleted and recreated, but persisted
  databases must be upgraded without replacing or modifying applied migrations.
- No ownership-claim or account-bootstrap path is supported.

## Product boundaries

- `Purchase` increases a tracked holding and `Sale` decreases it. Transfer
  amounts are signed internally but entered as positive values in the UI.
- Account values are stored in their own currencies. Cross-currency linked-goal
  conversion remains incomplete in the current read model; do not treat the
  cached account value as already converted to the goal currency.
- “Investible” and “liquid” are category properties so users can reclassify
  custom holdings without changing account history.
- Application users are independent tenants. There are no administrator roles,
  invitations, shared portfolios, or cross-user transfers. Filesystem-level
  deployment operators are outside the application authorization model.
- Estate beneficiaries are planning records, never application identities,
  account owners, or authorized viewers. Matching by username, email, OIDC
  claims, or another mutable identity attribute is prohibited.
- Every application identity originates from local signup or a validated OIDC
  first login. No environment variable, default credential, invitation, or
  unauthenticated ownership claim can create a user.
- Usernames are local identifiers or collision-resistant generated handles.
  Email linking/recovery, SAML, multiple simultaneous issuers, and mandatory
  external services remain out of scope.
- Appearance is a non-sensitive browser-local preference with System, Light,
  and Dark choices. A bootstrap before React renders resolves semantic CSS tokens;
  appearance is not user settings, financial data, or portable state.
- AI output remains explanatory, non-authoritative, and non-advisory. Files
  produced by an AI chat are untrusted input; deterministic validation and
  explicit user confirmation remain the sole path to persistence. MCP write
  tools only add records through the same ledger validation.
