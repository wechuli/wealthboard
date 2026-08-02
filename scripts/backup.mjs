import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const databasePath = path.resolve(
  process.env.DATABASE_PATH ?? "./data/wealthboard.db",
);
if (!fs.existsSync(databasePath))
  throw new Error(`Database not found at ${databasePath}.`);

const backupDirectory = path.resolve(process.env.BACKUP_PATH ?? "./backups");
fs.mkdirSync(backupDirectory, { recursive: true });
const timestamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d{3}Z$/, "Z");
const destination = path.join(backupDirectory, `wealthboard-${timestamp}.db`);

const sqlite = new Database(databasePath, {
  readonly: true,
  fileMustExist: true,
});
try {
  await sqlite.backup(destination);
} finally {
  sqlite.close();
}

console.log(`Deployment backup created at ${destination}.`);
