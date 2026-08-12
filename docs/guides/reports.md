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

## Privacy mode

Select the eye icon in the header to mask financial values across protected
screens. The setting is stored in the current browser.

Privacy mode does not remove data from the server or from a user export. It is a
display safeguard for screen sharing and shared devices. Log out when finished;
logout clears Wealthboard-specific client state.

## AI portfolio review

The optional **Review** workspace sends a bounded, deterministic portfolio
snapshot to the provider configured under **Settings**. The model explains
supplied evidence; it does not calculate authoritative balances or execute
financial changes.

Before generating a review, inspect the “Data sent to the provider” panel and
the exact-amount/account-name sharing choices. Provider retention and billing
remain subject to that provider's terms.
