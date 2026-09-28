---
title: Troubleshooting
description: Diagnose startup, readiness, database, currency, PWA, import, and authentication problems.
---

# Troubleshooting

Start with the smallest observable boundary: process, readiness, authentication,
then the user workflow.

## The application does not start

Check:

- `DATABASE_URL` reaches PostgreSQL;
- `SESSION_SECRET` is present and long enough;
- `APP_URL` is a valid absolute URL;
- no other process is using the requested port;
- embedded migrations can be applied by the configured database role.

The Go binary does not load `.env` automatically. Export the settings in the
process environment, and confirm `WEB_DIST_PATH` contains the compiled Vite
client. If startup reports that the Vite build is unavailable, run `make build`
after installing both the root and web dependencies.

Run migrations explicitly to separate database failure from HTTP startup:

```bash
make migrate
```

## Liveness is healthy but readiness is not

Request `/api/health/ready` and inspect server logs. Common causes are:

- an authentication mode would strand active users;
- OIDC-only mode cannot reach or validate provider discovery;
- PostgreSQL is unavailable;
- schema migrations are incomplete.

Authentication readiness checks run after the listener starts. A running process
or successful liveness probe is not enough to admit production traffic.

Do not point liveness at an external identity provider; a temporary provider
outage should not restart the Wealthboard process.

## Vite loads but API requests fail

The development client listens at `http://127.0.0.1:5173` and proxies `/api` to
`http://127.0.0.1:3100`. Run Go with `PORT=3100` and
`APP_URL=http://127.0.0.1:5173`, not the default port `3000`. Use that exact
browser origin rather than switching between `localhost` and `127.0.0.1`.
Authenticated mutations also need the session CSRF token, which the client
loads through `/api/v1/session`.

## Users behind a proxy share login rate limits

Go uses the socket peer IP for rate limiting and ignores forwarding headers.
`TRUST_PROXY_HEADERS` is retained only as a legacy setting and has no effect.
Clients reaching Go through one proxy may therefore share its bucket; account
for that in the ingress topology and ingress-side rate limiting.

## Totals are incomplete

Open **Settings → Exchange rates** and add the missing currency pair with an
effective date on or before the affected report date. Confirm base currency and
account currency are correct.

Wealthboard intentionally does not substitute a current rate for a missing
historical rate.

For a position account, also open the account's **Data quality** section. Add a
missing effective security price, correct its quote currency, or review a stale
carried price. Settings has separate stock, ETF, and fund freshness thresholds.
Warnings include the affected range and last available source observation.

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

## An investment import is rejected

Investment History v1 is all-or-nothing. Check the detailed preview for:

- an unresolved `instrument_external_id`;
- a duplicate or conflicting stable external ID;
- a sell or backdated correction that makes quantity negative;
- a cross-currency trade without actual settlement or an applied rate;
- an invalid dividend-reinvestment group; or
- a future date, unsupported currency, wrong CSV header, or file limit.

Correct the source file and preview it again. Do not change IDs merely to bypass
a conflict. See [Investment History v1](../reference/investment-import).

## A conversion cannot be confirmed

The conversion date must be on or after the source account's latest activity.
Create at least one instrument, enter explicit cash, quantities, and prices, and
preview again after every field change. A non-zero source/replacement difference
requires the explicit confirmation checkbox.

The source becomes archived history after conversion. It cannot be restored
while the linked replacement is active because that would double count the
same investment.

## An estate plan is not complete

Open **Estate → Summary**. Blocking items usually mean:

- an included asset has no directive;
- primary allocations and primary residue do not cover 100%;
- a contingent tier is present but incomplete;
- an allocated beneficiary was archived.

The live workspace also warns about liabilities, unknown transfer context,
undecided methods, zero values, shared title, and a missing last-reviewed date.
It does not provide a complete stale-value or overdue-review check. Snapshot
creation does not rerun those client review checks, and retained completeness
flags are not a guarantee that every issue was resolved. See
[Estate planning](../guides/estate-planning) for current valuation and review
limitations.

## The browser shows stale navigation or assets

Current Wealthboard registers its service worker only in production. It caches
the offline page, manifest, and icons, but not application pages or API
responses. A failed navigation shows the offline page.

For a browser that previously ran an older build:

1. Reload once while online.
2. If needed, close all Wealthboard tabs and reopen the site.
3. Clear only the site's storage in browser developer tools.

Do not alter PostgreSQL; this is browser cache state, not server data.

## OIDC login returns an error

Verify exact issuer, callback URL, client ID, confidential secret, provider
assignment, RS256 support, PKCE S256, server clock, and HTTPS reachability. Use
the commands in [OIDC provider configuration](../example/oidc_configuration).

Register `${APP_URL}/api/v1/auth/oidc/callback`, not the legacy unversioned
callback. The example Kubernetes egress policy allows only DNS and PostgreSQL;
it needs additional provider egress before OIDC or AI can connect.

Provider claims are not account-link evidence. Existing local users must link
from Settings in hybrid mode.

## PostgreSQL is unavailable or restore failed

Verify `DATABASE_URL`, DNS, TLS mode, credentials, NetworkPolicy, and the
database service. Keep the application in maintenance mode after a failed
restore. The restore command prints the automatic pre-restore safety dump path;
preserve it and investigate with a disposable database before another
destructive attempt.
