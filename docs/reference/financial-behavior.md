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
