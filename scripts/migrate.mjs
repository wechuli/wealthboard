import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";

const databasePath = path.resolve(
  process.env.DATABASE_PATH ?? "./data/wealthboard.db",
);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");

try {
  // Drizzle wraps pending migrations in one transaction. SQLite cannot change
  // foreign_keys inside that transaction, so disable it before table rebuilds.
  sqlite.pragma("foreign_keys = OFF");
  migrate(drizzle(sqlite), {
    migrationsFolder: path.resolve("./db/migrations"),
  });
  sqlite.pragma("foreign_keys = ON");
  const violations = sqlite.pragma("foreign_key_check");
  if (violations.length) {
    throw new Error(
      "Database migration left invalid foreign-key relationships.",
    );
  }
} finally {
  sqlite.pragma("foreign_keys = ON");
  sqlite.close();
}
console.log(`Database migrations applied to ${databasePath}`);
