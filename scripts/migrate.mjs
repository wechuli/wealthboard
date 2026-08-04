import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

class MigrationHistoryError extends Error {}

function assertCompatibleMigrationHistory(sqlite, migrationsFolder) {
  const migrationTable = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  const applicationTable = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' LIMIT 1",
    )
    .get();
  const lastAppliedMigration = migrationTable
    ? sqlite
        .prepare(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
        )
        .get()
    : undefined;

  if (!lastAppliedMigration) {
    if (applicationTable) {
      throw new MigrationHistoryError(
        "The database already contains application tables but has no applied Drizzle migration history. Refusing to apply a fresh baseline over existing tables. Restore the migration history that created this database, or back it up and recreate it.",
      );
    }
    return;
  }

  const appliedTimestamp = Number(lastAppliedMigration.created_at);
  const matchingMigration = readMigrationFiles({ migrationsFolder }).find(
    (migration) => migration.folderMillis === appliedTimestamp,
  );

  if (!matchingMigration) {
    throw new MigrationHistoryError(
      `The database's latest applied migration (${appliedTimestamp}) is missing from db/migrations. Migration files are append-only; restore the missing files instead of regenerating 0000.`,
    );
  }

  if (matchingMigration.hash !== lastAppliedMigration.hash) {
    throw new MigrationHistoryError(
      `Migration ${appliedTimestamp} was modified after it was applied. Restore its original SQL and generate a new migration for the schema change.`,
    );
  }
}

const databasePath = path.resolve(
  process.env.DATABASE_PATH ?? "./data/wealthboard.db",
);
const migrationsFolder = path.resolve("./db/migrations");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");

let migrationsApplied = false;
try {
  assertCompatibleMigrationHistory(sqlite, migrationsFolder);
  // Drizzle wraps pending migrations in one transaction. SQLite cannot change
  // foreign_keys inside that transaction, so disable it before table rebuilds.
  sqlite.pragma("foreign_keys = OFF");
  migrate(drizzle(sqlite), {
    migrationsFolder,
  });
  sqlite.pragma("foreign_keys = ON");
  const violations = sqlite.pragma("foreign_key_check");
  if (violations.length) {
    throw new Error(
      "Database migration left invalid foreign-key relationships.",
    );
  }
  migrationsApplied = true;
} catch (error) {
  if (error instanceof MigrationHistoryError) {
    console.error(`Database migration history error: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  sqlite.pragma("foreign_keys = ON");
  sqlite.close();
}

if (migrationsApplied) {
  console.log(`Database migrations applied to ${databasePath}`);
}
