---
title: Financial behavior
description: Reference for balance directions, valuations, transfers, currencies, and planning calculations.
---

# Financial behavior

This reference summarizes how Wealthboard interprets source records. It is not
accounting, tax, lending, or investment advice.

## Money representation

Money is stored as integer minor units. Currency decimal precision is enforced
when input is parsed. Financial calculations use `bigint` and Decimal.js, not
JavaScript floating-point arithmetic.

Exchange rates are precise decimal strings.

## Transaction balance direction

| Type               | Balance effect                                  |
| ------------------ | ----------------------------------------------- |
| Opening balance    | Increase from zero at account creation          |
| Deposit            | Increase                                        |
| Withdrawal         | Decrease                                        |
| Interest           | Increase                                        |
| Dividend           | Increase                                        |
| Capital gain       | Increase                                        |
| Capital loss       | Decrease                                        |
| Fee                | Decrease                                        |
| Purchase           | Increase                                        |
| Sale               | Decrease                                        |
| Manual adjustment  | Apply signed amount directly                    |
| Liability payment  | Decrease amount owed                            |
| Liability increase | Increase amount owed                            |
| Transfer           | Signed paired decrease/increase in two accounts |

Input amounts are positive except signed manual adjustments. Transfer signing is
internal.

## Replay ordering

Account balances are reconstructed from transactions and valuation snapshots in
chronological order. A valuation sets an absolute balance without becoming cash
flow. Transactions after that valuation apply normally.

Edits and deletions replay all later events for the affected account. Paired
transfer changes replay both accounts atomically.

Position quantities replay by trade date, explicit event sequence, creation
time, and ID. Buys, opening positions, transfer-ins, spin-offs, and merger-ins
increase quantity. Sells, transfer-outs, and merger-outs decrease it. Signed
quantity adjustments apply directly. A split multiplies the quantity held at
that point by its positive ratio. Any intermediate negative quantity rejects
the complete mutation.

Grouped dividend reinvestments, in-kind transfers, mergers, and their linked
fees are one economic event. Saving or deleting a member writes/deletes and
replays the complete group in one transaction. A later oversell prevents group
deletion and leaves every source record unchanged.

## Position valuation

At a requested date, each non-zero position uses the latest price effective on
or before that date. Future prices are never used. Wealthboard multiplies the
canonical Decimal.js quantity by the canonical unit price, rounds once to the
quote currency's minor unit, converts with the effective-dated owned rate, and
sums those integer values with replayed account cash.

A missing price or exchange rate excludes that unresolved component and marks
the result incomplete. Structured issues name the instrument, currency,
affected range, last price, source, provenance, and configured stock/ETF/fund
freshness threshold. Carrying an earlier price forward retains its as-of date
and stale state.

Buys and sells exchange account cash for units and are not external
contributions. Cross-currency trades require either the actual account-currency
settlement or an explicit applied settlement rate. A same-currency trade cannot
apply an exchange rate.

Guided conversion never rewrites a balance account. It calculates the source
balance at an as-of date no earlier than the latest source activity, previews
explicit opening cash plus holdings, archives the source effective on that
date, and creates a linked position replacement. Non-zero differences require
explicit confirmation.

## Position movement attribution

The `position_bridge_v1` read model reconciles start and end values into:

- external cash;
- income;
- fees and cash adjustments;
- internal trade cash;
- quantity movement at the starting price;
- price movement on ending quantity; and
- currency movement as the remaining exact FX bridge.

Completeness and residual are explicit. Position-account annualized return is
unavailable until A3 introduces validated cash-flow-aware TWR; the movement
bridge is attribution, not a return percentage or tax-gain calculation.

## Contribution classification

Contributions, income, gains, fees, and withdrawals are derived from transaction
types. Valuations are excluded from cash-flow categories. Transfers do not
change net worth or total contribution.

## Currency conversion

For a source and destination currency, Wealthboard chooses the most recent owned
rate effective on or before the calculation date. A newer inverse pair can be
used when appropriate. Conversion rounds to the destination currency's minor
unit using half-up rounding.

A missing rate produces explicit completeness metadata. The holding is not
silently treated as zero or converted with a later rate.

## Goal projections

Goal forecasts use:

- current linked-account or manual goal value;
- target amount and date;
- contribution frequency and window;
- assumed annual return with monthly compounding.

Scenario comparison changes inputs temporarily and never writes financial
activity.

## Estate calculations

For each included asset:

1. current source value is multiplied by estate ownership basis points;
2. primary account allocations receive their exact shares;
3. any remaining share flows through complete primary residual allocations;
4. contingent tiers are calculated separately and excluded from primary totals;
5. source values are converted to base currency for plan totals when rates exist.

Minor-unit allocation uses deterministic apportionment so beneficiary amounts
reconcile exactly to the allocated asset amount despite indivisible cents.

Liabilities reduce the estimated net estate but are not assigned to individual
beneficiaries. Taxes, administration costs, secured claims, and liquidity needs
are not automatically apportioned.
