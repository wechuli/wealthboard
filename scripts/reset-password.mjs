import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const username = process.env.TARGET_USERNAME?.trim().toLowerCase();
if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
  throw new Error("Set TARGET_USERNAME to a valid existing username.");
}
const password = process.env.NEW_USER_PASSWORD;
if (!password || password.length < 12) {
  throw new Error("Set NEW_USER_PASSWORD to at least 12 characters.");
}

const configured = process.env.DATABASE_PATH ?? "data/wealthboard.db";
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
    `UPDATE users
     SET password_hash = ?, session_version = session_version + 1, updated_at = ?
     WHERE username = ?`,
  )
  .run(hash, new Date().toISOString(), username);
sqlite.close();

if (result.changes !== 1) {
  throw new Error("The target user was not found.");
}
console.log(
  "Password reset. That user's existing sessions have been invalidated.",
);
