---
title: Import, export, and restore
description: Move account history and protect a user's complete Wealthboard portfolio.
---

# Import, export, and restore

Wealthboard has three different data-movement tools. Use the one that matches
the job.

## Account history import

Use an account-scoped CSV or JSON file to append transactions to one existing
active account. See [Transactions and values](./activity#import-detailed-account-history).

The file cannot choose a user, account, institution, or currency. The signed-in
session and account URL establish those values.

## Investment history import

Use an active position account's **Import** action for instruments, opening
holdings, trades, broker cash, and effective-dated prices. This is a strict,
all-or-nothing workflow because one trade can depend on earlier quantities and
cash.

See [Investment History v1](../reference/investment-import) for the JSON
envelope, four CSV templates, stable-ID policy, preview fields, and grouped
reinvestment rules.

## CSV downloads

- **Accounts CSV:** a spreadsheet-friendly account inventory.
- **Transactions CSV:** transaction records using the filters currently applied
  in the transaction workbench.

CSV is useful for analysis and interoperability, but it is not a complete
Wealthboard backup.

## Complete user export

Open **Settings → Data portability** and download the JSON export. Version 8
contains the current user's settings and source records, including:

- categories, institutions, accounts, transactions, and valuations;
- exchange rates, goals, contribution plans, milestones, and alert dismissals;
- beneficiaries, estate directives, allocations, residue, and retained estate
  summary snapshots;
- account tracking modes, investment instruments, ordered position events,
  effective security prices, and reconciliation observations; and
- grouped cash links, balance-to-position conversion provenance, selected
  corporate-action relationships, and price-freshness settings.

It excludes passwords, password hashes, sessions, OIDC identity mappings, AI
credentials, and every other user's data.

Treat the file as private financial data. Store it encrypted or in an
access-controlled location.

## Restore a user export

Restore replaces only the signed-in user's portfolio in one database
transaction.

1. Download a fresh pre-restore export when offered.
2. Select the JSON file.
3. Read the replacement warning carefully.
4. Confirm restore.
5. Verify settings, accounts, balances, goals, exchange rates, and estate plan.

Wealthboard validates archive version, every field, relationship, percentage
limit, and retained snapshot hash before replacement. IDs are remapped to the
current user. Any failure rolls back the complete restore.

Archives from versions 2 through 8 remain restorable. Version 7 position data
upgrades deterministically. Versions 2 through 6 restore accounts in balance
mode with empty position collections rather than inferring quantities from
money-only history. Older formats also receive the appropriate institution,
transaction-ID, goal, and estate compatibility defaults.

## Archive version history

| Version | Added source records                                                                              | Restore behavior                                                                            |
| ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 8       | Ordered advanced position events, grouped cash, account conversions, and freshness settings       | Current output; validates every advanced relationship before replacement                    |
| 7       | Initial instruments, position events, security prices, reconciliations, and account tracking mode | Upgrades deterministically; legacy advisory group IDs are cleared rather than reinterpreted |
| 6       | Beneficiaries, estate directives, allocations, residue, and retained summaries                    | Restores with balance-mode accounts and empty position collections                          |
| 5       | Stable transaction external IDs                                                                   | Missing later collections receive safe empty defaults                                       |
| 4       | User-owned institution directory                                                                  | Earlier institution names are normalized into owned records                                 |
| 3       | Goal milestones and alert dismissals                                                              | Receives later source-collection defaults                                                   |
| 2       | Baseline supported user archive                                                                   | Receives every compatibility conversion in order                                            |

Restore never infers units from money-only purchases, descriptions, valuations,
or cost basis in versions 2 through 6.

::: danger A user export is not a deployment backup
A JSON restore cannot recover login identities, OIDC mappings, or another user's
portfolio. Operators must separately back up the SQLite database. See
[Backup and recovery](../admin/backup-recovery).
:::
