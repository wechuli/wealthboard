# Project Improvement Backlog

## Executive Summary

Wealthboard is a strong late-stage MVP and an early production candidate. Its core workflow is complete: users can register, maintain isolated portfolios, record transactions and valuations, transfer funds atomically, track goals, review net worth and allocation, import and export data, install a PWA, and deploy the application with Docker or Kubernetes.

The strongest areas are:

- Financial amounts use integer minor units with `bigint` and Decimal.js in [lib/money.ts](lib/money.ts) and [lib/finance.ts](lib/finance.ts).
- Multi-user ownership is explicit in [db/schema.ts](db/schema.ts), reinforced with composite foreign keys, and passed from verified sessions into services.
- [tests/unit/multi-user.test.ts](tests/unit/multi-user.test.ts) and [tests/e2e/isolation.spec.ts](tests/e2e/isolation.spec.ts) directly cover dashboard, relationship, URL, transfer, exchange-rate, import, export, restore, and browser-switching isolation.
- Transfers, financial edits, user restore, and signup defaults use database transactions.
- The dashboard, accounts, goals, reports, privacy mode, responsive navigation, portability, and offline-safe shell are already substantial product features.

The most important gaps are not broad feature absence. They are edge cases that can make apparently valid financial output incomplete or misleading, destructive restore behavior without a server-side rollback copy, transaction workflows that do not scale to long histories, and production operations that lack automated quality gates and observability.

Supporting multiple users increases the blast radius of mistakes. No proven cross-user data leak was found, but every new query, aggregate, cache, import, background task, and AI tool must preserve the established session-derived `userId` boundary. Public signup also makes trusted proxy configuration, resource limits, dependency hygiene, and abuse monitoring more important than in the previous local-only model.

The five highest-priority improvements are:

1. Make exchange-rate provenance and historical completeness explicit so totals and charts never silently omit holdings.
2. Enforce archived-account and goal-link rules at the financial service boundary.
3. Make full-database restore fail-safe with an automatic pre-restore backup and tested rollback.
4. Replace or remove cash-flow-naive annualized return figures.
5. Gate container publication on tests and remediate the currently reported high-severity production dependency advisories.

## Priority Definitions

- **P0:** Critical issue involving security, data loss, incorrect financial data, or broken core functionality.
- **P1:** High-value improvement that should be addressed soon.
- **P2:** Useful medium-term improvement.
- **P3:** Optional enhancement or future consideration.

Effort estimates:

- **Small:** Less than one day.
- **Medium:** One to three days.
- **Large:** More than three days.
- **Epic:** Multiple phases or substantial architectural work.

## Functionality Improvements

### F1. Transaction Workbench with Search, Filters, and Pagination (Implemented)

- **Status:** Implemented on 2026-08-03.
- **Priority:** P1
- **Estimated effort:** Large
- **Previous gap:** The transaction page loaded and rendered the full user history as one chronological list, with no search, account/type filter, date range, sort control, or pagination.
- **Implementation:** `listTransactionPage()` in [lib/services/accounts.ts](lib/services/accounts.ts) now applies owner-scoped account, type, date, amount-direction, and literal text filters with AND semantics. It uses bidirectional keyset pagination over `transactionDate`, `createdAt`, and `id`, with a default and maximum page size of 100. [app/(app)/transactions/page.tsx](<app/(app)/transactions/page.tsx>) exposes the filters and sort order as GET parameters, preserves them across pagination and refresh, and provides filtered CSV export through [app/api/export/transactions.csv/route.ts](app/api/export/transactions.csv/route.ts).
- **User value:** Users can audit years of activity, find fees or dividends, investigate a balance, and prepare records without downloading all data.
- **Supporting work:** [db/schema.ts](db/schema.ts) defines owner-first composite indexes for the default, account, and type timelines. Filtered CSV uses the same service predicate as the page, so export and display cannot drift.
- **Trade-offs:** Text matching is a case-insensitive literal substring search across description, notes, and account name. Full-text infrastructure remains deferred; the current implementation is covered by a 10,000-row fixture and bounded result tests.
- **Acceptance criteria:** Met. [tests/unit/transaction-query.test.ts](tests/unit/transaction-query.test.ts) covers combined filters, both cursor directions, stable same-timestamp ordering, direct cross-user denial, filtered CSV, the 100-row default, a 10,000-row history, and index selection. [tests/e2e/acceptance.spec.ts](tests/e2e/acceptance.spec.ts) covers URL persistence, refresh, filtered CSV download, and responsive layout at the supported widths.

### F2. Reconciliation and Safe Correction Workflows

- **Priority:** P1
- **Estimated effort:** Large
- **Current gap:** Opening balances cannot be edited or deleted, transfers can only be deleted as a pair and recreated, and valuations can only be deleted and re-entered. There is no statement balance reconciliation workflow.
- **Evidence from the repository:** [lib/services/accounts.ts](lib/services/accounts.ts) rejects edits to existing opening balances and transfers. [app/(app)/accounts/[id]/page.tsx](<app/(app)/accounts/[id]/page.tsx>) offers valuation deletion but no edit. Balance replay is already centralized in `recalculateAccountBalance()`.
- **Proposed improvement:** Add explicit correction operations: adjust an opening balance with full replay, edit both transfer legs atomically, edit a valuation, and reconcile an account to a statement balance as of a date with a previewed adjustment.
- **User value:** Users can correct mistakes without deleting history or manually calculating compensating entries.
- **Dependencies:** Implemented architecture item A2; audit-event support is desirable; new forms and replay integration tests.
- **Risks or trade-offs:** Rewriting historical events changes every later balance. The UI must preview affected balances and distinguish correction from new economic activity.
- **Acceptance criteria:** Each correction shows old and new values, requires confirmation, updates all affected balances atomically, preserves transfer net worth, does not classify reconciliation adjustments as contributions, and is covered by replay tests.

### F3. Account-Scoped CSV/JSON History Import

- **Priority:** P1
- **Estimated effort:** Large
- **Status:** Implemented 2026-08-05.
- **Implementation:** [lib/services/account-history-import.ts](lib/services/account-history-import.ts) owns strict CSV/JSON parsing, row classification, physical CSV-line/JSON-position reporting, replay projection, and atomic accepted-subset commit. Account-scoped preview and commit routes verify the session, trusted origin, ownership, file limits, and SHA-256 confirmation. The account quick action opens an import page that identifies the target account before upload, publishes the exact fields and balance direction of every allowed type, links downloadable templates/schema, shows privacy-aware projected balances and paginated outcomes, and downloads CSV/JSON reports. [components/account-history-ai-prompt.tsx](components/account-history-ai-prompt.tsx) adds optional CSV/JSON prompts that users can copy into an external AI service; generation is currency-aware and entirely client-side, and Wealthboard sends no statement or prompt data to AI. Transaction external IDs are protected by an owner/account unique index, exported in CSV and portability v5, and legacy versions restore with null IDs. The global Settings importer and `/api/import/transactions` were removed.
- **Product direction:** Start imports from one owned account at `/accounts/[id]/import`. Wealthboard will not map arbitrary bank or brokerage formats. Users prepare CSV or JSON outside the application according to the published Account History Import v1 schema, preview the classified rows and projected account balance, then explicitly confirm the valid subset.
- **Required CSV contract:** Use the exact column set `external_id,type,amount,date,description,notes`. Header order may follow the downloadable template, optional text cells may be empty, and missing or unknown columns reject the whole file.
- **Required JSON contract:** Use a strict envelope with `format: "wealthboard-account-history"`, `version: 1`, and a `transactions` array. Each object uses `external_id`, `type`, `amount`, `date`, and optional nullable `description` and `notes`. Amounts remain decimal strings rather than JSON numbers.
- **Field rules:** `external_id` is required, trimmed, case-sensitive, no more than 200 characters, and unique within the target account. `date` is strict non-future `YYYY-MM-DD`. `amount` uses the account currency and its decimal precision; it is positive except for a signed, non-zero `manual_adjustment`. Allowed types are `deposit`, `withdrawal`, `interest`, `dividend`, `capital_gain`, `capital_loss`, `fee`, `purchase`, `sale`, `manual_adjustment`, `liability_payment`, and `liability_increase`. Opening balances and transfers retain their dedicated workflows.
- **Account boundary:** Files never carry or override `userId`, account ID, account name, or currency. The session and URL select one active owned account. Preview and confirmation prominently show the account, institution, currency, imported date range, current balance, projected balance, and net change to reduce wrong-account uploads.
- **Duplicate policy:** Add nullable `transactions.externalId` and a unique owner/account index on `(userId, accountId, externalId)` while retaining an internal generated transaction UUID. Existing identical IDs are skipped as `duplicate_existing`; an existing ID with different fields fails as `conflicting_existing` and is never updated. Every occurrence of an ID repeated inside one file fails as `duplicate_in_file`. Do not use fuzzy date/amount matching because legitimate repeated payments are common. Deleting an imported transaction releases its external ID for an intentional re-import.
- **Preview and commit:** File-level failures such as invalid CSV headers, malformed JSON, unsupported version, empty file, more than 10,000 rows, or more than 5 MB write nothing. A valid file is fully parsed and every row is classified as ready, duplicate, or failed. Preview stores no raw file; the browser resends it with its SHA-256 hash at confirmation. Commit reparses and rechecks ownership and duplicates, inserts all currently ready rows in one transaction, and recalculates the account once. An unexpected database error rolls back the complete accepted subset, while known invalid and duplicate rows remain excluded.
- **Result report:** Return summary counts for imported, skipped duplicates, and failed rows plus a paginated on-screen table. Provide downloadable CSV and JSON reports with `row`, `external_id`, `status`, `code`, `message`, and generated internal `transaction_id`. Reports distinguish `imported`, `duplicate_existing`, `duplicate_in_file`, validation failures, and ID conflicts. Raw files and row-level reports are not retained or logged after the response.
- **Schema documentation:** Publish downloadable `account-history-v1.csv`, `account-history-v1.json`, and JSON Schema examples from the import page. Document every transaction type and its balance direction, amount precision, date rules, limits, and stable-ID requirement. Providers without transaction IDs require users to construct deterministic IDs externally; changing row numbers are not acceptable IDs.
- **Architecture changes:** Move account-history parsing and business rules into a focused `lib/services/account-history-import.ts` service rather than expanding portability. Add account-scoped preview and commit route handlers with session ownership, trusted-origin checks, file limits, and no-store responses. Add `external_id` to transaction exports and display it read-only for imported records. Bump user portability to version 5; converters for versions 2 through 4 set `externalId` to null. Remove the global Settings importer and retire `/api/import/transactions` so the old duplicate-prone path cannot bypass the new contract.
- **User value:** Users can transform exports from any provider into one documented format, safely load years of account history, re-run files without duplicating balances, inspect projected effects before committing, and retain an actionable record of every accepted or rejected row.
- **Dependencies:** Implemented transaction pagination and balance replay; an append-only schema migration; version 5 portability conversion; account-level import page and templates. No bank-specific mapper, temporary-file datastore, background job, or Redis service is required for the first 5 MB/10,000-row release.
- **Risks or trade-offs:** Stable source IDs are mandatory and user-prepared data can still target the wrong account; the explicit account summary and projected balance are the safeguards. Partial row success is intentional, but all accepted rows remain atomic. Imported transactions sharing a date with an existing valuation must follow and test the established replay ordering. Account bootstrap, valuation import, transfer import, automatic provider mapping, fuzzy duplicate detection, and persistent import-history reports remain out of scope.
- **Acceptance criteria:** Met. CSV and JSON equivalents produce identical stored transactions; preview performs no writes; structural file failures perform no writes; valid rows commit while invalid and duplicate rows remain excluded; re-importing the same file changes no balances; conflicting IDs never overwrite data; the owner/account unique index stops duplicate races; deleting an imported transaction releases its external ID; foreign and archived accounts are denied; accepted-row database failure rolls back all accepted rows; projected and final balances match replay exactly; transaction export includes external IDs; version 5 round-trips and versions 2 through 4 restore; no raw file or sensitive row is logged. [tests/unit/account-history-import.test.ts](tests/unit/account-history-import.test.ts) covers sign, precision, date, valuation ordering, 10,000 rows, duplicate/conflict behavior, ID lifecycle, rollback, exports, and portability. [tests/unit/account-history-import-route.test.ts](tests/unit/account-history-import-route.test.ts) covers auth, origin, ownership/file error mapping, 5 MB limits, no-store responses, and hash confirmation. [tests/component/account-history-import.test.tsx](tests/component/account-history-import.test.tsx) covers preview, confirmation, privacy, reports, and hash mismatch feedback; [tests/component/account-history-ai-prompt.test.tsx](tests/component/account-history-ai-prompt.test.tsx) covers currency-aware CSV/JSON prompt contracts and clipboard behavior. [tests/e2e/acceptance.spec.ts](tests/e2e/acceptance.spec.ts) and [tests/e2e/isolation.spec.ts](tests/e2e/isolation.spec.ts) cover the complete account workflow, responsive layouts, and cross-user denial.

### F4. Account Data-Freshness Indicators

- **Priority:** P2
- **Estimated effort:** Medium
- **Current gap:** Account cards show `updatedAt`, but the product does not classify stale accounts or explain whether the latest update was a transaction or valuation.
- **Evidence from the repository:** [components/accounts-list.tsx](components/accounts-list.tsx) displays the update date and a 30-day change. Accounts and valuations already carry timestamps in [db/schema.ts](db/schema.ts).
- **Proposed improvement:** Add per-user freshness thresholds, an "as of" date, stale badges, and filters for stale accounts. For manual assets, base freshness on the latest valuation rather than any metadata edit.
- **User value:** Users know which land, vehicle, cash, or investment values need attention before trusting the dashboard.
- **Dependencies:** A query that returns latest financial event metadata; settings field for freshness thresholds.
- **Risks or trade-offs:** Different asset classes need different expectations. Avoid one universal threshold that marks illiquid assets incorrectly.
- **Acceptance criteria:** Users can see and filter stale accounts; freshness uses financial activity rather than cosmetic edits; thresholds are configurable; the dashboard reports how much net worth is stale.

### F5. Goal Scenario Comparison, Milestones, and Behind-Plan Alerts (Implemented)

- **Status:** Implemented on 2026-08-03. External notifications remain deferred to A15.
- **Priority:** P2
- **Estimated effort:** Large
- **Previous gap:** Goals showed one projection, but users could not compare scenarios, create milestones, or receive proactive reminders.
- **Implementation:** [lib/finance.ts](lib/finance.ts) provides a pure scenario projection used by [components/goal-scenario-comparison.tsx](components/goal-scenario-comparison.tsx) for three independently editable, non-persistent cases. [db/schema.ts](db/schema.ts) adds owner-scoped milestones and monthly alert dismissals. [lib/services/goals.ts](lib/services/goals.ts) derives deterministic milestone status and reliable behind-plan reminders; the goal detail and authenticated dashboard expose the workflows.
- **User value:** Users can answer "what if I add KES 20,000 per month?" and receive useful prompts before a target becomes unreachable.
- **Alert policy:** Active goals that are reliably calculated as behind plan appear on the post-login dashboard. A dismissal suppresses that goal through the current month in the user's timezone; it may return next month if still behind. No background worker or external notification channel was added.
- **Trade-offs:** Forecasts remain estimates, not promises. Comparison copy exposes monthly compounding, contribution timing, fixed target/date, and excluded fees, taxes, inflation, and volatility. Monthly dismissal prevents repeated prompts while preserving a later reminder.
- **Acceptance criteria:** Met. [tests/unit/finance.test.ts](tests/unit/finance.test.ts) covers immutable scenario math. [tests/unit/multi-user.test.ts](tests/unit/multi-user.test.ts) covers milestone status, cross-user denial, monthly dismissal recurrence, version 4 round-trip, and version 2 compatibility. [tests/e2e/acceptance.spec.ts](tests/e2e/acceptance.spec.ts) covers three scenario controls, reload non-persistence, milestone creation/restore, alert dismissal across refresh/restore, and responsive goal detail layouts.

### F6. Date-Scoped and Downloadable Reports with Movement Attribution

- **Priority:** P2
- **Estimated effort:** Large
- **Current gap:** The reports page is all-time and fixed-layout. It cannot compare arbitrary periods, download a presentation-ready report, or explain the events behind an unusual movement.
- **Evidence from the repository:** [app/(app)/reports/page.tsx](<app/(app)/reports/page.tsx>) always requests `getDashboardData(userId, "all")`. It renders net worth, allocation, income/returns, classification, and account comparison but has no date controls or report export.
- **Proposed improvement:** Add URL-based date ranges and prior-period comparison, deterministic movement attribution by account/event, and downloadable CSV/PDF summaries generated from the same calculated report model.
- **User value:** Better monthly and annual reviews, advisor sharing, and rapid understanding of major changes.
- **Dependencies:** Architecture items A1, A3, and A14; report DTO separate from page rendering.
- **Risks or trade-offs:** PDF generation increases bundle/runtime complexity. Start with print CSS and CSV before introducing a PDF dependency.
- **Acceptance criteria:** Users can select and bookmark a range, compare it with the preceding range, see top positive/negative account drivers, and download a report whose totals match the UI exactly.

### F7. User Account Deletion and Data-Retention Controls

- **Priority:** P1
- **Estimated effort:** Large
- **Current gap:** Users can change passwords and export data but cannot delete or disable their own application account. There is no retention policy or export-before-delete flow.
- **Evidence from the repository:** [app/(app)/settings/page.tsx](<app/(app)/settings/page.tsx>) exposes preferences, rates, password, and portability only. `users` has `active`/`disabled` status in [db/schema.ts](db/schema.ts), and owner foreign keys already cascade on user deletion.
- **Proposed improvement:** Add password-confirmed account deletion with a required pre-delete export option, clear consequences, session invalidation, and either immediate hard deletion or a documented short recovery window.
- **User value:** Users control their data lifecycle and can leave a multi-user deployment safely.
- **Dependencies:** Audit events; a short architecture decision record choosing immediate hard deletion or a defined soft-delete retention and purge policy.
- **Risks or trade-offs:** Soft deletion conflicts with a strict erasure promise; hard deletion is irreversible. Operator backups may retain data and must be covered by policy.
- **Acceptance criteria:** A user can export and delete only their own identity and portfolio; all sessions are invalidated; other users are unaffected; backup-retention implications are disclosed; automated tests verify cascading isolation.

### F8. Session and Login Activity Management

- **Priority:** P2
- **Estimated effort:** Large
- **Current gap:** Sessions are stateless JWTs. Users can invalidate all other sessions by changing their password, but cannot view active sessions, revoke one device, or review meaningful login history.
- **Evidence from the repository:** [lib/auth/session.ts](lib/auth/session.ts) validates JWT expiry and `sessionVersion`. `users.lastLoginAt` stores only one timestamp in [db/schema.ts](db/schema.ts); no session or auth-event table exists.
- **Proposed improvement:** Add privacy-minimized session records with creation, last seen, coarse client label, and revocation. Keep "sign out all devices" separate from password changes.
- **User value:** Better control after device loss and clearer security feedback.
- **Dependencies:** Auth-event/audit model; cookie token identifier; cleanup job.
- **Risks or trade-offs:** Device fingerprints can become invasive. Store minimal metadata and document retention.
- **Acceptance criteria:** Users can list and revoke their sessions, revoke all except current, see recent successful/failed security events without raw IP retention, and verify revoked tokens fail immediately.

### F9. Guided First-Run Onboarding

- **Priority:** P2
- **Estimated effort:** Medium
- **Current gap:** Signup now lets users choose a catalog-backed base currency and creates no exchange rate, then opens an empty dashboard. There is still no guided confirmation of enabled currencies, timezone, rate assumptions, or first account.
- **Evidence from the repository:** `registerUser()` in [lib/auth/users.ts](lib/auth/users.ts) creates settings and defaults. [app/(app)/page.tsx](<app/(app)/page.tsx>) provides a good first-account empty state but no multi-step onboarding.
- **Proposed improvement:** Add a dismissible onboarding checklist for locale/currency, exchange-rate setup, first account, first valuation/transaction, and optional first goal. Keep demo data opt-in and user-targeted.
- **User value:** New users reach a trustworthy dashboard with fewer hidden defaults.
- **Dependencies:** Remaining architecture item A1 provenance work; implemented F12 currency catalog and base-currency configuration; onboarding completion setting.
- **Risks or trade-offs:** A forced wizard can slow experienced users. Make steps skippable and resumable.
- **Acceptance criteria:** A new user can complete or dismiss onboarding, no financial account is created automatically, unsafe placeholder rates are not treated as authoritative, and progress survives refresh.

### F10. Recurring Activity and Contribution Automation

- **Priority:** P2
- **Estimated effort:** Epic
- **Current gap:** Goal plans describe expected contributions, but recurring transactions are not generated and users must enter every deposit, interest payment, fee, or liability payment manually.
- **Evidence from the repository:** `goal_contribution_plans` exists in [db/schema.ts](db/schema.ts), while no recurring transaction schedule or job table exists. All mutations are request-driven.
- **Proposed improvement:** Add recurring templates with previewed next occurrences, a database-backed scheduler, idempotent generation, pause/skip controls, and explicit distinction between planned and posted activity.
- **User value:** Less repetitive entry and more accurate goal adherence.
- **Dependencies:** Architecture item A15; notification design; timezone-safe scheduling.
- **Risks or trade-offs:** Automatically posting guessed transactions can corrupt trust. Default to "due for review" until the user opts into automatic posting.
- **Acceptance criteria:** Every occurrence is idempotent, user-scoped, timezone-correct, pausable, and auditable; missed runs recover safely; generated entries remain editable through supported correction workflows.

### F11. Liability Payoff Planning

- **Priority:** P3
- **Estimated effort:** Large
- **Current gap:** Liabilities affect net worth and support increase/payment transactions, but there is no interest model, amortization schedule, or payoff scenario.
- **Evidence from the repository:** Liability categories and transaction effects exist in [db/schema.ts](db/schema.ts) and [lib/finance.ts](lib/finance.ts). Goal projections currently model savings targets, not debt schedules.
- **Proposed improvement:** Add optional principal, interest rate, minimum payment, and extra-payment scenarios with a payoff chart. Keep manual balance valuations as the source of truth.
- **User value:** Users can plan debt reduction alongside asset goals.
- **Dependencies:** Deterministic amortization module; recurring activity.
- **Risks or trade-offs:** Loan terms differ widely. Avoid implying lender-grade statements or automatically altering balances from projections.
- **Acceptance criteria:** Scenarios reconcile mathematically, assumptions are explicit, projections do not mutate actual balances, and unsupported loan structures degrade to manual tracking.

### F12. Curated Currency Catalog and Per-User Base Currency (Implemented)

- **Status:** Implemented on 2026-08-03.
- **Priority:** P1
- **Estimated effort:** Medium
- **Previous gap:** User settings stored a per-user base currency and JSON list of supported currencies, but fresh users received only KES and USD, currency settings were manually typed, and account and goal forms accepted free-text three-letter codes. There was no curated, discoverable currency catalog or explicit policy for changing a user's base currency.
- **Previous evidence:** [db/schema.ts](db/schema.ts) defaulted `supportedCurrencies` to only KES and USD; settings, account, and goal forms accepted typed codes. [lib/money.ts](lib/money.ts) already provided the ISO-aware integer-minor-unit foundation retained by the implementation.
- **Implementation:** [lib/currencies.ts](lib/currencies.ts) defines the centralized ISO-backed catalog, labels, defaults, normalization, and legacy-option handling. Signup and Settings provide catalog-backed base selection; Settings manages each user's enabled set and locks base/in-use currencies. Account, goal, and exchange-rate forms use enabled-only selectors. [lib/services/settings.ts](lib/services/settings.ts) owns authoritative enablement and reference policies used by account, goal, rate, and CSV import services.
- **User value:** East African and internationally diversified users can model their actual holdings, choose the reporting currency that makes sense to them, and discover supported currencies without memorizing ISO codes.
- **Supporting work:** Fresh users enable KES, USD, TZS, and UGX and receive no fabricated rate. Restore normalizes its enabled set from every source record and supports zero-rate archives. Historical net-worth points carry completeness metadata, and dashboard/report warnings identify currencies excluded for missing effective-dated rates.
- **Trade-offs:** The curated list is intentionally smaller than all ISO 4217 codes, while valid previously configured currencies remain available as legacy options. Base-currency changes can leave totals incomplete until the user supplies rates; original source amounts are never rewritten.
- **Acceptance criteria:** Met. [tests/unit/money.test.ts](tests/unit/money.test.ts) covers catalog defaults plus JPY/KWD precision. [tests/unit/multi-user.test.ts](tests/unit/multi-user.test.ts) covers disabled and invalid service inputs, base auto-inclusion, in-use protection, source immutability, historical completeness, zero-rate portability, and two-user base/rate isolation. [tests/e2e/acceptance.spec.ts](tests/e2e/acceptance.spec.ts) covers signup choice, TZS/UGX discovery, settings, missing-rate resolution, restore persistence, enabled account/goal selectors, and supported responsive widths.

### F13. Institution Directory and Account Linking (Implemented)

- **Status:** Implemented on 2026-08-05.
- **Priority:** P2
- **Estimated effort:** Medium
- **Previous gap:** Each account stored an optional free-text institution name. Spelling variants became unrelated filter and report groups, institution details were duplicated or omitted, and users could not manage a consistent directory of banks, SACCOs, brokers, fund managers, lenders, or other providers.
- **Implementation:** [db/schema.ts](db/schema.ts) defines owner-scoped institutions and a composite-owned optional account relationship. [lib/services/institutions.ts](lib/services/institutions.ts) owns normalized uniqueness, create/read/update/archive behavior, and linked-account counts. [components/institution-selector.tsx](components/institution-selector.tsx) provides searchable selection, self-custodied accounts, and inline creation, while [app/(app)/institutions/page.tsx](<app/(app)/institutions/page.tsx>) manages full details and archives. Account filtering uses institution IDs, and analytics and CSV output resolve current names through owner-scoped joins.
- **User value:** Users select a consistent provider once, maintain its useful reference details centrally, and receive stable account filters and institution-allocation reports even after the provider is renamed.
- **Migration and portability:** [db/migrations/0001_concerned_famine.sql](db/migrations/0001_concerned_famine.sql) backfills distinct normalized legacy names per user before replacing the account string. User exports are version 4; version 2 and 3 archives synthesize institutions from legacy names during restore.
- **Trade-offs:** Institutions remain user-scoped rather than becoming a shared global catalog. Selection stays optional for property, vehicles, cash, private businesses, and self-custodied assets. Branch names and masked references remain account-level data, archived institutions retain existing links, and website values are validated but never fetched automatically. Merge-duplicate tooling remains deferred.
- **Acceptance criteria:** Met. [tests/unit/institutions.test.ts](tests/unit/institutions.test.ts) covers normalized uniqueness, two-user isolation, active/archive link policy, rename-driven reporting, version 4 round-trip, and version 3 conversion. [tests/e2e/institutions.spec.ts](tests/e2e/institutions.spec.ts) covers inline creation, account linking, directory counts, rename propagation, and ID-based filtering. The migration is tested against fresh and previous-schema disposable databases with foreign-key validation.

### F14. Configurable Local and OIDC Authentication

- **Priority:** P1
- **Estimated effort:** Epic
- **Current gap:** Wealthboard supports only local username/password signup and login. `/signup` is always public, `users.passwordHash` is required, and deployment configuration has no authentication policy or OIDC provider settings. Operators cannot use an identity provider as the sole login method or offer both local and OIDC login safely.
- **Product direction:** Add a startup-selected authentication policy through `AUTH_METHODS=local`, `AUTH_METHODS=oidc`, or `AUTH_METHODS=local,oidc`. The default remains `local` for backward compatibility. Authentication methods are deployment policy, not per-user feature flags, and changes take effect only after validated restart. Keep the immutable Wealthboard user UUID as the application session subject and ownership boundary regardless of login method.
- **Mode matrix:** In `local`, show local signup and username/password login and expose no OIDC routes or controls. In `oidc`, disable local signup and local password login completely and show only `Continue with <provider>`; `/signup` redirects to `/login`, and crafted calls to signup/login/password actions are rejected server-side. In `local,oidc`, local signup remains available and the login page offers both username/password and OIDC. OIDC never has a public signup form in any mode.
- **OIDC first login:** A successfully validated first OIDC login may provision the required internal Wealthboard user, settings, and seeded categories atomically. Treat this as login-driven just-in-time internal provisioning, not signup: there is no OIDC registration page, local password creation, owner ID input, default credential, or unauthenticated local account-creation action. Create no rates, financial accounts, goals, or demo data. An optional authenticated first-login profile-completion step may collect display name, base currency, and timezone after the OIDC session exists; it must not weaken OIDC-only mode or become another public creation path.
- **Internal identity model:** Make `users.passwordHash` nullable so an OIDC-only user has no usable local credential. Retain a unique internal username/handle for display, logs, CLI targeting, and compatibility, but do not use an OIDC claim as proof of local-login ownership. Generate collision-resistant handles such as `oidc-<stable hash of issuer and subject>` when no explicit local username exists. Existing local users and hashes remain unchanged.
- **OIDC identity table:** Add owner-scoped `oidc_identities` with `id`, `userId`, canonical `issuer`, opaque `subject`, `createdAt`, `updatedAt`, and `lastLoginAt`. Enforce unique `(issuer, subject)` so one provider identity maps to exactly one internal user, plus unique `(userId, issuer)` for one identity from the configured provider per user. Delete identities with their user. Identity mappings are excluded from per-user portability exports and restores but are naturally included in deployment-operator SQLite backups. Never persist access tokens, refresh tokens, ID tokens, authorization codes, PKCE verifiers, or provider claim payloads in the database, files, logs, exports, analytics, or client storage.
- **Configuration contract:** When OIDC is enabled, require `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, a base64-encoded 32-byte `OIDC_TRANSACTION_SECRET`, and a bounded `OIDC_PROVIDER_NAME`; derive the exact callback as `${APP_URL}/api/auth/oidc/callback`. Use scopes `openid profile email` initially, but require only protocol claims needed for identity and validation; email is optional display metadata and never an identity-linking key. Default the ID-token algorithm allowlist to `RS256`, with any future override intersected against discovery metadata rather than accepted blindly. Reject credentials embedded in URLs, query/fragment-bearing issuers, non-HTTPS issuers outside explicit localhost development, unknown `AUTH_METHODS` values, duplicate methods, malformed secrets, and incomplete OIDC settings. Do not expose either secret to browser bundles.
- **Startup and readiness:** Add one server-only validated authentication configuration module used by pages, actions, routes, proxy policy, and startup/readiness checks. OIDC-only startup fails closed if OIDC configuration or discovery is invalid. Hybrid mode may continue serving local login during a temporary provider outage, while the OIDC button reports provider unavailability safely. Prevent deployment lockout: switching to OIDC-only must fail readiness when active local users lack a linked OIDC identity; switching to local-only must fail readiness when active users lack a password hash. Operators must disable users deliberately or complete migration before changing modes. Preserve dormant hashes/identity links so rollback to the previous mode is possible.
- **Protocol implementation with JOSE:** Use the already installed `jose` package plus native `fetch`, `URL`, `URLSearchParams`, and `node:crypto`; do not add Axios, `openid-client`, a second session framework, or custom JWT parsing. Fetch `${OIDC_ISSUER}/.well-known/openid-configuration` with a short timeout and bounded server-only cache, validate the metadata with Zod, and require its returned `issuer` to equal the configured canonical issuer exactly. Validate HTTPS `authorization_endpoint`, `token_endpoint`, and `jwks_uri` values before use. This discovery pattern supports Keycloak realm issuers such as `https://host/realms/name` without hard-coding `/protocol/openid-connect/*` endpoint paths.
- **Authorization request:** Generate state, nonce, and a high-entropy PKCE verifier with `node:crypto`; derive the S256 challenge as base64url-encoded SHA-256. Build the authorization URL from the discovered `authorization_endpoint` with `client_id`, `response_type=code`, exact callback `redirect_uri`, `scope=openid profile email`, `state`, `nonce`, `code_challenge`, and `code_challenge_method=S256`. Store state, nonce, verifier, issued/expiry timestamps, safe relative `next`, intent, and optional linking user ID inside a short-lived encrypted JOSE transaction token; never put the client secret or provider token in that cookie.
- **Token exchange and verification:** On callback, validate the authorization response and constant-time state match before sending the code once to the discovered `token_endpoint` through native `fetch` as `application/x-www-form-urlencoded`, including `grant_type=authorization_code`, `client_id`, `client_secret`, exact `redirect_uri`, code, and PKCE verifier. Apply timeout, response-size, content-type, and safe provider-error handling. Create a cached `jose.createRemoteJWKSet(new URL(jwks_uri))` with bounded request timeout, cooldown, and key cache; verify `id_token` through `jose.jwtVerify` using exact issuer, audience/client ID, explicit algorithm allowlist, expiry/`nbf`, and small documented clock tolerance. Require non-empty `sub` and an exact constant-time nonce match from the verified payload. Read display claims only from that verified payload; never call `decodeJwt`/`decodeJWT` as authentication evidence. Discard the authorization code and all returned access, refresh, and ID tokens immediately after issuing the internal Wealthboard session.
- **OIDC transaction cookie:** Encrypt and authenticate the one-time transaction token with `jose.EncryptJWT`/`jwtDecrypt` using `alg=dir` and `enc=A256GCM` plus the dedicated `OIDC_TRANSACTION_SECRET`. Use a cookie separate from `wealthboard_session`, scoped narrowly to the callback flow, HTTP-only, Secure in production, `SameSite=Lax` for the top-level provider redirect, and expiring within ten minutes. Include issuer/audience markers and a random `jti`, consume and clear it on every success or failure, and rely on the provider's one-use authorization code plus cleared transaction cookie to reject callback replay. Reject missing, expired, replayed, malformed, or mismatched state/nonce/verifier transactions without revealing identity details.
- **Session boundary:** After local or OIDC authentication succeeds, issue the existing Wealthboard session cookie containing only internal user UUID, session version, and expiry. Continue checking user status and `sessionVersion` on every protected request. OIDC tokens never authorize portfolio access directly. Password changes, identity linking/unlinking, operator resets, and security-sensitive method changes increment `sessionVersion` and invalidate other Wealthboard sessions.
- **OIDC routes and proxy:** Add public `GET /api/auth/oidc/start` and `GET /api/auth/oidc/callback` routes and explicitly exempt only those protocol endpoints from [proxy.ts](proxy.ts). The start route is available only when OIDC is configured; the callback accepts only a valid outstanding transaction. Apply bounded per-client initiation/callback abuse controls without treating a provider error as a local password failure. Keep all financial mutation authorization independent of proxy middleware.
- **Login and signup UI:** [app/login/page.tsx](app/login/page.tsx) renders only configured methods: local form, OIDC button, or both with a clear separator. Preserve generic local login errors. [app/signup/page.tsx](app/signup/page.tsx) and [app/signup/actions.ts](app/signup/actions.ts) are available only when `local` is enabled; OIDC-only requests redirect or return a generic method-disabled response before parsing credentials. Do not label the OIDC button as signup. Keep keyboard, loading, unavailable-provider, callback-error, and safe retry states responsive at all supported widths.
- **JIT provisioning rules:** Resolve users only by canonical `(issuer, subject)`. Never auto-link or merge using username, `preferred_username`, display name, email, verified-email status, or other mutable claims. For a new identity, create the internal user, identity row, settings, and categories in one transaction and handle concurrent callbacks through the database uniqueness constraint. Derive display name from `name`, then `preferred_username`, then the generated handle, with existing length and control-character validation. Disabled internal users remain denied even when the provider login succeeds.
- **Hybrid linking:** Avoid duplicate portfolios by adding explicit authentication-method management in Settings. A signed-in local user may link OIDC only after fresh local-password confirmation and a complete OIDC flow marked with `intent=link`. A signed-in OIDC user may enable local login only in hybrid mode after fresh OIDC reauthentication and choosing an available local username/password. Never link based on matching claims. Reject an OIDC identity already owned by another user. Never allow unlinking/removal of the user's last usable method under the active deployment policy. Increment `sessionVersion` after every link, unlink, or local-credential enablement.
- **Password operations:** Show password change only to users with a password and only when local authentication is enabled. In OIDC-only mode, hide and server-side reject password login, password changes, and local signup. The operator reset CLI must refuse to create a local credential while local auth is disabled unless an explicitly documented recovery workflow is designed; it may continue resetting existing local credentials in local/hybrid mode. No email recovery or provider-token recovery is added.
- **Logout:** Application logout always destroys the Wealthboard session and user-specific browser state. The first release does not require provider-wide or single logout because that could sign users out of unrelated applications; optionally expose RP-initiated logout later through `end_session_endpoint` as a separate, provider-tested setting. Returning from the provider with an existing provider session still requires a new validated Wealthboard OIDC transaction.
- **Migration and rollback:** Append a migration for nullable password hashes and `oidc_identities`; do not rewrite current users or hashes. Test empty and previous-schema upgrades with `foreign_key_check`. Existing local deployments start in `local`. Recommended migration is `local` -> `local,oidc`, explicit linking for existing users, readiness verification that every required active user has OIDC, then `oidc`. Keep local hashes dormant in OIDC-only mode for rollback unless the user explicitly removes local authentication in hybrid mode.
- **Deployment documentation:** Update `.env` examples, [docker-compose.yml](docker-compose.yml), [deploy/kubernetes.yaml](deploy/kubernetes.yaml), README, SPEC, architecture, and authentication instructions with the mode matrix, callback URL, provider registration, secret handling, reverse-proxy/TLS requirements, issuer/client settings, rollout/rollback, and provider-outage behavior. Kubernetes stores both the OIDC client secret and transaction secret in a Secret, not the manifest or image. Include a tested Keycloak example using only the realm issuer, confidential client ID/secret, standard authorization-code flow, PKCE S256, exact callback URI, and provider-side user/application assignment; do not document or log discovered tokens or copy a real secret into repository examples. Document one provider in the first release; multiple simultaneous issuers remain out of scope.
- **Dependencies:** Complete or coordinate A7 trusted-proxy/origin hardening and A16 startup/readiness validation. Reuse the current internal session and user-isolation boundaries. F8 session inventory is complementary but not required for OIDC login. Update the repository authentication instruction that currently requires always-public signup before implementation, because F14 intentionally replaces that invariant with the mode matrix.
- **Risks or trade-offs:** JIT provisioning allows every identity accepted by the configured provider unless deployment policy adds an optional provider-side assignment or a validated required-claim allowlist; rely on provider application assignment by default and document it. OIDC outages block OIDC-only login. Misconfiguration can lock out users, so readiness checks and staged hybrid rollout are mandatory. Explicit linking adds friction but prevents account takeover and duplicate/merged portfolios. A single configured provider keeps the first implementation supportable.
- **Acceptance criteria:** All three modes expose and accept only configured methods; OIDC-only has no local signup or password login path; a valid first OIDC login provisions exactly one isolated internal user without financial data; repeat and concurrent logins resolve the same UUID; every protocol validation failure fails closed; state transactions are one-time and expire; issuer/subject uniqueness and disabled-user checks hold; username/email collisions never auto-link; explicit linking and unlinking require fresh reauthentication and cannot remove the final usable method; mode changes that would strand active users fail readiness; local users and hashes upgrade without change; local login remains usable during OIDC outage in hybrid mode; no provider secret/token/claim payload is logged, exported, persisted, or sent to the client; session cookies and OIDC transaction cookies have the required distinct attributes; two users authenticated by different methods remain isolated across URLs, mutations, imports, exports, analytics, and caches. Deterministic unit, route, component, migration, mock-provider integration, and Playwright tests cover the mode matrix, discovery metadata validation, Keycloak-compatible endpoints, state/nonce/PKCE, code replay, token endpoint failures, JWKS rotation/cache behavior, wrong issuer/audience/algorithm/signature, expired/early tokens and clock tolerance, JIT races, linking collisions, rollout guards, logout, callback errors, and 360/390/768/1024/1440 px layouts.

## AI-Assisted Functionality

AI should remain optional and must never become the source of truth for balances, conversions, returns, or goal forecasts. The current deterministic services are a good foundation, but they should be narrowed into purpose-built read models before any model receives portfolio data.

Mandatory constraints for every AI feature:

- Core financial calculations stay in application code and are covered by deterministic tests.
- The model explains supplied calculated results; it does not independently calculate authoritative balances.
- AI tools accept a session-derived `userId` internally and expose only narrow validated operations, never raw SQL or unrestricted database access.
- Models cannot execute investments, transfers, or financial mutations. Proposed changes require a preview and explicit user confirmation through normal validated actions.
- Structured inputs and outputs are validated with Zod before use.
- Sensitive values are minimized or redacted, API keys remain server-side, and no provider training/retention assumption is made without disclosure.
- Users can disable AI and delete AI activity where retained.
- AI requests record privacy-safe audit metadata, model, token usage, latency, and cost without logging prompts containing raw sensitive values by default.
- UI copy states that output is explanatory and not regulated financial advice.
- Per-user rate limits, token limits, monthly budgets, model allowlists, timeouts, and cancellation are required.

The deterministic AI1 foundation and on-demand AI2 review are implemented while explicitly omitting unavailable or unreliable metrics. A1 provenance, A3 cash-flow-aware performance, F4 freshness, and F6 movement attribution can enrich later snapshot versions without making the current model authoritative. Scheduled summaries and extraction jobs remain blocked on A15. F8 is useful for user security visibility but is not a prerequisite for read-only AI tools.

### AI1. Deterministic Portfolio Review Tool Layer (Implemented)

- **Status:** Implemented on 2026-08-04.
- **Priority:** P2
- **Estimated effort:** Large
- **Previous gap:** No AI integration existed, and services returned broad application/domain objects rather than a minimized model-facing contract.
- **Implementation:** [lib/services/portfolio-review.ts](lib/services/portfolio-review.ts) builds a strict version 1 owner-scoped snapshot with deterministic totals, ratios, category/currency allocation, pseudonymous concentration, goal trajectory, data-quality warnings, methodology, and stable evidence IDs. Exact aggregates and names are independent opt-ins; notes, references, descriptions, raw activity, annualized returns, unavailable freshness, and unavailable movement attribution are excluded. [lib/ai/schemas.ts](lib/ai/schemas.ts) bounds both snapshot and provider output contracts, and every model finding must cite supplied evidence.
- **User value:** Establishes a safe base for portfolio explanations without exposing the whole database.
- **Dependencies:** Current missing-rate completeness is included. A1 provenance, A3 cash-flow-aware performance, F4 freshness, and F6 movement attribution remain optional future snapshot fields rather than launch blockers.
- **Risks or trade-offs:** The bounded contract intentionally provides less context than a raw portfolio dump. This reduces privacy and prompt-injection risk but limits causal explanations until deterministic attribution exists.
- **Acceptance criteria:** Met. [tests/unit/portfolio-review.test.ts](tests/unit/portfolio-review.test.ts) covers two-user isolation, sensitive-field and injection-text exclusion, bounded exact sharing, evidence validation, immutable financial records, fake-provider orchestration, and token accounting.

### AI2. AI Portfolio Review and Monthly Wealth Summary (On-Demand Implemented)

- **Status:** On-demand review implemented on 2026-08-04. Scheduled monthly summaries remain deferred to A15.
- **Priority:** P2
- **Estimated effort:** Epic
- **Previous gap:** The dashboard showed metrics but did not provide a bounded narrative critique of concentration, liquidity, cash flow, goal trajectory, or data quality.
- **Implementation:** [app/(app)/review/page.tsx](<app/(app)/review/page.tsx>) and [components/portfolio-review-workspace.tsx](components/portfolio-review-workspace.tsx) provide a dedicated, privacy-aware, non-persistent review workspace with period/focus controls, per-request sharing consent, session-only credentials, cancellation, evidence-linked findings, and a non-advisory label. [lib/ai/provider.ts](lib/ai/provider.ts) uses the official OpenAI Node client through Chat Completions for fixed OpenAI/DeepSeek presets or operator-allowlisted compatible endpoints. [lib/services/ai-provider.ts](lib/services/ai-provider.ts) owns encrypted BYOK settings, one-minute cooldown, monthly token budgets, metadata-only usage, and user deletion controls; [app/api/ai/review/route.ts](app/api/ai/review/route.ts) enforces session ownership, trusted origin, bounded input, no-store responses, and safe provider errors.
- **User value:** Makes the existing analytics understandable and actionable for non-specialists.
- **Remaining change:** Add optional idempotent scheduled monthly summaries only after A15 provides durable jobs and retention. F6 may later add deterministic movement-driver evidence.
- **Dependencies:** AI1 is implemented. A15 is required only for scheduled reviews; F6 is required only for causal movement narrative.
- **Risks or trade-offs:** OpenAI-compatible providers differ in model behavior and JSON reliability. Responses are therefore validated locally, rejected for invented evidence, never persisted, and cannot execute tools or financial mutations. BYOK shifts provider cost and retention policy to each user, with explicit disclosure.
- **Acceptance criteria:** On-demand criteria are met. [tests/unit/ai-security.test.ts](tests/unit/ai-security.test.ts) covers encryption, tampering, owner binding, and endpoint policy; [tests/unit/ai-provider.test.ts](tests/unit/ai-provider.test.ts) covers two-user credential/usage isolation, cooldown, budgets, exports, deletion, and disconnect; [tests/unit/ai-review-route.test.ts](tests/unit/ai-review-route.test.ts) covers authentication, origin, strict input, and session-derived ownership; [tests/component/portfolio-review.test.tsx](tests/component/portfolio-review.test.tsx) covers sharing consent, session-key clearing, privacy-mode removal, and cancellation. Scheduled-summary acceptance remains deferred with A15.

### AI3. Natural-Language Portfolio Questions and Scenario Planning

- **Priority:** P3
- **Estimated effort:** Large
- **Current gap:** Users cannot ask questions such as excluding land/vehicles, isolating global equities, comparing contributions with returns, or changing a goal contribution scenario in natural language.
- **Evidence from the repository:** Deterministic category flags, allocation maps, account comparisons, and goal projection functions already exist, but only fixed pages call them.
- **Proposed improvement:** Map natural-language requests to a fixed allowlist of read-only tools and deterministic scenario functions. Show the interpreted filters and assumptions before the answer.
- **User value:** Faster ad hoc analysis without adding dozens of report controls.
- **Dependencies:** AI1; F5; F6; clear category taxonomy.
- **Risks or trade-offs:** Ambiguous language can select the wrong assets. The interface must display and let users correct the interpreted scope.
- **Acceptance criteria:** Questions are answered only from validated tool results; every answer shows scope/as-of date; scenarios never persist without confirmation; unsupported questions fail safely; no raw SQL or arbitrary code path exists.

### AI4. Statement and Screenshot Extraction with Reconciliation Assistance

- **Priority:** P3
- **Estimated effort:** Epic
- **Current gap:** CSV import is structured and safe, but PDF/image statements require manual transcription. There is no OCR or model-assisted categorization.
- **Evidence from the repository:** [lib/services/portability.ts](lib/services/portability.ts) accepts CSV and validates every row. [components/settings-forms.tsx](components/settings-forms.tsx) has no statement preview/extraction path.
- **Proposed improvement:** Extract candidate account names, dates, descriptions, amounts, currencies, and balances into the same import preview model proposed in F3. Use deterministic duplicate checks and require confirmation before commit.
- **User value:** Faster statement entry and reconciliation while preserving control.
- **Dependencies:** F2, F3, AI1 safety infrastructure, secure temporary-file handling.
- **Risks or trade-offs:** OCR and models make transcription errors and statements contain highly sensitive information. Prefer local extraction where feasible, minimize retention, and never auto-post.
- **Acceptance criteria:** Original files have explicit retention/deletion behavior; extracted rows show confidence and source location; low-confidence fields require review; structured output validates; no transaction is created before confirmation.

### AI5. Anomaly Detection and Categorization Suggestions

- **Priority:** P3
- **Estimated effort:** Large
- **Current gap:** Wealthboard does not flag unusual balance jumps, duplicate-looking activity, stale valuations, or inconsistent category choices beyond deterministic validation errors.
- **Evidence from the repository:** Event history and category metadata are available, but no anomaly baseline or suggestion workflow exists.
- **Proposed improvement:** Implement deterministic rules first, then optionally use AI to explain anomalies and suggest categories. Suggestions remain non-authoritative and user-confirmed.
- **User value:** Earlier detection of entry mistakes and easier cleanup.
- **Dependencies:** F2, F3, F4, AI1, audit events.
- **Risks or trade-offs:** False positives can erode trust. Users need controls to dismiss, mute, and explain expected outliers.
- **Acceptance criteria:** Deterministic rules are separately testable; AI never changes data; suggestions show evidence; dismissal feedback is user-scoped; costs and false-positive rates are measurable.

## Architecture Improvements

### A1. Make Exchange-Rate Provenance and History Completeness Authoritative (Partially Implemented)

- **Status:** Placeholder removal and aggregate/history completeness implemented on 2026-08-03; provenance/freshness remains.
- **Priority:** P0
- **Estimated effort:** Medium
- **Previous architectural concern:** Signup seeded USD/KES `130` effective from 2000 as `initial-default`, and historical net-worth calculation silently omitted holdings when a rate was missing.
- **Implemented foundation:** [lib/auth/users.ts](lib/auth/users.ts) creates no exchange rate. `getHistoricalPoint()` in [lib/services/analytics.ts](lib/services/analytics.ts) returns completeness and missing-currency metadata, while dashboard and reports visibly mark incomplete totals and history.
- **Remaining change:** Add richer rate provenance/freshness and expose affected historical date ranges. Keep optional automatic providers explicit and user-controlled.
- **Expected benefit:** Net worth, trends, goal progress, and reports cannot silently understate foreign-currency holdings.
- **Migration considerations:** The fresh baseline contains no placeholder. A pre-change deployment should identify `source = "initial-default"` rows and require user confirmation instead of treating them as authoritative or silently deleting other user-entered rates.
- **Risks and trade-offs:** Users with cross-currency holdings now see an initial missing-rate warning until they enter a rate. That is preferable to a plausible but stale number. Automatic rates can remain optional later.
- **Acceptance criteria:** Placeholder removal, aggregate/history completeness flags, affected currency codes, and historical missing-rate regression tests are complete. Rate provenance/freshness and explicit affected date ranges remain.

### A2. Enforce Reserved Transaction-Type Invariants on Update (Implemented)

- **Status:** Implemented on 2026-08-04.
- **Priority:** P0
- **Estimated effort:** Small
- **Previous architectural concern:** Creation blocked `opening_balance` and `transfer`, but update validation accepted every `transactionType`. `updateTransaction()` checked the existing row's type, not the requested new type, so a crafted authenticated action could turn a normal row into an unpaired transfer or an extra opening balance.
- **Implementation:** [lib/validation.ts](lib/validation.ts) now defines ordinary transaction mutations by excluding `opening_balance` and `transfer`, with separate create and update schemas. [app/(app)/actions.ts](<app/(app)/actions.ts>) uses the update-specific schema, and [lib/services/accounts.ts](lib/services/accounts.ts) independently rejects both reserved target types before database work so non-action callers cannot bypass the invariant.
- **Expected benefit:** Preserves transfer pairing, contribution classification, and balance replay invariants even under crafted requests.
- **Migration considerations:** No schema or fresh-database migration was required. Existing malformed historical rows, if any, are not rewritten by this guard and should be audited separately before correction workflows are introduced.
- **Risks and trade-offs:** Users still need correction workflows; merely blocking edits without F2 preserves current friction.
- **Acceptance criteria:** Met. [tests/unit/transaction-update.test.ts](tests/unit/transaction-update.test.ts) submits crafted `transfer` and `opening_balance` payloads through the server action and directly to the service, verifies the complete transaction row, idempotency key, and account balance remain unchanged, confirms no extra opening or transfer row appears, and proves a normal type change still replays the balance.

### A3. Replace Cash-Flow-Naive Annualized Return Calculations

- **Priority:** P0
- **Estimated effort:** Large
- **Current architectural concern:** Account comparison subtracts aggregate net flows from gain but annualizes against the opening balance without considering when deposits and withdrawals occurred. The displayed "effective annualized" value can therefore be materially misleading.
- **Evidence from the repository:** `getAccountComparisons()` in [lib/services/analytics.ts](lib/services/analytics.ts) calculates `periodReturn = gain / start` and compounds by elapsed days. [app/(app)/reports/page.tsx](<app/(app)/reports/page.tsx>) presents the result as account performance with only a short-period badge.
- **Proposed change:** Implement time-weighted return for investment performance and optionally XIRR/money-weighted return for investor experience. Define cash-flow classification and valuation boundaries explicitly. Until validated, remove or relabel the current figures as a non-performance estimate.
- **Expected benefit:** Account comparison becomes financially meaningful under irregular contributions and withdrawals.
- **Migration considerations:** No schema change is required initially. Reliable TWR may require valuation points at cash-flow boundaries or a documented approximation.
- **Risks and trade-offs:** XIRR can have no solution or multiple solutions; TWR needs adequate valuations. The UI must show method, period, and data sufficiency.
- **Acceptance criteria:** Golden tests cover deposits at beginning/middle/end, withdrawals, fees, transfers, missing valuations, and negative returns; reports show methodology and confidence; fixtures reconcile with an independent reference implementation.

### A4. Make Offline Database Restore Fail-Safe

- **Priority:** P0
- **Estimated effort:** Medium
- **Current architectural concern:** The restore script checks candidate integrity, then replaces the active database after deleting WAL/SHM files. It does not automatically create a pre-restore backup or restore the original on a failed swap/post-check.
- **Evidence from the repository:** [scripts/restore-backup.mjs](scripts/restore-backup.mjs) copies the candidate to a temporary path and renames it over the target. [scripts/backup.mjs](scripts/backup.mjs) is separate and manual. No backup/restore tests exist.
- **Proposed change:** Create and verify a timestamped pre-restore online/offline copy, fsync the staged file where supported, atomically swap, run post-restore integrity/schema checks, and automatically roll back if validation fails.
- **Expected benefit:** A mistaken or logically incompatible restore does not destroy the last working database.
- **Migration considerations:** Preserve current CLI flags but add free-space checks and clear paths for the recovery artifact.
- **Risks and trade-offs:** Requires approximately twice the database size during restore. Explicitly fail before touching the target when space is insufficient.
- **Acceptance criteria:** Automated tests cover valid restore, corrupt source, missing tables, interrupted swap simulation, insufficient space, and post-check failure; every failed case leaves the original byte-for-byte recoverable.

### A5. Enforce Account State, Goal-Link, and Supported-Currency Rules in Services (Partially Implemented)

- **Status:** Supported-currency service policy implemented on 2026-08-03; archived-account and goal-link state rules remain.
- **Priority:** P1
- **Estimated effort:** Medium
- **Current architectural concern:** UI forms filter archived/liability accounts, but transaction, valuation, and transfer services fetch accounts by owner and ID without consistently rejecting archived rows. Goal service validation verifies ownership but not archived/liability state.
- **Evidence from the repository:** `recordTransaction()`, `recordValuation()`, and [lib/services/transfers.ts](lib/services/transfers.ts) do not filter `archivedAt`. `GoalForm` filters accounts client-side in [components/forms/goal-form.tsx](components/forms/goal-form.tsx), while `assertLinkedAccountAvailable()` in [lib/services/goals.ts](lib/services/goals.ts) does not enforce the same state rules. Currency selectors and service enforcement are complete through F12.
- **Remaining change:** Centralize `requireActiveOwnedAccount()` in the service layer. Block normal transactions, valuations, transfers, and goal links for archived accounts. Permit historical corrections only through the explicit correction workflow in F2, with a separate authorization/invariant path.
- **Expected benefit:** Crafted or stale forms cannot mutate archived accounts, link liabilities to savings goals, or create unsupported currency states.
- **Migration considerations:** Audit existing linked liabilities, archived-account activity after archive dates, and currencies outside settings before tightening validation.
- **Risks and trade-offs:** Strict currency allowlists can frustrate users adding a new currency. Offer an inline settings path rather than silent acceptance.
- **Acceptance criteria:** Service-level tests reject every normal mutation against archived accounts regardless of UI; only the dedicated correction command can alter historical archived activity; linked liabilities and unsupported currencies are rejected; account, goal, rate, import, and transfer validation use one policy.

### A6. Introduce Typed Domain Errors and Safe Client Error Mapping

- **Priority:** P1
- **Estimated effort:** Medium
- **Current architectural concern:** Server actions log only the error name but return arbitrary `Error.message` to the client. SQLite/Drizzle errors can leak internal constraint or schema details, while some API routes collapse useful row errors into generic messages.
- **Evidence from the repository:** `mutationError()` in [app/(app)/actions.ts](<app/(app)/actions.ts>) returns `error.message`. Import and restore handlers in [app/api](app/api) use separate ad hoc policies.
- **Proposed change:** Define domain error codes with safe user messages and internal causes. Map validation, not-found, conflict, rate, and invariant errors consistently; log unexpected errors with a request ID.
- **Expected benefit:** Better UX without exposing database internals, plus logs that can correlate failures with user-visible support codes.
- **Migration considerations:** Convert service errors incrementally, starting with financial mutations and portability.
- **Risks and trade-offs:** Excessive error classes add ceremony. Keep a small discriminated union and one mapping layer.
- **Acceptance criteria:** Unexpected database text never reaches clients; expected errors retain actionable messages and field context; every 5xx response includes a safe request ID; tests cover representative mappings.

### A7. Harden Proxy Trust, CSRF Tests, and Browser Security Headers

- **Priority:** P1
- **Estimated effort:** Medium
- **Current architectural concern:** Login/signup rate limiting trusts the leftmost `x-forwarded-for` value without an explicit trusted-proxy model. Import/restore routes validate `Origin`, while server actions rely on SameSite cookies and Next.js framework checks. No CSP, HSTS, frame, referrer, or permissions policy is configured.
- **Evidence from the repository:** [app/login/actions.ts](app/login/actions.ts) and [app/signup/actions.ts](app/signup/actions.ts) split `x-forwarded-for` at the first value. [lib/auth/origin.ts](lib/auth/origin.ts) protects file mutations. [next.config.ts](next.config.ts) disables `X-Powered-By` but defines no security headers.
- **Proposed change:** Document supported proxy topology, accept a sanitized client IP only from trusted ingress, normalize IPv4 and configurable IPv6 prefix identities for rate limiting, test spoofed headers, add cross-origin server-action tests, and configure a deployment-compatible CSP and standard security headers.
- **Expected benefit:** Rate limiting cannot be trivially bypassed by spoofed headers, and browser defenses are explicit rather than implicit.
- **Migration considerations:** CSP must account for Next.js scripts/styles and Recharts. Test in report-only mode before enforcement.
- **Risks and trade-offs:** Incorrect proxy trust can rate-limit every user as one address or trust attacker input. Incorrect CSP can break the app.
- **Acceptance criteria:** Direct clients cannot choose their rate-limit identity; documented ingress configuration produces the correct IPv4 address or configured IPv6 prefix; unsupported proxy topologies fail closed; cross-origin mutations fail; automated header tests cover CSP, frame denial, referrer, MIME sniffing, and production HSTS policy.

### A8. Remediate Verified Production Dependency Advisories

- **Priority:** P1
- **Estimated effort:** Medium
- **Current architectural concern:** A review-time `npm audit --omit=dev` reported three high-severity advisories through Next's bundled PostCSS and Sharp/libvips dependencies. The suggested forced fix is an invalid breaking downgrade and must not be applied blindly.
- **Evidence from the repository:** [package.json](package.json) pins `next@16.2.12`. `npm ls` resolves Next's `postcss@8.4.31` and `sharp@0.34.5`; the audit reported PostCSS disclosure/XSS advisories and Sharp/libvips CVEs. Direct Tailwind/Vite PostCSS resolves to a newer version.
- **Proposed change:** Identify the first supported Next release that includes fixed transitive versions, upgrade in a dedicated branch, and add lockfile audit plus container scanning to CI. If no supported fix exists, document exploitability and temporary mitigations.
- **Expected benefit:** Removes known vulnerable production components and prevents silent recurrence.
- **Migration considerations:** Re-run full Next.js build, image optimization, PWA, and E2E checks. Do not use `npm audit fix --force` when it proposes a major downgrade.
- **Risks and trade-offs:** Framework upgrades may change Server Actions or build output. Pin reviewed action/dependency versions and stage the rollout.
- **Acceptance criteria:** Production audit has no unaccepted high/critical findings; any exception has an owner, exploitability note, mitigation, and expiry; container scanning reports are retained in CI.

### A9. Gate Container Publication on Quality and Supply-Chain Checks

- **Priority:** P1
- **Estimated effort:** Medium
- **Current architectural concern:** The only GitHub Actions workflow builds and pushes on every commit without first running lint, typecheck, tests, or the production build as explicit gates. Actions use mutable major tags, and no SBOM, provenance, signature, or vulnerability scan is published.
- **Evidence from the repository:** [.github/workflows/publish-container.yml](.github/workflows/publish-container.yml) contains checkout, Buildx, login, metadata, and push steps only.
- **Proposed change:** Add a required validation job, publish only after it passes, use least-privilege permissions, and pin third-party actions to reviewed commit SHAs. Produce a CycloneDX JSON SBOM, SLSA provenance, a Sigstore/Cosign signature, and a Trivy image scan before tagging `latest` (equivalent standards may be substituted through an explicit architecture decision).
- **Expected benefit:** Broken or vulnerable images are less likely to become the default deployment artifact.
- **Migration considerations:** E2E adds several minutes and may be separated into required pull-request and push jobs. Keep BuildKit cache sharing explicit.
- **Risks and trade-offs:** Longer CI and scanner false positives. Define severity policy and exception process.
- **Acceptance criteria:** A failing lint/type/test/E2E/build or unaccepted high/critical Trivy finding blocks publication; branch and SHA tags remain traceable; image digest, CycloneDX SBOM, SLSA provenance, Cosign verification command, and scan result are available for each release.

### A10. Bound Synchronous Import, Restore, and Analytics Workloads

- **Priority:** P1
- **Estimated effort:** Large
- **Current architectural concern:** CSV parsing and up to 10,000 inserts, JSON restore arrays up to 100,000 records, and historical analytics all run synchronously in the web process. File-size limits exist, but there is no processing deadline, progress, cancellation, or event-loop isolation.
- **Evidence from the repository:** [lib/services/portability.ts](lib/services/portability.ts) uses `csv-parse/sync` and synchronous better-sqlite3 transactions. Import/restore routes read full files into memory. [lib/services/analytics.ts](lib/services/analytics.ts) repeatedly replays event histories.
- **Proposed change:** Establish measured workload budgets. Keep small operations synchronous; route large previews/restores/reports through bounded database-backed jobs with progress and cancellation. Add per-user concurrency limits.
- **Expected benefit:** One user's large upload or report cannot make every user's requests unresponsive.
- **Migration considerations:** Introduce jobs only after benchmarks show the synchronous threshold; do not add Redis by default.
- **Risks and trade-offs:** Jobs add recovery and UX complexity. SQLite still serializes writes, so job concurrency must remain low.
- **Acceptance criteria:** Benchmarks define supported sizes and latency; requests above the synchronous threshold become jobs or are rejected clearly; operations time out/cancel safely; concurrent users retain an agreed response-time budget.

### A11. Automate Backups, Retention, and Restore Drills

- **Priority:** P1
- **Estimated effort:** Large
- **Current architectural concern:** Backup is a manual script with no schedule, retention, integrity verification after creation, status reporting, encryption guidance, or automated restore drill.
- **Evidence from the repository:** [scripts/backup.mjs](scripts/backup.mjs) creates timestamped files. Compose and Kubernetes mount backup storage, but [deploy/kubernetes.yaml](deploy/kubernetes.yaml) has no CronJob. README advises manual testing.
- **Proposed change:** Add configurable scheduled backups, retention, post-backup integrity/hash checks, optional encrypted off-host copy, and a periodic disposable restore verification. Expose only non-sensitive status/age metrics.
- **Expected benefit:** Recovery objectives are demonstrable rather than assumed.
- **Migration considerations:** Work with A4 so pre-restore and scheduled backups share primitives. Keep operator control for secrets and external storage.
- **Risks and trade-offs:** Local-only backups do not protect against host loss; off-host copies increase secret-management obligations.
- **Acceptance criteria:** RPO/RTO and retention are documented; backup files use restrictive permissions; off-host backups are encrypted with operator-managed keys; failed or stale backups alert; a scheduled drill restores into a disposable path and runs integrity/schema checks; production data never appears in logs.

### A12. Add Minimal Structured Observability and Audit Events

- **Priority:** P2
- **Estimated effort:** Large
- **Current architectural concern:** Production behavior is visible mainly through `console.error`, a `SELECT 1` health check, and no request IDs, duration metrics, backup status, or privacy-safe audit trail.
- **Evidence from the repository:** Console logging appears in actions and import/restore/login/signup handlers. [app/api/health/route.ts](app/api/health/route.ts) only checks database connectivity. No observability dependency or audit table exists.
- **Proposed change:** Start with JSON logs, request IDs, operation durations, auth/security events, backup/job status, and optional error tracking. Add a minimal user-visible audit history for destructive or security-sensitive actions. Avoid a mandatory large monitoring stack.
- **Expected benefit:** Operators can diagnose failures and users can understand sensitive changes without exposing financial payloads.
- **Migration considerations:** Define a redaction policy and retention before logging. Metrics should be optional for self-hosted deployments.
- **Risks and trade-offs:** Logs can become a second sensitive datastore. Never log amounts, notes, exports, passwords, tokens, or raw uploaded rows by default.
- **Acceptance criteria:** Every error has a request ID; logs are machine-parseable and redacted; auth, restore, password, deletion, and backup events are auditable; health distinguishes liveness from readiness without leaking internals.

### A13. Keep SQLite, but Define Its Operating Envelope

- **Priority:** P2
- **Estimated effort:** Medium
- **Current architectural concern:** SQLite is appropriate for the current self-hosted single-process design, but multi-user growth, background jobs, reporting, and Kubernetes can increase write contention. No measured operating envelope or WAL maintenance runbook exists.
- **Evidence from the repository:** [lib/db.ts](lib/db.ts) enables WAL, foreign keys, and a 5-second busy timeout. [deploy/kubernetes.yaml](deploy/kubernetes.yaml) correctly uses one replica, `Recreate`, and ReadWriteOnce storage. better-sqlite3 is synchronous and there is no connection pool.
- **Proposed change:** Retain SQLite now. Add lock/busy metrics, WAL checkpoint policy, `quick_check`/`ANALYZE` maintenance, storage monitoring, concurrency benchmarks, and explicit single-writer/single-replica documentation.
- **Expected benefit:** Preserves low operational complexity while making capacity limits observable.
- **Migration considerations:** Begin this capacity work after A1-A3 establish trusted financial semantics. PostgreSQL is not justified solely by multi-user support. Reassess when sustained lock timeouts occur, more than one application replica is required, background write concurrency becomes material, datasets reach measured reporting limits, or online failover is required.
- **Risks and trade-offs:** Staying too long can cause contention; moving early adds a database service, pooling, backup, migration, and deployment burden.
- **Acceptance criteria:** Baseline tests record p95 read/write latency, lock failures, and WAL growth before tuning; supported transaction/user/concurrency ranges are documented; one-replica constraints are enforced; PostgreSQL review triggers are measurable.

If those triggers are reached, use a phased PostgreSQL plan: introduce dialect-neutral service tests; create a PostgreSQL Drizzle schema and migrations; dual-run export/import validation on a production-like copy; compare row counts, balances, ownership, and reports; rehearse rollback; add pooled connections and backups; perform a low-downtime cutover with writes paused; retain the SQLite snapshot until validation completes.

### A14. Optimize Historical Analytics and Account Comparison After Benchmarking

- **Priority:** P2
- **Estimated effort:** Large
- **Current architectural concern:** Dashboard rendering loads and replays all user transactions/valuations multiple times. Account comparisons issue a transaction query per account. Complexity grows predictably with history length.
- **Evidence from the repository:** [app/(app)/page.tsx](<app/(app)/page.tsx>) requests dashboard data, all-time history, and three separate historical points. Each path calls `eventMap()` in [lib/services/analytics.ts](lib/services/analytics.ts). `getAccountComparisons()` loops over accounts and queries transactions per account.
- **Proposed change:** Benchmark first. Consolidate dashboard history into one event load/replay, batch account comparisons, add cursor pagination, and consider user-scoped daily/monthly snapshots only when replay exceeds the latency budget.
- **Expected benefit:** Predictable dashboard/report latency for long-lived portfolios without premature caching complexity.
- **Migration considerations:** Derived snapshots must be rebuildable and invalidated after backdated edits, deletes, or rate changes.
- **Risks and trade-offs:** Cached financial aggregates can become stale and more dangerous than slow queries. Keep event history authoritative and add reconciliation tests.
- **Acceptance criteria:** Benchmarks cover 10,000 and 100,000 events; query counts and p95 latency targets are recorded; backdated mutations produce identical cached and replayed results; no cache key omits `userId`.

### A15. Add a Small Database-Backed Job Runner and Retention Policies

- **Priority:** P2
- **Estimated effort:** Large
- **Current architectural concern:** Scheduled backups, recurring activity, notifications, large reports, and AI reviews need durable background execution. `idempotency_keys` has no expiry and grows indefinitely.
- **Evidence from the repository:** There is no job table or worker. `login_attempts` is pruned in [lib/auth/rate-limit.ts](lib/auth/rate-limit.ts), while `idempotency_keys` in [db/schema.ts](db/schema.ts) has only a created-date index.
- **Proposed change:** Add a minimal SQLite job table with lease, attempts, next-run time, owner context, and idempotency. Run one worker in the single application process or a controlled sidecar. Add explicit retention for completed jobs, idempotency keys, auth attempts, and AI audit metadata.
- **Expected benefit:** Durable automation without introducing Redis or a separate queue prematurely.
- **Migration considerations:** Jobs that touch private data must carry an immutable `userId` and re-check user status at execution time.
- **Risks and trade-offs:** Multiple workers can contend on SQLite. Enforce one active worker and transactional leasing.
- **Acceptance criteria:** Jobs are at-least-once and idempotent, preserve user isolation, recover after restart, expose failure status, and prune according to documented retention.

### A16. Validate Production Configuration and Harden Deployment Probes

- **Priority:** P2
- **Estimated effort:** Medium
- **Current architectural concern:** Required configuration is validated lazily. The health route only executes `SELECT 1`. Kubernetes uses the same shallow endpoint for readiness and liveness, has no startup probe, and defines no CPU limit.
- **Evidence from the repository:** [lib/auth/token.ts](lib/auth/token.ts) validates `SESSION_SECRET` only when used; [lib/auth/origin.ts](lib/auth/origin.ts) validates `APP_URL` only for state-changing file routes. [app/api/health/route.ts](app/api/health/route.ts) checks connectivity. [deploy/kubernetes.yaml](deploy/kubernetes.yaml) runs migrations in `npm start` before Next starts.
- **Proposed change:** Add startup configuration validation, separate liveness/readiness semantics, migration/schema readiness, storage writability/free-space checks, a startup probe, resource tuning, and documented graceful termination behavior.
- **Expected benefit:** Misconfigured deployments fail before serving traffic and orchestration makes safer restart decisions.
- **Migration considerations:** Keep health responses minimal and unauthenticated; detailed diagnostics belong in logs or an operator command.
- **Risks and trade-offs:** A write-heavy health check can create load. Cache checks briefly and keep liveness independent of transient dependencies.
- **Acceptance criteria:** Missing/invalid secrets, URL, timezone, or paths stop startup; readiness stays false during migrations; liveness does not restart a pod for a temporary lock; deployment manifests include startup behavior and measured resources.

### A17. Expand Risk-Based Automated Tests and Coverage Gates

- **Priority:** P1
- **Estimated effort:** Large
- **Current architectural concern:** Existing tests are high value but narrow: 32 named tests, two component tests, three Chromium E2E journeys, and coverage configured only for `lib/finance.ts` and `lib/money.ts` with no threshold.
- **Evidence from the repository:** [vitest.config.ts](vitest.config.ts), [playwright.config.ts](playwright.config.ts), and [tests](tests) show strong core/isolation coverage but no backup/restore CLI tests, archived-account mutation test, broad form component coverage, accessibility scan, or concurrency/load fixture. Reserved transaction-type update attacks and historical incomplete-rate behavior now have focused regressions.
- **Proposed change:** Build a risk matrix and add tests in priority order: A1-A5 and A4 restore cases; auth header/rate-limit behavior; import preview/deduplication; PWA offline/update; component form states; accessibility; performance fixtures. Add meaningful per-module coverage thresholds rather than a global vanity number.
- **Expected benefit:** Protects the exact invariants most likely to cause financial or multi-user regressions.
- **Migration considerations:** Keep deterministic clocks/timezones and disposable databases. Add Firefox/WebKit only for workflows with demonstrated browser risk.
- **Risks and trade-offs:** Broad E2E suites become slow and flaky. Prefer service integration tests for financial/authorization matrices and reserve E2E for critical journeys.
- **Acceptance criteria:** Every P0 has a regression test; CI enforces thresholds for finance, money, auth, services, and portability; accessibility tests cover key pages; performance fixtures report trends without brittle wall-clock assertions.

### A18. Complete PWA and Accessibility Verification

- **Priority:** P2
- **Estimated effort:** Medium
- **Current architectural concern:** The service worker correctly caches only shell/static assets, but tests only verify manifest/service-worker availability. There is no automated offline-navigation/update test or accessibility audit beyond two primitive component tests.
- **Evidence from the repository:** [public/sw.js](public/sw.js) uses network-first navigation and static caching. [components/pwa-manager.tsx](components/pwa-manager.tsx) blocks offline submissions. [tests/component](tests/component) covers privacy and progress only.
- **Proposed change:** Add Playwright offline/update lifecycle tests and axe-based checks for login, signup, dashboard, forms, dialogs, charts, and mobile navigation. Add accessible text summaries for all chart states where absent.
- **Expected benefit:** The installed application remains safe and usable across connectivity and assistive-technology scenarios.
- **Migration considerations:** Service-worker tests need isolated browser contexts and cache cleanup.
- **Risks and trade-offs:** Automated accessibility tools do not replace keyboard and screen-reader review.
- **Acceptance criteria:** Authenticated responses are never cached; offline mutations are blocked; update activation is tested; critical pages have no serious automated accessibility violations and pass documented keyboard checks.

## Technical Debt

### TD1. Split Large Service and UI Modules Along Existing Ownership Boundaries

- **Priority:** P2
- **Estimated effort:** Large
- **Issue:** [lib/services/portability.ts](lib/services/portability.ts) is about 649 lines, accounts and analytics exceed 500 lines, settings forms approach 470 lines, and the central action module approaches 400 lines.
- **Improvement:** Separate archive schema/export/restore/CSV concerns, account command/query/replay concerns, and settings preference/rate/security/portability panels. Keep domain APIs stable; do not introduce repository classes or generic service layers without a concrete need.
- **Acceptance criteria:** Modules have focused responsibilities, no behavior changes, circular dependencies are absent, and existing tests remain green.

### TD2. Unify Validation and Form Contracts

- **Priority:** P2
- **Estimated effort:** Medium
- **Issue:** Shared Zod schemas exist in [lib/validation.ts](lib/validation.ts), while settings/rate schemas live in the action module and client forms sometimes use weaker parallel schemas or `action as unknown` casts.
- **Improvement:** Define shared input contracts per domain, derive client types from them, and use typed adapters for progressive enhancement instead of unchecked action casts.
- **Acceptance criteria:** Client and server reject the same invalid inputs; schemas remain in dependency-light validation modules that never import React components or services; settings/rates use reusable schemas; no form action requires an `unknown` cast; field errors retain current UX; no circular imports are introduced.

### TD3. Centralize Product Defaults and Policy Values (Partially Implemented)

- **Priority:** P2
- **Estimated effort:** Small
- **Issue:** Currency catalog/defaults are now centralized in [lib/currencies.ts](lib/currencies.ts), but Africa/Nairobi, session duration, goal return, upload limits, auth rate limits, and date-range values remain spread across services, schemas, forms, routes, and deployment files.
- **Improvement:** Separate product defaults from security/runtime policy and expose one server-only validated configuration module plus safe client constants where needed.
- **Acceptance criteria:** Each policy has one source of truth, environment overrides validate at startup, and tests cover defaults and invalid values.

### TD4. Version Portability Formats Explicitly (Partially Implemented)

- **Priority:** P2
- **Estimated effort:** Medium
- **Issue:** User export now emits version 4 and restore explicitly converts version 2 and 3 archives for newer goal and institution collections, but there is still no general converter registry or documented support window.
- **Improvement:** Document archive support windows, add version-dispatched parsers/converters, and keep exported calculation-independent source records forward portable.
- **Acceptance criteria:** The archive version changes only when the serialized contract changes; each supported version has an isolated parser and converter; unsupported versions return a clear message; at least one fixture per supported version validates conversion and round-trip; removals follow the documented support window.

### TD5. Document Financial Semantics as Executable Examples

- **Priority:** P3
- **Estimated effort:** Medium
- **Issue:** Purchase/sale effects, valuation ordering, contribution classification, linked-goal semantics, and transfer currency behavior are implemented but spread across code and tests.
- **Improvement:** Add a concise financial semantics document backed by golden test fixtures for each transaction type and same-date ordering rule.
- **Acceptance criteria:** An engineer can predict balance, contribution, growth, and goal effects from the document; examples execute in tests; ambiguous same-date ordering is explicitly resolved.

## Suggested Delivery Phases

Phases describe dependency order for one delivery stream, not a ban on parallel work. Within a phase, independent items may run concurrently; A8 can proceed alongside A1-A7, A9 and A17 should be delivered together, and AI1/A12 can be designed together while scheduled AI remains blocked on A15. Item-level dependencies take precedence over phase placement.

### Phase 1: Critical Correctness and Security

- A1 exchange-rate provenance and completeness.
- A2 reserved transaction-type invariants. **Implemented 2026-08-04.**
- A3 cash-flow-aware return methodology.
- A4 fail-safe restore.
- A5 service-level account/currency/goal rules.
- A7 proxy/origin/header hardening.
- A8 dependency remediation.
- A17 regression tests for every P0/P1 invariant.
- F14 configurable local and OIDC authentication.

### Phase 2: Core Product Completeness

- F1 transaction workbench. **Implemented 2026-08-03.**
- F2 reconciliation and corrections.
- F3 account-scoped CSV/JSON history import.
- F4 freshness indicators.
- F5 goal scenarios, milestones, and in-app alerts. **Implemented 2026-08-03.**
- F6 date-scoped downloadable reports.
- F7 account deletion and export-before-delete.
- F12 currency catalog and per-user base currency. **Implemented 2026-08-03.**
- F13 institution directory and account linking. **Implemented 2026-08-05.**
- F9 onboarding.

### Phase 3: Reliability and Operational Maturity

- A9 CI/container quality gates.
- A10 bounded heavy workloads.
- A11 backup automation and restore drills.
- A12 observability and audit events.
- A13 SQLite operating envelope.
- A14 analytics performance work based on benchmarks.
- A15 database-backed jobs and retention.
- A16 deployment validation and probes.
- A18 PWA/accessibility verification.
- F8 session management.
- F10 recurring activity.

### Phase 4: Intelligent Features

- AI1 deterministic read-only tool layer. **Implemented 2026-08-04.**
- AI2 on-demand AI Portfolio Review. **Implemented 2026-08-04; monthly scheduling deferred to A15.**
- AI3 natural-language questions and goal scenarios.
- AI4 statement extraction through import preview.
- AI5 anomaly explanations and categorization suggestions.

### Phase 5: Optional Expansion

- F11 liability payoff planning.
- Optional automatic market/exchange-rate providers with explicit provenance and manual fallback.
- Advanced tax-oriented exports only after jurisdiction and methodology are defined.
- Shared household views only if product direction changes; keep independent ownership as the default and do not retrofit organizations prematurely.

## Quick Wins

"Quick" describes implementation size and independence, not urgency. P0 quick wins remain release-blocking.

- ~~Block reserved `transfer` and `opening_balance` types in transaction updates (A2).~~ Completed on 2026-08-04.
- Reject archived accounts and invalid goal links at service boundaries (A5).
- ~~Stop treating the seeded USD/KES placeholder as authoritative (first part of A1).~~ Completed on 2026-08-03.
- Add a server-side pre-restore backup before replacing the SQLite file (first part of A4).
- ~~Add transaction type/account/date filters before full pagination (first slice of F1).~~ Completed as the full F1 transaction workbench on 2026-08-03.
- Add security headers in report-only/tested mode and trusted-proxy documentation (first slice of A7).
- Add an npm audit and image scan job without automatic forced fixes (first slice of A8/A9).
- Add stale-account badges using existing event timestamps (F4).
- Add an account-deletion product decision and retention statement before implementation (F7).
- Add coverage thresholds for finance, money, auth, portability, and owner-scoped services (A17).

## Recommended Next Five Tasks

1. **Complete exchange-rate provenance and freshness.** Why next: placeholder removal and missing-rate completeness are implemented, but users still need richer source/freshness metadata and affected historical date ranges. **Estimated effort:** Medium. **Dependencies:** F12 implemented foundation. **Expected outcome:** Every configured rate has clear provenance/freshness and incomplete periods identify their affected ranges.
2. **Implement fail-safe database restore with automatic rollback.** Why next: the current operator restore can replace the last working database without creating a recovery copy. **Estimated effort:** Medium. **Dependencies:** Shared backup primitive. **Expected outcome:** Every restore either succeeds and validates or leaves the previous database recoverable.
3. **Replace or temporarily remove the current annualized return figures.** Why next: cash-flow timing is ignored, so a prominent report can misstate performance. **Estimated effort:** Large. **Dependencies:** Agreed TWR/XIRR methodology and golden fixtures. **Expected outcome:** Performance comparisons are mathematically defensible and disclose method/data sufficiency.
4. **Create a required CI quality and dependency-security gate before image publication.** Why next: verified high-severity transitive advisories are present and the publish workflow currently has no test or scan prerequisite. **Estimated effort:** Medium. **Dependencies:** Supported Next/Sharp remediation choice and stable E2E environment. **Expected outcome:** Only tested, audited, traceable container images can receive publish tags.
5. **Reject archived accounts and invalid goal links at service boundaries.** Why next: UI filtering does not stop crafted or stale requests from mutating archived accounts or linking liabilities to savings goals. **Estimated effort:** Medium. **Dependencies:** A2 implemented foundation. **Expected outcome:** Normal financial mutations and goal links consistently enforce active, compatible accounts regardless of caller.
