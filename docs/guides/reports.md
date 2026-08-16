---
title: Reports and privacy
description: Interpret net worth, allocation, account comparisons, missing rates, and privacy controls.
---

# Reports and privacy

Reports summarize the same accounts, transactions, valuations, and exchange
rates used by the dashboard.

![Reports page with net-worth history and allocation views](/images/screenshots/reports-overview.png)

## Net worth

Net worth is included assets minus included liabilities after conversion to the
base currency. Dashboard period cards compare the current estimate with earlier
replayed values.

If a required exchange rate is missing, Wealthboard marks the result as
incomplete and identifies the affected currency. Add an effective-dated rate
instead of interpreting the partial total as complete.

For a position account, a missing security price has the same completeness
effect. The unresolved component is excluded from the partial numeric total,
and the warning identifies its instrument, currency, affected range, last price,
source, and provenance. Resolve the source record before relying on the total.

## Allocation

Allocation groups source accounts by category, institution, currency,
liquidity, or investibility. Category settings therefore matter: changing a
category can change reports without changing account history.

## Contributions, income, gains, and fees

These values come from transaction classifications. A valuation is excluded
from contribution and income totals because it is an absolute observation.
Transfers move value within the portfolio and do not create net contributions.

## Account comparison

Use account comparison as a review aid, not a broker-grade performance
statement. Cash-flow timing and sparse valuations can limit what can be inferred
from a balance history. Always read the displayed period and methodology notes.

## Position movement attribution

Position accounts include a deterministic bridge from starting value to ending
value.

| Component               | Meaning                                                     |
| ----------------------- | ----------------------------------------------------------- |
| External cash           | Deposits and withdrawals entering or leaving the account    |
| Income                  | Interest and cash dividends                                 |
| Fees / cash adjustments | Explicit costs and signed cash corrections                  |
| Internal trade cash     | Cash exchanged for buys and sells inside the account        |
| Quantity changes        | Unit changes valued at the bridge's starting price          |
| Price movement          | Price change applied to ending quantity                     |
| Currency movement       | The exact remaining effect of quote/account/base FX changes |

![Position movement bridge separating cash, quantity, price, and currency effects](/images/screenshots/position-movement-attribution.png)

Internal buys and sells are not contributions. The bridge is attribution, not a
return percentage or tax-gain calculation. Annualized position return remains
unavailable until Wealthboard has a validated cash-flow-aware TWR methodology.

## Privacy mode

Select the eye icon in the header to mask financial values across protected
screens. The setting is stored in the current browser.

Privacy mode does not remove data from the server or from a user export. It is a
display safeguard for screen sharing and shared devices. Log out when finished;
logout clears Wealthboard-specific client state.

For position accounts, privacy mode masks cash, quantities, prices, reference
basis, movement amounts, and derived values. Instrument names, symbols, dates,
and source-event types remain visible so a hidden-value screen can still be
reconciled.

## AI portfolio review

The optional **Review** workspace sends a bounded, deterministic portfolio
snapshot to the provider configured under **Settings**. The model explains
supplied evidence; it does not calculate authoritative balances or execute
financial changes.

Before generating a review, inspect the “Data sent to the provider” panel and
the exact-amount/account-name sharing choices. Provider retention and billing
remain subject to that provider's terms.
