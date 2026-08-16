---
title: Position-tracked investments
description: Track brokerage cash, instruments, units, prices, trades, corporate actions, reconciliation, and account conversion.
---

# Position-tracked investments

Use position tracking when one brokerage or investment account contains cash
plus one or more long-only stocks, ETFs, or directly priced funds. Wealthboard
replays source records for cash and quantity, then derives value from the latest
effective price and exchange rate available on the requested date.

::: warning Record keeping, not trading or tax software
Position accounts do not place orders, synchronize with a broker, calculate
tax lots or realized gains, or supply live market prices. Record or import only
activity that a trusted source confirms.
:::

## Choose the tracking method

Select the method when creating the account.

| Method               | Use it for                                                                                     | Authoritative value                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Total value**      | Cash, property, vehicles, liabilities, unsupported investments, or one manually valued holding | Monetary transactions and absolute valuations                                     |
| **Units and prices** | A brokerage cash ledger with long-only stocks, ETFs, or directly priced funds                  | Cash transactions, position events, security prices, and effective exchange rates |

An account cannot switch methods through normal editing. Use the guided
conversion workflow when an existing investible balance account needs explicit
units and prices.

## Create a position account

1. Open **Accounts → Add account**.
2. Choose an active investment category such as **Securities**.
3. Select **Units and prices**.
4. Choose the permanent account currency and enter opening broker cash.
5. Create or select an instrument.
6. Record an opening position with its explicit quantity and optional reference
   cost basis.
7. Add an effective-dated unit price.

An instrument has its own identity, symbol, type, quote currency, and optional
exchange or MIC. A ticker is not globally unique, so include the exchange or a
stable identifier when the source provides one.

![Position account showing cash, one priced holding, data quality, and a unified activity timeline](/images/screenshots/position-account-detail.png)

The current account value is:

1. replayed account-currency cash;
2. plus each replayed quantity multiplied by its effective unit price;
3. converted into the account currency when the instrument is quoted elsewhere.

## Record buys and sells

Use **Buy** or **Sell** from the position account. Do not use the generic
balance-account `Purchase` or `Sale` transaction types.

![Buy form with quantity, execution price, fee, trade date, and settlement date](/images/screenshots/position-trade-entry.png)

- A buy increases quantity and reduces account cash by settlement plus fees.
- A sale decreases quantity and increases account cash by proceeds less fees.
- Buys and sells exchange cash for units inside one account. They are not
  external contributions or withdrawals.
- Backdated changes replay the complete later sequence. A mutation that makes
  quantity negative at any point is rejected without a partial write.

For a cross-currency trade, enter either the actual settlement in the account
currency or the applied settlement rate. Wealthboard does not substitute a
later portfolio reporting rate for the broker's trade settlement. An applied
rate is invalid when trade and account currency are the same.

## Record cash and dividend reinvestment

Deposits, withdrawals, interest, cash dividends, fees, and signed cash
adjustments belong to the account cash subledger. A cash dividend alone does
not add units.

Use **Reinvest** when one dividend immediately purchases units. Wealthboard
stores the dividend cash row and the buy as one grouped economic event. Saving,
deleting, restoring, or importing the group is atomic.

![Dividend reinvestment form with income, purchase, quantity, and effective date](/images/screenshots/investment-actions.png)

## Transfer units and record corporate actions

Open **Investment action** from the account and choose the source event that
matches the statement.

| Action               | Result                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| **In-kind transfer** | Writes paired transfer-out and transfer-in position events without treating the units as a contribution or sale |
| **Stock split**      | Multiplies the quantity held at that point by the explicit new-to-existing share ratio                          |
| **Spin-off**         | Adds an explicit quantity of a related instrument while retaining the source holding                            |
| **Merger**           | Removes the source quantity and adds the resulting-instrument quantity as one grouped event                     |

These actions model quantity and account history. They do not infer tax basis,
legal ownership, cash in lieu, fractional-share disposal, or jurisdictional tax
treatment. Add separate confirmed cash or fee records when the statement shows
them.

## Maintain prices and freshness

Each price records the instrument, positive decimal unit price, effective date,
source, optional stable external ID, and provenance.

![Effective-dated security price with source and fictional statement provenance](/images/screenshots/security-price-entry.png)

At any value date, Wealthboard uses the latest price effective on or before that
date. It never uses a future price. An earlier price may be carried forward, but
its original date and stale state remain visible.

Configure separate stock, ETF, and fund freshness thresholds under
**Settings → Preferences → Price freshness thresholds**. A missing price,
missing exchange rate, or stale carried price identifies the affected
instrument, currency, date range, last price, source, and provenance in account,
goal, estate, dashboard, report, and import views.

An unresolved component is excluded from the partial numeric total and marks
the result incomplete. Do not interpret that partial total as zero exposure.

## Reconcile a broker statement

Choose **Reconcile** and record the statement date, reported total, optional
reported cash, and notes. Wealthboard calculates cash plus positions on the same
date and shows the difference.

A reconciliation observation is evidence for review. It never overwrites cash,
quantity, prices, or the derived account value. Resolve differences by correcting
the underlying source event or adding a confirmed missing record.

## Convert an existing account

Use **Convert** on an active, investible total-value account. The workflow does
not rewrite or infer historical units.

1. Choose a conversion date no earlier than the account's latest activity.
2. Enter explicit opening broker cash.
3. Add each instrument, quantity, unit price, source, provenance, and optional
   reference basis.
4. Preview the source balance, opening cash, positions, projected total, and
   difference.
5. Resolve the difference, or explicitly accept it when the source statement
   supports the replacement values.
6. Confirm conversion.

![Guided conversion preview matching an archived total-value account to explicit cash and holdings](/images/screenshots/account-conversion-preview.png)

Confirmation archives the source effective on the conversion date and creates a
linked position account. Earlier monetary history stays on the archived source.
Existing goal and estate links move to the replacement atomically. The archived
source cannot be restored while its replacement remains active because that
would count the same investment twice.

## Import investment history

Position accounts use **Investment History v1**, not Account History Import v1.
The preview resolves instruments, replays every event in deterministic order,
and shows before/after quantities, price impact ranges, projected cash and
positions, net change, duplicates, conflicts, oversells, and completeness
issues.

The import page also provides a strict, currency-aware AI transformation prompt
for complete JSON or one of the four CSV collections. Copy it into an AI service
you trust and add the source statement there. Prompt generation and copying are
entirely client-side; Wealthboard sends neither the prompt nor the statement.
Complete JSON is recommended when records are interdependent or a dividend and
its reinvestment buys must share one atomic group.

![Client-only investment transformation prompt with a selectable output contract](/images/screenshots/investment-ai-prompt.png)

![Atomic investment import preview with instrument resolution, event ordering, quantities, and price impact](/images/screenshots/investment-import-preview.png)

Confirmation reparses the SHA-256-confirmed file and writes the complete
interdependent sequence in one transaction. See the exact fields, templates,
and duplicate rules in [Investment History v1](../reference/investment-import).

## Understand downstream values

- **Goals** use the linked account's complete market value as current progress.
- **Estate planning** uses the account value and surfaces missing or stale data
  as review items.
- **Dashboard and reports** include complete converted exposure and identify
  unresolved components.
- **Movement attribution** separates external cash, income, fees, internal trade
  cash, quantity, price, and currency movement.

Position movement attribution is an exact value bridge, not a return percentage.
Annualized position return remains unavailable until a validated cash-flow-aware
TWR methodology is implemented.

## Privacy and supported scope

Privacy mode masks cash, quantities, unit prices, reference basis, and derived
values. Instrument name, symbol, event type, and dates remain visible so the
account can still be reconciled.

Use a total-value account for unsupported holdings. Position mode intentionally
does not cover shorts, margin, options, derivatives, bonds quoted as a percentage
of par, cryptocurrency wallets, multi-leg trades, automatic trading, tax-grade
lots, or silent corporate-action inference.
