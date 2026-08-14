# Wealthboard product specification

## Status and terminology

This document defines the product contract for the implemented multi-user
baseline and accepted planned extensions. [backlog.md](backlog.md) is
authoritative for implementation status. In particular, position-based
investment accounts are planned under F17 and are not part of the current
runtime schema. The current implemented schema remains the only supported
runtime schema until an append-only migration delivers a planned extension;
pre-release databases may be deleted and recreated rather than migrated.

To avoid ambiguity:

- **Application user** means a person who signs up and authenticates.
- **Financial account** means a bank account, investment, property, vehicle,
  liability, or other tracked holding owned by one application user.
- **Investment instrument** means one user-owned security reference, such as a
  stock, ETF, or directly priced fund.
- **Position** means the quantity of one investment instrument held in one
  position-tracked financial account.

Wealthboard is a polished, self-hosted, multi-user personal wealth and goals tracker.

The app should stay intentionally simpler than full accounting, trading, and
portfolio-management platforms. It is not a detailed budgeting app.

The main user workflow should be:

1. Sign up or sign in to a private portfolio.
2. Add a financial account or asset.
3. Enter its current value, or add instruments with opening quantities and
   prices when the account is position-tracked.
4. Categorize it, for example:
   - Securities
   - Money market funds
   - Fixed income
   - Savings
   - Cash
   - Land and real estate
   - Vehicles
   - Other assets
   - Liabilities
5. Periodically update the value or unit price, or record a deposit,
   withdrawal, trade, gain, or loss.
6. View total net worth and portfolio allocation through useful dashboards.
7. Create financial goals and track contributions toward them.

The product should be optimized for individuals manually tracking their own
wealth over time. Users share the deployment but never share portfolio data.

## Product name

Use the temporary name:

“Wealthboard”

Make it easy to rename later through a configuration file.

## Technology stack

Use:

- Next.js latest stable version
- App Router
- TypeScript with strict mode
- React
- SQLite
- Drizzle ORM
- Recharts
- Tailwind CSS
- shadcn/ui
- Zod
- React Hook Form
- Lucide icons
- date-fns
- Argon2 or bcrypt for password hashing
- Next.js server actions or route handlers
- Docker and Docker Compose
- PWA support

Do not create a separate backend application. The Next.js application should handle server-side operations and access SQLite directly.

Use a persistent SQLite database file mounted through Docker.

The application should be suitable for deployment to a home server or Kubernetes cluster.

## Important architectural principles

- Support multiple independent application users in one deployment.
- Enforce strict per-user data isolation in schema, services, actions, pages,
  route handlers, exports, imports, analytics, caches, and tests.
- Do not implement organizations, teams, households, roles, invitations,
  shared portfolios, or cross-user financial accounts in the initial
  multi-user release.
- No mandatory external authentication provider; local-only operation remains supported
- No mandatory external APIs
- Manual data entry should work without external financial integrations
- Prefer simple and reliable architecture over enterprise abstractions
- Keep business logic separate from UI components
- Use decimal-safe money handling
- Store monetary values as integer minor units where practical
- Store fractional quantities and unit prices as canonical decimal strings and
  calculate them with Decimal.js; round only when producing a monetary amount
- Do not use JavaScript floating-point arithmetic for financial calculations
- Use transactions when updating balances and financial records
- All dates should be stored in UTC and shown in the user’s configured timezone
- Default timezone: Africa/Nairobi
- Each user chooses a base currency during signup; KES is the default selection

## Identity, signup, and authentication

Authentication is deployment-selected with `AUTH_METHODS=local`, `oidc`, or
`local,oidc`; the backward-compatible default is `local`. Keep the immutable
internal user UUID as the application session subject and ownership boundary in
every mode.

Requirements:

- Local authentication uses a unique, case-insensitive username and bcrypt
  password. Keep display name separate from the login identifier.
- Normalize usernames to lowercase and restrict them to 3-32 characters using
  letters, numbers, `.`, `_`, and `-`.
- Expose `/signup`, local password login, password changes, and local credential
  creation only when local authentication is enabled. OIDC-only `/signup`
  redirects to `/login`, and crafted local actions fail before parsing secrets.
- Do not support environment-created users, default credentials, setup users,
  invitation-only creation, or any other account bootstrap path.
- Hash passwords with bcrypt using the existing work factor. Never store or log
  plaintext passwords or sensitive form values.
- Require a password of at least 12 characters and confirm it during signup.
- Create each local or OIDC-JIT user, settings, and seeded categories atomically.
  A failed operation must not leave partial user data.
- Signup must not create financial accounts or sample portfolio data. Each user
  adds their own financial accounts after authentication unless they explicitly
  run the optional demo seed against their own identity.
- A validated first OIDC login may provision one internal user with a null
  password hash. Resolve identities only by canonical issuer and opaque subject;
  never auto-link or merge using username, email, display claims, or verified
  email status.
- After local signup or OIDC login, create the same internal Wealthboard session
  and redirect to the private dashboard.
- Put the immutable user ID in the signed session token subject. Never accept a
  user ID from form data, route parameters, headers, or query strings as proof
  of ownership.
- Use secure, HTTP-only, SameSite=Strict cookies. Sessions expire after the
  user's configured period and are rejected when the user is inactive or the
  session version no longer matches.
- Allow password and authentication-method changes only under the active mode.
  Explicit hybrid linking requires a current password and complete provider
  flow; local credential changes require fresh provider reauthentication. Never
  remove the last usable method. Every method change increments session version.
- Include logout and clear user-specific client state when switching users.
- Protect every application route except login, mode-enabled signup, the two
  OIDC protocol endpoints, health checks, and public PWA assets.
- Rate-limit login by normalized username and client address, and rate-limit
  signup by client address. Login errors must not reveal whether a username
  exists.
- Do not implement email password reset. Provide a documented operator CLI that
  resets one user by username, reads the new password from an environment
  variable, and invalidates only that user's sessions. It must not create a
  local credential for an OIDC-only user.
- OIDC uses discovery, Authorization Code flow, PKCE S256, state, nonce, exact
  callback matching, RS256 verification, bounded network responses, and a
  short-lived encrypted A256GCM transaction cookie. Provider codes, tokens,
  verifiers, and claims are never persisted or logged.
- OIDC-only startup/readiness requires valid discovery and a link for every
  active user. Local-only readiness requires every active user to have a
  password. Hybrid remains locally usable during provider outages.

## Core data model

Design a clean SQLite schema using Drizzle.

### Users

Authentication identity and credentials belong in a dedicated `users` table.

Fields should include:

- id, generated UUID
- username, normalized and unique case-insensitively
- passwordHash, nullable for OIDC-only users
- status: Active or Disabled
- sessionVersion
- lastLoginAt, optional
- createdAt
- updatedAt

### OIDC identities

Store provider mappings separately with `id`, `userId`, canonical `issuer`,
opaque `subject`, `createdAt`, `updatedAt`, and `lastLoginAt`. Enforce unique
`(issuer, subject)` and `(userId, issuer)` and cascade-delete mappings with the
internal user. Exclude mappings from per-user portability while retaining them
in operator SQLite backups.

### User settings

Fields should include:

- userId, unique foreign key to users
- displayName
- baseCurrency
- supportedCurrencies
- timezone
- preferredDateFormat
- appName
- defaultDashboardPeriod
- sessionTimeoutMinutes
- defaultGoalReturnBps
- createdAt
- updatedAt

### Ownership and data isolation

- Every user-owned table must have a non-null `userId` foreign key, including
  categories, financial accounts, transactions, valuations, exchange rates,
  investment instruments, position events, security prices, goals, goal
  contribution plans, and idempotency keys.
- Derive `userId` exclusively from the verified session. Service functions
  should accept it explicitly as their first ownership argument.
- Read, update, archive, and delete resources by both `userId` and resource ID.
  A request for another user's resource should behave as not found and must not
  disclose that the resource exists.
- Validate that every relationship stays within one owner. A goal cannot link
  to another user's account, a transaction or valuation cannot target another
  user's account, a position event cannot use another user's instrument or
  account, a security price cannot target another user's instrument, and a
  transfer cannot cross users.
- Scope unique constraints by user where appropriate, including category slugs,
  linked goal accounts, transaction and position-event idempotency, imported
  external IDs, security-price instrument/date, and exchange-rate pair/date.
- Include `userId` in database indexes and any server cache key used for private
  data. Do not use a process-global cache for user-specific settings or results.
- Seed default categories and currency settings separately for each new user so
  one user's edits never change another user's portfolio. Do not seed a
  plausible exchange rate; rates begin empty and remain user-entered until an
  optional authoritative provider is implemented.

### Asset categories

Seed these categories:

- Securities
- Money Market Fund
- Fixed Income
- Savings
- Cash
- Land and Real Estate
- Vehicle
- Retirement
- Business
- Other Asset
- Liability

Each category should include:

- id
- userId
- name
- slug
- icon
- displayOrder
- assetOrLiability
- description
- isLiquid
- isInvestible
- isArchived
- isSystem
- createdAt
- updatedAt

Allow each user to create, rename, reorder, archive, and assign icons to their
own categories. Category slugs are unique only within one user.
Treat bank accounts, investments, vehicles, and land as trackable holdings under
one flexible account model with explicit balance or position tracking.
Institutions are optional, owner-scoped reference records. Each institution has
a normalized unique name per user, a controlled provider type, optional website,
country, address, and notes, plus archive timestamps. Archived institutions keep
existing account links but cannot be selected for a new link.

Fields:

- id
- userId
- name
- description
- categoryId
- institutionId, optional
- accountReference or optional masked account number
- currency
- trackingMode: `balance` or `positions`
- currentValueMinor, authoritative replay result or rebuildable derived cache
- costBasisMinor, optional
- isLiability
- isIncludedInNetWorth
- goalId, optional
- notes
- openedAt, optional
- archivedAt, optional
- createdAt
- updatedAt

Examples:

- Zimele Fixed Income Fund
- Madison Money Market Fund
- KCB Car Fund
- Interactive Brokers Brokerage, containing a VWRA position
- Southern Bypass Land
- Honda Fit
- 2028 Car Fund
- Cash Savings

Balance tracking is the default and preserves the existing transaction and
absolute-valuation replay. Use it for cash, property, vehicles, businesses,
liabilities, manually valued funds, and any unsupported investment structure.

Position tracking is opt-in for active, non-liability investment accounts. It
contains an account-currency cash subledger plus one or more long-only
investment positions. A normal account edit must not change `trackingMode`
after financial activity exists. A guided conversion establishes opening cash,
positions, and prices on an explicit as-of date and preserves the earlier
balance-tracked account history; it must never infer quantities from historical
money-only purchases, sales, or valuations.

Guided conversion archives the source effective on the conversion date and
creates a linked position replacement with explicit opening cash, holdings,
prices, and optional reference basis. The date cannot precede later source
activity. Existing goal and estate links move atomically to the replacement,
while source history remains unchanged and visible as archived history.

### Investment instruments, position events, and security prices

Investment instruments are owner-scoped reference records. Fields should
include:

- id
- userId
- name
- symbol, optional
- identifierType: `isin`, `ticker_exchange`, or `custom`
- identifier, optional
- exchange or MIC, optional
- assetType: `stock`, `etf`, or `fund` initially
- quoteCurrency
- archivedAt, optional
- createdAt
- updatedAt

A symbol alone is not a globally unique identity. Use the internal instrument
ID for relationships and preserve the supplied identifier and exchange as
reference metadata. Archived instruments retain history but cannot receive new
positions, trades, or prices until restored.

Position events are immutable source records from which quantity is replayed.
Fields should include:

- id
- userId
- accountId
- instrumentId
- relatedInstrumentId, optional for spin-offs and mergers
- type: `opening_position`, `buy`, `sell`, `quantity_adjustment`,
  `transfer_in`, `transfer_out`, `split`, `spinoff`, `merger_in`, or
  `merger_out`
- quantity as a positive canonical decimal string, with direction supplied by
  the event type
- unitPrice as a canonical decimal string when the event is priced
- tradeCurrency
- grossAmountMinor in the trade currency, optional when deterministically
  derivable
- feeAmountMinor and feeCurrency, optional
- cashEffectMinor in the account currency
- appliedExchangeRate as a canonical decimal string, optional when trade and
  account currencies differ
- openingCostBasisMinor, optional only for an `opening_position` event and
  excluded from market-value calculations
- actionRatioNumerator and actionRatioDenominator for ratio-based actions
- tradeDate
- eventSequence for deterministic same-date replay
- settlementDate, optional
- externalId, optional
- eventGroupId, optional linkage for one compound economic event
- description and notes, optional
- createdAt
- updatedAt

Current position quantity is a projection over position events, not a mutable
authoritative field. Long-only accounts reject a sale or correction that makes
quantity negative at that date or any later date. Edits, deletions, and
backdated corrections replay all affected quantities, cash, and account values
atomically.

An in-kind transfer writes paired transfer-out and transfer-in quantity events
with no contribution or withdrawal. Optional source-account fees use the same
group. Supported stock splits, spin-offs, and mergers use explicit positive
ratios and grouped related-instrument records. Deleting any grouped member
deletes and replays the complete group atomically or changes nothing.

Security prices are effective-dated, owner-scoped source records. Fields should
include:

- id
- userId
- instrumentId
- price as a positive canonical decimal string
- currency
- effectiveDate
- source and provenance
- createdAt
- updatedAt

The price currency must match the instrument quote currency unless an explicit
instrument-currency migration is performed. The current and historical price
for a date is the latest price effective on or before that date; a future price
must never be used. Manual entry and strict import work without an external
provider. Any later automatic provider is optional, records provenance, never
overwrites a user price silently, and leaves a manual fallback.

For a position-tracked account, derive the value at a date from replayed cash
plus every replayed quantity multiplied by its effective price and converted
to the account currency when necessary. Calculate quantity times price with
Decimal.js, round each quote value to that currency's minor unit, convert using
the user's effective-dated exchange rate, and then sum integer minor units.
`currentValueMinor` remains a rebuildable cache so goals, estate planning,
dashboard totals, and existing account-level consumers share one value.

Missing prices or exchange rates make the affected account and aggregate
incomplete rather than silently treating a position as zero. Show the affected
instrument, currency, missing date range, last price date, source, and freshness
state. Carrying the latest earlier price forward is allowed only with its as-of
date and stale status visible.

Position mode does not use the account-level `costBasisMinor` as an
authoritative aggregate. An optional `openingCostBasisMinor` on each opening
position may be retained as reference metadata. Do not claim tax-grade cost
basis, realized gain, or lot selection until purchase lots, corporate actions,
and an explicit jurisdiction-neutral disposal method are implemented and
tested. Supported split, spin-off, and merger quantity events do not claim to
calculate tax basis.

## Estate planning

Provide a private inheritance-planning overlay on the authenticated user's
portfolio at `/estate`. It records intent without changing financial account
ownership, application authorization, account balances, or provider-held
beneficiary designations.

Support one current estate plan per user with:

- An owner-scoped beneficiary directory for people, organizations, and trusts.
- Optional relationship, contact summary, and private notes; do not collect
  government identifiers, identity-document images, medical details, or bank
  instructions.
- Per-asset inclusion, ownership share, transfer context, distribution method,
  document reference, notes, and review date.
- Separate primary and contingent allocations stored as integer basis points,
  where 10,000 equals 100%.
- Plan-wide primary and contingent residual allocations for portions not
  specifically assigned.
- Exact allocated and remaining percentages, indicative source/base-currency
  values, and deterministic data-quality and completion warnings.

Validate every beneficiary, plan, account, directive, allocation, residual
allocation, snapshot, aggregate, and download by session-derived `userId`.
Primary or contingent allocations within one asset or residue tier must never
exceed 100%. Archived beneficiaries cannot receive new allocations. Archived
or foreign assets cannot receive a new directive, and liabilities must remain
visible separately rather than being assigned as gifts.

Calculate indicative estate values from the authoritative replayed balance or
position-derived account value multiplied by the user's asserted ownership
share. Derive beneficiary values from allocation basis points with `bigint` and
Decimal.js. Percentages are authoritative planning inputs; calculated currency
values are estimates and must report missing effective-dated prices and exchange
rates rather than silently omit holdings. Liabilities reduce the estimated net
estate but do not automatically reduce or transfer an individual beneficiary's
gift.

Allow users to create immutable, owner-scoped Estate Planning Summary snapshots
with an as-of date, version, SHA-256 content hash, and minimized document
contract. Later portfolio edits do not rewrite retained snapshots. The HTML
print view supports browser Print/Save as PDF and excludes exact values,
beneficiary contacts, account/document references, and notes until each is
explicitly selected. Global privacy mode continues to mask values even after
the document control is enabled. Snapshot downloads use `Cache-Control:
no-store` and return not found for another user's ID.

Every summary must state that it is an Estate Planning Summary or Will
Preparation Worksheet, not a legally executed will. It does not transfer
ownership or determine jurisdiction-specific witnessing, capacity, probate,
guardianship, trust, tax, debt, or provider-designation rules. Do not implement
death detection, inactivity triggers, beneficiary notifications, executor
access, credential handoff, automatic disclosure, custody, or asset transfers.

Per-user JSON portability version 6 introduced beneficiaries, plans,
directives, allocations, residue, and retained snapshots with relationship
validation, owner-field rejection, integrity checks, and ID remapping. The
position-account release must preserve those records while advancing the
archive contract as described under import and export.

### Transactions

Transactions should describe changes to an account or asset.

Supported transaction types:

- Opening Balance
- Deposit
- Withdrawal
- Interest
- Dividend
- Capital Gain
- Capital Loss
- Fee
- Purchase
- Sale
- Manual Adjustment
- Liability Payment
- Liability Increase
- Transfer

These types retain their existing meanings for balance-tracked accounts.
`Purchase` increases and `Sale` decreases a generic tracked holding; they must
not be reinterpreted as security trades.

For a position-tracked account, ordinary transactions describe its cash
subledger. Deposits, withdrawals, interest, dividends, fees, transfers, and
explicit cash adjustments affect cash. Generic purchase, sale, capital-gain,
capital-loss, and liability transaction types are rejected at the service
boundary. Security buys and sells use position events linked to their atomic
cash effects.

Fields:

- id
- userId
- accountId
- type
- amountMinor
- currency
- transactionDate
- description
- notes
- transferGroupId, optional
- createdAt
- updatedAt

A deposit should increase the account balance.

A withdrawal should reduce the balance.

Interest and dividends should increase the balance and be counted as returns.

Fees should reduce the balance and be counted as expenses.

Transfers should move value between accounts without changing total net worth.

A security buy increases quantity and decreases account cash by the settlement
amount plus fees. A security sale decreases quantity and increases account cash
by proceeds less fees. When trade and account currencies differ, store the
actual settlement cash effect or an explicit applied exchange rate; never infer
settlement with a later market rate. A dividend increases cash without changing
quantity. A reinvested dividend is a linked dividend plus buy rather than an
implicit quantity change. The dividend cash transaction and buy position event
share an event group and commit in one database transaction; failure of either
record rolls back both.

Buys and sells are internal allocation changes inside a position-tracked
account, not contributions or withdrawals. Ignoring price movement, a same-day
buy or sale changes total account value only by explicit fees and any difference
between execution and valuation prices.

Allow ordinary transactions and supported position events to be corrected or
deleted through their dedicated workflows, with cash, quantities, prices, and
all later account values recalculated atomically. Reject a correction that
would oversell a position or break a linked cash event.

### Valuation snapshots

Some assets, such as land, vehicles, private investments, and manually tracked funds, may be valued periodically without a normal transaction.

Fields:

- id
- userId
- accountId
- valueMinor
- currency
- valuationDate
- notes
- createdAt

A valuation update should not automatically be treated as a cash contribution.

Absolute valuation snapshots apply only to balance-tracked accounts. A
position-tracked account changes market value through instrument price
snapshots without changing quantity. A broker statement total may be stored as
a reconciliation observation showing the difference from calculated cash plus
positions, but it must not overwrite quantities, prices, or the derived value.

An optional retained reconciliation observation contains `id`, `userId`,
`accountId`, observation date, optional reported cash, reported total, notes,
and timestamps. It is non-authoritative and owner-scoped. The service derives
calculated cash, position value, and difference for the same date and visibly
reports missing prices or rates; retaining or deleting an observation never
changes financial source records.

The app must distinguish:

- Contributions
- Withdrawals
- Investment income
- Market or valuation changes

### Exchange rates

Support a centralized ISO 4217 currency catalog. It must include East African
currencies such as KES, TZS, UGX, RWF, BIF, ETB, SSP, CDF, and SOS, plus common
international currencies. Each user independently chooses a base currency and
enabled set. The base currency is always enabled, and currencies referenced by
source records cannot be disabled.

Fields:

- id
- userId
- baseCurrency
- quoteCurrency
- rate
- effectiveDate
- source
- createdAt

Initially, exchange rates can be entered manually. Rates are user-owned; an
update must affect only the current user's calculations.

Provide a settings area where the user can manage effective-dated rates between
any two enabled currencies.

All dashboard totals should be converted into the configured base currency.
Changing that base must not rewrite source amounts. Current and historical
aggregates must declare when a rate is missing and identify affected currencies
instead of silently presenting an incomplete total as authoritative.

Position valuation first resolves each instrument in its quote currency, then
uses the user's most recent exchange rate effective on that valuation date to
reach the account and base currencies. Changing an account or base currency
must not rewrite quantities, historical prices, trade execution values, or
actual stored settlement effects.

Keep the design ready for an optional exchange-rate API later, but do not require one.

### Goals

Fields:

- id
- userId
- name
- description
- targetAmountMinor
- currentAmountMinor, preferably calculated
- currency
- targetDate
- linkedAccountId, optional
- icon
- status
- priority
- createdAt
- updatedAt

Goal statuses:

- Active
- Paused
- Completed
- Cancelled

Example goal:

- Name: 2028 Family Car
- Target: KES 3,250,000
- Target date: July 1, 2028
- Linked account: KCB Car Fund
- Planned monthly contribution: KES 120,000

Goal contributions may either:

1. Be recorded directly against the goal, or
2. Be calculated from deposits into a linked account.

Prefer linked-account tracking so balances are not duplicated.

A goal linked to a position-tracked account uses its complete derived account
value. If a required price or exchange rate is missing, goal progress and
forecast status must report incomplete data rather than use a partial balance.

### Goal contribution plan

Fields:

- id
- userId
- goalId
- plannedContributionMinor
- frequency
- startDate
- endDate
- createdAt
- updatedAt

Supported frequency:

- Weekly
- Monthly
- Quarterly
- Annually
- Custom

## Dashboard

The dashboard is the heart of the app.

It should be visually rich but easy to understand. Do not overload it with dozens of small widgets.

The dashboard should answer:

- What is my current net worth?
- How has my net worth changed?
- Where is my wealth allocated?
- How much have I contributed?
- How much has come from returns?
- How are my goals progressing?
- Am I on track for my goals?
- Which accounts changed recently?

### Primary dashboard cards

Show:

- Total net worth
- Total assets
- Total liabilities
- Net-worth change over:
  - One month
  - Three months
  - One year
  - All time
- Total contributions
- Total investment gains and income
- Current liquid assets
- Current investment assets

Each amount should support hiding or revealing sensitive values with an eye icon.

### Net-worth chart

Use Recharts to create an attractive responsive area chart.

Features:

- Time ranges:
  - One month
  - Three months
  - Six months
  - One year
  - All time
- Tooltip showing:
  - Date
  - Net worth
  - Assets
  - Liabilities
- Smooth but not overly decorative
- Gracefully handle sparse historical data
- Show a useful empty state when there is insufficient history

The chart should use daily or monthly historical values derived from
transactions and valuations for balance-tracked accounts and from cash,
position events, effective-dated security prices, and exchange rates for
position-tracked accounts.

### Asset allocation chart

Use a donut or radial chart showing allocation by category.

Examples:

- Securities
- Fixed income
- Money market funds
- Savings
- Land
- Vehicles

Show:

- Category value
- Percentage of net worth
- Clickable legend
- Ability to exclude non-investment assets such as a personal vehicle
- Optional position-level allocation by instrument for position-tracked
  accounts

Provide a toggle between:

- Total net worth allocation
- Investible assets allocation

### Assets versus liabilities

Create a clean stacked bar or comparison visualization.

### Contributions versus growth

Create a chart separating:

- User contributions
- Interest and dividends
- Capital or valuation growth
- Withdrawals
- Fees

This is important because the user should be able to see whether wealth increased through saving or investment performance.

For position-tracked accounts, buys and sells are internal allocation changes,
not contributions or withdrawals. Price movement contributes to market growth;
dividends and interest remain income; explicit fees remain expenses.

### Goal cards

Show active goals with:

- Goal name
- Current amount
- Target amount
- Percentage completed
- Target date
- Required monthly contribution
- Current planned monthly contribution
- Whether the goal is:
  - Ahead
  - On track
  - Behind
- Estimated completion date
- Progress bar
- Linked account

### Recent activity

Show recent:

- Deposits
- Interest credits
- Valuation updates
- Withdrawals
- Transfers
- Security buys and sells
- Security price updates
- Goal updates

## Accounts and assets page

Create a page listing all accounts and assets.

Allow views by:

- Category
- Institution
- Currency
- Active or archived
- Asset or liability
- Balance or position tracking mode
- Complete, missing-price, or stale-price state

Each card or row should show:

- Name
- Institution
- Category
- Current value
- Currency
- Value converted to base currency
- Tracking mode and position count when applicable
- Value as-of and price-freshness state
- Month-over-month change
- Goal association
- Last updated date

Provide both:

- Card view
- Compact table view

Allow sorting by:

- Value
- Name
- Category
- Recent change
- Last updated

## Account detail page

Each account should have a dedicated page with:

- Current value
- Cash balance and position market value when position-tracked
- Positions with quantity, effective unit price, quote currency, as-of date,
  source, and converted value
- Total contributions
- Total withdrawals
- Total interest and dividends
- Total fees
- Estimated gain or loss
- Historical value chart
- Transaction list
- Position-event and price history when position-tracked
- Valuation history
- Linked goals
- Notes

Actions:

- Add deposit
- Add withdrawal
- Add interest
- Add dividend
- Add fee
- Update valuation
- Add or edit an opening position
- Buy or sell a security
- Update a security price
- Reconcile a position account to a broker statement total without overwriting
  calculated holdings
- Transfer money
- Edit account
- Archive account

For manually valued assets such as land or vehicles, emphasize valuation history instead of investment-return metrics.

For position-tracked accounts, emphasize current holdings, cash, price
freshness, missing data, and a unified chronological activity feed. Show only
actions valid for the account mode.

Privacy mode masks position quantities, unit prices, cash balances, cost-basis
references, and derived values on screen and in privacy-sensitive previews or
print views. Authenticated portability exports retain exact source records and
are not presentation surfaces. Instrument names and symbols remain visible for
identification; raw identifiers, notes, and account references remain excluded
unless an existing explicit inclusion control permits them.

## Goals page

Create a dashboard-focused goals page.

Show:

- Total target amount across active goals
- Total amount saved
- Monthly planned contributions
- Goals on track
- Goals behind schedule
- Progress timeline

Each goal detail page should contain:

- Target
- Current progress
- Contributions over time
- Forecast completion date
- Required contribution to finish by target date
- Contribution history
- Linked account history
- Ability to pause or modify the goal
- At least three editable, non-persistent contribution/return scenarios
- Optional amount checkpoints with deterministic reached, upcoming, or overdue status

Include a projection chart using a conservative linear or configurable annual-return assumption.

For example:

- Current balance: KES 119,617
- Monthly contribution: KES 120,000
- Assumed annual return: 8%
- Target: KES 3,250,000
- Target date: July 2028

The projection and every comparison must state its compounding, contribution
timing, fixed target/date, and excluded-cost assumptions. Scenario edits must
never mutate the saved goal.

An active goal that is behind plan should produce an in-app dashboard reminder
when its progress can be calculated reliably. Users can dismiss that reminder
for the current calendar month in their configured timezone; it may return in a
later month if the goal remains behind. External notifications remain out of
scope until durable background jobs exist.

## Reports and analytics

Create a reports page with:

### Net-worth history

- Monthly net worth
- Year-over-year change
- Highest recorded net worth
- Total change since tracking began

### Portfolio allocation

- By category
- By institution
- By currency
- By investment instrument within position-tracked accounts
- Liquid versus illiquid
- Investible versus lifestyle assets

### Income and returns

- Interest by account
- Dividends
- Capital growth
- Position price movement when complete price history exists
- Fees
- Contributions

Security buys and sells must not appear as external contributions or
withdrawals. Do not present tax-grade realized gains or lot-based returns until
the required lot and corporate-action model is implemented.

Position movement attribution uses a deterministic bridge that separates
external cash, income, fees, cash adjustments, internal trade cash, quantity
changes, price movement, and currency movement. The bridge reports
completeness and any residual explicitly. Until A3 implements validated
cash-flow-aware TWR, position-account annualized returns display an explicit
unavailable methodology state rather than a generic insufficient-history value.

### Account comparison

Allow comparison of accounts such as:

- KCB MMF
- Zimele Fixed Income Fund
- Madison MMF

Show:

- Starting balance
- Ending balance
- Deposits
- Withdrawals
- Net income
- Simple annualized return
- Effective annualized return, when enough data exists
- Price and exchange-rate completeness, valuation method, and oldest effective
  price used for position-tracked accounts

Do not show misleading annualized performance for very short measurement periods without a warning.
Do not annualize a position account when missing or stale prices make the
selected period unreliable.

## Import, export, and deployment backup

User-facing portability must be scoped to the authenticated user.

Support:

- Export the current user's complete portfolio as JSON without credentials,
  session data, login attempts, or another user's records.
- Export the current user's transactions as CSV.
- Export the current user's financial accounts as CSV.
- Import transactions only into a financial account owned by the current user.
- Import instruments, holdings, trades, cash activity, and prices only into a
  position-tracked account owned by the current user.
- Restore a validated per-user JSON export by replacing only the current user's
  portfolio in one transaction.

Account history imports start from `/accounts/[id]/import` and use Account
History Import v1. CSV files contain exactly
`external_id,type,amount,date,description,notes`; JSON files use the strict
`wealthboard-account-history` version 1 envelope. Files contain no owner,
account, institution, or currency fields. The verified session and URL select
one active owned account.

Account History Import v1 remains unchanged for balance-tracked accounts. It
must not create or mutate instruments, quantities, position events, or security
prices, and it must not be expanded with loosely optional position columns. A
position-tracked account rejects Account History Import v1, and a
balance-tracked account rejects Investment History Import v1, before parsing
financial rows.

The import page may provide a copyable, currency-aware prompt for use with an
external AI service. It must offer CSV and JSON output modes, require the exact
v1 schema, preserve one output row per source transaction, prohibit invented or
ambiguous financial records, and explain deterministic external IDs and balance
directions. Prompt generation and copying are entirely client-side: Wealthboard
must not send the prompt, account history, statement, or generated file to an AI
provider. Users are responsible for choosing a provider they trust and must
still preview the generated file before importing it.

Each row requires a stable, trimmed, case-sensitive external ID of at most 200
characters. Provider IDs should be used when available; otherwise users must
construct deterministic IDs outside Wealthboard (changing row numbers are not
stable IDs). Dates are non-future `YYYY-MM-DD` values and amounts are decimal
strings with the target account currency's precision. Imports are limited to 5
MB and 10,000 rows.

Balance directions for Account History Import v1 are:

- `deposit`, `interest`, `dividend`, `capital_gain`, `purchase`, and
  `liability_increase` increase the replayed balance.
- `withdrawal`, `capital_loss`, `fee`, `sale`, and `liability_payment` decrease
  it.
- `manual_adjustment` applies its signed, non-zero amount directly.
- Opening balances and transfers are not importable and retain their dedicated
  workflows.

Preview performs no writes and shows the selected account, institution,
currency, date range, current balance, projected balance, net change, and every
row outcome. Confirmation resends the file and its SHA-256 hash, reparses it,
rechecks ownership and duplicates, and atomically imports the currently valid
subset before one balance replay. Existing identical external IDs are skipped;
conflicting or in-file duplicate IDs fail and are never overwritten. Raw files
and reports are not retained or logged.

Position-tracked accounts use a separate strict
`wealthboard-investment-history` version 1 contract. The JSON envelope contains
bounded `instruments`, `position_events`, `cash_transactions`, and `prices`
arrays. CSV uses separate published templates for opening holdings, trades,
cash activity, and prices rather than mixing heterogeneous records in one row
shape.

Investment instrument records use a stable external instrument ID plus name,
optional symbol, identifier type/value, exchange, asset type, and quote
currency. Position-event records use a stable external event ID, referenced
external instrument ID, event type, quantity, optional unit price, trade
currency, gross amount, optional fee amount/currency, account-currency cash
effect, optional applied settlement rate, trade date, optional settlement date,
description, and notes. Price records use a stable external price ID,
referenced instrument, positive unit price, currency, effective date, and
source. Decimal quantities, prices, rates, and user-facing amounts are strings
rather than JSON numbers.

An optional external `event_group_id` links one dividend cash row to one or
more same-date buy rows for a reinvestment. The importer remaps that external
identifier to one internal group UUID, rejects malformed or orphaned groups,
and preserves whole-file atomicity.

An opening-holdings template may combine instrument metadata, opening quantity,
opening reference cost basis, effective unit price, and price date for initial
setup. It creates explicit opening-position and price source records; it does
not fabricate historical trades. Full activity import preserves separate cash,
trade, and price records.

Files never carry or override `userId`, internal account ID, institution ID,
account name, account currency, or `trackingMode`. The verified session and URL
select one active owned position account. Instrument quote and trade currencies
must be enabled for that user. Same-currency trade gross and cash effects are
derived and cross-checked after fees. A cross-currency trade requires the actual
account-currency settlement effect or an explicit applied rate; a later market
rate must not be silently substituted.

Preview performs no writes and shows instrument resolution, new and existing
instruments, quantities before and after every event, projected cash, projected
position and account values, price and exchange-rate gaps, stale prices,
oversells, duplicate IDs, conflicts, date range, and net change. Price updates
must identify every current and historical date range they affect.

Identical existing external IDs are skipped. Conflicting IDs, duplicate IDs in
one file, invalid instrument relationships, unsupported currencies, oversells,
or any event sequence that becomes invalid block confirmation. Because one
failed trade can invalidate later events, investment-history commit is
all-or-nothing for the complete remaining sequence, unlike the accepted-subset
policy of Account History Import v1. Confirmation resends the file with its
SHA-256 hash, reparses it, rechecks ownership and duplicates, and commits all
instruments, events, linked cash effects, prices, and account caches in one
database transaction. Limits begin at 5 MB and 10,000 total records.

The investment import page may generate copyable, currency-aware CSV or JSON
prompts entirely in the browser under the same privacy rules as Account History
Import v1. It must require one output record per source record, prohibit guessed
identifiers, quantities, prices, trades, currencies, and corporate actions, and
still require deterministic preview before commit.

Position-account source records first appeared in portability version 7.
Version 8 adds conversion provenance, grouped cash links, explicit event
ordering, selected corporate-action relationships, and freshness settings
alongside every version 7 collection. Restore validates and remaps every
relationship and group, rejects owner fields, rebuilds quantities and values,
and verifies that no replayed position becomes negative. Version 7 upgrades
deterministically; versions 2 through 6 remain restorable as balance-tracked
accounts with empty position collections. Export and restore never infer
position history from legacy monetary purchases or sales.

Before a per-user restore:

- Validate the archive version and every record.
- Reject foreign user IDs and remap imported record IDs to the current user.
- Warn that only the current user's portfolio will be replaced.
- Create a current-user export that can be downloaded before replacement.
- Roll back the entire operation on any failure.

A raw SQLite backup contains credentials and every user's financial data. Do
not expose full-database backup or restore through an ordinary authenticated
route or user settings. Deployment operators, who are outside the application
role model, perform consistent full-database backup and offline restore through
documented CLI or container operations. Document the persistent backup
directory and require the app to be stopped for a raw-file restore.

## AI portfolio review

Support an optional, on-demand portfolio review through OpenAI, DeepSeek, or an
operator-approved OpenAI-compatible Chat Completions endpoint.

- Wealthboard must first create a bounded, versioned snapshot from deterministic
  calculations. Models must not independently calculate authoritative balances,
  conversions, returns, or goal forecasts.
- Raw position events, trade rows, prices, quantities, and instrument
  identifiers are excluded from model input. Any later instrument-level derived
  allocation follows the existing independent consent for exact values and
  names.
- Default snapshots use pseudonymous accounts and goals and omit exact amounts.
  Exact aggregate amounts and names require separate, explicit per-request
  consent. Never include notes, account references, raw transaction rows, or
  transaction descriptions.
- Omit cash-flow-naive annualized returns, unavailable freshness, and movement
  attribution until deterministic implementations exist. Include explicit
  missing-rate and methodology warnings.
- Validate model output with a strict schema. Every finding must cite a valid
  evidence ID from the snapshot. Do not expose arbitrary HTML, links, tool calls,
  or mutation operations.
- Derive ownership only from the verified session. Apply a per-user cooldown,
  monthly token limit, request timeout, cancellation, and bounded output size.
- Provider credentials remain server-side. Session-only keys are not persisted;
  remembered keys require a dedicated encryption key and owner-bound authenticated
  encryption. Never reuse the session secret.
- Fixed OpenAI and DeepSeek endpoints are allowed. Custom endpoint URLs must
  exactly match an operator allowlist, cannot contain credentials, queries, or
  fragments, and must not follow redirects.
- Do not retain reviews. Store only privacy-safe owner-scoped usage metadata;
  users must be able to delete this metadata, delete a stored credential, and
  disconnect the provider. Per-user exports exclude all AI credentials and usage.
- Clearly state that output is explanatory and not regulated financial advice.

## User interface and styling

The visual style should feel like a modern financial dashboard, not a generic admin template.

Use a dark-first design.

Design direction:

- Deep charcoal or near-black background
- Slightly lighter cards and panels
- Restrained green accents for positive values
- Amber for warnings
- Red for losses and liabilities
- Muted blue or cyan accents for informational elements
- High-quality typography
- Generous spacing
- Subtle borders
- Soft shadows
- Minimal gradients
- Avoid neon cyberpunk styling
- Avoid excessive glassmorphism
- Avoid clutter
- Avoid excessive animations
- Use animations only for meaningful transitions

The design should resemble a premium wealth-management dashboard.

Use:

- Tabular numbers for financial values
- Clear positive and negative indicators
- Consistent currency formatting
- Skeleton states
- Empty states
- Helpful tooltips
- Responsive charts
- Accessible contrast
- Keyboard-accessible controls

Do not hardcode chart colours throughout the application. Define a reusable financial chart palette using CSS variables.

## Navigation

Desktop layout:

- Collapsible left sidebar
- Top header
- Main dashboard content

Navigation items:

- Dashboard
- Accounts
- Transactions
- Goals
- Reports
- Categories
- Settings

Mobile layout:

- Compact header
- Bottom navigation for:
  - Dashboard
  - Accounts
  - Add
  - Goals
  - More
- Floating or central quick-add action
- Full-screen mobile forms
- Charts that remain readable on narrow screens
- No horizontal page scrolling

## Quick-add flow

The user should be able to record common actions in a few taps.

Quick-add options:

- Add deposit
- Add withdrawal
- Add interest
- Update asset value
- Buy or sell a security
- Update a security price
- Transfer between accounts
- Add a new account
- Create a goal

Remember recently used account and transaction type where appropriate.

## PWA requirements

Make the app installable as a Progressive Web App.

Include:

- Web app manifest
- Application name and short name
- Theme colour
- Background colour
- Icons in all required sizes
- Apple touch icon
- Standalone display mode
- Mobile viewport configuration
- Service worker
- Offline shell for the main interface
- Graceful offline message
- Cached static assets
- Install prompt where supported
- Update-available notification

Because SQLite is server-side, do not pretend full offline transaction creation is supported.

When offline:

- Show previously cached dashboard shell where possible
- Clearly indicate that fresh account data requires a server connection
- Disable financial mutations
- Do not queue transactions unless a safe synchronization system is implemented
- Do not cache authenticated financial responses in the service worker.
- Clear user-specific in-memory state and caches on logout so a subsequent user
  on the same device cannot see the previous user's data.

The PWA should launch cleanly from an Android or iOS home screen.

## Responsive requirements

The app must be genuinely mobile-friendly, not merely shrink the desktop dashboard.

Test layouts at:

- 360px
- 390px
- 768px
- 1024px
- 1440px

On mobile:

- Prioritize total net worth, goal progress, and quick actions
- Collapse less important dashboard widgets
- Use horizontal scrolling only inside specific chart containers where unavoidable
- Ensure touch targets are at least 44px
- Use mobile-friendly date and amount inputs

## Calculations

Implement and test these calculations:

- Total assets
- Total liabilities
- Net worth
- Base-currency conversions
- Category allocation percentage
- Account performance
- Total contributions
- Total withdrawals
- Total interest
- Total dividends
- Total fees
- Goal progress
- Required monthly contribution
- Forecast goal completion
- Monthly and yearly net-worth change
- Liquid versus illiquid assets
- Investible versus non-investible assets
- Position quantity at a date
- Position market value in quote, account, and base currencies
- Position-account cash and total value
- Price freshness and missing-price completeness

Net worth:

Net worth = total assets minus total liabilities

Position quote value:

Position quote value = replayed quantity multiplied by effective unit price

Position-tracked account value:

Account value = replayed cash plus the sum of converted position quote values

Round each position quote value to its quote currency minor unit before
effective-dated conversion and sum integer minor units. A missing price or
exchange rate makes the result incomplete; never substitute zero or a future
observation. Buys and sells change allocation between cash and positions, while
external deposits, withdrawals, income, fees, and price movement retain their
separate classifications.

Goal required monthly contribution:

At a zero assumed annual return:

Required monthly contribution = remaining target amount divided by remaining contribution periods

When a goal has an assumed annual return, derive the required monthly
contribution by inverting the same monthly-compounded future-value calculation
used by its forecast. Include growth of both the current balance and subsequent
end-of-month contributions, and round the required contribution up to whole
minor units.

For projections with investment returns, use a proper future-value calculation.

Clearly distinguish:

- Nominal contribution totals
- Current value
- Investment growth
- Forecast values

## Example seed data

Provide an optional demo-data seed script using realistic but clearly fictionalized values.

Example accounts:

1. Zimele Fixed Income Fund
   - Category: Fixed Income
   - Currency: KES
   - Current value: KES 4,576,918

2. Madison Money Market Fund
   - Category: Money Market Fund
   - Currency: KES
   - Current value: KES 1,396,000

3. KCB Car Fund
   - Category: Money Market Fund
   - Currency: KES
   - Current value: KES 119,617
   - Linked goal: 2028 Family Car

4. Interactive Brokers Brokerage
   - Category: Securities
   - Currency: USD

- Tracking mode: Positions
- Cash balance: USD 111
- Position: VWRA, 40 units at USD 100 per unit
- Derived current value: USD 4,111

5. Southern Bypass Land
   - Category: Land and Real Estate
   - Currency: KES
   - Current value: KES 5,000,000

6. Honda Fit
   - Category: Vehicle
   - Currency: KES
   - Current value: KES 750,000

Example goal:

- Name: 2028 Family Car
- Target: KES 3,250,000
- Target date: July 1, 2028
- Planned monthly contribution: KES 120,000
- Linked account: KCB Car Fund
- Assumed annual return: 8%

Do not expose these exact values unless demo mode is explicitly enabled.
The seed command must require an explicit target username or user ID and must
never add demo data to every user.

## Settings

Create settings for:

- Display name
- Application name
- Base currency
- Supported currencies
- Current exchange rates
- Timezone
- Date format
- Dark theme
- Default dashboard period
- Password change
- Session timeout
- Personal data export and restore
- Category management
- Asset classification
- Default goal return assumption

The initial release can be dark-theme only, but structure the theme tokens so a light theme can be added later.

## Accessibility

Ensure:

- Proper semantic HTML
- Labelled inputs
- Keyboard navigation
- Visible focus states
- Sufficient colour contrast
- Charts include accessible text summaries
- Colour is not the only indication of profit, loss, or status
- Respect reduced-motion preferences

## Error handling

Implement:

- Friendly validation messages
- Toast notifications
- Error boundaries
- Confirmation dialogs for destructive actions
- Database error logging without exposing sensitive data
- Safe handling of duplicate submissions
- Idempotent transfer creation
- Loading and empty states

## Testing

Use:

- Vitest for unit tests
- React Testing Library for component tests
- Playwright for end-to-end tests

Test at minimum:

- All local, OIDC-only, and hybrid mode UI/action/proxy combinations
- Signup for the first and subsequent users
- OIDC discovery, state/nonce/PKCE, token/JWKS validation, expiry, replay, and JIT races
- Explicit link/unlink and local credential transitions, collisions, and rollout guards
- Rejection of access to the private application before signup or login
- Confirmation that signup creates no financial accounts or demo data
- Login and logout
- Generic login failure without username enumeration
- Password change and per-user session invalidation
- Two simultaneous users with isolated categories, exchange rates, financial
  accounts, transactions, goals, analytics, and settings
- Direct URL and mutation attempts against another user's resource
- Rejection of cross-user transfers, goal links, imports, and idempotency keys
- Rejection of cross-user instrument, position-event, and security-price IDs
- Per-user exports and restores that contain no other user's data
- Creating an account
- Creating a position-tracked account with multiple instruments
- Recording a deposit
- Recording interest
- Updating a valuation
- Recording a security buy and sale with atomic cash effects
- Updating a unit price without changing quantity
- Rejecting an oversell and a backdated correction that causes a later oversell
- Position valuation with fractional quantities, sub-minor-unit prices,
  effective-dated exchange rates, missing prices, and stale prices
- Investment-history preview, duplicate/conflict handling, atomic commit, and
  all-or-nothing rollback
- Guided balance-to-position conversion with explicit discrepancy confirmation
- Grouped dividend reinvestment and rollback-safe deletion
- Atomic in-kind transfer and selected split, spin-off, and merger actions
- Deterministic same-date event ordering and future-price exclusion
- Configurable stock, ETF, and fund freshness thresholds with affected ranges
- Position movement attribution and explicit unavailable-return methodology
- Creating a goal
- Linking a goal to an account
- Transfer between accounts
- Net-worth calculation
- Liability calculation
- Multi-currency conversion
- Goal projection
- Editing and deleting transactions
- Backup and restore
- Mobile navigation
- PWA manifest

Financial calculation logic should have comprehensive unit tests.

## Deployment

Provide:

- Dockerfile using a multi-stage build
- docker-compose.yml
- Persistent volume for SQLite
- Persistent volume for backups
- Health-check endpoint
- Environment variable example file
- Production startup instructions
- Kubernetes deployment example
- Kubernetes Service
- PersistentVolumeClaim example
- Ingress example
- SecurityContext using a non-root user

Required environment variables should include:

- DATABASE_PATH
- SESSION_SECRET
- APP_URL
- TZ
- BACKUP_PATH

Do not bake secrets into the image.

## Documentation

Create a detailed README with:

- Product overview
- Screenshots placeholder
- Local development
- Docker deployment
- Kubernetes deployment
- Signup and first-user onboarding
- Fresh database initialization
- Password reset by username
- Per-user export and restore
- Deployment-wide backup and offline restore
- Database migrations
- Updating the application
- PWA installation
- CSV import format
- Investment-history JSON and separate holdings, trade, cash, and price CSV
  formats
- Security considerations

## Scope exclusions for the first release

Do not implement these in version one:

- Bank account integrations
- Brokerage API integrations
- Automatic trade execution
- Live stock-price APIs
- Mandatory market-data providers
- Tax reporting
- Tax-lot accounting and tax-grade realized gains
- Bonds quoted as a percentage of par, options, shorts, margin, derivatives,
  and multi-leg trades
- Household budgeting
- Expense categorization
- Recurring bills
- Organizations, households, and teams
- Roles and administrator UI
- Invitations and shared portfolios
- Cross-user financial accounts or transfers
- Email verification and email password recovery
- Additional OAuth/social providers, SAML, and multiple simultaneous OIDC issuers
- Social features
- Public profiles
- AI financial advice or autonomous financial actions; bounded explanatory
  portfolio review is permitted under the requirements above
- Cryptocurrency wallets
- Complex double-entry accounting
- Full offline synchronization

Keep the first version focused on manually tracking net worth, account values, contributions, investment growth, and financial goals.

## Database lifecycle

- `db/schema.ts` is the source of truth.
- Generated migrations are append-only and support both fresh Wealthboard
  databases and upgrades of existing databases.
- Applied migration files must not be deleted, renamed, or modified. Schema
  changes require a new generated migration.
- Disposable pre-release databases may be deleted when their data is not needed;
  persisted databases and backups must retain a valid upgrade path.
- No data-claim path is required.
- Run linting, type checking, relevant tests, and a production build after
  schema changes.

## Acceptance criteria

The application is complete when:

- An empty deployment presents signup and cannot create an application user by
  environment variable, default credential, or any route other than signup.
- The first and subsequent users can sign up and log in concurrently. Signup is
  always available and has no enabled or disabled mode.
- Signup creates settings, categories, and rates but no financial accounts or
  sample portfolio data.
- Usernames are unique case-insensitively and login failures do not reveal
  whether a username exists.
- Each user can see and change only their own settings, categories, exchange
  rates, financial accounts, transactions, valuations, instruments, position
  events, security prices, goals, reports, imports, exports, and idempotent
  operations.
- Guessing another user's URL or submitting another user's resource ID returns
  not found or a generic authorization failure without leaking data.
- I can add Zimele, Madison, KCB, an Interactive Brokers account containing a
  VWRA position, land, a car, savings, and liabilities.
- I can manually set or update each balance-tracked account's value.
- I can add multiple long-only positions, update their effective-dated prices,
  and see the exact derived position-account value and data-freshness state.
- I can record deposits, withdrawals, interest, fees, and transfers.
- I can record buys and sells without classifying them as contributions or
  withdrawals, and their quantity and cash effects remain atomic.
- I can convert an investment balance account without rewriting its earlier
  history, reinvest dividends atomically, move units in kind, and record
  supported split, spin-off, and merger actions.
- I can see current net worth.
- I can see historical net-worth changes.
- Historical position values never use a future price and visibly report a
  missing or stale price or exchange rate.
- I can see allocation by category and institution.
- I can distinguish contributions from investment growth.
- I can create a July 2028 car goal.
- I can link that goal to a car-fund account.
- I can see whether the goal is ahead, on track, or behind.
- I can use the application comfortably on a phone.
- I can install it as a PWA.
- Logging out and signing in as another user on the same device never reveals
  cached data from the previous user.
- My SQLite data persists across application upgrades.
- I can export and restore my own portfolio without receiving another user's
  records or credentials.
- Position-account exports and restores preserve instruments, events, prices,
  cash links, conversion provenance, event ordering, quantities, and owner
  isolation exactly.
- A deployment operator can back up and restore the complete SQLite database
  outside ordinary user routes.
- The dashboard looks like a premium financial application.
- The interface remains focused and easy to understand.
