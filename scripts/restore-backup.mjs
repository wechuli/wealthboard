import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

if (process.env.CONFIRM_OFFLINE_RESTORE !== "true") {
  throw new Error(
    "Stop Wealthboard, then set CONFIRM_OFFLINE_RESTORE=true to confirm an offline restore.",
  );
}

const sourceValue = process.env.RESTORE_FILE;
if (!sourceValue)
  throw new Error("Set RESTORE_FILE to the SQLite backup to restore.");
const source = path.resolve(sourceValue);
const target = path.resolve(
  process.env.DATABASE_PATH ?? "./data/wealthboard.db",
);
if (source === target)
  throw new Error("RESTORE_FILE must not be the active database.");
if (!fs.existsSync(source)) throw new Error(`Backup not found at ${source}.`);

const candidate = new Database(source, { readonly: true, fileMustExist: true });
try {
  if (candidate.pragma("integrity_check", { simple: true }) !== "ok") {
    throw new Error("The backup failed its SQLite integrity check.");
  }
  const users = candidate.prepare("SELECT COUNT(*) AS total FROM users").get();
  if (typeof users?.total !== "number") {
    throw new Error("The backup is not a compatible Wealthboard database.");
  }
} finally {
  candidate.close();
}

fs.mkdirSync(path.dirname(target), { recursive: true });
const temporary = `${target}.restore-${crypto.randomUUID()}`;
fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
try {
  fs.rmSync(`${target}-wal`, { force: true });
  fs.rmSync(`${target}-shm`, { force: true });
  fs.renameSync(temporary, target);
} finally {
  fs.rmSync(temporary, { force: true });
}

console.log(`Deployment database restored from ${source}.`);
