---
title: Backup and recovery
description: Distinguish user exports from PostgreSQL backups and restore safely.
---

# Backup and recovery

Use both levels of protection:

- **User export:** portable source records for one authenticated user.
- **PostgreSQL backup:** deployment-wide recovery, including identities and every
  user's records.

## Create an operator backup

Install PostgreSQL client tools compatible with the server. Create an
access-controlled destination directory, then choose a new explicit filename:

```bash
mkdir -p backups
make backup BACKUP_FILE="$PWD/backups/wealthboard-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

The target directory must already exist and the file must not. The command uses
`DATABASE_URL` and `pg_dump --format=custom --no-owner --no-privileges`, checks
that the result is a nonempty regular file, and sets mode `0600`. A database
archive contains password hashes, OIDC mappings, encrypted remembered AI keys,
provider settings, and every user's financial data. Treat it as a
high-sensitivity secret.

## Retention

Keep more than one generation and at least one encrypted copy away from the
application host. A backup on the same disk does not protect against disk loss,
ransomware, or destructive operator error.

Document the intended recovery point and recovery time for the deployment.

## Maintenance-mode restore

Restore is destructive. Stop every Wealthboard replica and any other database
writer, verify the target `DATABASE_URL`, and leave maintenance mode in place
until validation completes. Then run:

```bash
make restore RESTORE_FILE="$PWD/backups/wealthboard-20260920T120000Z.dump"
```

The underlying command requires `--confirm-maintenance`; the Make target supplies
it only after you explicitly invoke `restore`. The restore workflow:

1. verifies that the source is a regular custom-format archive with
  `pg_restore --list`;
2. creates `wealthboard-pre-restore-<UTC timestamp>.dump` beside the source;
3. runs `pg_restore --clean --if-exists --exit-on-error --single-transaction`
  without restoring ownership or privileges; and
4. checks the expected schema version and rejects unvalidated foreign keys.

The safety dump is retained on success or failure and its path is printed. A
failed restore must be investigated while maintenance mode remains active.

Before restore:

1. Confirm the target deployment and backup timestamp.
2. Verify the archive directory can also hold the automatic safety dump.
3. Verify enough free disk space exists for staging and recovery copies.
4. Stop all processes that can write to the database.

After restore:

1. Start Wealthboard and check `/api/health/ready`.
2. Review startup and migration logs without exposing record content.
3. Sign in with a controlled account.
4. Verify representative accounts, goals, rates, and estate snapshots.
5. Retain the pre-restore copy until validation is complete.

## Test recovery

A backup is unproven until restored into a disposable location and checked. A
regular drill should verify:

- PostgreSQL schema version and foreign keys;
- migration history;
- authentication readiness;
- representative user login;
- exact account and report totals;
- expected file permissions.

## User restore is different

The authenticated JSON restore replaces only one user's portable portfolio. It
does not restore passwords, sessions, OIDC mappings, login attempts, or another
user. See [Import, export, and restore](../guides/data-portability).
