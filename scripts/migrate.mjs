import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";

const databasePath = path.resolve(process.env.DATABASE_PATH ?? "./data/worthboard.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

migrate(drizzle(sqlite), {
  migrationsFolder: path.resolve("./db/migrations"),
});

sqlite.close();
console.log(`Database migrations applied to ${databasePath}`);
