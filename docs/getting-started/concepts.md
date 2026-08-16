---
title: Understand the numbers
description: Learn how balances, valuations, currencies, goals, and estate estimates relate.
---

# Understand the numbers

Wealthboard keeps source records separate from the interpretations built on top
of them. That separation prevents a report, goal, or estate plan from silently
changing an account balance.

## Accounts hold the current replayed value

An account starts with an opening balance. Later events are replayed in date
order:

- transactions add to or subtract from the balance;
- a valuation sets the balance to an absolute amount at that point;
- later transactions continue from the valuation.

Editing or deleting a supported event recalculates the affected account.

A position-tracked account instead replays broker cash and ordered quantity
events, then values each instrument with the latest price effective on or before
the requested date. Missing prices or rates mark the result incomplete rather
than turning unresolved exposure into zero.

## Transactions and valuations answer different questions

Use a **transaction** when an economic event changed the holding: a deposit,
withdrawal, fee, interest payment, purchase, sale, or debt payment.

Use a **valuation** when you learned what an asset was worth on a date. A
valuation is not a contribution or investment return by itself.

## Transfers do not change net worth

A transfer creates paired records in two accounts atomically. It moves value
inside your portfolio; it does not create a contribution or return. For
different currencies, enter both source and destination amounts explicitly.

## Source currency and base currency

Every account keeps its own currency. The user setting called **Base currency**
is only the common reporting currency.

Exchange rates are:

- private to one user;
- effective-dated;
- stored as precise decimal strings;
- never silently borrowed from another user or a later date.

If a rate is missing, Wealthboard reports an incomplete total rather than
inventing one.

## Linked goals read account balances

A linked account is the source of truth for goal progress. Wealthboard does not
copy that balance into a contribution record. An unlinked goal instead uses its
own manually maintained current amount.

Forecasts and scenario comparisons are estimates based on the configured
contribution plan and assumed return. They do not modify account history.

## Estate plans read the same accounts

The estate planner stores instructions and percentages, not another set of
balances. Indicative gift values are derived from:

1. the current account value;
2. the share of the asset that belongs to the estate;
3. primary or residual allocation percentages;
4. effective exchange rates for the summary date.

This means an updated valuation changes the current estate estimate, while a
retained summary snapshot remains unchanged.

## Archive is not delete

Archiving an account or institution preserves its history. It removes the item
from normal active choices but does not erase the underlying financial record.
An archived asset already referenced by an estate plan is surfaced for review.
