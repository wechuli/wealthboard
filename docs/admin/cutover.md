---
title: Cutover and removal
description: Validate the Go, Vite, and PostgreSQL runtime before retiring legacy code.
---

# Cutover and removal

Use this checklist when replacing a legacy Wealthboard deployment. The target
runtime is one Go process serving the Vite SPA and `/api/v1`, backed by a fresh
PostgreSQL database. There is no SQLite data migration or dual-write period.

Legacy Next.js, Drizzle, and SQLite source remains in the repository during
acceptance and rollback planning. Documentation closure does not authorize its
removal.

## Before cutover

- [ ] Record the release, image digest, PostgreSQL version, and configuration.
- [ ] Confirm users understand that legacy SQLite data will not be imported.
- [ ] Provision an empty PostgreSQL database with durable storage, restricted
      credentials, required TLS, and capacity for expected users.
- [ ] Run `wealthboard migrate` and verify `wealthboard migrate-status`.
- [ ] Configure stable `SESSION_SECRET`, exact `APP_URL`, `AUTH_METHODS`, and
      any OIDC or AI secrets outside the image.
- [ ] Build the Vite client and Go binary or immutable application image.
- [ ] Configure PDF/XLSX/DOCX extraction either through the isolated socket
      worker or a bounded direct-install Node fallback. Do not add Node to the
      distroless application image.
- [ ] Verify `/api/health/live`, `/api/health/ready`, SPA deep links, login,
      logout, and the configured signup policy.
- [ ] Complete representative two-user isolation, financial replay, import,
      portability, estate, AI, PWA, mobile, and API-key acceptance checks.
- [ ] Create and test a PostgreSQL custom-format backup in a disposable target.

## Switch traffic

- [ ] Stop the legacy application before directing users to the replacement.
- [ ] Start only the Go/Vite deployment against the prepared PostgreSQL
      database.
- [ ] Route TLS traffic to the Go service; do not route `/api` to legacy
      Next.js handlers.
- [ ] Confirm static assets, SPA fallback, `/api/v1`, and health probes reach
      the new release.
- [ ] Verify representative accounts, totals, goals, reports, imports, exports,
      and privacy mode with controlled users.
- [ ] Monitor request IDs, structured errors, PostgreSQL saturation, and
      extraction-worker failures without logging private payloads.

## Rollback readiness

- [ ] Keep the legacy code and deployment definition available but stopped.
- [ ] Keep PostgreSQL backups and configuration from before each replacement
      release; test the documented maintenance-mode restore procedure.
- [ ] Define who can stop all writers, restore PostgreSQL, verify readiness,
      and reopen traffic.
- [ ] Treat legacy SQLite state as a separate historical system, not a rollback
      target for writes made after PostgreSQL cutover.

## Authorize legacy removal

Remove legacy Next.js, Drizzle, SQLite, and obsolete Node scripts only in a
separate reviewed change after all of these are true:

- [ ] The Go/Vite production path has completed the agreed observation period.
- [ ] No deployment, operator procedure, documentation page, package script,
      or supported test depends on the legacy runtime.
- [ ] API and UI parity acceptance is recorded, including responsive and PWA
      behavior.
- [ ] PostgreSQL backup and restore evidence is retained.
- [ ] The extraction-worker files and dependencies have been distinguished from
      removable legacy Node code.
- [ ] The owner explicitly approves removal and the rollback plan no longer
      depends on the retained source.

After removal, rebuild documentation and application artifacts, scan for stale
Next.js/SQLite commands, and rerun the full release validation suite.
