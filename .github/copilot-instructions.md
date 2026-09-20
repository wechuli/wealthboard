# Wealthboard repository instructions

## Project context

- Wealthboard is a self-hosted wealth and goals tracker built with a Go/Chi API, PostgreSQL, and a strict TypeScript Vite/React client. The runtime supports multiple independent application users.
- Treat `SPEC.md` and `docs/ARCHITECTURE.md` as the product and architecture contracts.
- Use `docs/ARCHITECTURE.md` for system decisions and `README.md` for setup, operations, and verification. Inspect the owning implementation and nearby tests before changing behavior.
- Keep the product local-first and deployable without cloud services or a separate backend. Users are independent: do not add organizations, roles, invitations, shared portfolios, or cross-user transfers.

## Architecture boundaries

- Keep persistence and business rules in `internal/service`, reusable HTTP validation in `internal/api`, exact money logic in `internal/domain`, and SQL in `db/postgres/queries` for sqlc generation.
- The Vite client consumes `/api/v1`; it must not contain database access, session signing, secrets, or authoritative financial calculations.
- Reuse primitives and feature components in `web/src/components` and the generated API types in `web/src/api/schema.ts` before adding abstractions or dependencies.

## Non-negotiable invariants

- Store money as integer minor units. Use `bigint` and Decimal.js helpers; never use JavaScript floating-point arithmetic for financial values or exchange rates.
- Store timestamps in UTC and format dates in the configured user timezone. Exchange rates remain effective-dated decimal strings.
- Preserve balance replay semantics: valuations set an absolute value without becoming contributions, edits and deletions recalculate balances, and transfers write paired records atomically without changing net worth.
- A linked account is the source of truth for goal progress. Do not duplicate its balance in a goal contribution record.
- Derive the immutable application `userId` only from the verified session. Never trust a client-supplied owner ID, and never fetch a private resource by ID without the owner predicate.
- Scope settings, categories, rates, financial accounts, transactions, valuations, goals, analytics, imports, exports, idempotency keys, and private caches to one user. Validate every relationship and both transfer accounts belong to that user.
- Validate untrusted input with Zod. Protected mutations must verify the session, preserve established idempotency behavior, use a database transaction when multiple financial records change, and invalidate only affected user-scoped routes or caches.
- Never log or commit usernames with passwords, password hashes, session secrets, submitted sensitive values, database files, backups, or exports. Return not found for another user's resource instead of revealing it exists.

## Database changes

- Add a Goose migration under `db/postgres/migrations`, update matching SQL under `db/postgres/queries`, then run `make generate` and review sqlc output. Migration history is append-only: never delete, rename, or edit an applied migration.
- Test schema changes against both a disposable empty database and a disposable database at the previous migration state. Persisted pre-release databases must retain an upgrade path.
- Signup is public only when deployment policy enables local authentication. Validated OIDC first login is the only other provisioning path; do not add claim-based merging, environment-created identities, invitations, setup users, or default credentials.
- Keep foreign keys enabled and retain historical records through the established archive behavior.
- Do not hand-edit generated or runtime artifacts such as `web/src/api/schema.ts`, `web/dist`, `node_modules`, `data/*`, or files under `test-results`.

## Working and validation

- Use Node.js 22 or newer and npm. Keep changes focused and preserve existing public behavior unless the task changes it.
- Add or update the closest unit, component, or Playwright test when behavior changes. Authorization-sensitive work requires at least two users and a negative cross-user assertion. Prefer deterministic fixtures and avoid real financial or secret data.
- Run the narrowest relevant test first. Before finishing a code change, run `make lint`, `make typecheck`, and `make test`; run `make test-e2e-go` for user-workflow changes and `make build` for integration or release-sensitive changes.
- Do not start or replace a development server when one is already running. `wealthboard serve` applies pending PostgreSQL migrations before starting the Go server.
