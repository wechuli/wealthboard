---
title: Accounts and assets
description: Organize holdings, liabilities, institutions, categories, and account values.
---

# Accounts and assets

Open **Accounts** to search, filter, sort, and switch between card and table
views.

![Account workspace with search, filters, cards, multiple currencies, and a liability](/images/screenshots/accounts-workspace.png)

## Find the right account

The account workspace can filter by:

- category;
- currency;
- institution;
- asset or liability;
- active or archived status.

Sort by value, name, category, recent change, or last update. Table view is
useful for comparison; card view gives each account more context.

## Read account detail

Select an account to see its current value, classification, chart, transactions,
valuations, linked goals, and quick actions.

The account detail shows the 10 newest transactions per page. Use **Previous**
and **Next** for nearby history, or **View all** to open the account-filtered
transaction workbench with search, date/type filters, sorting, and CSV export.

![Fictional land account detail with value history and quick actions](/images/screenshots/account-detail.png)

Common actions include:

- **Deposit / Withdrawal:** ordinary cash movement.
- **Interest:** income credited to the account.
- **Value:** an absolute valuation snapshot.
- **Transfer:** move value to another owned account.
- **Import:** load prepared history into this account.
- **Estate plan:** define inheritance intent for an asset.

## Track investment positions

Choose **Units and prices** when creating an active investment account that
contains brokerage cash plus long-only stocks, ETFs, or directly priced funds.
Position accounts derive value from:

- replayed account-currency cash;
- instrument quantities replayed in explicit same-date order;
- the latest price effective on or before the value date; and
- effective-dated exchange rates when quote and account currencies differ.

Use **Buy** and **Sell** for trades, **Price** for effective unit prices, and
**Reconcile** to compare a broker statement with calculated cash and positions.
Reconciliation observations never overwrite quantities, prices, or values.

The **Reinvest**, **Move units**, and **Corp action** quick actions record
grouped dividend reinvestments, paired in-kind transfers, and explicit stock
splits, spin-offs, or mergers. Grouped records save, delete, and replay
atomically. Corporate-action quantities are planning records, not tax-lot or
tax-basis calculations.

Missing prices or rates make totals incomplete rather than treating exposure as
zero. Price rows retain their date, source, and provenance. Configure separate
stock, ETF, and fund freshness thresholds under **Settings**; account, goal,
estate, dashboard, report, and import views show affected date ranges.

![Position account with cash, priced units, data quality, and one activity timeline](/images/screenshots/position-account-detail.png)

See [Position-tracked investments](./investments) for account setup, trades,
settlement, prices, reinvestment, transfers, corporate actions, reconciliation,
conversion, privacy, and supported instrument boundaries.

## Convert an existing investment account

For an active balance-tracked investment account, choose **Convert**. Select an
as-of date at or after its latest activity, enter explicit opening cash,
holdings, unit prices, and optional reference cost basis, then preview the
source balance against the replacement total. A non-zero difference requires
explicit confirmation.

Confirmation archives the source effective on the conversion date and creates
a linked position replacement. Earlier balance history remains unchanged;
Wealthboard never infers units from monetary purchase descriptions or
valuations. Existing goal and estate links move to the replacement atomically.

## Import investment history

Position accounts use **Investment History v1**, separate from Account History
Import v1. JSON supports bounded instruments, position events, cash activity,
prices, and optional grouped dividend reinvestments. Separate CSV templates are
available for opening holdings, trades, cash, and prices.

Preview shows existing/new instrument resolution, before/after quantities,
date range, net change, missing/stale price or rate issues, duplicates,
conflicts, and oversells. Confirmation reparses the SHA-256-confirmed file and
commits the complete valid sequence in one transaction; one invalid dependent
record blocks the whole investment import.

See the exact [Investment History v1 contract](../reference/investment-import)
for JSON fields, CSV headers, grouped reinvestments, and rejection guidance.

## Edit account metadata

Select **Edit** to change the name, description, category, institution, masked
reference, cost basis, net-worth inclusion, or notes.

You cannot change account currency after creation. An included estate asset must
first be excluded from the estate plan before it can be reclassified as a
liability.

## Archive an account

Archive records that should no longer appear in normal active workflows. The
history remains available. Before archiving, review:

- linked goals;
- estate allocations;
- outstanding transfers or reconciliation work;
- whether the account should still count in net worth.

## Categories

Categories classify holdings as assets or liabilities and also describe
liquidity and investibility. Manage them under **Categories**. Existing history
keeps its account relationship when a category is renamed.

Avoid creating categories for temporary statuses such as “needs review.” Use
names that remain useful in long-term allocation reports.

## Institutions

Institutions are user-owned directory entries, not a shared global catalog.
Renaming one updates its name everywhere it is linked. Archiving one preserves
existing links but prevents selecting it for a new account.
