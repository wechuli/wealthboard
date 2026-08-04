// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

const projectRoot = path.resolve(".");
const workspaces: string[] = [];

function createDatabasePath() {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "wealthboard-migration-runner-"),
  );
  workspaces.push(workspace);
  return path.join(workspace, "wealthboard.db");
}

function runMigrations(databasePath: string) {
  return spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

describe("migration runner", () => {
  test("migrates a fresh database and is idempotent", () => {
    const databasePath = createDatabasePath();

    const firstRun = runMigrations(databasePath);
    const secondRun = runMigrations(databasePath);

    expect(firstRun.status, firstRun.stderr).toBe(0);
    expect(secondRun.status, secondRun.stderr).toBe(0);

    const sqlite = new Database(databasePath, { readonly: true });
    const migrationCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
      .get() as { count: number };
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, "db/migrations/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: unknown[] };
    sqlite.close();

    expect(migrationCount.count).toBe(journal.entries.length);
  });

  test("rejects a replacement baseline before running its SQL", () => {
    const databasePath = createDatabasePath();
    const sqlite = new Database(databasePath);
    sqlite.exec(`
      CREATE TABLE accounts (id text PRIMARY KEY NOT NULL);
      CREATE TABLE __drizzle_migrations (
        id integer PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('old-migration-hash', 1);
    `);
    sqlite.close();

    const result = runMigrations(databasePath);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "latest applied migration (1) is missing from db/migrations",
    );
    expect(result.stderr).toContain("Migration files are append-only");
    expect(result.stderr).not.toContain("table `accounts` already exists");
  });
});
