# Wealthboard design direction: "Quiet Ledger"

## Concept

Wealthboard should feel like a well-kept private ledger: warm paper, dark ink, and a single
evergreen accent, closer to a good bank statement or an annual report than to a trading
terminal. Numbers are the hero, so they get the best typography in the product: lining,
tabular figures that align in columns. Surfaces are quiet, and colour is spent only where it
carries meaning (gain, loss, needs attention). The serif display face gives the product a
human, considered voice, and the neutral sans keeps dense screens legible. The two themes are
two lighting conditions for the same desk: **Paper** (day) and **Night ledger** (evening). Neither
is a mechanical inversion of the other.

## Inspiration

- Private-bank statements and annual reports: generous margins, serif headlines, figures in
  tidy columns.
- Field notebooks and ledgers: warm off-white paper, ruled hairlines, ink-dark text.
- Editorial data graphics (FT, The Economist): direct labelling, restrained palettes, honest
  axes, and annotations instead of legends where possible.

## Colour tokens

All colours are CSS custom properties in `src/styles/tokens.css`, under `:root[data-theme="light"]`
and `:root[data-theme="dark"]`. Components and charts read tokens only; nothing hard-codes
a hex value.

### Paper (light)

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| `--bg` | `#F5F3EE` | App background (warm paper) | — |
| `--surface` | `#FFFEFB` | Cards, sheets | — |
| `--surface-sunken` | `#EEEBE4` | Wells, table headers, inputs | — |
| `--surface-raised` | `#FFFFFF` | Popovers, menus | — |
| `--border` | `#E1DCD2` | Hairlines | decorative |
| `--border-strong` | `#9E9586` | Input outlines | ≥3:1 on surface (non-text UI) |
| `--text` | `#1B201D` | Body and figures | 15.9:1 on `--bg` |
| `--text-muted` | `#545B56` | Secondary text | 6.6:1 on `--bg` |
| `--text-subtle` | `#656B66` | Captions, axis labels | 5.2:1 on `--bg` |
| `--accent` | `#1D5A46` | Primary actions, links, focus | 7.6:1 on `--bg` |
| `--accent-strong` | `#154536` | Hover and pressed | 10.3:1 |
| `--accent-soft` | `#E2ECE6` | Selected rows, soft fills | — |
| `--on-accent` | `#FFFFFF` | Text on accent | 8.2:1 |
| `--positive` | `#1C6B43` | Gains (always with ▲ or +) | 6.4:1 |
| `--negative` | `#A63A2C` | Losses, liabilities (with ▼ or −) | 6.0:1 |
| `--warning` | `#835500` | Stale or incomplete text | 5.9:1 |
| `--warning-soft` | `#F8EED6` | Warning fills | — |
| `--info` | `#2B5A88` | Informational | 6.8:1 |
| `--focus-ring` | `#1D5A46` | 2px ring and 2px offset | ≥3:1 against adjacent colours |

### Night ledger (dark)

The dark theme is deep green-black with lifted surfaces. Accents are desaturated so they don't glow.

| Token | Value | Contrast |
| --- | --- | --- |
| `--bg` | `#0E1311` | — |
| `--surface` | `#151B18` | — |
| `--surface-sunken` | `#111714` | — |
| `--surface-raised` | `#1C2420` | — |
| `--border` | `#26302B` | decorative |
| `--border-strong` | `#56635C` | ≥3:1 vs surface (UI) |
| `--text` | `#E8ECE7` | 15.2:1 on `--bg` |
| `--text-muted` | `#A9B2AC` | 8.6:1 |
| `--text-subtle` | `#8A948E` | 5.9:1 |
| `--accent` | `#86C9AB` | 10.1:1 |
| `--on-accent` | `#0E1311` | 10.1:1 |
| `--positive` | `#6FCF97` | 9.9:1 |
| `--negative` | `#F0907F` | 7.7:1 |
| `--warning` | `#E3B456` | 9.5:1 |
| `--info` | `#8DB8E8` | 9.0:1 |

Semantic colour is never the only signal. Gains carry `▲`/`+`, losses `▼`/`−`, stale data a
clock icon and the word "Stale", and incomplete data a dashed outline plus the word "Incomplete".

## Typography

- **Display:** Fraunces Variable (self-hosted through `@fontsource-variable/fraunces`), optical size
  axis on, soft and wonk axes at 0. Used for page titles, the net-worth hero, and goal names.
- **UI and figures:** Inter Variable (`@fontsource-variable/inter`). Every financial figure uses
  the `.num` utility: `font-variant-numeric: tabular-nums lining-nums`.
- Figures are right-aligned in tables, and currency codes are set slightly smaller and tracked
  (`font-size: 0.8em; letter-spacing: 0.04em`) so the digits lead.

| Step | Size / line height | Use |
| --- | --- | --- |
| `--fs-xs` | 12 / 16 | Badges, axis ticks |
| `--fs-sm` | 13 / 18 | Captions, table meta |
| `--fs-base` | 15 / 22 | Body |
| `--fs-md` | 17 / 24 | Card titles |
| `--fs-lg` | 20 / 28 | Section titles (Fraunces) |
| `--fs-xl` | 26 / 32 | Page titles (Fraunces) |
| `--fs-2xl` | 34 / 40 | Secondary hero figures |
| `--fs-3xl` | 44 / 48 | Net-worth hero (Fraunces, lining) |

## Spacing, radii, and elevation

- Spacing uses a 4 px base: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72.
- Radii: `--radius-sm` 6 px (inputs, badges), `--radius-md` 10 px (buttons, rows),
  `--radius-lg` 14 px (cards), `--radius-xl` 22 px (sheets, hero).
- Elevation: Paper uses soft, warm, low-spread shadows (`--shadow-1`, `--shadow-2`, `--shadow-3`). Night ledger
  uses borders and lighter surfaces instead, with a faint shadow only on overlays.
- Layout: content max width is 1240 px. Desktop has a 248 px sidebar; tablet a 76 px rail; mobile
  a bottom bar with a centred Add action.

## Motion

| Token | Duration | Use |
| --- | --- | --- |
| `--dur-1` | 120 ms | Hover, press |
| `--dur-2` | 200 ms | State changes, tabs, toggles |
| `--dur-3` | 280 ms | Sheets, dialogs, route fade |

- Easing is `--ease-out: cubic-bezier(.2,.8,.2,1)`. Sheets slide in from the bottom on mobile and the
  right on desktop, and routes fade in (opacity plus a 4 px rise).
- Chart lines draw in once on first mount.
- `prefers-reduced-motion: reduce` sets all durations to 0 ms and disables chart draw-in.

## Chart palette

Charts read `--chart-*` tokens through `src/components/charts/theme.ts`. The categorical palette
derives from Okabe–Ito, which stays distinguishable under protanopia, deuteranopia, and
tritanopia, with luminance tuned for each theme:

| Token | Paper | Night |
| --- | --- | --- |
| `--chart-1` | `#2E6A9E` blue | `#7FB2E5` |
| `--chart-2` | `#C9822B` orange | `#E9A85A` |
| `--chart-3` | `#2F8C6E` bluish green | `#5DC2A0` |
| `--chart-4` | `#B8573A` vermilion | `#EE8C6A` |
| `--chart-5` | `#8C6A9E` reddish purple | `#C3A3D6` |
| `--chart-6` | `#6FA8CF` sky | `#A9D2EE` |
| `--chart-7` | `#A8913A` olive yellow | `#D8C46E` |
| `--chart-8` | `#7B807C` neutral | `#9AA19C` |

- The net-worth series is `--accent`, assets `--chart-1`, and liabilities `--negative`.
- Grid lines use `--chart-grid` and axis text `--text-subtle`. Incomplete segments are dashed
  with hollow points, and stale ranges get a `--warning-soft` band.

## Iconography

Icons come from Lucide (`lucide-react`, tree-shaken), drawn at 1.75 px stroke and sized 16, 18,
or 20 px. Category icons use the same set, with names stored as Lucide identifiers. Icon buttons
always have an accessible name and a tooltip.

## Microcopy voice

- Calm, precise, plain. Say what happened and what to do next ("USD → KES rate missing since
  12 Mar. Add a rate to complete your total.").
- Use **account** only for financial accounts and **profile** or **you** for the person.
- Never alarmist: "Behind plan", not "Failing". Offer the fix in the same sentence.
- Use sentence case everywhere, with no exclamation marks except for completed goals.
- Show sign and direction on every change ("+KES 120,400.00 this month").
