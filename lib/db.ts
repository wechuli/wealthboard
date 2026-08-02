import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";

type DatabaseState = {
  sqlite: Database.Database;
  orm: BetterSQLite3Database<typeof schema>;
};

const globalForDatabase = globalThis as unknown as {
  wealthboardDatabase?: DatabaseState;
};

function resolvedDatabasePath() {
  const configured = process.env.DATABASE_PATH ?? "data/wealthboard.db";
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

function openDatabase(): DatabaseState {
  const databasePath = resolvedDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return {
    sqlite,
    orm: drizzle(sqlite, { schema }),
  };
}

export function getDatabase() {
  globalForDatabase.wealthboardDatabase ??= openDatabase();
  return globalForDatabase.wealthboardDatabase.orm;
}

export function getSqlite() {
  globalForDatabase.wealthboardDatabase ??= openDatabase();
  return globalForDatabase.wealthboardDatabase.sqlite;
}

export function closeDatabase() {
  const state = globalForDatabase.wealthboardDatabase;
  if (!state) return;
  state.sqlite.close();
  globalForDatabase.wealthboardDatabase = undefined;
}

export function databasePath() {
  return resolvedDatabasePath();
}
