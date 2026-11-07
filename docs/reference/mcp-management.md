---
title: Assistant management tools (MCP)
description: Tools that let a connected AI assistant manage accounts, transactions, statement imports, investments, goals, exchange rates, and reports, with parameters, examples, and behavior.
---

# Assistant management tools (MCP)

A connected assistant can manage almost everything in Wealthboard through the
[MCP endpoint](./mcp.md): edit and delete records, import whole statements in
one call, synchronize broker positions and trades, reconcile statements, and
read performance, tax, and audit reports. This page lists those tools, their
parameters, and how they behave.

The tools reuse Wealthboard's own services, so they follow the same validation,
balance replay, and ownership rules as the web app. They act only on the
signed-in user's data: another user's IDs return "No matching record was found
for this user."

## Access

| Connection                                         | Tools                                                     |
| -------------------------------------------------- | --------------------------------------------------------- |
| Summary only                                       | None of these tools                                       |
| Detailed, read-only                                | The [read tools](#read-tools)                             |
| Detailed with **Allow changes**, or an API key with `portfolio:read` and `portfolio:write` | Read tools and [write tools](#write-tools) |

Every change made through a write tool is recorded in the
[audit log](#audit-log).

## Conventions

- **Amounts** are plain decimal strings in the account's or instrument's
  currency, such as `"122.61"`, with at most the currency's decimal places (0
  for JPY, KES has 2, 3 for BHD). Thousands separators, symbols, and exponents
  are refused. Only `manual_adjustment` amounts may be negative. Results return
  amounts as `{"minor": "12261", "decimal": "122.61", "currency": "KES"}`.
- **Quantities, prices, and rates** are decimal strings stored exactly at the
  precision you send. Wealthboard never uses binary floating point for them.
- **Dates** are `YYYY-MM-DD` and can't be in the future in the user's time
  zone.
- **IDs** are the UUIDs other tools return. Bulk results report each row's
  `index` (1-based position in the request).
- **`idempotencyKey`** is a UUID the assistant generates. Retrying the same
  call with the same key returns the original result; reusing it for a
  different request is refused. Bulk imports also skip rows they already
  recorded, so retrying without a key is safe too.
- **`dryRun`** validates everything and reports the result without writing.
- **Atomic bulk changes:** every bulk tool writes all of its rows or none.
  Imports accept `allowPartial` to write the valid rows and report the rest.
- **Partial updates:** `update_*` tools change only the fields you send.
- **Errors** are returned as tool errors with a message that names the
  problem, such as an invalid amount, a currency mismatch, a reused external
  ID, a missing instrument, or a record that changed since it was read. They
  never include internal details.

## Read tools

| Tool                        | Parameters                                                        | Returns |
| --------------------------- | ----------------------------------------------------------------- | ------- |
| `list_categories`           | none                                                              | Categories and institutions, for creating or updating accounts |
| `get_account_history`       | `accountId`, `from`, `to`, `interval` (`month` or `day`)          | The account's value over time in its currency, at most 400 points |
| `list_valuations`           | `accountId`, `from`, `to`, `limit`, `offset`                       | Valuations, newest first |
| `get_transaction`           | `transactionId`                                                   | One transaction, its import ID, whether it can be edited, and `updatedAt` |
| `reconcile_transactions`    | Statement request (below), `from`, `to`                           | How a statement compares with the records; writes nothing |
| `get_import_history`        | `accountId`, `kind`, `status`, `limit`, `offset`                   | Imports with counts, statement balances, and rollback state |
| `get_reconciliation_status` | `accountId`                                                       | Whether each account still matches its latest imported statement balance |
| `list_instruments`          | `includeArchived`                                                 | Instruments with identifiers and the latest recorded price |
| `get_price_history`         | `instrumentId`, `from`, `to`, `limit`                              | Recorded prices labelled `current`, `stale`, or `historical` |
| `simulate_goal`             | `goalId`, `monthlyContribution`, `annualReturnPercent`             | A what-if projection; never changes the goal |
| `get_exchange_rates`        | `currency`, `from`, `to`, `limit`, `offset`                        | Effective-dated rates with source and whether each is the latest |
| `get_performance_report`    | `range` (`1m`, `3m`, `6m`, `1y`, `all`)                            | Contributions and withdrawals separated from investment return, time- and money-weighted returns |
| `get_tax_report`            | `year`, `accountId`                                               | Recorded income, gains, fees, withholding tax, and sale proceeds |
| `get_portfolio_history`     | `range`, `interval` (`month`, `week`, or `day`)                    | Net worth, assets, liabilities, and investible value over time |
| `get_audit_log`             | `accountId`, `tool`, `from`, `to`, `limit`, `offset`               | Changes made through MCP |

`get_transaction` includes the record's `externalId` only on connections that
can make changes, because import source IDs otherwise stay on the server.

## Write tools

### Accounts and valuations

| Tool               | Parameters | Behavior |
| ------------------ | ---------- | -------- |
| `create_account`   | `name`, `categoryId` or `category`, optional `institutionId` or `institution`, `currency`, `trackingMode` (`balance` or `positions`), `openingBalance`, `openedAt`, `includedInNetWorth`, `idempotencyKey` | Creates the account and its opening balance |
| `update_account`   | `accountId`, then any of `name`, `description`, `categoryId`/`category`, `institutionId`/`institution`, `clearInstitution`, `includedInNetWorth`, `costBasis` | Currency and tracking mode can't change |
| `archive_account`  | `accountId`, `restore` | Archives (or restores); nothing is deleted |
| `record_valuation` | `accountId`, `value`, `date`, `idempotencyKey` | Sets a balance account's value on a date |
| `update_valuation` | `valuationId`, `value`, `date` | Replays the account |
| `delete_valuation` | `valuationId` | Replays the account |

Balance-tracked accounts are valued from transactions and valuations.
Investment (`positions`) accounts are valued from holdings, prices, and cash, so
they don't take valuations; use the [investment tools](#investments) instead.

### Transactions

| Tool                        | Parameters | Behavior |
| --------------------------- | ---------- | -------- |
| `record_transaction`        | `accountId`, `type`, `amount`, `date`, `description`, `idempotencyKey` | Adds one transaction (the create tool) |
| `update_transaction`        | `transactionId`, then any of `type`, `amount`, `date`, `description`, `externalId`, and optional `expectedUpdatedAt` | Replays the account. With `expectedUpdatedAt` from `get_transaction`, fails if the record changed since |
| `bulk_update_transactions`  | `updates`: up to 1,000 objects like `update_transaction` | All or nothing; each account is replayed once |
| `delete_transaction`        | `transactionId` | Deleting either side of a transfer deletes both |
| `bulk_delete_transactions`  | `transactionIds`: up to 1,000 | All or nothing |
| `transfer_between_accounts` | `fromAccountId`, `toAccountId`, `amount`, `destinationAmount`, `date`, `description`, `idempotencyKey` | Records both sides together; transfers aren't contributions or withdrawals |
| `bulk_create_transactions`  | [Statement request](#statement-imports), `dryRun`, `idempotencyKey` | Imports up to 1,000 rows atomically |

Transaction types are `deposit`, `withdrawal`, `interest`, `dividend`,
`capital_gain`, `capital_loss`, `fee`, `purchase`, `sale`,
`manual_adjustment`, `liability_payment`, and `liability_increase`. Opening
balances and transfers have their own workflows. Investment accounts accept
only `deposit`, `withdrawal`, `interest`, `dividend`, `fee`, and
`manual_adjustment`; record buys and sells as [trades](#trades).

Edits and deletions replay the account from its records, so later balances and
reports update. A valuation sets the balance on its date, so changing a record
dated before a valuation doesn't change balances after it.

### Statement imports

| Tool              | Parameters | Behavior |
| ----------------- | ---------- | -------- |
| `preview_import`  | Statement request | Reports what would happen and returns a `hash`; writes nothing |
| `commit_import`   | Statement request, `hash`, `idempotencyKey` | Writes the previewed rows in one database transaction |
| `rollback_import` | `importId` | Deletes exactly the records that import created |

A **statement request** is:

| Field                     | Meaning |
| ------------------------- | ------- |
| `accountId`               | The account the statement belongs to |
| `source`                  | Where the rows came from, such as `etica_statement` |
| `transactions`            | Up to 1,000 rows of `date`, `type`, `amount`, optional `externalId`, `currency`, `description` |
| `closingBalance`          | Optional `{date, amount}` printed on the statement, to check |
| `allowPartial`            | Write valid rows even if others are rejected or conflict |
| `allowPossibleDuplicates` | Create rows that only structurally match an existing record |

Each row is classified:

| Status               | Meaning |
| -------------------- | ------- |
| `create` / `created` | New; will be or was created |
| `duplicate`          | A record with the same ID and the same date, type, and amount exists; skipped |
| `possible_duplicate` | No ID match, but a record with the same date, type, and amount exists; skipped for review |
| `conflict`           | The ID belongs to a record with different details; existing records are never overwritten |
| `rejected`           | Invalid: bad amount or date, wrong type for the account, currency mismatch, or a repeated ID in the request |
| `not_imported`       | Valid, but not written because other rows failed and `allowPartial` was off |

Matching works like this:

1. **External IDs first.** Give each row the statement's own transaction ID as
   `externalId` when it has one. IDs are case-sensitive and unique per account.
2. **Derived IDs otherwise.** A row without an ID gets
   `derived-<date>-<type>-<amount>`, with `-2`, `-3`, and so on for repeats in
   the same request. Two genuine identical transactions on one day are both
   kept, and importing the same statement again skips them. The account history
   file import uses the same IDs, so the two deduplicate each other.
3. **Structured matching** then compares the remaining rows with existing
   records in the statement's period by date, type, and amount, one record per
   row. A match is reported as `possible_duplicate` instead of being created,
   for example when you recorded a deposit by hand before importing the
   statement. Resend with `allowPossibleDuplicates` once the user confirms the
   rows are separate.

The result reports `created`, `updated`, `skipped`, `duplicates`,
`possibleDuplicates`, `conflicts`, and `rejected` counts, the balance before
and after (cash for investment accounts), the import ID, and warnings. Balances
are the ones Wealthboard calculates after replaying the account.

When `closingBalance` is given, Wealthboard compares it with its own balance at
the end of that date and reports the difference, for example
`"Statement closing balance differs by 0.01 KES"`. It never adds a balancing
adjustment. Interest and tax are matched as separate rows on their own posting
dates; a statement that reports monthly interest produces monthly records, not
daily ones.

**Rollback** deletes only the records the import created and replays the
account. It refuses when any of them was edited after the import, or when
removing trades would leave a later sale without holdings; records the user
already deleted are simply skipped. Prices recorded by a position sync are
kept, and a sync that replaced an earlier same-day snapshot doesn't restore it.

**Reconciliation status** recalculates each account's balance on its latest
imported statement date. `out_of_balance` means a later edit or deletion changed
a statement that previously reconciled.

### Investments

| Tool                    | Parameters | Behavior |
| ----------------------- | ---------- | -------- |
| `create_instrument`     | `name`, `assetType` (`stock`, `etf`, `fund`), `quoteCurrency`, and an `isin`, `symbol` with `exchangeMic`, or `externalId` | Creates an instrument |
| `update_instrument`     | `instrumentId`, then any of `name`, `symbol`, `isin`, `exchangeMic`, `externalId`, `assetType`, `quoteCurrency` | The quote currency can't change once prices or activity exist |
| `bulk_upsert_positions` | `accountId`, `asOf`, `source`, `positions`, `cash`, `closeMissing`, `createMissingInstruments`, `dryRun`, `idempotencyKey` | Synchronizes holdings and cash from a broker snapshot |
| `upsert_position`       | `accountId`, `asOf`, `instrument`, `quantity`, `unitPrice`, `currency` | One position snapshot |
| `update_cash_balance`   | `accountId`, `asOf`, `amount`, `currency`, `source` | A cash snapshot in the account currency |
| `delete_position`       | `accountId`, `instrument`, `asOf`, `includeTrades` | Removes an incorrect holding's snapshots, and with `includeTrades` its trades |
| `record_trade`          | `accountId`, one trade | Like `bulk_import_trades` with one trade |
| `bulk_import_trades`    | `accountId`, `source`, `trades`, `allowPartial`, `createMissingInstruments`, `dryRun`, `idempotencyKey` | Imports executed trades |
| `update_price`          | `instrument`, `date`, `price`, `currency`, `source` | Records a price |
| `bulk_update_prices`    | `prices`: up to 1,000 | All or nothing |
| `delete_price`          | `priceId` | Values are recalculated |

**Instrument identity.** An `instrument` object identifies an instrument by
`instrumentId`, the broker's contract ID as `externalId` (for example
`ibkr:conid:12345`), `isin`, or `symbol` with `exchangeMic`, tried in that
order. A bare `symbol` matches only when exactly one instrument has it, because
tickers repeat across exchanges. With `createMissingInstruments`, an unknown
instrument is created from `name`, `assetType`, `quoteCurrency`, and a stable
identifier.

**Position snapshots versus trades.** These have different meanings:

- A **snapshot** (`bulk_upsert_positions`, `upsert_position`,
  `update_cash_balance`) says what was held on `asOf`. Wealthboard records it
  as an absolute observation, like a valuation: no buy or sell is invented.
  Activity before `asOf` is reconciled to the snapshot, and activity after it
  still applies. Statuses are `updated`, `confirmed` (Wealthboard already had
  that quantity), `unchanged` (the same snapshot was already recorded),
  `historical`, `closed`, or `rejected`.
- A **trade** (`bulk_import_trades`, `record_trade`) is a historical purchase
  or sale with quantity, execution price, trade and settlement dates,
  commission and other fees (added together as the fee), and the broker's
  trade ID as `externalId`. Trades change holdings and cash.

You can import both for the same period without double counting: a trade dated
on or before a snapshot is already part of that snapshot, so it doesn't change
the snapshot's quantity or cash; a trade after it adds on top. A snapshot older
than an existing snapshot for the same instrument is kept as history (status
`historical`) and doesn't change current holdings. A new snapshot for the same
instrument and date replaces the earlier one.

**Trades are idempotent.** A trade without `externalId` gets a derived ID from
its date, side, instrument, quantity, and price. Importing the same trades again
reports them as `duplicate`; a trade whose ID matches a different recorded trade
is a `conflict` and is never overwritten. Trades are recorded in date order, and
a sale that would make a holding negative is rejected. Cross-currency trades
need `netCash` (the settled amount in the account currency) or `fxRate`.

**Cash.** An investment account holds cash in its own currency. Cash in another
currency is rejected with a currency mismatch, because the account can't hold
separate currency balances.

**Prices** are recorded observations, not live quotes. `get_price_history`
labels the latest price `current` while it is within the user's staleness
threshold for the asset type (**Settings**) and `stale` after that; older prices
are `historical`. Price rows report `historical: true` when a newer price
already exists, so current values keep using the newer one.

### Goals

| Tool          | Parameters | Behavior |
| ------------- | ---------- | -------- |
| `create_goal` | `name`, `target`, `currency`, `targetDate`, `linkedAccountId`, `currentAmount`, `priority`, `assumedAnnualReturnPercent`, `contribution` (`amount`, `frequency`, `startDate`, `endDate`), `milestones` | A linked account's value is the goal's progress |
| `update_goal` | `goalId`, then any of the create fields, `status`, `clearLinkedAccount`, `addMilestones`, `removeMilestoneIds` | |
| `delete_goal` | `goalId` | Linked accounts aren't affected |

`simulate_goal` uses the same forecast as the goal page and never saves
anything; use `update_goal` to keep a plan.

### Exchange rates

| Tool                         | Parameters | Behavior |
| ---------------------------- | ---------- | -------- |
| `upsert_exchange_rate`       | `baseCurrency`, `quoteCurrency`, `rate`, `effectiveDate`, `source` | `1 base = rate quote`; replaces a rate on the same date |
| `bulk_upsert_exchange_rates` | `rates`: up to 1,000 | All or nothing |
| `delete_exchange_rate`       | `rateId` | |

Reports convert each date at the latest rate effective on that date. After a
change, investment account values are recalculated. A pair whose inverse is
already recorded is refused; the inverse is calculated automatically.

## Reports

**Performance.** `get_performance_report` separates contributions and
withdrawals (transfers between the user's own accounts are neither) from
investment return, which is income, fees, and growth. It reports:

- a **time-weighted return** that chains each month's Modified Dietz return,
  so the size and timing of contributions don't affect it, and
- a **money-weighted return**, the Modified Dietz return for the whole period
  with each month's flows weighted from mid-month, so it reflects when money
  was added.

Both are period returns. Each account also has Wealthboard's annualized return
where enough history exists.

**Tax.** `get_tax_report` lists a calendar year's recorded interest,
dividends, `capital_gain` and `capital_loss` transactions, fees, withholding
tax, and sale proceeds by account, with the underlying records. Withholding tax
is identified from fee transactions whose description mentions tax or
withholding. Gains on sales aren't calculated from purchase lots, and nothing in
the report is a statement of tax owed.

## Audit log

Every successful write records the time, the tool, the action, the affected
record IDs, the account, the import ID, and which connection made it
(`grant:<id>` for an OAuth connection or `key:<id>` for an API key). It never
records amounts, descriptions, or other submitted values. Previews, dry runs,
and rejected imports aren't recorded because they change nothing.

## Examples

### Import a statement

An assistant reads an Etica statement with 51 days of interest and two
deposits, previews it, shows the user the result, and commits it with the
preview's hash:

```json
{
  "accountId": "account-uuid",
  "source": "etica_statement",
  "closingBalance": { "date": "2026-11-06", "amount": "700641.94" },
  "transactions": [
    {
      "externalId": "etica-2026-09-17-interest",
      "date": "2026-09-17",
      "type": "interest",
      "amount": "122.61",
      "currency": "KES",
      "description": "Daily net interest"
    },
    {
      "externalId": "etica-2026-10-06-deposit",
      "date": "2026-10-06",
      "type": "deposit",
      "amount": "130000.00",
      "currency": "KES",
      "description": "Investment deposit"
    }
  ]
}
```

`commit_import` returns, in part:

```json
{
  "importId": "batch-uuid",
  "status": "completed",
  "created": 53,
  "updated": 0,
  "skipped": 0,
  "rejected": 0,
  "balanceBefore": { "minor": "43333363", "decimal": "433333.63", "currency": "KES" },
  "balanceAfter": { "minor": "70064193", "decimal": "700641.93", "currency": "KES" },
  "closingBalance": { "date": "2026-11-06", "matches": false, "difference": { "decimal": "-0.01" } },
  "warnings": ["Statement closing balance differs by 0.01 KES. No balancing adjustment was made."]
}
```

For a Madison money market statement, send each month's interest as an
`interest` row and its withholding tax as a `fee` row on the posting date.
`reconcile_transactions` reports which are already recorded, which are missing,
and any records in the period the statement lacks.

### Synchronize Interactive Brokers holdings

```json
{
  "accountId": "account-uuid",
  "asOf": "2026-11-06",
  "source": "interactive_brokers",
  "createMissingInstruments": true,
  "positions": [
    {
      "instrument": { "isin": "IE00BK5BQT80", "symbol": "VWRA", "exchangeMic": "XLON", "name": "Vanguard FTSE All-World", "assetType": "etf", "quoteCurrency": "USD" },
      "quantity": "50.9006",
      "unitPrice": "184.98",
      "currency": "USD"
    },
    {
      "instrument": { "isin": "IE00BKM4GZ66", "symbol": "EIMI", "exchangeMic": "XLON" },
      "quantity": "14",
      "unitPrice": "48.91"
    }
  ],
  "cash": { "USD": "96.39" }
}
```

### Import executed trades

```json
{
  "accountId": "account-uuid",
  "source": "interactive_brokers",
  "trades": [
    {
      "instrument": { "externalId": "ibkr:conid:128831206" },
      "externalId": "ibkr-exec-0000e0d5.6543a1b2.01.01",
      "tradeDate": "2026-10-01",
      "settlementDate": "2026-10-03",
      "side": "buy",
      "quantity": "1",
      "price": "180.00",
      "currency": "USD",
      "commission": "1.25"
    }
  ]
}
```

## Limits

- Bulk tools accept up to 1,000 records per call, and requests up to 1 MiB.
- An investment account holds cash only in its own currency.
- Gains on sales aren't calculated from purchase lots.
- Rollback doesn't restore same-day snapshots or prices an import replaced.
- A user export and restore keeps every record and value, but restored
  snapshots become ordinary adjustments, and import history and the audit log
  aren't part of the export.
