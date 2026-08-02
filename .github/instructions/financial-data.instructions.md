---
description: "Use when changing the Drizzle schema, migrations, services, server actions, route handlers, money calculations, balances, valuations, transfers, exchange rates, goals, imports, exports, backups, or restores."
name: "Worthboard Financial Data"
applyTo: "db/**/*.ts, lib/services/**/*.ts, lib/db.ts, lib/money.ts, lib/finance.ts, lib/dates.ts, lib/validation.ts, app/**/actions.ts, app/api/**/*.ts, scripts/**/*.ts, scripts/**/*.mjs"
---

# Financial data and mutations

- Treat `db/schema.ts` as the schema source of truth and `lib/services` as the owner of financial behavior. UI components and route handlers should call those boundaries rather than reproduce calculations or SQL.
- Treat `SPEC.md` and `docs/ARCHITECTURE.md` as the target for the multi-user migration. Preserve existing singleton credentials and records through the mandatory signup claim while moving ownership incrementally. Do not deploy until cross-user isolation tests pass.
- Derive `userId` only from `requireSession()` and pass it explicitly into services. Never accept a form, URL, header, import, or payload owner ID as authorization evidence.
- Every private query and mutation must include the owner predicate. Fetch resources by `userId` and ID together, return not found for foreign resources, and include `userId` in private cache keys.
- Validate same-owner relationships inside the transaction: category/account, transaction/account, valuation/account, goal/account, plan/goal, imported account references, and both sides of a transfer.
- Preserve integer minor units end to end. Parse and format through `lib/money.ts`; use `bigint` or Decimal.js for arithmetic and conversion. Convert to `number` only at a display-library boundary after establishing that the value is safe and non-authoritative.
- Recalculate an account by replaying transactions and valuation snapshots in chronological order using the existing helpers. A valuation is an absolute balance observation, not income, gain, or contribution.
- Keep transaction effects consistent with `lib/finance.ts`. Transfers must create both sides with one transfer group and idempotency key in a single database transaction.
- Use the current user's most recent exchange rate effective on the date being calculated. Do not silently substitute the current rate for historical reports or reuse another user's rates.
- Validate request and form data with the schemas in `lib/validation.ts`. Return the established `ActionState` shape for expected action errors; do not expose raw database errors to the client.
- Every protected mutation must verify the session. Scope UUID idempotency keys to that user and perform multi-record financial changes atomically.
- Keep authentication, database handles, password hashes, backup contents, and raw financial exports in server-only modules. Do not add secrets or sensitive values to logs.
- User-facing exports, imports, and restores contain only the current user's data. Raw SQLite backup and restore are deployment-operator operations, not ordinary authenticated endpoints.
- For schema changes, generate a new migration with `npm run db:generate`, inspect it, and test both a fresh database and a copy of the singleton schema. Never modify an existing applied migration.
- Add focused tests for sign behavior, rounding, replay ordering, historical exchange rates, idempotency, rollback, and cross-user denial whenever the touched behavior could affect balances or ownership.
