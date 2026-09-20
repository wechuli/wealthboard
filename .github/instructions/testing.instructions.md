---
description: "Use when adding, changing, debugging, or reviewing Vitest unit tests, Testing Library component tests, Playwright end-to-end tests, test fixtures, or test configuration."
name: "Wealthboard Testing"
applyTo: "web/src/**/*.test.ts, web/src/**/*.test.tsx, tests/e2e-go/**/*.ts, tests/e2e-go/**/*.mjs, tests/docs/**/*.ts, tests/docs/**/*.mjs, playwright.go.config.ts, playwright.docs.config.ts"
---

# Testing strategy

- Put deterministic financial and service rules beside their Go owners as `_test.go` files. Assert exact integer minor-unit results and boundary rounding.
- Put isolated client interaction and rendering behavior beside Vite source as `*.test.tsx` with Testing Library. Query by role, label, or visible meaning instead of implementation details.
- Use `tests/e2e-go` for complete authenticated workflows, persistence, route protection, responsive layouts, privacy mode, import/export, backup/restore, and offline behavior.
- Keep fixtures fictional and deterministic. Fix the relevant date, timezone, and exchange rate in tests instead of relying on the host clock, locale, network, or external services.
- Authorization tests must create at least two users with visibly different fixtures. Assert both the positive owner path and the negative foreign-user path; a filtered list alone does not prove direct-resource isolation.
- E2E setup owns a disposable PostgreSQL container and schema. Never point automated tests at the normal development or production database, and preserve cleanup even when a test fails.
- Test signup for the first and subsequent users, verify no environment or default-credential path can create a user, and cover case-insensitive username uniqueness, generic login failures, concurrent sessions, and logout followed by another user on the same browser.
- Test direct URLs, actions, transfers, goal links, CSV account resolution, analytics, exports, restores, rates, settings, idempotency, and cache behavior for cross-user denial and absence of data leakage.
- Test both the successful path and the financial failure modes relevant to the change, such as duplicate submission, invalid amount, missing historical rate, atomic rollback, or unauthorized mutation.
- Do not weaken assertions, add arbitrary sleeps, increase global timeouts, or disable tests to make a failure pass. Wait for user-visible state or a specific response.
- Run a focused check first: `go test <package> -run <name>`, `npm --prefix web test -- <test-file>`, or `npx playwright test --config=playwright.go.config.ts <spec> -g "<test name>"`. Then run the broader suite required by the changed behavior.
- Keep viewport coverage meaningful at 360, 390, 768, 1024, and 1440 px when changing shared layout or responsive navigation. Check for overflow and overlapping controls, not only screenshots.
