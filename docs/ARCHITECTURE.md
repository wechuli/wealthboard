# Wealthboard architecture

> **Status:** This multi-user architecture is implemented. The repository ships
> one baseline schema for fresh Wealthboard databases. Sections explicitly
> marked "Planned" describe future work and are not runtime guarantees.

Wealthboard remains a single-process Next.js application. Server Components read
SQLite through Drizzle ORM, Server Actions perform validated mutations, and
Route Handlers provide user-scoped import/export and health checks. There is no
separate API service. One optional OIDC provider may authenticate internal users.

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
  in SQLite.
- **OIDC protocol:** Native fetch plus `jose` performs exact-issuer discovery,
  Authorization Code + PKCE S256, state/nonce validation, bounded token exchange,
  cached remote JWKS, and RS256 verification. Encrypted A256GCM transaction and
  reauthentication cookies are distinct from the application session. No
  provider code, token, verifier, or claim payload is retained.
- **Method management:** Hybrid links are explicit and require fresh local
  password confirmation. Local credential enable/remove operations require an
  exact linked-identity reauthentication. Identity claims never trigger merging,
  and successful changes increment session version.
- **Readiness:** Startup and readiness reject mode changes that strand active
  users. OIDC-only also requires valid discovery. Hybrid remains ready through a
  temporary provider outage so local login continues to work.
- **Authorization:** Every private operation derives `userId` from the verified
  session and supplies it to the owning service. Queries use both owner and
  resource ID; client input is never accepted as ownership evidence.
- **Institutions:** Each user owns a private directory of financial providers.
  Accounts may link one institution through a composite owner foreign key or
  remain self-custodied. Names are normalized for per-user uniqueness; archived
  institutions retain existing links but cannot receive new ones.
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
- **Exchange-rate management:** Settings groups observations by unordered
  currency pair while preserving effective-dated source rows. Updates upsert a
  directional pair/date; corrections and deletions require an owner-scoped ID
  and recalculate position account projections in the same transaction. New
  inverse-only duplicates are rejected; existing bidirectional histories remain
  reviewable without automatic data conversion. Current missing/stale rate
  issues are distinct from historical pair/date gaps. Freshness uses the selected
  rate's effective date and a one-calendar-month threshold; stale rates remain
  usable and historical conversions never look ahead.
- **Goals:** A linked account is the source of truth for goal progress. Unlinked
  goals retain a direct current amount. Forecasts use Decimal.js future-value
  calculations and a configurable annual return assumption. Scenario
  comparisons are pure client-side projections over immutable inputs.
  Milestones are owner-scoped source records with status derived from current
  progress and due date. Behind-plan reminders are computed on authenticated
  reads; owner-scoped dismissals suppress one goal for one user-calendar month.
- **Estate planning:** `lib/services/estate-planning.ts` owns one private plan
  per user, beneficiaries, account directives, primary/contingent basis-point
  allocations, residue, converted indicative values, deterministic review
  items, and immutable SHA-256 snapshots. It never changes account ownership,
  balances, sessions, or institution-held designations. Liabilities remain a
  separate estimate rather than inheritable allocations.
- **Estate documents:** The print surface renders a minimized retained snapshot,
  not live mutable data. Exact values, contacts, references, and notes are
  independent opt-ins, and the global privacy setting remains authoritative.
  The document identifies itself as planning information rather than a legal
  will. No death trigger, executor access, notification, custody, or transfer
  automation exists.
- **Portability:** JSON and CSV routes operate only on the authenticated user's
  records. A per-user JSON restore replaces only that user's portfolio in one
  transaction. Export version 6 includes transaction external IDs and estate
  plans with retained snapshot integrity hashes. Versions 2 through 5 remain
  restorable; legacy transactions receive null external IDs and pre-v6 archives
  begin with an empty estate plan. Legacy account institution strings are
  normalized into owner-scoped records.
  Account history import uses stateless account-scoped preview and atomic commit
  routes with a strict CSV/JSON v1 contract and SHA-256 confirmation. Raw
  SQLite backup and offline restore are deployment-operator commands, never
  ordinary authenticated routes.
- **Offline and updates:** Service workers are production-only; development
  unregisters Wealthboard's worker and removes only Wealthboard caches. The
  production worker precaches the offline shell and uses network-first static
  application assets with cached offline fallback so stale code cannot hydrate
  against newer server HTML. It never caches authenticated financial responses
  or queues mutations. Logout clears user-specific client state before another
  user can sign in on the device.
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

## Position-account architecture

Position source records, derived values, conversion, imports, advanced actions,
portability, and downstream completeness are part of the current runtime
contract.

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
- Quantities and unit prices use canonical decimal strings and Decimal.js so
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
  Every grouped edit or deletion replays all affected accounts in one SQLite
  transaction. Same-date events use an explicit per-account sequence before
  timestamp and ID tie-breakers.
- Position accounts use price snapshots rather than account valuations to
  change market value. An optional owner/account-scoped broker reconciliation
  may retain its observation date and reported cash/total, but it cannot
  overwrite instrument quantities, prices, or derived values. Retaining or
  deleting it changes no financial source record. Missing prices or exchange
  rates make affected current and historical totals incomplete; stale prices
  remain visible with their as-of date and provenance. Stock, ETF, and fund
  freshness thresholds are user-configurable. Detailed issues carry the
  affected range, instrument, currency, last price, source, and provenance to
  account, goal, estate, dashboard, report, and import-preview consumers.
- Account History Import v1 remains unchanged. Position accounts receive a
  separate versioned investment-history contract for instruments, opening
  holdings, trades, cash activity, and prices. Identical external IDs are
  skipped, conflicts fail, and interdependent investment activity commits only
  when the complete remaining event sequence is valid. Each account mode
  rejects the other mode's format before parsing financial rows.
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

## LLM-assisted text-file import

The implemented conversion layer sits upstream of existing import services;
it is not a financial write path. Strict v1 contracts and the browser-only
manual prompt workflow remain unchanged. OCR/image processing remains backlog AI3.

1. The account import UI offers direct structured import or explicit AI
   conversion. Account-scoped POST routes,
   `/api/accounts/[id]/import/{extract,convert}`, handle bounded multipart/JSON concerns,
   verifies the session and trusted origin, and delegates to a server-only
   service in `lib/services/import-conversion.ts`. Resolve the active account by `userId` and account ID
   before expensive parsing or external calls; return not found for foreign
   accounts. The account's tracking mode selects the target schema.
2. Bounded local parsers prepare source text/tables and stable page/sheet/row
   references for user review, selection, and redaction before external
   submission. `lib/services/import-source.ts` handles UTF-8 CSV, TSV, JSON, and
   TXT; a terminable Node worker in `scripts/extract-import-source.mjs` handles
   XLSX, text PDFs, and DOCX using yauzl, fast-xml-parser, PDF.js, and Mammoth.
   XLSX numeric cells remain original strings. Formula caches and excluded
   image/Word/PDF content have review warnings; no OCR is performed. Enforce
   extension/content validation, 5 MB source size, 64 KB/1,000 extracted sections,
   100 PDF pages, 20 sheets, 20 MB expanded archives/2,000 ZIP entries, and a
   15-second document timeout. Workers have bounded V8 heap/stack limits and
  receive no deployment environment or AI credentials. An optional PDF
  `documentPassword` is accepted only by the authenticated extraction multipart
  route, validated as a single untrimmed string of at most 1,024 characters,
  and passed to PDF.js through the worker message. It is never included in
  extraction responses, source records, configuration, conversion requests,
  provider prompts, logs, or persistent storage. PDF.js password exceptions
  map to `password_required` and `incorrect_password` with fixed safe messages;
  each attempt terminates its worker and retries explicitly resend the file.
  The masked client field clears at submission, file change, cancellation, or
  unmount. No server-side document/password retry cache is introduced.
  Compound-file Office headers are rejected as encrypted-or-legacy containers,
  not assumed to prove encryption. Encrypted ZIP entries are also rejected with
  export guidance. Office password-to-open decryption remains unsupported;
  worksheet/workbook and Word editing-protection metadata need no decryption.
  Never execute macros, formulas, embedded scripts, or external references.
  Reject unsupported encryption, corrupt, or over-limit input rather than
  silently truncating.
3. After explicit per-request consent, resolve the current user's provider and
   credentials through `lib/services/ai-provider.ts`. Reuse encrypted-key
   handling, endpoint allowlisting, disabled redirects, cancellation, and safe
   errors. Existing usage reservation/completion functions enforce shared
   review/conversion rate and monthly token budgets. A configuration fingerprint
   binds consent to the reviewed provider/model/output limit and account context.
   Record only owner-scoped status/model/token/latency metadata; no source names,
   financial values, prompts, output, or credentials. Reserve conservatively
   from prompt bytes plus the output ceiling; retain the reservation on failed
   conversion when usage is unknown. Requests have bounded streaming body reads
   and active preparations are limited to one per user/four per module instance.
4. `lib/ai/provider.ts` exposes a separate extraction operation and strict Zod
   schema from `lib/ai/import-schemas.ts`; it never calls the portfolio-review
   snapshot builder. OpenAI uses native structured output through Responses;
   DeepSeek/custom models must support text Chat Completions and JSON output.
   The configured model ID is not discovered or probed during settings save;
   incompatible requests fail without model/provider substitution. Both paths
   validate locally and reject refusals, malformed JSON, and incomplete output.
   Provider response bodies are bounded to 8 MB, extracted JSON to 5 MB, and
   candidate records to 1,000. No document or vision model capability is needed.
   The model receives only approved text, minimal account/schema context,
   and no internal owner/account IDs, SQL, tools, URL fetching, or write access.
   Filenames and source location labels are not sent. Treat source text as
   untrusted data, including instructions embedded in it.
5. Validate a bounded extraction envelope containing candidate v1 records,
   source references, exclusions, and issues, with metadata outside the canonical
   contract. The conversion service maps string-valued fields deterministically
   to canonical JSON; money, dates, sign rules, identifiers, and replay stay in
   their existing deterministic modules. Prefer original external IDs; otherwise
   derive cash IDs through the existing date/type/amount rule and other IDs
   through versioned normalized-field hashes, rejecting collisions. An instrument
   without an original external ID requires a stable source identifier. Supplied
   IDs must appear in cited source text. Unknown references fail; unaccounted
   source sections, currency mismatches, and deterministic preview errors become
   visible review issues. Users resolve/correct the editable draft and acknowledge
   exclusions before a fresh preview. Section coverage and schema validity are
   not proof that every event was interpreted correctly.
6. Keep the source review and editable/downloadable draft transient. After
   resolution, serialize the canonical file and submit it to the existing
   `history-import/preview` or `investment-import/preview` route. Editing any
   draft invalidates its preview/hash. Confirmation sends those same canonical
   bytes and hash to the corresponding existing commit route. Commit rechecks
   ownership, account state, duplicates, and replay in its transaction; it
   never invokes AI. Preserve balance accepted-subset commits, investment
   whole-file atomicity, and canonical 5 MB/10,000-record limits.

The implementation is bounded and request-scoped within the existing
Next.js process, with no new backend, durable document store, or required job
queue. Apply abort signals and time/output limits across parsing and provider
work; no silent chunking, retries, truncation, or automatic partial acceptance.
Larger-document/background processing requires a separate durable-job design.
Content stays in memory; workers are terminated on completion, failure, timeout,
or cancellation, and no temporary document files are written. All financial
responses use `Cache-Control: no-store` and remain outside service-worker caches.
Client drafts are cleared on completion, cancel, navigation, or logout and never
stored in localStorage/IndexedDB. Disable provider storage where supported and
disclose that local cleanup cannot control provider retention.

Regression coverage includes deterministic parser/identity fixtures, both
account modes, direct-import/no-provider regressions, two-user account and
credential isolation, consent/redaction, malicious files and prompt injection,
provider compatibility errors, missing keys, shared budget enforcement,
encrypted-PDF missing/wrong/correct passwords, secret isolation, Office container
rejection and readable editing protection,
refusal/malformed/truncated output, cancellation/cleanup, changed-draft hashes,
duplicates, rollback, and existing financial replay invariants. Mock provider
responses in tests; never use real statements or credentials.

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
| `user_settings`                | One user's locale, display, dashboard, and goal preferences               |
| `categories`                   | One user's seeded and custom classifications                              |
| `institutions`                 | One user's financial-provider directory and reference details             |
| `accounts`                     | One user's holdings and liabilities with replayed values                  |
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
| `ai_provider_settings`         | Owner-scoped provider, sharing defaults, limits, encrypted key            |
| `ai_usage_events`              | Owner-scoped request status, latency, model, and token metadata           |

Every table except `login_attempts` is either the identity table or is owned by
one user. Foreign keys are enabled. IDs are UUIDs. Account and category archive
operations retain history. All timestamps are UTC ISO-8601 strings.

Creating a user is one transaction that inserts the identity, base/enabled
currency settings, and a copy of the default categories. User defaults are
copied, not shared mutable rows. Signup creates no exchange rates, financial
accounts, goals, or sample portfolio data. The same applies to OIDC JIT.

## Routes and components

- `/login` — renders only deployment-enabled login methods
- `/signup` — public local registration only when local authentication is enabled
- `/api/auth/oidc/{start,callback}` — public only when OIDC is enabled
- `/` — net-worth dashboard
- `/accounts`, `/accounts/new`, `/accounts/[id]`, `/accounts/[id]/edit`,
  `/accounts/[id]/import`
- `/transactions`, `/transactions/new`, `/transactions/[id]/edit`
- `/goals`, `/goals/new`, `/goals/[id]`, `/goals/[id]/edit`
- `/estate/{beneficiaries,distribution,summary}` and
  `/estate/snapshots/[id]` — private estate planning and retained print views
- `/reports`, `/categories`, `/institutions`, `/settings`
- `/api/export/*`, `/api/accounts/[id]/history-import/{preview,commit}`, `/api/restore/user`,
  `/api/estate/snapshots/[id]`, `/api/ai/review`, `/api/health/{live,ready}`
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
  and Dark choices. A pre-hydration bootstrap resolves semantic CSS tokens;
  appearance is not user settings, financial data, or portable state.
- AI review output remains explanatory, non-authoritative, and non-advisory. Reviews
  are never persisted, cannot execute financial changes, and omit unreliable
  annualized performance until deterministic cash-flow-aware metrics exist.
  Import extraction produces untrusted drafts only; deterministic
  validation and explicit user confirmation remain the sole path to persistence.
