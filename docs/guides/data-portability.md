---
title: Import, export, and restore
description: Move account history and protect a user's complete Wealthboard portfolio.
---

# Import, export, and restore

Wealthboard has three different data-movement tools. Use the one that matches
the job.

## Account history import

Use an account-scoped CSV or JSON file to append transactions to one existing
active balance-tracked account. See [Transactions and values](./activity#import-detailed-account-history).

The file cannot choose a user, account, institution, or currency. The signed-in
session and account URL establish those values. Files are limited to 5 MB and
10,000 rows. CSV requires exactly
`external_id,type,amount,date,description,notes`; JSON requires the strict
`wealthboard-account-history` version 1 envelope. Preview returns a SHA-256 hash,
and commit accepts only the same bytes and hash. Identical stored external IDs
are skipped, conflicting IDs reject commit, and accepted rows plus balance
replay commit in one serializable transaction.

## Investment history import

Use an active position account's **More → Import history** action for instruments, opening
holdings, trades, broker cash, and effective-dated prices. This is a strict,
all-or-nothing workflow because one trade can depend on earlier quantities and
cash. JSON uses `wealthboard-investment-history` version 1. CSV accepts one of
four exact templates: opening holdings, trades, cash, or prices. The 5 MB limit
and 10,000-record combined limit also apply here.

See [Investment History v1](../reference/investment-import) for the JSON
envelope, four CSV templates, stable-ID policy, preview fields, and grouped
reinvestment rules.

## Converting statements with an AI chat

Wealthboard imports only the strict formats above. Both account modes offer a
copyable prompt on the import page that asks an AI chat, such as ChatGPT or
Claude, to turn a pasted statement into one of these formats. Wealthboard sends
nothing to the AI service; you paste the prompt and statement yourself and
import the file it returns after reviewing the preview. See
[Convert a statement with an AI chat](./activity#convert-a-statement-with-an-ai-chat).

## CSV downloads

Open **Settings → Export and restore**:

- **Accounts (CSV):** a spreadsheet-friendly account inventory.
- **Transactions (CSV):** every transaction record.

CSV is useful for analysis and interoperability, but it is not a complete
Wealthboard backup.

## Complete user export

Open **Settings → Export and restore** and download **Full portfolio
(JSON)**. Version 8
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
transaction. Archives larger than 25 MB are rejected.

1. Choose the JSON file under **Restore from a backup**, then select **Restore
   this backup**.
2. Read the **This replaces your entire portfolio** warning and select **Export
   current portfolio first** to download a pre-restore copy.
3. Type `REPLACE` and select **Replace portfolio**.
4. Keep that pre-restore copy until you have checked the restored portfolio.
5. Verify settings, accounts, balances, goals, exchange rates, and estate plan.

Wealthboard validates the archive version, required fields, relationships,
percentage limits, and retained snapshot hashes. IDs are remapped to the
current user, and balances are replayed from restored records. Any failure
rolls back the complete restore.

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
portfolio. Operators must separately back up PostgreSQL. See
[Backup and recovery](../admin/backup-recovery).
:::
