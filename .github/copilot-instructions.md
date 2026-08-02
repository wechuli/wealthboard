# Worthboard repository instructions

## Project context

- Worthboard is a self-hosted wealth and goals tracker built with Next.js App Router, strict TypeScript, SQLite, and Drizzle ORM. The runtime supports multiple independent application users and retains a signup-time legacy claim only for upgraded singleton databases.
- Treat `SPEC.md` and `docs/ARCHITECTURE.md` as the target contract for the multi-user migration. Do not claim target behavior is shipped before its migration and isolation acceptance criteria pass.
- Use `docs/ARCHITECTURE.md` for system decisions and `README.md` for setup, operations, and verification. Inspect the owning implementation and nearby tests before changing behavior.
- Keep the product local-first and deployable without cloud services or a separate backend. Users are independent: do not add organizations, roles, invitations, shared portfolios, or cross-user transfers.

## Architecture boundaries

- Keep persistence and business rules in `lib/services`, reusable validation in `lib/validation.ts`, money logic in `lib/money.ts` or `lib/finance.ts`, and date logic in `lib/dates.ts`.
- Use Server Components for authenticated reads and server actions for mutations. Add route handlers only for file or HTTP concerns such as import, export, backup, restore, and health checks.
- Mark interactive components with `"use client"` only when they need browser state or events. Keep secrets, database access, session logic, and financial calculations server-only.
- Reuse primitives in `components/ui`, forms in `components/forms`, and the existing service and action patterns before adding abstractions or dependencies.

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

- Change `db/schema.ts`, then run `npm run db:generate` and review the generated migration. Never rewrite a migration that may already have run.
- Follow the staged singleton-to-user migration in `docs/ARCHITECTURE.md`: preserve the existing password hash and financial data through a signup-time legacy claim, then enforce ownership constraints. Signup is always public; do not add a feature flag, environment-created identity, or default user.
- Keep foreign keys enabled and retain historical records through the established archive behavior.
- Do not hand-edit generated or runtime artifacts such as `.next`, `next-env.d.ts`, `node_modules`, `data/*.db`, or files under `test-results`.

## Working and validation

- Use Node.js 22 or newer and npm. Keep changes focused and preserve existing public behavior unless the task changes it.
- Add or update the closest unit, component, or Playwright test when behavior changes. Authorization-sensitive work requires at least two users and a negative cross-user assertion. Prefer deterministic fixtures and avoid real financial or secret data.
- Run the narrowest relevant test first. Before finishing a code change, run `npm run lint`, `npm run typecheck`, and `npm test`; run `npm run test:e2e` for user-workflow changes and `npm run build` for integration or release-sensitive changes.
- Do not start or replace a development server when one is already running. `npm run dev` applies pending migrations before starting Next.js.
