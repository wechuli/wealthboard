// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
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

  test("upgrades the previous schema with nullable external IDs and uniqueness", () => {
    const databasePath = createDatabasePath();
    const migrations = readMigrationFiles({
      migrationsFolder: path.join(projectRoot, "db/migrations"),
    });
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    const previous = migrations.slice(0, -1);
    const sqlite = new Database(databasePath);
    sqlite.pragma("foreign_keys = OFF");
    sqlite.transaction(() => {
      for (const migration of previous) {
        for (const statement of migration.sql) sqlite.exec(statement);
      }
      sqlite.exec(`
        CREATE TABLE __drizzle_migrations (
          id integer PRIMARY KEY AUTOINCREMENT,
          hash text NOT NULL,
          created_at numeric
        );
      `);
      for (const migration of previous) {
        sqlite
          .prepare(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
          )
          .run(migration.hash, migration.folderMillis);
      }
    })();
    sqlite.close();

    const result = runMigrations(databasePath);
    expect(result.status, result.stderr).toBe(0);

    const upgraded = new Database(databasePath);
    const columns = upgraded.pragma("table_info(transactions)") as Array<{
      name: string;
      notnull: number;
    }>;
    const indexes = upgraded.pragma("index_list(transactions)") as Array<{
      name: string;
      unique: number;
    }>;
    expect(columns).toContainEqual(
      expect.objectContaining({ name: "external_id", notnull: 0 }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({
        name: "transactions_user_account_external_unique",
        unique: 1,
      }),
    );
    expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    upgraded.close();
  });

  test("upgrades legacy institution strings without changing account values", () => {
    const databasePath = createDatabasePath();
    const migrations = readMigrationFiles({
      migrationsFolder: path.join(projectRoot, "db/migrations"),
    });
    const baseline = migrations[0];
    expect(migrations.length).toBeGreaterThanOrEqual(2);

    const sqlite = new Database(databasePath);
    sqlite.pragma("foreign_keys = OFF");
    sqlite.transaction(() => {
      for (const statement of baseline.sql) sqlite.exec(statement);
      sqlite.exec(`
        CREATE TABLE __drizzle_migrations (
          id integer PRIMARY KEY AUTOINCREMENT,
          hash text NOT NULL,
          created_at numeric
        );
      `);
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(baseline.hash, baseline.folderMillis);
    })();
    sqlite.exec(`
      INSERT INTO users
        (id, username, password_hash, status, session_version, created_at, updated_at)
      VALUES
        ('user-a', 'migration-a', 'hash', 'active', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('user-b', 'migration-b', 'hash', 'active', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO categories
        (id, user_id, name, slug, icon, display_order, asset_or_liability, is_liquid, is_investible, is_archived, is_system, created_at, updated_at)
      VALUES
        ('category-a', 'user-a', 'Cash', 'cash', 'Wallet', 0, 'asset', 1, 1, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('category-b', 'user-b', 'Cash', 'cash', 'Wallet', 0, 'asset', 1, 1, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO accounts
        (id, user_id, name, category_id, institution, currency, current_value_minor, is_liability, is_included_in_net_worth, created_at, updated_at)
      VALUES
        ('account-a1', 'user-a', 'Primary', 'category-a', 'KCB Bank', 'KES', 100, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('account-a2', 'user-a', 'Savings', 'category-a', '  kcb' || char(9) || '        bank  ', 'KES', 200, 0, 1, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
        ('account-a3', 'user-a', 'Cash', 'category-a', NULL, 'KES', 300, 0, 1, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
        ('account-a4', 'user-a', 'Unicode', 'category-a', 'ＫＣＢ' || char(160) || 'Bank', 'KES', 350, 0, 1, '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z'),
        ('account-b1', 'user-b', 'Primary', 'category-b', 'KCB Bank', 'KES', 400, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    sqlite.close();

    const result = runMigrations(databasePath);
    expect(result.status, result.stderr).toBe(0);

    const upgraded = new Database(databasePath, { readonly: true });
    const institutionRows = upgraded
      .prepare(
        "SELECT id, user_id, name, normalized_name FROM institutions ORDER BY user_id",
      )
      .all() as Array<{
      id: string;
      user_id: string;
      name: string;
      normalized_name: string;
    }>;
    const accountRows = upgraded
      .prepare(
        "SELECT id, user_id, institution_id, current_value_minor FROM accounts ORDER BY id",
      )
      .all() as Array<{
      id: string;
      user_id: string;
      institution_id: string | null;
      current_value_minor: number;
    }>;
    const violations = upgraded.pragma("foreign_key_check");
    upgraded.close();

    expect(violations).toEqual([]);
    expect(institutionRows).toHaveLength(3);
    expect(institutionRows.map((row) => row.user_id)).toEqual([
      "user-a",
      "user-a",
      "user-b",
    ]);
    const aliceKcb = institutionRows.find(
      (row) => row.user_id === "user-a" && row.normalized_name === "kcb bank",
    );
    const aliceUnicode = institutionRows.find(
      (row) =>
        row.user_id === "user-a" && row.normalized_name === "ＫＣＢ bank",
    );
    const bobKcb = institutionRows.find(
      (row) => row.user_id === "user-b" && row.normalized_name === "kcb bank",
    );
    expect(aliceKcb).toBeDefined();
    expect(aliceUnicode).toBeDefined();
    expect(bobKcb).toBeDefined();
    expect(
      institutionRows.every((row) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          row.id,
        ),
      ),
    ).toBe(true);
    expect(accountRows).toEqual([
      expect.objectContaining({
        id: "account-a1",
        institution_id: aliceKcb!.id,
        current_value_minor: 100,
      }),
      expect.objectContaining({
        id: "account-a2",
        institution_id: aliceKcb!.id,
        current_value_minor: 200,
      }),
      expect.objectContaining({
        id: "account-a3",
        institution_id: null,
        current_value_minor: 300,
      }),
      expect.objectContaining({
        id: "account-a4",
        institution_id: aliceUnicode!.id,
        current_value_minor: 350,
      }),
      expect.objectContaining({
        id: "account-b1",
        institution_id: bobKcb!.id,
        current_value_minor: 400,
      }),
    ]);
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
