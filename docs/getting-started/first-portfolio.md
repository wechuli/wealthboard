---
title: Build your first portfolio
description: Add accounts, liabilities, currencies, and values in a reliable order.
---

# Build your first portfolio

An account in Wealthboard is any holding or obligation whose value you want to
track. It can represent a bank account, fund, brokerage account, pension,
property, vehicle, business, cash holding, or debt.

## 1. Confirm settings

Open **Settings** and check:

- **Base currency** (**Currencies and rates**): the currency for combined Home
  and Insights totals.
- **Enabled currencies** (**Currencies and rates**): currencies accepted for
  accounts, goals, and exchange rates.
- **Timezone** (**Preferences**): controls local dates and reminders.
- **Date format** (**Preferences**): changes how dates are displayed, not how
  they are stored.

Changing the base currency does not rewrite source values. Add the required
exchange rates afterward so combined totals remain complete.

## 2. Add an institution when useful

Institutions are optional provider records. Use them for banks, brokers, fund
managers, pension providers, lenders, and wallets. Leave property, vehicles,
cash, and self-custodied assets unlinked when no provider is useful.

Create the institution under **Settings → Institutions**, then select it in the
account form. The account form links existing institutions; it does not create
them.

## 3. Create an account

Open **Accounts**, then select **Add account**. The form walks through four
steps: **Tracking**, **Details**, **Opening**, and **Review**.

| Field                       | How to use it                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Tracking                    | Choose **Value-tracked** for one running value or **Position-tracked** for a long-only brokerage ledger. |
| Category                    | Determines asset/liability classification and reporting behavior.                              |
| Account name                | Use a name you will recognize in Insights and transfers.                                       |
| Institution                 | Optional provider link.                                                                        |
| Currency                    | The account's permanent source currency.                                                       |
| Account number or reference | Keep this short and non-sensitive.                                                             |
| Include in net worth        | Turn off for informational accounts you do not want in totals.                                 |
| Tracking starts             | Date from which the opening value applies.                                                     |
| Value today                 | Starting balance or current value when tracking begins (**Amount owed today** for a liability). |

::: warning Choose the currency carefully
An account's currency cannot be changed after creation because every transaction
and valuation belongs to that currency. Create a replacement account if the
original currency was wrong.
:::

## 4. Add liabilities separately

Choose the **Liability** category for loans and other amounts owed. Enter the
amount currently owed as a positive value. Use **Record payment** on the
liability's page to reduce the balance and **Record increase** when the debt
grows.

Liabilities reduce net worth but are not assignable as inheritance gifts in the
estate planner.

## 5. Review the account list

Use search, filters, and the **Archived** view to confirm every item has the
expected category, currency, institution, status, and value.

![Account workspace with fictional assets and one liability](/images/screenshots/accounts-workspace.png)

The cards show source-currency values. A foreign-currency account also shows its
converted base value when a usable rate exists.

## 6. Decide how much history you need

You have three reasonable starting points:

- **Current state only:** use today's value as the opening value and continue
  from now.
- **Key checkpoints:** add occasional historical valuations.
- **Detailed history:** import an account-specific CSV or JSON file after the
  account exists.

For a manual asset such as land or a vehicle, periodic valuations are usually
more useful than artificial purchase/sale transactions.

For a brokerage account that needs cash, units, and effective prices, select
**Position-tracked** before entering activity. Follow
[Position-tracked investments](../guides/investments) rather than importing
generic purchase/sale transactions.

## Reconcile before expanding

Before adding more accounts, compare the net worth on **Home** with your
source records. Resolve missing-rate warnings and incorrect liability classifications
early; goals and estate summaries reuse these same balances.
