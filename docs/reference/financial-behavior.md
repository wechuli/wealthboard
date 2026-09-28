---
title: Financial behavior
description: Reference for balance directions, valuations, transfers, currencies, and planning calculations.
---

# Financial behavior

This reference summarizes how Wealthboard interprets source records. It is not
accounting, tax, lending, or investment advice.

## Money representation

Money is stored as integer minor units in PostgreSQL. The Go API and
`internal/service` own balance replay and financial calculations; exact
integer/rational arithmetic uses Go's `math/big`, with checked conversion to
stored 64-bit minor units. Currency decimal precision is enforced when input is
parsed. The Vite client is not the authoritative owner of balances or financial
rules.

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

Ordinary transaction amounts are positive except signed manual adjustments.
An opening balance may be zero. Transfer signing is internal.

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
or before that date. Future prices are never used. Go multiplies the
canonical decimal quantity by the canonical unit price using exact rational
arithmetic, rounds once to the quote currency's minor unit, converts with the
effective-dated owned rate, and sums those integer values with replayed account
cash.

A missing price or exchange rate excludes that unresolved component and marks
the result incomplete. Account position tables expose instrument identity,
quote currency, effective price date, source, and stale state. Dashboard/report
completeness and import reports expose missing data, but detailed diagnostics
vary by view. Carrying an earlier price forward retains its as-of date; stock,
ETF, and fund freshness thresholds are user-configurable.

Buys and sells exchange account cash for units and are not external
contributions. Cross-currency trades require either the actual account-currency
settlement or an explicit applied settlement rate. A same-currency trade cannot
apply an exchange rate. An explicit settlement is the full net cash movement
including fees; fees are not added to it a second time.

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
unavailable until Wealthboard introduces validated cash-flow-aware TWR; the
movement bridge is attribution, not a return percentage or tax-gain
calculation.

## Contribution classification

Contributions, income, gains, fees, and withdrawals are derived from transaction
types. Balance-account capital growth also includes the non-cash difference
introduced by a valuation during replay. Valuations remain excluded from
contributions, withdrawals, income, and fees. Transfers do not create a
contribution or income.

## Currency conversion

For a source and destination currency, Wealthboard chooses the most recent owned
rate effective on or before the calculation date. A newer inverse pair can be
used when appropriate. Conversion rounds to the destination currency's minor
unit using half-up rounding.

A missing rate produces explicit completeness metadata. The holding is not
silently treated as zero or converted with a later rate.

## Goal projections

Goal forecasts use:

- cached linked-account or manual goal value;
- target amount and date;
- contribution frequency and window;
- assumed annual return with monthly compounding.

Scenario comparison changes inputs temporarily and never writes financial
activity.

The current goal read model marks cross-currency links incomplete rather than
converting them, and does not propagate position price-quality metadata. Check
the linked account before relying on progress or a forecast.

## Estate calculations

The Go service stores ownership shares and allocations as exact basis points
and validates per-tier limits. Primary and contingent instructions remain
separate; complete primary residual allocations describe the portion not
specifically assigned.

Current estate endpoints return cached source values and explicitly do not
provide complete effective-dated position valuation or FX conversion. Live
base-currency totals omit foreign-currency values. Displayed gift estimates are
indicative, not authoritative minor-unit apportionments guaranteed to reconcile
every cent. Retained summaries preserve source instructions and cached values;
their integrity hashes do not certify the calculations.

Liabilities reduce the estimated net estate but are not assigned to individual
beneficiaries. Taxes, administration costs, secured claims, and liquidity needs
are not automatically apportioned.
