---
title: Troubleshooting
description: Diagnose startup, readiness, database, currency, PWA, import, and authentication problems.
---

# Troubleshooting

Start with the smallest observable boundary: process, readiness, authentication,
then the user workflow.

## The application does not start

Check:

- Node.js is version 22 or newer;
- `SESSION_SECRET` is present and long enough;
- `APP_URL` is a valid absolute URL;
- the database directory exists and is writable;
- no other process is using the requested port;
- pending migrations have not been edited or removed.

Run migrations explicitly to separate database failure from Next.js startup:

```bash
npm run db:migrate
```

## Liveness is healthy but readiness is not

Request `/api/health/ready` and inspect server logs. Common causes are:

- an authentication mode would strand active users;
- OIDC-only mode cannot reach or validate provider discovery;
- the SQLite database is unavailable;
- schema migrations are incomplete.

Do not point liveness at an external identity provider; a temporary provider
outage should not restart the Wealthboard process.

## Totals are incomplete

Open **Settings → Exchange rates** and add the missing currency pair with an
effective date on or before the affected report date. Confirm base currency and
account currency are correct.

Wealthboard intentionally does not substitute a current rate for a missing
historical rate.

## An imported file is rejected

Confirm:

- upload starts from the intended active account;
- file is no larger than 5 MB and has at most 10,000 rows;
- CSV columns exactly match the documented v1 header;
- dates are valid non-future `YYYY-MM-DD` values;
- decimal precision matches the account currency;
- every row has a stable, unique external ID;
- opening balances and transfers are absent.

Use the downloadable row report to distinguish validation failures, duplicates,
and conflicting IDs.

## An estate plan is not complete

Open **Estate → Summary**. Blocking items usually mean:

- an included asset has no directive;
- primary allocations and primary residue do not cover 100%;
- a contingent tier is present but incomplete;
- an allocated beneficiary or asset was archived.

Warnings about stale values, liabilities, transfer context, or review date do
not change percentage arithmetic, but they should be resolved before relying on
the summary.

## The browser shows stale navigation or a hydration warning

Current Wealthboard registers its service worker only in production.
Development automatically unregisters Wealthboard's worker and deletes only
Wealthboard caches. In production, code assets are network-first with cached
offline fallback.

For a browser that previously ran an older build:

1. Reload once while online.
2. If needed, close all Wealthboard tabs and reopen the site.
3. Clear only the site's storage in browser developer tools.

Do not clear the SQLite database; this is browser cache state, not server data.

## OIDC login returns an error

Verify exact issuer, callback URL, client ID, confidential secret, provider
assignment, RS256 support, PKCE S256, server clock, and HTTPS reachability. Use
the commands in [OIDC provider configuration](../example/oidc_configuration).

Provider claims are not account-link evidence. Existing local users must link
from Settings in hybrid mode.

## SQLite reports busy or locked

Confirm only one Wealthboard process/replica writes the database, storage is
local or supports SQLite locking correctly, and no backup/restore tool is
replacing files while the app runs. Preserve the database before invasive
repair and use a disposable copy for investigation.
