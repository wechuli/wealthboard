---
title: Investment History v1
description: Exact JSON and CSV contracts for importing instruments, holdings, trades, cash, and prices into one position account.
---

# Investment History v1

Investment History v1 appends source records to one active position-tracked
account. The signed-in session and account URL supply the owner, account,
institution, account currency, and tracking mode. A file cannot override them.

Use the downloadable examples:

- [JSON envelope](/templates/investment-history-v1.json)
- [Opening holdings CSV](/templates/investment-holdings-v1.csv)
- [Trades CSV](/templates/investment-trades-v1.csv)
- [Cash CSV](/templates/investment-cash-v1.csv)
- [Prices CSV](/templates/investment-prices-v1.csv)

Files are limited to 5 MB and 10,000 combined source records. Dates are
non-future `YYYY-MM-DD` values. Quantities, prices, rates, and money are decimal
strings, not JSON numbers.

The position import page also offers optional **Convert document with AI**.
Extraction happens within your self-hosted instance; selected source sections
are sent to the configured provider only after approval. The resulting JSON
draft must pass the normal import preview. See [AI-assisted import](./ai-import).

## Stable external IDs

Supply stable, case-sensitive external IDs no longer than 200 characters.
Instruments, position events, and prices require them. A cash row with no ID
receives a derived date/type/minor-amount ID; supply your own to distinguish
otherwise identical source events. Instrument references use the instrument's
external ID rather than a Wealthboard database ID.

- An identical stored ID is skipped as a duplicate.
- An existing ID with different authoritative fields is a conflict.
- Every occurrence of an ID repeated inside its identity scope is invalid.
- Instrument IDs are user-scoped; position-event and cash IDs are scoped to the
  user/account and their respective collections; price IDs are scoped to the
  user/instrument.
- Deleting an imported position event, cash transaction, or price releases its
  external ID for an intentional reimport. Archived instruments retain their
  identity and external ID.

Do not use spreadsheet row numbers that change when rows are inserted or
sorted. Prefer provider IDs or deterministic IDs built from stable source
fields outside Wealthboard.

## JSON envelope

The JSON root is strict:

```json
{
  "format": "wealthboard-investment-history",
  "version": 1,
  "instruments": [],
  "position_events": [],
  "cash_transactions": [],
  "prices": []
}
```

Unknown root or record fields reject the file.

### Instruments

| Field             | Required | Rule                                          |
| ----------------- | -------- | --------------------------------------------- |
| `external_id`     | Yes      | Stable instrument reference                   |
| `name`            | Yes      | 1 to 100 characters                           |
| `symbol`          | No       | Up to 30 characters                           |
| `identifier_type` | Yes      | `isin`, `ticker_exchange`, or `custom`        |
| `identifier`      | No       | ISIN, exchange ticker, or custom source value |
| `exchange_mic`    | No       | Exchange or MIC used with ticker identity     |
| `asset_type`      | Yes      | `stock`, `etf`, or `fund`                     |
| `quote_currency`  | Yes      | Enabled three-letter currency code            |

An existing instrument with the same external ID must match the imported
identity. Ticker alone is not assumed globally unique.

### Position events

| Field                    | Required                   | Rule                                                                          |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------- |
| `external_id`            | Yes                        | Stable event reference                                                        |
| `instrument_external_id` | Yes                        | Resolves an imported or existing instrument                                   |
| `type`                   | Yes                        | `opening_position`, `buy`, `sell`, or `quantity_adjustment`                   |
| `quantity`               | Yes                        | Positive except a signed, non-zero quantity adjustment                        |
| `unit_price`             | Buy/sell                   | Positive execution price                                                      |
| `trade_currency`         | No                         | Enabled three-letter code; defaults to the instrument quote currency          |
| `fee_amount`             | No                         | Non-negative fee in `fee_currency` or trade currency                          |
| `fee_currency`           | No                         | Enabled fee currency                                                          |
| `cash_effect`            | Cross-currency alternative | Positive net cash movement including fees, in account currency; direction comes from buy/sell |
| `applied_exchange_rate`  | Cross-currency alternative | Positive settlement rate; invalid for same-currency trades                    |
| `opening_cost_basis`     | Opening only               | Optional non-negative reference in account currency                           |
| `event_group_id`         | No                         | JSON-only dividend-reinvestment group reference                               |
| `trade_date`             | Yes                        | Effective financial date                                                      |
| `settlement_date`        | No                         | Settlement date for a trade                                                   |
| `description`, `notes`   | No                         | Optional source context                                                       |

A cross-currency buy or sell requires `cash_effect` or
`applied_exchange_rate`. An explicit `cash_effect` is used as the complete cash
debit or credit; the fee is not applied again. The complete existing plus
imported sequence must stay long-only at every date and explicit same-date order.

### Cash transactions

| Field                  | Required | Rule                                                                           |
| ---------------------- | -------- | ------------------------------------------------------------------------------ |
| `external_id`          | No       | Stable source reference; strongly recommended to avoid derived-ID collisions |
| `type`                 | Yes      | `deposit`, `withdrawal`, `interest`, `dividend`, `fee`, or `manual_adjustment` |
| `amount`               | Yes      | Positive except a signed, non-zero manual adjustment                           |
| `date`                 | Yes      | Financial date                                                                 |
| `event_group_id`       | No       | JSON-only dividend-reinvestment group reference                                |
| `description`, `notes` | No       | Optional source context                                                        |

One reinvestment group contains one dividend cash row and one or more same-date
buy events. The group is remapped to one internal UUID and commits, restores,
or deletes atomically. Separate CSV uploads cannot form a grouped reinvestment;
use JSON or the **Reinvest** workflow.

### Prices

| Field                    | Required | Rule                                        |
| ------------------------ | -------- | ------------------------------------------- |
| `external_id`            | Yes      | Stable observation reference                |
| `instrument_external_id` | Yes      | Resolves an imported or existing instrument |
| `price`                  | Yes      | Positive decimal unit price                 |
| `effective_date`         | Yes      | Date from which this observation applies    |
| `source`                 | Yes      | Short source label such as `statement`      |
| `provenance`             | No       | Statement, file, or provider reference      |

Price currency is always the instrument quote currency. A later file cannot
silently overwrite a conflicting observation on the same effective date.

## CSV contracts

Each CSV uses one exact set of header names; column order may vary. Missing,
extra, duplicate, or renamed columns reject the file. CSV does not wrap records
in a JSON envelope.

### Opening holdings

```csv
instrument_external_id,event_external_id,price_external_id,instrument_name,symbol,identifier_type,identifier,exchange_mic,asset_type,quote_currency,quantity,unit_price,price_date,opening_cost_basis,notes
```

Each row creates or resolves an instrument, writes one opening position, and
writes its effective price. It counts as three records against the combined
10,000-record limit.

### Trades

```csv
external_id,instrument_external_id,type,quantity,unit_price,trade_currency,fee_amount,fee_currency,cash_effect,applied_exchange_rate,trade_date,settlement_date,description,notes
```

Trade rows support `buy`, `sell`, and `quantity_adjustment`. Instruments must
already exist or be included through a JSON envelope/opening-holdings import.

### Cash

```csv
external_id,type,amount,date,description,notes
```

### Prices

```csv
external_id,instrument_external_id,price,effective_date,source,provenance
```

## Preview and commit

Preview writes nothing. The downloadable **Report** contains:

- existing or new instrument resolution;
- per-instrument and per-event before/after quantities;
- deterministic date/order placement;
- current and projected cash, position value, total, and net change;
- price values, currencies, sources, and affected-from dates;
- missing prices and currencies;
- duplicates, conflicts, invalid relationships, and oversells.

![Investment import preview showing exact quantity and value effects](/images/screenshots/investment-import-preview.png)

The current page shows summary counts and the first 50 row outcomes. Use the
report for complete quantities and projected values; stale-price diagnostics
remain in the account's Positions table rather than this import result.

Confirmation requires the same file bytes and SHA-256 hash. Wealthboard
reparses the file, rechecks ownership and duplicates, inserts every accepted
source record, validates grouped relationships and long-only replay, and
rebuilds the account value inside one serializable PostgreSQL transaction. Any
unexpected error rolls back the entire investment import.

## Common rejection reasons

| Message or state                    | Resolution                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Position would become negative      | Add the missing earlier holding/buy, correct the quantity/date, or remove the oversell                                              |
| External ID conflicts               | Use the original authoritative fields or a genuinely different stable source ID                                                     |
| Referenced instrument was not found | Import/create the instrument first or correct `instrument_external_id`                                                              |
| Cross-currency settlement required  | Supply actual account-currency settlement or the applied settlement rate                                                            |
| Missing price or rate               | The import may be structurally valid but projected value remains incomplete; add the effective observation before relying on totals |
| File changed after preview          | Preview the final file again before confirming                                                                                      |

For ordinary balance-account transactions, use
[Account History Import v1](../guides/activity#import-detailed-account-history)
instead.
