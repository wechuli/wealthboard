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

  test("upgrades existing users and accounts through the latest invariants", () => {
    const databasePath = createDatabasePath();
    const migrations = readMigrationFiles({
      migrationsFolder: path.join(projectRoot, "db/migrations"),
    });
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, "db/migrations/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: Array<{ tag: string }> };
    const positionMigrationIndex = journal.entries.findIndex(
      (entry) => entry.tag === "0006_supreme_riptide",
    );
    expect(positionMigrationIndex).toBeGreaterThan(0);
    expect(migrations.length).toBeGreaterThan(positionMigrationIndex);
    const previous = migrations.slice(0, positionMigrationIndex);
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
      sqlite.exec(`
        INSERT INTO users
          (id, username, password_hash, status, session_version, created_at, updated_at)
        VALUES
          ('local-user', 'existing-local', 'preserved-password-hash', 'active', 7, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        INSERT INTO categories
          (id, user_id, name, slug, icon, display_order, asset_or_liability, is_liquid, is_investible, is_archived, is_system, created_at, updated_at)
        VALUES
          ('category-existing', 'local-user', 'Fixed Income', 'fixed-income', 'BadgeDollarSign', 0, 'asset', 0, 1, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        INSERT INTO user_settings
          (id, user_id, display_name, created_at, updated_at)
        VALUES
          ('settings-existing', 'local-user', 'Existing Local', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        INSERT INTO accounts
          (id, user_id, name, category_id, currency, current_value_minor, is_liability, is_included_in_net_worth, created_at, updated_at)
        VALUES
          ('account-existing', 'local-user', 'Existing investment', 'category-existing', 'USD', 12345, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
          ('account-position', 'local-user', 'Existing positions', 'category-existing', 'USD', 0, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        UPDATE accounts SET tracking_mode = 'positions' WHERE id = 'account-position';
        INSERT INTO investment_instruments
          (id, user_id, external_id, name, symbol, identifier_type, identifier, exchange_mic, asset_type, quote_currency, created_at, updated_at)
        VALUES
          ('instrument-existing', 'local-user', 'instrument:existing', 'Existing ETF', 'OLD', 'ticker_exchange', 'OLD', 'XNAS', 'etf', 'USD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        INSERT INTO position_events
          (id, user_id, account_id, instrument_id, type, quantity, trade_currency, cash_effect_minor, trade_date, created_at, updated_at)
        VALUES
          ('z-opening', 'local-user', 'account-position', 'instrument-existing', 'opening_position', '5', 'USD', 0, '2026-01-01T12:00:00.000Z', '2026-01-01T12:00:00.000Z', '2026-01-01T12:00:00.000Z'),
          ('a-sell', 'local-user', 'account-position', 'instrument-existing', 'sell', '2', 'USD', 200, '2026-01-01T12:00:00.000Z', '2026-01-01T12:00:01.000Z', '2026-01-01T12:00:01.000Z');
      `);
    })();
    sqlite.close();

    const result = runMigrations(databasePath);
    expect(result.status, result.stderr).toBe(0);

    const upgraded = new Database(databasePath);
    const columns = upgraded.pragma("table_info(users)") as Array<{
      name: string;
      notnull: number;
    }>;
    const indexes = upgraded.pragma("index_list(oidc_identities)") as Array<{
      name: string;
      unique: number;
    }>;
    expect(columns).toContainEqual(
      expect.objectContaining({ name: "password_hash", notnull: 0 }),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "oidc_identities_issuer_subject_unique",
          unique: 1,
        }),
        expect.objectContaining({
          name: "oidc_identities_user_issuer_unique",
          unique: 1,
        }),
      ]),
    );
    expect(
      upgraded
        .prepare(
          "SELECT password_hash, session_version FROM users WHERE id = ?",
        )
        .get("local-user"),
    ).toEqual({
      password_hash: "preserved-password-hash",
      session_version: 7,
    });
    expect(
      upgraded
        .prepare(
          "SELECT tracking_mode, current_value_minor FROM accounts WHERE id = ?",
        )
        .get("account-existing"),
    ).toEqual({ tracking_mode: "balance", current_value_minor: 12345 });
    expect(
      upgraded
        .prepare("SELECT is_liquid FROM categories WHERE id = ?")
        .get("category-existing"),
    ).toEqual({ is_liquid: 1 });
    expect(
      [
        "account_conversions",
        "investment_instruments",
        "position_events",
        "security_prices",
        "position_reconciliations",
      ].every((table) =>
        Boolean(
          upgraded
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .get(table),
        ),
      ),
    ).toBe(true);
    expect(
      (
        upgraded.pragma("index_list(position_events)") as Array<{
          name: string;
        }>
      ).map((index) => index.name),
    ).toEqual(
      expect.arrayContaining([
        "position_events_user_account_external_unique",
        "position_events_user_account_date_idx",
      ]),
    );
    expect(
      upgraded
        .prepare(
          "SELECT id, event_sequence FROM position_events WHERE account_id = ? ORDER BY event_sequence",
        )
        .all("account-position"),
    ).toEqual([
      { id: "z-opening", event_sequence: 1 },
      { id: "a-sell", event_sequence: 2 },
    ]);
    expect(
      upgraded
        .prepare(
          "SELECT position_stale_days_stock, position_stale_days_etf, position_stale_days_fund FROM user_settings WHERE user_id = ?",
        )
        .get("local-user"),
    ).toEqual({
      position_stale_days_stock: 7,
      position_stale_days_etf: 7,
      position_stale_days_fund: 31,
    });
    upgraded.exec(`
      INSERT INTO users
        (id, username, password_hash, status, session_version, created_at, updated_at)
      VALUES
        ('oidc-user', 'oidc-generated', NULL, 'active', 1, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      INSERT INTO oidc_identities
        (id, user_id, issuer, subject, created_at, updated_at, last_login_at)
      VALUES
        ('identity-one', 'oidc-user', 'https://identity.example.test/realm', 'subject-one', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    `);
    expect(() =>
      upgraded.exec(`
        INSERT INTO oidc_identities
          (id, user_id, issuer, subject, created_at, updated_at, last_login_at)
        VALUES
          ('identity-duplicate-subject', 'local-user', 'https://identity.example.test/realm', 'subject-one', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      `),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      upgraded.exec(`
        INSERT INTO oidc_identities
          (id, user_id, issuer, subject, created_at, updated_at, last_login_at)
        VALUES
          ('identity-duplicate-issuer', 'oidc-user', 'https://identity.example.test/realm', 'subject-two', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      `),
    ).toThrow(/UNIQUE constraint failed/);
    upgraded.prepare("DELETE FROM users WHERE id = ?").run("oidc-user");
    expect(
      upgraded.prepare("SELECT COUNT(*) AS count FROM oidc_identities").get(),
    ).toEqual({ count: 0 });
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
