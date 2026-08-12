---
title: Backup and recovery
description: Distinguish user exports from full SQLite backups and restore safely.
---

# Backup and recovery

Use both levels of protection:

- **User export:** portable source records for one authenticated user.
- **SQLite backup:** deployment-wide recovery, including identities and every
  user's records.

## Create an operator backup

Set `BACKUP_PATH` to persistent, access-controlled storage, then run:

```bash
npm run backup
```

The backup script creates a consistent timestamped SQLite copy. A raw backup
contains password hashes, OIDC mappings, provider configuration records, and all
users' financial data. Treat it as a high-sensitivity secret.

## Retention

Keep more than one generation and at least one encrypted copy away from the
application host. A backup on the same disk does not protect against disk loss,
ransomware, or destructive operator error.

Document the intended recovery point and recovery time for the deployment.

## Offline restore

Stop Wealthboard before replacing the active SQLite file. Then run:

```bash
CONFIRM_OFFLINE_RESTORE=true \
RESTORE_FILE=/backups/wealthboard-2026-08-02T10-00-00Z.db \
npm run backup:restore
```

Start Wealthboard afterward so pending migrations and readiness checks run.

Before restore:

1. Confirm the target deployment and backup timestamp.
2. Preserve a copy of the current database.
3. Verify enough free disk space exists for staging and recovery copies.
4. Stop all processes that can write to the database.

After restore:

1. Check `/api/health/ready`.
2. Review startup and migration logs without exposing record content.
3. Sign in with a controlled account.
4. Verify representative accounts, goals, rates, and estate snapshots.
5. Retain the pre-restore copy until validation is complete.

## Test recovery

A backup is unproven until restored into a disposable location and checked. A
regular drill should verify:

- SQLite integrity and foreign keys;
- migration history;
- authentication readiness;
- representative user login;
- exact account and report totals;
- expected file permissions.

## User restore is different

The authenticated JSON restore replaces only one user's portable portfolio. It
does not restore passwords, sessions, OIDC mappings, login attempts, or another
user. See [Import, export, and restore](../guides/data-portability).
