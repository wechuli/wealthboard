# Project Improvement Backlog

## Purpose

This file contains only work that is not fully implemented. Completed product
and architecture contracts belong in [SPEC.md](SPEC.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [README.md](README.md), and the
user/operator guides under [docs](docs).

Wealthboard is a strong late-stage MVP and early production candidate. Its
implemented baseline includes multi-user authentication and isolation,
balance- and position-tracked accounts, paginated transaction history, goals,
reports, imports and portability, estate planning, browser-local appearance
themes, optional on-demand AI review, PWA behavior, and Docker/Kubernetes
deployment.

The highest remaining risks are financial methodology and completeness,
operator restore safety, service-boundary consistency, publication controls,
and operational observability. Supporting multiple users increases the blast
radius of mistakes: every future query, aggregate, cache, import, job, API, and
AI tool must preserve the verified-session `userId` boundary.

## Priority Definitions

- **P0:** Critical issue involving security, data loss, incorrect financial
  output, or broken core functionality.
- **P1:** High-value improvement that should be addressed soon.
- **P2:** Useful medium-term improvement.
- **P3:** Optional expansion.

Effort estimates:

- **Small:** Less than one day.
- **Medium:** One to three days.
- **Large:** More than three days.
- **Epic:** Multiple phases or substantial architectural work.

## Functionality Improvements

### F1. Reconciliation and Safe Correction Workflows

- **Priority:** P1
- **Estimated effort:** Large
- **Current gap:** Balance-account opening balances cannot be corrected,
  transfers can only be deleted and recreated, and valuations can only be
  deleted and re-entered. Position-event corrections and broker reconciliation
  observations exist, but equivalent safe correction workflows do not cover
  ordinary balance accounts.
- **Proposed improvement:** Add explicit commands to adjust an opening balance,
  edit both transfer legs atomically, edit a valuation, and reconcile an account
  to a statement balance as of a date with a previewed adjustment.
- **User value:** Users can correct mistakes without deleting history or
  manually calculating compensating entries.
- **Dependencies:** Use the established balance replay and reserved-transaction
  invariants. Audit events under A10 are desirable.
- **Risks or trade-offs:** Rewriting historical events changes every later
  balance. The UI must preview affected values and distinguish correction from
  new economic activity.
- **Acceptance criteria:** Every correction shows old/new source values and
  downstream effects, requires confirmation, updates all affected records in
  one transaction, preserves transfer net worth, excludes reconciliation
  adjustments from contributions, and has replay/rollback/cross-user tests.

### F2. Manual-Account Data Freshness

- **Priority:** P2
- **Estimated effort:** Medium
- **Current gap:** Position accounts expose configurable per-instrument price
  freshness, but balance-account cards still use generic update timestamps.
  Manual land, vehicle, business, cash, and fund accounts do not distinguish
  financial freshness from cosmetic metadata edits.
- **Proposed improvement:** Add configurable freshness policies for
  balance-tracked asset classes, derive an `as of` date from the latest relevant
  valuation or financial event, expose stale badges and filters, and report how
  much net worth is stale.
- **User value:** Users can tell which manual values need review before trusting
  dashboard, goal, estate, or report totals.
- **Dependencies:** Coordinate exchange-rate freshness with A1 and reuse the
  existing position issue model without pretending one threshold fits every
  asset class.
- **Risks or trade-offs:** Illiquid assets need different review cadences from
  cash or traded funds. Metadata edits must not reset financial freshness.
- **Acceptance criteria:** Users can configure and filter stale manual
  accounts; freshness is based on financial evidence; account, dashboard,
  goal, estate, and report views identify stale exposure; tests prove cosmetic
  edits do not make an account fresh.

### F3. Date-Scoped Downloadable Reports

- **Priority:** P2
- **Estimated effort:** Large
- **Current gap:** Reports remain all-time and fixed-layout. Deterministic
  position movement attribution exists, but users cannot select/bookmark an
  arbitrary period, compare it with the preceding period, download one shared
  report model, or see complete account/event drivers across all account modes.
- **Proposed improvement:** Add URL-based ranges and prior-period comparison,
  deterministic movement attribution by account/event, and downloadable CSV
  plus print-ready summaries generated from the same calculated DTO.
- **User value:** Better monthly/annual reviews, advisor sharing, and rapid
  explanation of unusual changes.
- **Dependencies:** A1 rate provenance/completeness, A2 return methodology, and
  A12 analytics performance.
- **Risks or trade-offs:** Server-side PDF generation adds runtime complexity;
  start with print CSS and CSV. A download must never drift from UI totals.
- **Acceptance criteria:** Users can select and bookmark a range, compare the
  preceding range, see top positive/negative drivers, and download a report
  whose totals, completeness, and methodology exactly match the UI.

### F4. User Account Deletion and Data-Retention Controls

- **Priority:** P1
- **Estimated effort:** Large
- **Current gap:** Users can export data and manage credentials but cannot
  delete or disable their own application identity and portfolio. There is no
  product retention/recovery policy.
- **Proposed improvement:** Add reauthentication-confirmed account deletion,
  an export-before-delete step, clear consequences, immediate session
  invalidation, and either hard deletion or a documented short recovery window.
- **User value:** Users control their data lifecycle and can leave a shared
  deployment safely.
- **Dependencies:** A10 audit events and an architecture decision for hard
  deletion versus retained recovery.
- **Risks or trade-offs:** Soft deletion conflicts with strict erasure; hard
  deletion is irreversible. Operator backups may retain data and must be
  disclosed.
- **Acceptance criteria:** A user can export and delete only their own identity
  and portfolio; every session is invalidated; other users are unchanged;
  backup-retention implications are disclosed; cascade/isolation tests pass.

### F5. Session and Login Activity Management

- **Priority:** P2
- **Estimated effort:** Large
- **Current gap:** Browser sessions are stateless JWTs. Users can invalidate all
  sessions through security-sensitive changes but cannot list devices, revoke
  one session, retain the current session while revoking others, or review a
  useful login/security history.
- **Proposed improvement:** Add privacy-minimized session records with token ID,
  creation, last seen, coarse client label, expiry, and revocation. Add recent
  auth events without retaining raw IP addresses.
- **User value:** Better control after device loss and clearer security
  feedback.
- **Dependencies:** A10 audit/redaction policy and A13 retention jobs. The
  mobile API under F9 should reuse this inventory rather than create another.
- **Risks or trade-offs:** Device fingerprinting can become invasive. Keep
  metadata minimal, bounded, and documented.
- **Acceptance criteria:** Users can revoke one session or all except current,
  see recent privacy-minimized security events, and verify revoked tokens fail
  immediately; two-user isolation and retention tests pass.

### F6. Guided First-Run Onboarding

- **Priority:** P2
- **Estimated effort:** Medium
- **Current gap:** Signup creates safe defaults and an empty dashboard, but
  there is no resumable guide for enabled currencies, timezone, exchange-rate
  assumptions, first account, first financial update, or optional first goal.
- **Proposed improvement:** Add a dismissible/resumable onboarding checklist.
  Keep demo data opt-in and targeted to one user.
- **User value:** New users reach a trustworthy dashboard with fewer hidden
  assumptions.
- **Dependencies:** A1 rate provenance guidance and existing account/goal empty
  states.
- **Risks or trade-offs:** A forced wizard slows experienced users. Steps must
  be skippable and non-destructive.
- **Acceptance criteria:** A new user can complete, skip, or resume onboarding;
  progress survives refresh; no financial account/rate/demo data is fabricated;
  responsive and accessibility tests cover the workflow.

### F7. Recurring Activity and Contribution Automation

- **Priority:** P2
- **Estimated effort:** Epic
- **Current gap:** Goal plans describe expected contributions, but users still
  enter deposits, interest, fees, and liability payments manually.
- **Proposed improvement:** Add recurring templates, previewed next
  occurrences, a durable scheduler, idempotent generation, pause/skip controls,
  and a distinction between planned and posted activity.
- **User value:** Less repetitive entry and more accurate goal adherence.
- **Dependencies:** A13 durable jobs, F1 corrections, notification design, and
  timezone-safe scheduling.
- **Risks or trade-offs:** Automatically posting guessed activity damages
  trust. Default to due-for-review until a user explicitly enables posting.
- **Acceptance criteria:** Occurrences are user-scoped, timezone-correct,
  idempotent, pausable, auditable, restart-safe, and editable through supported
  correction workflows.

### F8. Liability Payoff Planning

- **Priority:** P3
- **Estimated effort:** Large
- **Current gap:** Liabilities affect net worth and support manual increase and
  payment transactions, but there is no interest model, amortization schedule,
  or payoff scenario.
- **Proposed improvement:** Add optional principal, interest rate, minimum
  payment, and extra-payment scenarios with a payoff chart. Keep recorded
  balances/valuations authoritative.
- **User value:** Users can plan debt reduction alongside savings goals.
- **Dependencies:** Deterministic amortization and F7 recurring activity.
- **Risks or trade-offs:** Loan terms differ widely. Do not imply lender-grade
  statements or mutate balances from projections.
- **Acceptance criteria:** Scenarios reconcile mathematically, assumptions are
  explicit, no projection changes actual balances, and unsupported structures
  degrade to manual tracking.

### F9. Expo and React Native Mobile Companion

- **Priority:** P2
- **Estimated effort:** Epic
- **Current gap:** Wealthboard is installable as a PWA but has no stable native
  API, mobile device-session model, or iOS/Android application.
- **Product direction:** Build an Expo/React Native/TypeScript companion under
  `mobile/`. It connects directly to a user-selected self-hosted HTTPS instance;
  the existing Next.js deployment remains the only backend and SQLite remains
  server-owned.
- **Versioned API:** Add `/api/v1` Route Handlers and an OpenAPI-generated client
  for capabilities, current user, dashboard, accounts/history, transactions,
  valuations, transfers, goals, institutions, categories, rates, settings, and
  read-only position summaries. Derive ownership only from the API principal.
- **Authentication:** Use system-browser Authorization Code + PKCE and dedicated
  short-lived access/rotating refresh tokens. Never collect local passwords or
  expose provider tokens in native UI. Integrate refresh-token/device inventory
  with F5.
- **On-device security:** Store refresh tokens only in secure storage, keep
  access tokens in memory where practical, clear all user state on logout/user
  or instance switch, preserve privacy mode, and prevent stale app-switcher
  snapshots.
- **Initial scope:** Phase 1 is online-only read access. Phase 2 adds deliberate
  ordinary mutations with idempotency and unknown-outcome recovery. Keep bulk
  import, backup/restore, auth-method management, advanced reports, and position
  mutations web-only until each has a native-safe workflow.
- **Dependencies:** A5 typed errors, A6 HTTP/proxy security, F5 sessions, A8
  workload limits, A11 SQLite envelope, and existing position replay/serialization.
- **Acceptance criteria:** Supported production builds connect to arbitrary
  valid HTTPS Wealthboard instances, authenticate in every deployment auth
  mode, refresh/revoke device sessions, render exact owner-scoped data, preserve
  money/date serialization and idempotency, never leak across users/instances,
  never queue writes offline, and remain API-compatible for a documented window.

## AI-Assisted Functionality

Core financial calculations remain deterministic and authoritative. Models may
explain validated read models but cannot receive SQL or mutation tools, execute
financial changes, or bypass normal confirmation. Inputs/outputs remain
schema-validated, sensitive data is minimized, provider credentials stay
server-side or session-only as designed, and usage metadata must not retain raw
financial prompts by default.

### AI1. Scheduled Monthly Wealth Summaries

- **Priority:** P2
- **Estimated effort:** Large
- **Current gap:** Evidence-linked on-demand portfolio review exists, but there
  is no durable monthly schedule, retained summary policy, or failure/retry
  workflow.
- **Proposed improvement:** Add opt-in idempotent monthly review jobs using the
  existing deterministic snapshot/provider boundary, with explicit retention,
  delivery status, budgets, pause/delete controls, and no financial mutations.
- **Dependencies:** A13 durable jobs and A10 audit/retention policy. F3 may add
  deterministic movement-driver evidence to later snapshot versions.
- **Risks or trade-offs:** Scheduling increases provider cost and creates a new
  sensitive retained artifact. Default to no retention unless the user opts in.
- **Acceptance criteria:** Jobs are owner-scoped, idempotent, timezone-correct,
  budget-bounded, restart-safe, cancellable, and auditable; retained content has
  explicit deletion/retention behavior; prompts never contain undisclosed data.

### AI2. Natural-Language Portfolio Questions and Scenario Planning

- **Priority:** P3
- **Estimated effort:** Large
- **Current gap:** Users cannot ask ad hoc questions such as excluding selected
  assets, isolating global equities, comparing contributions and returns, or
  changing a goal scenario in natural language.
- **Proposed improvement:** Map requests to a fixed allowlist of read-only
  deterministic tools and scenario functions. Display interpreted filters,
  evidence, assumptions, and as-of date before/with the answer.
- **Dependencies:** Existing deterministic review and goal-scenario foundations;
  F3 for date-scoped report tools.
- **Risks or trade-offs:** Ambiguous language may select the wrong scope. Users
  must be able to inspect/correct it.
- **Acceptance criteria:** Answers use only validated tool results, show
  scope/date/evidence, never persist scenarios without confirmation, reject
  unsupported questions safely, and expose no raw SQL/code path.

### AI3. Statement and Screenshot Extraction

- **Priority:** P3
- **Estimated effort:** Epic
- **Current gap:** Structured account/investment imports are safe, but PDF/image
  statements require external preparation or manual transcription.
- **Proposed improvement:** Extract candidate instruments, account context,
  dates, descriptions, amounts, currencies, quantities, prices, and balances
  into the existing import/reconciliation preview models. Require confirmation
  before commit.
- **Dependencies:** F1 corrections, existing strict imports/AI safety, and a
  secure temporary-file lifecycle.
- **Risks or trade-offs:** Statements are highly sensitive and extraction can
  be wrong. Prefer local extraction where feasible; minimize retention; never
  auto-post.
- **Acceptance criteria:** Files have explicit retention/deletion behavior;
  candidates show confidence/source location; low-confidence fields require
  review; output validates against strict import contracts; nothing writes
  before confirmation.

### AI4. Anomaly Detection and Categorization Suggestions

- **Priority:** P3
- **Estimated effort:** Large
- **Current gap:** Wealthboard does not flag unusual balance jumps,
  duplicate-looking activity, stale values, or inconsistent classifications
  beyond deterministic validation failures.
- **Proposed improvement:** Implement deterministic anomaly rules first, then
  optionally use AI to explain evidence and suggest categories. Suggestions are
  non-authoritative and user-confirmed.
- **Dependencies:** F1 corrections, F2 freshness, deterministic review
  contracts, and A10 audit events.
- **Risks or trade-offs:** False positives erode trust. Users need dismiss/mute
  controls and measurable precision.
- **Acceptance criteria:** Rules are independently testable; suggestions cite
  evidence and never mutate data; dismissals are owner-scoped; cost and
  false-positive rates are measurable.

## Architecture Improvements

### A1. Complete Exchange-Rate Provenance and Freshness

- **Priority:** P0
- **Estimated effort:** Medium
- **Implemented foundation:** Signup creates no fabricated rate. Current and
  historical aggregates carry completeness and missing-currency metadata.
- **Remaining concern:** Rates lack a complete source/freshness model, and
  incomplete historical periods do not consistently identify affected currency
  pairs, assets, and date ranges.
- **Proposed change:** Add bounded provenance/source metadata and freshness,
  expose affected historical ranges, and keep any automatic provider optional,
  explicit, and provenance-preserving.
- **Acceptance criteria:** Every rate has clear provenance/effective date and
  freshness; incomplete periods identify pair/assets/ranges; no total silently
  omits unresolved exposure; tests cover historical gaps and user isolation.

### A2. Replace Cash-Flow-Naive Annualized Returns

- **Priority:** P0
- **Estimated effort:** Large
- **Current concern:** Balance-account comparison annualizes aggregate gain
  against the opening balance without respecting contribution/withdrawal timing.
- **Proposed change:** Implement time-weighted return for investment performance
  and optionally XIRR/money-weighted return for investor experience. Define cash
  flows, valuation boundaries, fees, transfers, and incomplete coverage. Until
  validated, remove or clearly relabel naive figures.
- **Risks or trade-offs:** XIRR can have no or multiple solutions; TWR needs
  adequate valuation boundaries.
- **Acceptance criteria:** Golden fixtures cover beginning/middle/end deposits,
  withdrawals, fees, transfers, missing valuations, negative returns, and
  position-account coverage; reports show method and confidence and reconcile
  with an independent reference.

### A3. Make Offline Database Restore Fail-Safe

- **Priority:** P0
- **Estimated effort:** Medium
- **Current concern:** Offline restore validates a candidate before replacement
  but does not automatically create/verify a pre-restore recovery copy and roll
  back after a failed swap/post-check.
- **Proposed change:** Check free space, create and hash a timestamped recovery
  copy, fsync staged files where supported, swap atomically, run integrity/schema
  checks, and restore the original automatically on failure.
- **Risks or trade-offs:** Restore requires approximately twice the database
  size. Fail before touching the target when space is insufficient.
- **Acceptance criteria:** Automated CLI tests cover success, corrupt source,
  missing tables, interrupted swap, insufficient space, and post-check failure;
  every failed case leaves the original byte-for-byte recoverable.

### A4. Enforce Goal-Link Account State in Services

- **Priority:** P1
- **Estimated effort:** Small
- **Implemented foundation:** Normal transaction, valuation, transfer, import,
  and supported-currency services reject archived/incompatible targets.
- **Remaining concern:** Goal forms filter archived/liability accounts, but the
  service relationship check does not enforce the same state under crafted or
  stale requests.
- **Proposed change:** Centralize the active/compatible owned-account predicate
  and require it from goal create/update/link commands. Preserve the explicit
  correction path for historical archived activity under F1.
- **Acceptance criteria:** Archived accounts and liabilities cannot be linked to
  savings goals through any caller; foreign resources remain not found; existing
  valid links behave consistently; service tests cover create/update/direct IDs.

### A5. Introduce Typed Domain Errors and Safe Client Mapping

- **Priority:** P1
- **Estimated effort:** Medium
- **Current concern:** Actions and routes use several ad hoc policies and some
  paths return arbitrary `Error.message`, risking internal SQLite/Drizzle detail
  exposure.
- **Proposed change:** Define a small domain error code union with safe messages,
  field context, internal causes, and one mapping layer. Unexpected errors receive
  request IDs and redacted structured logs.
- **Acceptance criteria:** Database/schema text never reaches clients; expected
  errors remain actionable; every 5xx has a safe request ID; representative
  action/route/import/restore mappings are tested.

### A6. Harden Proxy Trust, CSRF, and Browser Security Headers

- **Priority:** P1
- **Estimated effort:** Medium
- **Current concern:** Trusted forwarding is an operator toggle without ingress
  identity validation or IPv4/IPv6 prefix normalization. Browser CSP, HSTS,
  frame, referrer, MIME, and permissions policies are not configured.
- **Proposed change:** Define/document one supported proxy topology, accept
  sanitized client identity only from ingress-overwritten headers, normalize
  IPv4/IPv6 rate-limit keys, test spoofed chains/cross-origin actions, and add a
  deployment-compatible CSP and standard headers.
- **Risks or trade-offs:** Bad proxy trust can collapse users into one identity
  or trust attackers; bad CSP can break Next/Recharts.
- **Acceptance criteria:** Direct clients cannot choose rate-limit identity;
  supported ingress yields correct IPv4/prefix keys; unsupported chains fail
  closed; cross-origin mutations fail; automated header tests cover production
  HSTS and all declared policies.

### A7. Gate Container Publication and Produce Supply-Chain Artifacts

- **Priority:** P1
- **Estimated effort:** Medium
- **Current concern:** Release publication builds/pushes without required lint,
  typecheck, tests, E2E, production build, vulnerability policy, pinned action
  SHAs, SBOM, provenance, or signature.
- **Proposed change:** Add required validation before push, least-privilege jobs,
  reviewed SHA-pinned actions, CycloneDX SBOM, SLSA provenance, Cosign/Sigstore
  signing, and Trivy image scanning before release tags/latest.
- **Risks or trade-offs:** CI time and scanner false positives require a bounded
  exception process.
- **Acceptance criteria:** Any failed gate or unaccepted high/critical finding
  blocks publication; branch/SHA tags are traceable; digest, SBOM, provenance,
  signature verification command, and scan result are retained per release.

### A8. Bound Synchronous Import, Restore, and Analytics Workloads

- **Priority:** P1
- **Estimated effort:** Large
- **Current concern:** Large CSV/JSON parsing, restore writes, and historical
  analytics run synchronously in the web process without deadlines, progress,
  cancellation, or per-user concurrency limits.
- **Proposed change:** Establish measured budgets. Keep small work synchronous;
  route larger operations through A13 jobs or reject clearly. Bound concurrency
  and cancellation without adding Redis by default.
- **Acceptance criteria:** Benchmarks define supported sizes/latency; work over
  threshold becomes a job or clear rejection; timeout/cancel is safe; concurrent
  users retain an agreed response budget.

### A9. Automate Backups, Retention, and Restore Drills

- **Priority:** P1
- **Estimated effort:** Large
- **Current concern:** Backups are manual, with no schedule, retention, status,
  stale/failure alerts, encrypted off-host guidance, or disposable restore drill.
- **Proposed change:** Add configurable scheduled backups, retention,
  post-backup integrity/hash checks, optional encrypted off-host copy, and
  periodic disposable restore verification using A3 primitives.
- **Acceptance criteria:** RPO/RTO and retention are documented; files have
  restrictive permissions; off-host data is operator-key encrypted; stale or
  failed backups alert; scheduled drills restore and validate without logging
  production data.

### A10. Add Structured Observability and Audit Events

- **Priority:** P2
- **Estimated effort:** Large
- **Current concern:** Production visibility remains mostly console errors and
  shallow health status, with no consistent request IDs, operation durations,
  backup/job metrics, or privacy-safe user-visible audit trail.
- **Proposed change:** Add redacted JSON logs, request IDs, durations,
  auth/security/destructive events, backup/job status, optional error tracking,
  and bounded retention.
- **Acceptance criteria:** Errors correlate to safe request IDs; logs are
  machine-parseable/redacted; auth, restore, credential, deletion, backup, and
  job events are auditable without amounts, notes, secrets, or raw rows.

### A11. Define SQLite Operating Envelope

- **Priority:** P2
- **Estimated effort:** Medium
- **Current concern:** SQLite fits the single-process product, but supported
  user/event/concurrency ranges, lock/busy metrics, WAL maintenance, storage
  monitoring, and database-migration triggers are not measured/documented.
- **Proposed change:** Benchmark p95 read/write latency, lock failures, and WAL
  growth; define checkpoint/quick-check/ANALYZE and storage runbooks; enforce
  one-replica/single-writer constraints; publish measurable PostgreSQL review
  triggers.
- **Acceptance criteria:** Baselines and supported ranges are documented;
  maintenance is tested; one-replica constraints are enforced; database
  migration triggers are measurable rather than speculative.

### A12. Optimize Historical Analytics After Benchmarking

- **Priority:** P2
- **Estimated effort:** Large
- **Current concern:** Dashboard/history paths reload and replay the same user
  events multiple times, and account comparisons issue per-account queries.
- **Proposed change:** Benchmark first, consolidate event loading/replay, batch
  comparisons, and add rebuildable user-scoped daily/monthly snapshots only when
  latency budgets require them.
- **Risks or trade-offs:** Stale financial caches are worse than slow queries;
  event history remains authoritative.
- **Acceptance criteria:** 10k/100k-event benchmarks record query counts and p95;
  backdated edits/deletes/rate changes yield identical cached and replayed
  results; every cache key includes `userId`.

### A13. Add a Small Database-Backed Job Runner and Retention Policies

- **Priority:** P2
- **Estimated effort:** Large
- **Current concern:** Scheduled summaries, recurring activity, notifications,
  backups, and larger reports need durable execution. Idempotency/auth/AI usage
  records also need explicit pruning.
- **Proposed change:** Add an owner-aware SQLite job table with lease, attempts,
  next-run, status, and idempotency. Run one controlled worker and define
  retention for completed jobs, idempotency keys, auth attempts, and AI metadata.
- **Acceptance criteria:** Jobs are at-least-once and idempotent, recheck active
  user status, preserve isolation, recover after restart, expose failure status,
  enforce one active worker, and prune to documented policy.

### A14. Complete Startup Configuration and Deployment Readiness

- **Priority:** P2
- **Estimated effort:** Medium
- **Implemented foundation:** Liveness/readiness endpoints, auth readiness, and
  Kubernetes startup/readiness/liveness probes exist.
- **Remaining concern:** Startup does not fully validate migration availability,
  schema state, data/backup path writability/free space, or graceful termination.
- **Proposed change:** Add one server-only startup validator and cached readiness
  checks for migration/schema and storage. Keep liveness independent of transient
  dependencies and document shutdown behavior.
- **Acceptance criteria:** Invalid secrets/URLs/timezone/paths fail before
  serving; readiness is false during migrations or unusable storage; liveness
  does not restart for temporary locks; startup probe and graceful termination
  are tested with minimal public responses.

### A15. Add Risk-Based Coverage Gates

- **Priority:** P1
- **Estimated effort:** Large
- **Implemented foundation:** The repository has broad unit, component, migration,
  documentation, isolation, OIDC, position, estate, PWA, and Chromium E2E tests.
- **Remaining concern:** Coverage targets remain narrow and threshold-free;
  restore CLI, service goal-link state, security-header/cross-origin, concurrency,
  and performance risk matrices are incomplete.
- **Proposed change:** Define module-specific thresholds for finance, money, auth,
  portability, and owner-scoped services; add missing high-risk regressions and
  trend-based performance fixtures without brittle wall-clock assertions.
- **Acceptance criteria:** Every P0 has a regression; CI enforces meaningful
  module thresholds; restore/security/concurrency gaps are covered; performance
  trends report without arbitrary sleeps or disabled tests.

### A16. Complete PWA and Accessibility Verification

- **Priority:** P2
- **Estimated effort:** Medium
- **Implemented foundation:** Service-worker update/offline behavior, stale cache
  cleanup, responsive layouts, labels, and screen-reader chart summaries have
  focused coverage.
- **Remaining concern:** There is no comprehensive axe/WCAG gate or documented
  keyboard/screen-reader review across login, dashboard, forms, dialogs, charts,
  mobile navigation, estate, and both appearance themes.
- **Proposed change:** Add axe-based checks, keyboard journeys, serious-violation
  gating, and a documented manual assistive-technology checklist. Isolate service
  worker contexts and clean caches deterministically.
- **Acceptance criteria:** Authenticated responses are never cached; offline
  mutations remain blocked; update activation passes; critical routes in light
  and dark have no serious automated violations and pass documented keyboard and
  screen-reader checks.

## Technical Debt

### TD1. Split Large Modules Along Existing Ownership Boundaries

- **Priority:** P2
- **Estimated effort:** Large
- **Issue:** Portability, account, analytics, settings, and central action modules
  span multiple responsibilities and continue to grow.
- **Improvement:** Separate archive schema/export/restore, account command/query/
  replay, analytics read models, and settings/security/import panels while
  preserving public domain APIs. Do not introduce generic repository layers
  without concrete value.
- **Acceptance criteria:** Modules have focused responsibilities, stable behavior,
  no circular dependencies, and unchanged tests/build output.

### TD2. Finish Shared Validation and Form Contracts

- **Priority:** P2
- **Estimated effort:** Medium
- **Issue:** Shared Zod coverage has improved, but some forms/actions retain
  parallel schemas or unchecked `action as unknown` progressive-enhancement
  casts.
- **Improvement:** Define remaining dependency-light domain input contracts,
  derive client/server types, and add typed form-action adapters without React ↔
  service circular imports.
- **Acceptance criteria:** Client/server reject the same inputs; settings/rates
  and remaining forms use shared schemas; no form action needs an `unknown` cast;
  field errors and progressive enhancement remain intact.

### TD3. Centralize Product Defaults and Runtime Policy

- **Priority:** P2
- **Estimated effort:** Small
- **Issue:** Currency and several investment defaults are centralized, but
  timezone, session duration, goal return, upload/workload limits, auth rate
  limits, and report ranges remain spread across code and deployment files.
- **Improvement:** Separate product defaults from security/runtime policy and
  expose one validated server-only configuration plus safe client constants.
- **Acceptance criteria:** Each policy has one source of truth, environment
  overrides validate at startup, and tests cover defaults/invalid values.

### TD4. Document Portability Support and Sunset Policy

- **Priority:** P2
- **Estimated effort:** Small
- **Implemented foundation:** Strict version-dispatched parsers and deterministic
  converters support user archives 2 through 8; current source relationships
  round-trip and are documented.
- **Remaining issue:** There is no long-term support window, deprecation notice,
  fixture-retention policy, or operator upgrade/sunset process for old versions.
- **Improvement:** Publish support guarantees and removal criteria while keeping
  calculation-independent source records forward portable.
- **Acceptance criteria:** Every supported version has a retained fixture and
  documented support state; unsupported versions fail clearly; removals require
  a published window and migration path.

### TD5. Turn Financial Semantics into Executable Golden Examples

- **Priority:** P3
- **Estimated effort:** Medium
- **Implemented foundation:** Financial behavior documentation and focused tests
  describe replay, transfers, effective rates, and position semantics.
- **Remaining issue:** Examples are not maintained as one executable fixture set
  from which documentation expectations can be verified.
- **Improvement:** Add golden fixtures for every transaction/position type,
  valuation/price boundary, same-date ordering, rounding, contribution, growth,
  and linked-goal effect; execute them in tests and reference them from docs.
- **Acceptance criteria:** An engineer can predict every effect from one concise
  reference; examples run in CI; ambiguous ordering and rounding are explicit.

## Suggested Delivery Phases

Phases describe dependency order for one delivery stream, not a ban on parallel
work. Item-level dependencies take precedence.

### Phase 1: Critical Correctness and Security

- A1 exchange-rate provenance and freshness.
- A2 cash-flow-aware return methodology.
- A3 fail-safe restore.
- A4 goal-link service rules.
- A6 proxy/origin/header hardening.
- A7 container publication and supply-chain gates.
- A15 risk-based regression and coverage gates.

### Phase 2: Core Product Completeness

- F1 balance-account reconciliation and corrections.
- F2 manual-account freshness.
- F3 date-scoped downloadable reports.
- F4 account deletion and retention controls.
- F6 onboarding.
- F9 mobile API and companion foundation.

### Phase 3: Reliability and Operational Maturity

- A8 bounded heavy workloads.
- A9 backup automation and restore drills.
- A10 observability and audit events.
- A11 SQLite operating envelope.
- A12 analytics performance.
- A13 durable jobs and retention.
- A14 startup/readiness validation.
- A16 PWA/accessibility verification.
- F5 session management.
- F7 recurring activity.

### Phase 4: Intelligent Features

- AI1 scheduled monthly summaries.
- AI2 natural-language questions and scenarios.
- AI3 statement/screenshot extraction.
- AI4 anomaly explanations and categorization suggestions.

### Phase 5: Optional Expansion

- F8 liability payoff planning.
- Later native position mutations after the read-only/mobile ordinary-mutation
  phases of F9 are proven.
- Optional automatic market/exchange-rate providers after A1 provenance is
  complete.
- Advanced tax-oriented exports only after jurisdiction and methodology are
  explicitly defined.
- Shared household views only if independent-user product direction changes.

## Quick Wins

"Quick" describes implementation size and independence, not urgency.

- Enforce archived/liability goal-link rules in services (A4).
- Add and verify a pre-restore recovery copy before database replacement (first
  slice of A3).
- Add tested browser security headers and trusted-proxy documentation (first
  slice of A6).
- Add required lint/type/test/build and image-scan jobs before container push
  (first slice of A7).
- Add stale manual-account badges using financial event dates (first slice of
  F2).
- Record the account-deletion retention decision before implementation (F4).
- Add module-specific coverage thresholds (first slice of A15).

## Recommended Next Five Tasks

1. **Complete exchange-rate provenance and freshness (A1).** Add source and
   freshness metadata plus affected historical date ranges so incomplete totals
   identify exactly what is excluded.
2. **Implement fail-safe offline restore (A3).** Every restore must either
   validate successfully or leave the previous database recoverable.
3. **Replace or remove naive annualized returns (A2).** Agree on TWR/XIRR
   methodology and protect it with independent golden fixtures.
4. **Gate and attest container publication (A7).** Publish only tested, scanned,
   signed, traceable images with retained SBOM/provenance.
5. **Enforce goal-link account state in services (A4).** Reject archived,
   liability, and foreign linked-account IDs regardless of caller.
