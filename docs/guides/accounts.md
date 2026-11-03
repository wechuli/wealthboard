---
title: Accounts and assets
description: Organize holdings, liabilities, institutions, categories, and account values.
---

# Accounts and assets

Open **Accounts** to group, sort, and switch between card and compact table
views. Use **Show** to switch between active and **Archived** accounts. To find
one account quickly, press **⌘ K** (or **Ctrl K**) and type part of its name.

![Account workspace with grouping, cards, multiple currencies, and a liability](/images/screenshots/accounts-workspace.png)

## Find the right account

**Group** the workspace by:

- category;
- institution;
- currency;
- own or owe (asset or liability);
- tracking mode; or
- data state, which gathers accounts with missing or stale prices and rates.

**Sort** by value, name, category, or change this month. The compact table view
is useful for comparison; card view gives each account more context.

## Read account detail

Select an account to see its current value, classification, chart, activity,
valuations, linked goals, notes, and actions. On a phone, the same sections sit
behind tabs at the top of the page.

The **Activity** card lists the account's entries newest first, grouped by
month. Select **Load more** for older entries. **Activity** in the sidebar
shows the same records across every account with search, date, type, and
account filters.

![Fictional land account detail with value history and actions](/images/screenshots/account-detail.png)

The buttons beside the account name depend on the account. Common actions
include:

- **Update value:** an absolute valuation snapshot.
- **Record:** **Deposit**, **Withdrawal**, **Interest**, **Fee**, and
  **Transfer** to another owned account. Position-tracked accounts use **Buy**,
  **Sell**, **Update price**, and a **Cash** menu instead.
- **More → Import history:** load prepared history into this account.
- **More → Edit details**, **Archive**, and **Delete**.

Press **N** on an account page to open quick add for that account. Plan an
asset's inheritance intent under **Estate planning → Distribution**.

## Track investment positions

Choose **Position-tracked** when creating an active investment account that
contains brokerage cash plus long-only stocks, ETFs, or directly priced funds.
Position accounts derive value from:

- replayed account-currency cash;
- instrument quantities replayed in explicit same-date order;
- the latest price effective on or before the value date; and
- effective-dated exchange rates when quote and account currencies differ.

Use **Buy** and **Sell** for trades, **Update price** for effective unit
prices, and **More → Reconcile to statement** to retain reported statement cash
and totals. Compare those
observations with the account history yourself; the current reconciliation
screen does not calculate a dated difference. Observations never overwrite
quantities, prices, or values.

The **More** menu's corporate actions (**Dividend reinvestment**, **In-kind
transfer**, **Stock split**, **Spin-off**, and **Merger**) record grouped
dividend reinvestments, paired in-kind transfers, and explicit stock splits,
spin-offs, or mergers. Grouped records save, delete, and replay
atomically. Corporate-action quantities are planning records, not tax-lot or
tax-basis calculations.

Missing prices or rates make totals incomplete rather than treating exposure as
zero in account analytics and Insights. Price records retain their date, source,
and provenance. Configure separate stock, ETF, and fund freshness thresholds
under **Settings → Preferences → Price freshness**; the account's **Holdings**
table shows effective dates, sources, and stale flags. See the valuation limitations for
[goals](./goals#create-a-goal) and
[estate planning](./estate-planning#step-1-make-the-asset-list-trustworthy).

![Position account with cash, priced units, data quality, and one activity timeline](/images/screenshots/position-account-detail.png)

See [Position-tracked investments](./investments) for account setup, trades,
settlement, prices, reinvestment, transfers, corporate actions, reconciliation,
conversion, privacy, and supported instrument boundaries.

## Convert an existing investment account

For an active value-tracked investment account, choose **More → Convert to
position tracking**. Select an as-of date at or after its latest activity,
enter explicit opening cash and each holding with its quantity, unit price, and
optional reference cost basis (**Add holding** adds another), then select
**Preview conversion** to compare the source balance with the replacement
total. A non-zero difference requires explicit confirmation before **Convert
account** is available.

Confirmation archives the source effective on the conversion date and creates
a linked position replacement. Earlier balance history remains unchanged;
Wealthboard never infers units from monetary purchase descriptions or
valuations. Existing goal and estate links move to the replacement atomically.

## Import investment history

Position accounts use **Investment History v1**, separate from Account History
Import v1. JSON supports bounded instruments, position events, cash activity,
prices, and optional grouped dividend reinvestments. Separate CSV templates are
available for opening holdings, trades, cash, and prices.

The **Review before importing** preview contains existing/new instrument
resolution, before/after quantities, date range, net change, missing prices or
rates, duplicates, conflicts, and oversells, with every record listed under
**Every record**. Confirmation reparses the SHA-256-confirmed file and commits
the complete valid sequence in one transaction; one invalid dependent record
blocks the whole investment import.

See the exact [Investment History v1 contract](../reference/investment-import)
for JSON fields, CSV headers, grouped reinvestments, and rejection guidance.

## Edit account metadata

Select **More → Edit details** to change the name, description, category,
institution, reference, net-worth inclusion, or notes.

You cannot change account currency after creation. An included estate asset must
first be excluded from the estate plan before it can be reclassified as a
liability.

## Archive an account

Choose **More → Archive** from account detail. Archived accounts disappear
from the accounts list, activity, selectors, Home, Insights, and live estate
views. Their balances no longer contribute to goals, current totals,
or historical totals. Price and rate changes do not update archived values.

Records remain in full JSON backups. Open **Accounts**, switch **Show** to
**Archived**, and restore an account to rebuild its value from retained
history. An archived account's page also offers **Restore**. Converted
source accounts cannot be restored while their replacement exists.

## Permanently delete an account

Archive the account, open it from the **Archived** view, and choose **More →
Delete**. Enter the account name exactly and confirm permanent deletion.
This removes its transactions, valuations, positions, reconciliations, and
estate allocations. Goals remain but lose their account link; shared
instruments and prices remain available.

Deletion is blocked while a cash or in-kind transfer has a paired record in
another account. Remove the linked transfer through the other account's
activity, or restore the archived account to correct it first. Other account
balances are never silently changed by permanent account deletion.

Downloaded backups and previously saved estate snapshots are unchanged copies;
deleting an account does not rewrite them.

## Categories

Categories classify holdings as assets or liabilities and also describe
liquidity and investibility. Manage them under **Settings → Categories**. Existing history
keeps its account relationship when a category is renamed.

By default, **Money Market Fund**, **Fixed Income**, **Savings**, and **Cash**
are liquid. The **Liquid** total in the Home allocation panel includes active,
net-worth-included asset accounts whose current category has the **Liquid** flag.
You can change that flag for any owned category when your classification differs.

Avoid creating categories for temporary statuses such as “needs review.” Use
names that remain useful in long-term allocation insights.

## Institutions

Institutions are user-owned directory entries, not a shared global catalog.
Renaming one updates its name everywhere it is linked. Archiving one preserves
existing links but prevents selecting it for a new account.
