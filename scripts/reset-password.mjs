import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const password = process.env.NEW_ADMIN_PASSWORD;
if (!password || password.length < 10) {
  throw new Error("Set NEW_ADMIN_PASSWORD to at least 10 characters.");
}

const configured = process.env.DATABASE_PATH ?? "data/worthboard.db";
const databasePath = path.isAbsolute(configured)
  ? configured
  : path.join(process.cwd(), configured);
if (!fs.existsSync(databasePath)) {
  throw new Error(`Database not found at ${databasePath}.`);
}

const sqlite = new Database(databasePath);
sqlite.pragma("busy_timeout = 5000");
const hash = await bcrypt.hash(password, 12);
const result = sqlite
  .prepare(
    `UPDATE user_settings
     SET password_hash = ?, session_version = session_version + 1, updated_at = ?
     WHERE id = 'single-user'`,
  )
  .run(hash, new Date().toISOString());
sqlite.close();

if (result.changes !== 1) {
  throw new Error("The single-user account has not been initialized.");
}
console.log("Password reset. Existing sessions have been invalidated.");
