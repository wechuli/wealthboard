---
title: Security and privacy
description: Understand user isolation, sensitive data, exports, sessions, browser privacy, and safe operations.
---

# Security and privacy

Wealthboard is private software, but self-hosting does not remove the need for
access control, patching, backups, and careful data handling.

## User isolation

Every private resource is scoped to the immutable internal user ID derived from
the verified session. Services query by owner and resource ID together. Another
user's direct ID behaves as not found.

Users are independent. There are no organizations, invitations, roles, shared
portfolios, or cross-user transfers.

## Sessions

Application sessions use signed HTTP-only cookies with explicit expiry,
SameSite restrictions, user status, and session version checks. Password and
authentication-method changes invalidate older sessions.

Use HTTPS in production. Keep `SESSION_SECRET` unique to the deployment and out
of images, logs, source control, and public automation output.

## Sensitive records

The database can contain:

- account values and history;
- private notes and masked references;
- beneficiary names and contact summaries;
- estate allocation and document-location notes;
- password hashes and OIDC identity mappings;
- encrypted AI provider credentials when enabled.

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

All user-facing import, export, and restore routes derive ownership from the
session and return private responses with `Cache-Control: no-store` where
appropriate.

Exports intentionally contain no credentials or sessions, but still contain
highly sensitive financial and estate data.

## PWA cache boundary

The production service worker never intercepts `/api` requests and therefore
never caches authenticated financial responses. It precaches only the offline
HTML page, web manifest, and icons. A failed navigation receives the offline
page; previously viewed pages and records are not guaranteed to remain usable.
There is no background-sync handler, mutation queue, in-app install prompt, or
update notification. Users must reconnect and retry any write themselves.

## AI provider boundary

AI review is optional. Wealthboard builds a bounded deterministic snapshot and
does not provide financial mutation tools. Session-only API keys remain in
client memory for the request; remembered keys require the deployment
encryption key.

Custom endpoints require an operator allowlist. Users should review provider
retention, training, and billing terms before sending data.

Remembered provider keys require a dedicated canonical base64 32-byte key and
are bound to one user with AES-256-GCM associated data. Custom endpoint hosts
are resolved and rejected when they map to private or local address space;
redirects and environment proxies are disabled. PDF/XLSX/DOCX extraction may
cross a pod-local Unix socket, so its sidecar and socket permissions are part of
the trusted deployment boundary. Document passwords must never be logged or
persisted by that sidecar.

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
- Review production dependency and image scan results.
- Disable users deliberately when access should end.
