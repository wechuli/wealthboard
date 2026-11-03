# Wealthboard web client

The React client for Wealthboard. It talks only to the Go API at `/api/v1`, and the Go server serves its
production build from `web/dist`.

- Design system ("Quiet Ledger"): [`docs/design-direction.md`](docs/design-direction.md), with tokens in
  [`src/styles/tokens.css`](src/styles/tokens.css)
- Routes and navigation: [`docs/information-architecture.md`](docs/information-architecture.md)
- API contract: [`../api/openapi.yaml`](../api/openapi.yaml), with types generated into `src/api/schema.ts`
  by `npm run generate:api` (never edit that file by hand)

## Develop

```bash
npm --prefix web ci
PORT=3100 APP_URL=http://127.0.0.1:5173 AUTH_METHODS=local make go-run   # see the root README
npm --prefix web run dev             # http://127.0.0.1:5173, proxies /api to :3100
```

`WEALTHBOARD_API=http://host:port` changes the proxy target. To work on the UI without a database,
run `npm --prefix web run dev:mock`. It uses in-memory fictional fixtures, signed in as `amani` /
`wealthboard-demo`, and adds a scenario switcher with Full portfolio, New user, Incomplete data, Slow
network, Errors, and the local, OIDC-only, and both auth modes. Production builds never include the mock.

| Script | Purpose |
| --- | --- |
| `dev` / `dev:mock` | Vite dev server against the API or the mock |
| `build` | Regenerates API types, type-checks, and builds `dist/` |
| `lint` / `typecheck` / `test` | ESLint (with jsx-a11y), `tsc -b`, and Vitest (runs against the mock) |

## Structure

```
src/
  api/          schema.ts (generated), types.ts aliases, extensions.ts (read models), DataSource
                interface, http/ adapter (CSRF, Idempotency-Key, X-Preview-Hash, problem+json), mock/
  app/          providers, router (lazy pages, previous-URL redirects), session guards
  components/   ui/ primitives, charts/ (d3 + SVG), format.tsx (privacy-aware Money, Delta, …)
  features/     home, accounts, account-detail, activity, goals, insights, recording (quick add),
                imports, instruments, estate, review, settings, auth, shell, system, styleguide
  lib/          money (BigInt and string formatting), dates, theme, privacy, session, queries,
                source-extraction (in-browser PDF/DOCX/XLSX/CSV text extraction for AI import)
```

## Rules this client follows

- **No authoritative financial arithmetic.** Totals, conversions, returns, projections, goal status,
  and shares come from the server. Money stays in minor-unit strings and is formatted with string and
  `BigInt` helpers in `src/lib/money.ts`. Values become numbers only for chart geometry.
- **Privacy mode.** `Shift H` or the eye icon masks every amount, quantity, price, and chart axis. The
  choice is stored as `wealthboard-values-hidden`.
- **Per-user data.** Server-state cache keys are scoped to the signed-in user and cleared on sign-out
  or a user switch. The service worker (`public/sw.js`) never caches `/api/`.
- **Appearance.** System, Light, or Dark, stored as `wealthboard-theme` and applied before first paint.
  Print output is always light.

## Libraries

| Concern | Choice | Why |
| --- | --- | --- |
| Routing | `react-router` 8 | Nested layouts, search-param state, lazy routes |
| Server state | `@tanstack/react-query` | User-scoped caching and invalidation |
| API client | `openapi-fetch` + `openapi-typescript` | Typed against the contract |
| Styling | Tailwind CSS 4 over CSS variables | Tokens live in CSS, so themes swap at runtime and there's no kit look |
| Primitives | `radix-ui`, `cmdk` | Accessible dialogs, menus, tabs, and the command palette |
| Charts | `d3-scale`, `d3-shape`, `d3-array` with SVG | Honest charts: incomplete segments, stale bands, keyboard reading, masked axes |
| Forms | `react-hook-form` + `zod` | Schema feedback on the client; the server stays authoritative |
| Dates | `date-fns` + `@date-fns/tz` | Formats in the user's timezone |
| Type | `@fontsource-variable/fraunces`, `@fontsource-variable/inter` | Self-hosted, with no CDN requests |
| Documents | `pdfjs-dist`, `mammoth`, `fast-xml-parser` | In-browser extraction for AI-assisted import |
