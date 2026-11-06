---
title: Security and privacy
description: Understand user isolation, sensitive data, exports, sessions, browser privacy, and safe operations.
---

# Security and privacy

Wealthboard is private software, but self-hosting does not remove the need for
access control, patching, backups, and careful data handling.

## User isolation

Every private resource is scoped to the immutable internal user ID derived from
the verified session or API-key principal. Services query by owner and resource ID together. Another
user's direct ID behaves as not found.

Users are independent. There are no organizations, invitations, roles, shared
portfolios, or cross-user transfers.

## Sessions

Application sessions use signed HTTP-only cookies with explicit expiry,
SameSite restrictions, user status, and session version checks. Password and
authentication-method changes invalidate older sessions.

Authenticated browser mutations require the exact trusted `Origin` and a
session-bound `X-CSRF-Token`. External clients use separately scoped API keys;
keys are not revoked by password changes and must be revoked explicitly when
needed. Credential management and user restore remain browser-session-only.
See [Go authentication and API keys](./go-authentication).

Use HTTPS in production. Keep `SESSION_SECRET` unique to the deployment and out
of images, logs, source control, and public automation output.

## Sensitive records

The database can contain:

- account values and history;
- private notes and masked references;
- beneficiary names and contact summaries;
- estate allocation and document-location notes;
- password hashes and OIDC identity mappings;
- personal API-key hashes, scopes, and revocation metadata;
- MCP connection grants, hashed OAuth tokens, and tool-call history.

Protect PostgreSQL, database backups, and user exports accordingly.

## Browser privacy mode

Privacy mode masks financial values in the current browser. It does not remove
records from server responses, exports, or database backups. It is a display
control, not encryption.

Estate print controls separately default to excluding values, contacts,
references, and notes. Global privacy mode remains authoritative over exact
value display.

## Logs

Do not log passwords, tokens, API keys, raw exports, uploaded rows, notes,
beneficiary contacts, or exact financial values. Unexpected errors should be
identified by safe operation/request metadata rather than private payloads.

## Imports and exports

All import and export routes derive ownership from verified authentication;
user restore requires a browser session. Financial API responses use
`Cache-Control: no-store`.

Exports intentionally contain no credentials or sessions, but still contain
highly sensitive financial and estate data.

## PWA cache boundary

The production service worker never intercepts `/api` requests and therefore
never caches authenticated financial responses. It precaches only the offline
HTML page, web manifest, and icons. A failed navigation receives the offline
page; previously viewed pages and records are not guaranteed to remain usable.
There is no background-sync handler or mutation queue. The profile menu offers
**Install app** when the browser supports installation.
The client displays an offline warning, blocks forms marked as financial
mutations while the browser reports offline, and offers Reload when a new
service worker is waiting. Users must reconnect and retry writes themselves.

## AI services

Wealthboard has no built-in AI provider, stores no AI API keys, and never sends
data to an AI service itself. Assistants read and record data only through the
MCP boundary below. The import page's copyable prompt is plain text: you paste
it and your statement into an AI chat yourself, so that service's terms apply,
and the file it returns must pass the normal import preview. Source documents
are never uploaded to or parsed by Wealthboard.

The distroless application image contains no Node.js runtime, and production
runs no JavaScript on the server.

## AI assistant (MCP) boundary

`/mcp` accepts only a personal API key or an OAuth access token with
`portfolio:read` in a single `Authorization: Bearer` header; it never uses the
session cookie, so a browser can't be tricked into calling it. Every tool reads
and writes with the `userId` from the verified key or token, and another user's
IDs return the same "not found" result as unknown IDs.

Write tools (`record_transaction` and `record_valuation`) exist only for
Detailed connections whose token carries `portfolio:write`: an OAuth grant
where the user turned on **Allow changes**, or an API key with both portfolio
scopes. They only add records through the existing ledger service, with its
validation and idempotency, and can't edit, delete, transfer, restore, or touch
credentials. Because a prompt injection in imported text could ask an assistant
to record something, the server instructions limit writes to the user's
explicit request, and each write appears in the connection's activity log. Tool results exclude account references,
notes, and import external IDs, and mark transaction descriptions as
untrusted text. Errors returned to the assistant never include internal
details. Data an assistant reads is subject to that assistant's provider
terms. Revoke the key or disconnect the app to cut access, or set
`MCP_ENABLED=false` to remove the endpoint and OAuth sign-in. See
[Connect an AI assistant (MCP)](./mcp).

OAuth sign-in for assistants follows OAuth 2.1:

- Only registered redirect URIs are used, compared exactly (loopback addresses
  on any port). An unknown client or redirect shows an error page instead of
  redirecting, so Wealthboard can't be used as an open redirect.
- PKCE with `S256` is required. Codes are single-use and short-lived; a
  replayed code revokes everything it produced, and so does a reused refresh
  token. Tokens are opaque, stored only as SHA-256 hashes, and valid only for
  this deployment's `/mcp`.
- Consent needs a signed-in browser session, and approving or declining also
  needs the trusted origin and CSRF token. The page warns that the
  application's name is self-reported and shows where the browser returns.
  API keys and OAuth tokens can't approve or manage connections.
- Disabled users' tokens stop working immediately. Password changes don't
  revoke connections; disconnect them in **Settings → Connected apps**.
- Authorization request errors show a Wealthboard error page rather than
  redirecting, because anyone can register a client; the client's redirect URI
  is used only after the user approves or cancels.
- Authorization, token, and revocation requests are limited per client, so one
  client can't exhaust another's quota, with a high backstop per connecting
  address. Registration is limited per connecting address; behind a reverse
  proxy that address is the proxy's, so the limit applies to the whole
  instance, but existing connections keep working. Wealthboard never fetches
  URLs supplied by clients.

## Estate-planning boundary

Beneficiaries are planning records, not identities or authorized users. Estate
summaries do not transfer ownership, detect death, notify recipients, expose an
executor portal, or replace legal documents and provider beneficiary forms.

## Operator checklist

- Terminate TLS at a trusted proxy.
- Restrict PostgreSQL access and backup filesystem permissions.
- Use secret storage for session, OIDC, and AI keys.
- Keep Go, PostgreSQL, Node.js parser/build dependencies, images, host OS, and proxy patched.
- Back up regularly and test restore into a disposable location.
- Keep every replica on the same migration-compatible release.
- Treat the [completed legacy cutover](../admin/cutover) as historical context;
  retain tested PostgreSQL recovery artifacts for current releases.
- Review production dependency and image scan results.
- Disable users deliberately when access should end.
