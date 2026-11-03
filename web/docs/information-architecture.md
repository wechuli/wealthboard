# Wealthboard information architecture

## Navigation model

Wealthboard has five primary destinations. Everything else is at most two steps away, or
reachable through search and the command palette.

| Primary | Purpose |
| --- | --- |
| **Home** | Net worth, change, allocation, flows, goals, attention, and recent activity |
| **Accounts** | Every financial account, grouped and sorted; a gateway to account detail |
| **Activity** | One ledger across all accounts |
| **Goals** | Goal summary, cards, and goal detail with what-if scenarios |
| **Insights** | Net-worth history, allocation, income and returns, and account comparison |

Secondary destinations are **Settings** (user menu, sidebar footer, palette) and **Planning**
(estate planning and AI portfolio review, in the sidebar's "Planning" group and the mobile menu).

### Global affordances (every signed-in screen)

| Affordance | Desktop | Mobile | Shortcut |
| --- | --- | --- | --- |
| Quick add | "Add" button at the top of the sidebar | Central "+" in the bottom bar | `N` |
| Command palette and search | Search field in the top bar | Search icon in the top bar | `⌘K` / `Ctrl K`, `/` |
| Privacy toggle | Eye icon in the top bar | Eye icon in the top bar | `Shift H` |
| Theme switcher | User menu → Appearance (System / Light / Dark) | Menu sheet | palette |
| User menu with sign-out | Avatar in the top bar | Menu tab → profile block | — |
| Offline indicator | Banner below the top bar | Same | — |
| Needs attention | Amber dot on the bell icon, opening the attention popover | Same | — |

Go-to shortcuts are `G H` (home), `G C` (accounts), `G T` (activity), `G G` (goals),
`G I` (insights), and `G S` (settings). `?` lists every shortcut.

### Layouts

- **≥ 1024 px:** a persistent 248 px sidebar (brand, Add, primary nav, Planning, and Settings) and a slim
  top bar (search, attention, privacy, user menu). Content is max 1240 px.
- **768–1023 px:** a 76 px icon rail with tooltips and the same top bar.
- **< 768 px:** a compact top bar (brand, search, attention, privacy) and a bottom bar with Home,
  Accounts, **Add** (raised, central), Goals, and Menu. Menu opens a sheet with Activity,
  Insights, Settings, labs, appearance, and sign-out. Forms open as full-screen sheets
  rather than side sheets, and tables become lists.

## Route map

All screens are lazy-loaded. Protected routes render only after `GET /session` bootstraps.

| Path | Screen | Notes |
| --- | --- | --- |
| `/sign-in` | Sign in | Local and/or "Continue with {providerName}" |
| `/sign-up` | Sign up | Hidden in OIDC-only mode |
| `/` | Home | `?range=1m\|3m\|6m\|1y\|all`; becomes the first-run guide when the portfolio is empty |
| `/accounts` | Accounts list | `?group=category\|institution\|currency\|kind\|mode\|state&sort=value\|name\|category\|change\|updated&view=cards\|table&show=active\|archived` |
| `/accounts/new` | New-account wizard | Value-tracked or position-tracked first |
| `/accounts/:accountId` | Account detail | Variant chosen by `trackingMode` and `isLiability`; `?tab=` selects a section |
| `/accounts/:accountId/import` | Account history import | Direct import (balance or investment history) and "Convert with AI" |
| `/instruments/:instrumentId` | Instrument detail | Price history with stale ranges, plus an add-price form |
| `/activity` | Activity ledger | `?kind=&account=&type=&from=&to=&q=` |
| `/goals` | Goals overview | `?status=active\|paused\|completed\|cancelled\|all` |
| `/goals/:goalId` | Goal detail | Projection, what-if, milestones, linked account |
| `/insights` | Redirects to `/insights/net-worth` | — |
| `/insights/net-worth` | Net-worth history | Monthly, year over year, highest, since start, change bars |
| `/insights/allocation` | Allocation | `?by=category\|institution\|currency\|instrument&scope=total\|investible` |
| `/insights/income` | Income and returns | Bridge, monthly stacked flows, interest by account, dividends |
| `/insights/compare` | Account comparison | `?period=1y\|3m\|all` |
| `/settings` | Redirects to `/settings/profile` | — |
| `/settings/profile` | Profile, display name, app name | — |
| `/settings/currencies` | Base and enabled currencies, exchange rates | `?add=USD-KES` pre-fills the add-rate form |
| `/settings/preferences` | Timezone, date format, appearance, home period, goal return, stale thresholds | — |
| `/settings/categories` | Categories | Reorder by drag or with move up/down buttons |
| `/settings/institutions` | Institutions | — |
| `/settings/instruments` | Instruments and latest prices | Links to `/instruments/:id` |
| `/settings/security` | Sign-in methods (password, single sign-on link/unlink), change password, session timeout | `?auth=<code>` shows the provider result |
| `/settings/ai` | AI provider, key, sharing defaults, usage | — |
| `/settings/api-keys` | Personal API keys | Token shown once at creation |
| `/settings/data` | Export and restore | Restore requires typed confirmation and offers export first |
| `/estate` | Estate planning overview | Sections: Overview, Beneficiaries, Distribution, Summary |
| `/estate/beneficiaries` | Beneficiaries | — |
| `/estate/distribution` | Per-asset directives, primary/contingent shares, residual estate | `?account=<id>` opens an asset |
| `/estate/summary` | Review checks and retained summaries | — |
| `/estate/snapshots/:snapshotId` | Printable retained summary | Privacy controls exclude sensitive fields by default |
| `/review` | AI portfolio review | Consent and sharing controls; not financial advice |
| `/dev/style-guide` | Living style guide | Dev builds only |
| `*` | Not found | — |

### Sheets and overlays (no route; launched from anywhere)

- **Quick add** (`N`): pick an action (deposit, withdrawal, interest, dividend, fee, update value,
  buy or sell, update price, transfer, new account, new goal). The last-used account and action
  are pre-selected; launching from an account page pre-selects that account and offers only
  actions valid for its mode.
- **Recording forms:** one sheet per action, with schema validation, submit-once handling, and toasts.
- **Advanced position actions** (the account "More" menu): convert to positions (value-tracked
  accounts), reconcile, stock split, spin-off, merger, in-kind transfer, and dividend reinvestment.
  Deep links: `/accounts/:id?action=convert|reconcile|corporate`, `?editTrade=<eventId>`, `?edit=1`.
- **Command palette:** navigation, accounts, goals, instruments, actions, theme, and privacy.
- **Attention popover:** missing rates, missing prices, stale prices, and goals behind plan, each
  with a direct fix link.

## Deep links

- Account: `/accounts/{uuid}`. Goal: `/goals/{uuid}`. Instrument: `/instruments/{uuid}`.
- Fix links: `/settings/currencies?add=USD-KES` opens the add-rate form pre-filled, and
  `/instruments/{uuid}?addPrice=1` opens the add-price form.

## Quick add from a URL

`?record=<action>` on any page opens quick add (`deposit`, `withdrawal`, `interest`, `dividend`,
`fee`, `valuation`, `buy`, `sell`, `price`, `transfer`, `payment`, `increase`, `goal`; `1` opens the
picker), optionally with `&accountId=` or `&instrumentId=`.

## Previous URLs

The previous client's paths keep working through redirects in `web/src/app/router.tsx`:
`/login`, `/signup`, `/transactions[/new|/:id/edit]`, `/reports`, `/categories`, `/institutions`,
`/instruments[/new|/:id/edit]`, `/accounts/archived`, `/accounts/:id/{edit,valuation,convert,reconcile,
investment-actions,positions/new,positions/:eventId/edit,prices/new,instruments/new}`, `/goals/new`,
`/goals/:id/edit`, and `/offline`. The server's OIDC redirects (`/login?oidc_error=…`,
`/settings?auth=…`) land on Sign in and Settings → Security.

## Dev-only

`npm run dev:mock` runs the client on in-memory fixtures. Its floating scenario switcher (rendered only
in dev with the mock data source, so it is tree-shaken from production builds) switches between Full
portfolio, New user, Incomplete data, Slow network, and Errors, and between the local, OIDC-only, and
both auth modes.
