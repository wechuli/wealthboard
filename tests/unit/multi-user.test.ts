// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  accounts,
  categories,
  exchangeRates,
  goalContributionPlans,
  goals,
  legacyClaims,
  transactions,
  users,
  userSettings,
  valuationSnapshots,
} from "@/db/schema";
import {
  authenticateUser,
  changeUserPassword,
  registerUser,
} from "@/lib/auth/users";
import { getSettings } from "@/lib/bootstrap";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  createAccount,
  getAccount,
  listAccounts,
  recordTransaction,
} from "@/lib/services/accounts";
import { getDashboardData } from "@/lib/services/analytics";
import { createGoal } from "@/lib/services/goals";
import {
  exportData,
  importTransactionsCsv,
  restoreUserData,
} from "@/lib/services/portability";
import { addExchangeRate, listExchangeRates } from "@/lib/services/settings";
import { recordTransfer } from "@/lib/services/transfers";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "worthboard-multi-user-"));
const freshDatabase = path.join(workspace, "fresh.db");
const legacyDatabase = path.join(workspace, "legacy.db");

function migrateDatabase(databasePath: string) {
  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = OFF");
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite.pragma("foreign_keys = ON");
  expect(sqlite.pragma("foreign_key_check")).toHaveLength(0);
  sqlite.close();
}

function useDatabase(databasePath: string) {
  closeDatabase();
  process.env.DATABASE_PATH = databasePath;
}

function createLegacyDatabase(databasePath: string) {
  const migrationNames = [
    ["0000_harsh_mother_askani.sql", 1785655073717],
    ["0001_handy_dagger.sql", 1785655315110],
    ["0002_fluffy_scalphunter.sql", 1785658123255],
  ] as const;
  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  for (const [name] of migrationNames) {
    sqlite.exec(
      fs
        .readFileSync(path.join(migrationsFolder, name), "utf8")
        .replaceAll("--> statement-breakpoint", ""),
    );
  }
  sqlite.exec(
    'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  for (const [name, createdAt] of migrationNames) {
    const sql = fs.readFileSync(path.join(migrationsFolder, name), "utf8");
    sqlite
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      )
      .run(createHash("sha256").update(sql).digest("hex"), createdAt);
  }

  const createdAt = "2025-01-01T00:00:00.000Z";
  sqlite.pragma("foreign_keys = OFF");
  sqlite
    .prepare(
      `INSERT INTO user_settings
       (id, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "single-user",
      "Legacy Owner",
      bcrypt.hashSync("legacy-password-123", 12),
      createdAt,
      createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO transactions
       (id, account_id, type, amount_minor, currency, transaction_date, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-transaction",
      "legacy-account",
      "opening_balance",
      123456,
      "KES",
      createdAt,
      "Legacy opening balance",
      createdAt,
      createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO valuation_snapshots
       (id, account_id, value_minor, currency, valuation_date, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-valuation",
      "legacy-account",
      130000,
      "KES",
      "2025-02-01T00:00:00.000Z",
      "Legacy valuation",
      "2025-02-01T00:00:00.000Z",
    );
  sqlite
    .prepare(
      `INSERT INTO goals
       (id, name, target_amount_minor, currency, target_date, linked_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-goal",
      "Legacy Goal",
      500000,
      "KES",
      "2028-01-01T00:00:00.000Z",
      "legacy-account",
      createdAt,
      createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO goal_contribution_plans
       (id, goal_id, planned_contribution_minor, frequency, start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-plan",
      "legacy-goal",
      10000,
      "monthly",
      createdAt,
      createdAt,
      createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO categories
       (id, name, slug, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-category",
      "Savings",
      "savings",
      "PiggyBank",
      createdAt,
      createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO accounts
       (id, name, category_id, currency, current_value_minor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-account",
      "Legacy Savings",
      "legacy-category",
      "KES",
      123456,
      createdAt,
      createdAt,
    );
  sqlite.pragma("foreign_keys = ON");
  expect(sqlite.pragma("foreign_key_check")).toHaveLength(0);
  sqlite.close();
}

describe.sequential("multi-user persistence and isolation", () => {
  let aliceId = "";
  let bobId = "";
  let aliceCategoryId = "";
  let bobCategoryId = "";
  let aliceAccountId = "";
  let bobAccountId = "";

  beforeAll(() => {
    process.env.SESSION_SECRET = "unit-test-session-secret-longer-than-32-characters";
    process.env.TZ = "Africa/Nairobi";
    process.env.INITIAL_ADMIN_PASSWORD = "must-not-create-a-user";
    migrateDatabase(freshDatabase);
    useDatabase(freshDatabase);
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("fresh migrations create no environment or default identity", () => {
    expect(getDatabase().select().from(users).all()).toHaveLength(0);
  });

  test("first and subsequent signup create isolated defaults without portfolio data", async () => {
    const alice = await registerUser({
      username: "Alice",
      displayName: "Alice Example",
      password: "alice-password-123",
    });
    const bob = await registerUser({
      username: "bob",
      displayName: "Bob Example",
      password: "bob-password-12345",
    });
    aliceId = alice.userId;
    bobId = bob.userId;

    await expect(
      registerUser({
        username: "ALICE",
        displayName: "Duplicate",
        password: "duplicate-password-123",
      }),
    ).rejects.toThrow("username is unavailable");

    const db = getDatabase();
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(
      db.select().from(categories).where(eq(categories.userId, aliceId)).all(),
    ).toHaveLength(11);
    expect(
      db.select().from(categories).where(eq(categories.userId, bobId)).all(),
    ).toHaveLength(11);
    expect(
      db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.userId, aliceId))
        .all(),
    ).toHaveLength(1);
    expect((await getSettings(aliceId)).displayName).toBe("Alice Example");
    expect((await getSettings(bobId)).displayName).toBe("Bob Example");
  });

  test("login failures do not distinguish unknown users from bad passwords", async () => {
    await expect(authenticateUser("alice", "wrong-password")).resolves.toBeNull();
    await expect(authenticateUser("unknown", "wrong-password")).resolves.toBeNull();
    await expect(
      authenticateUser("alice", "alice-password-123"),
    ).resolves.toMatchObject({ userId: aliceId });

    const db = getDatabase();
    const aliceVersion = db
      .select({ version: users.sessionVersion })
      .from(users)
      .where(eq(users.id, aliceId))
      .get()!.version;
    const bobVersion = db
      .select({ version: users.sessionVersion })
      .from(users)
      .where(eq(users.id, bobId))
      .get()!.version;
    await expect(
      changeUserPassword(bobId, "bob-password-12345", "bob-new-password-12345"),
    ).resolves.toMatchObject({ sessionVersion: bobVersion + 1 });
    expect(
      db
        .select({ version: users.sessionVersion })
        .from(users)
        .where(eq(users.id, aliceId))
        .get()!.version,
    ).toBe(aliceVersion);
    await expect(
      authenticateUser("bob", "bob-password-12345"),
    ).resolves.toBeNull();
    await expect(
      authenticateUser("bob", "bob-new-password-12345"),
    ).resolves.toMatchObject({ userId: bobId });
  });

  test("owner predicates, relationships, analytics, caches, and idempotency stay isolated", async () => {
    const db = getDatabase();
    aliceCategoryId = db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, aliceId), eq(categories.slug, "savings")))
      .get()!.id;
    bobCategoryId = db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, bobId), eq(categories.slug, "savings")))
      .get()!.id;

    const sharedIdempotencyKey = crypto.randomUUID();
    aliceAccountId = createAccount(aliceId, {
      idempotencyKey: sharedIdempotencyKey,
      name: "Alice Savings",
      categoryId: aliceCategoryId,
      currency: "KES",
      openingValue: "100",
      isIncludedInNetWorth: true,
      openedAt: "2025-01-01",
    });
    bobAccountId = createAccount(bobId, {
      idempotencyKey: sharedIdempotencyKey,
      name: "Bob Savings",
      categoryId: bobCategoryId,
      currency: "KES",
      openingValue: "200",
      isIncludedInNetWorth: true,
      openedAt: "2025-01-01",
    });

    await expect(getAccount(bobId, aliceAccountId)).resolves.toBeUndefined();
    expect(() =>
      createAccount(bobId, {
        name: "Foreign category attack",
        categoryId: aliceCategoryId,
        currency: "KES",
        openingValue: "1",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("category is unavailable");
    expect(() =>
      recordTransaction(bobId, {
        accountId: aliceAccountId,
        type: "deposit",
        amount: "1",
        transactionDate: "2025-02-01",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow("Account not found");
    expect(() =>
      recordTransfer(aliceId, {
        fromAccountId: aliceAccountId,
        toAccountId: bobAccountId,
        amount: "1",
        transactionDate: "2025-02-01",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow("unavailable");
    expect(() =>
      createGoal(bobId, {
        name: "Foreign goal attack",
        targetAmount: "1000",
        currency: "KES",
        targetDate: "2028-07-01",
        linkedAccountId: aliceAccountId,
        icon: "Target",
        status: "active",
        priority: 1,
        assumedAnnualReturn: 8,
        plannedContribution: "10",
        frequency: "monthly",
        planStartDate: "2026-01-01",
      }),
    ).toThrow("Linked account not found");

    expect(() =>
      importTransactionsCsv(
        bobId,
        `account_id,type,amount,currency,date\n${aliceAccountId},deposit,10,KES,2025-02-01`,
      ),
    ).toThrow("account was not found");

    const [aliceDashboard, bobDashboard] = await Promise.all([
      getDashboardData(aliceId),
      getDashboardData(bobId),
    ]);
    expect(aliceDashboard.totals.netWorth).toBe(10000n);
    expect(bobDashboard.totals.netWorth).toBe(20000n);
    expect(aliceDashboard.accountCount).toBe(1);
    expect(bobDashboard.accountCount).toBe(1);

    addExchangeRate(aliceId, {
      baseCurrency: "EUR",
      quoteCurrency: "KES",
      rate: "150",
      effectiveDate: "2025-01-01",
    });
    addExchangeRate(bobId, {
      baseCurrency: "EUR",
      quoteCurrency: "KES",
      rate: "160",
      effectiveDate: "2025-01-01",
    });
    expect(
      (await listExchangeRates(aliceId)).find(
        (rate) => rate.baseCurrency === "EUR",
      )?.rate,
    ).toBe("150");
    expect(
      (await listExchangeRates(bobId)).find(
        (rate) => rate.baseCurrency === "EUR",
      )?.rate,
    ).toBe("160");
  });

  test("exports, restores, and imported owner fields cannot cross users", async () => {
    const archive = await exportData(aliceId);
    const serialized = JSON.stringify(archive);
    expect(serialized).toContain("Alice Savings");
    expect(serialized).not.toContain("Bob Savings");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain('"userId"');

    createAccount(aliceId, {
      name: "Temporary Alice Account",
      categoryId: aliceCategoryId,
      currency: "KES",
      openingValue: "50",
      isIncludedInNetWorth: true,
    });
    expect(await listAccounts(aliceId)).toHaveLength(2);
    restoreUserData(aliceId, archive);
    expect((await listAccounts(aliceId)).map((account) => account.name)).toEqual([
      "Alice Savings",
    ]);
    expect((await listAccounts(bobId)).map((account) => account.name)).toEqual([
      "Bob Savings",
    ]);

    const malicious = structuredClone(archive) as typeof archive & {
      accounts: Array<(typeof archive.accounts)[number] & { userId?: string }>;
    };
    malicious.accounts[0].userId = bobId;
    expect(() => restoreUserData(aliceId, malicious)).toThrow();
    expect((await listAccounts(bobId)).map((account) => account.name)).toEqual([
      "Bob Savings",
    ]);
  });

  test("a disposable singleton database is preserved through one signup claim", async () => {
    closeDatabase();
    createLegacyDatabase(legacyDatabase);
    migrateDatabase(legacyDatabase);
    useDatabase(legacyDatabase);

    const db = getDatabase();
    expect(db.select().from(users).all()).toHaveLength(0);
    expect(db.select().from(legacyClaims).all()).toHaveLength(1);
    expect(db.select().from(accounts).where(isNull(accounts.userId)).all()).toHaveLength(1);
    expect(db.select().from(transactions).all()).toHaveLength(1);
    expect(db.select().from(valuationSnapshots).all()).toHaveLength(1);
    expect(db.select().from(goals).get()?.linkedAccountId).toBe("legacy-account");
    expect(db.select().from(goalContributionPlans).all()).toHaveLength(1);

    await expect(
      registerUser({
        username: "legacy-owner",
        displayName: "Legacy Owner",
        password: "new-legacy-password-123",
        legacyPassword: "wrong-legacy-password",
      }),
    ).rejects.toThrow("could not be verified");

    const owner = await registerUser({
      username: "legacy-owner",
      displayName: "Legacy Owner",
      password: "new-legacy-password-123",
      legacyPassword: "legacy-password-123",
    });
    expect(db.select().from(legacyClaims).all()).toHaveLength(0);
    expect(
      db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, owner.userId))
        .get()?.name,
    ).toBe("Legacy Savings");
    expect(db.select().from(accounts).where(isNull(accounts.userId)).all()).toHaveLength(0);
    expect(
      db.select().from(transactions).where(eq(transactions.userId, owner.userId)).all(),
    ).toHaveLength(1);
    expect(
      db
        .select()
        .from(valuationSnapshots)
        .where(eq(valuationSnapshots.userId, owner.userId))
        .all(),
    ).toHaveLength(1);
    expect(
      db.select().from(goals).where(eq(goals.userId, owner.userId)).get()
        ?.linkedAccountId,
    ).toBe("legacy-account");
    expect(
      db
        .select()
        .from(goalContributionPlans)
        .where(eq(goalContributionPlans.userId, owner.userId))
        .all(),
    ).toHaveLength(1);
    expect(
      db.select().from(userSettings).where(eq(userSettings.userId, owner.userId)).all(),
    ).toHaveLength(1);
    expect(
      db.select().from(categories).where(eq(categories.userId, owner.userId)).all(),
    ).toHaveLength(11);

    await registerUser({
      username: "later-user",
      displayName: "Later User",
      password: "later-user-password-123",
    });
    expect(db.select().from(users).all()).toHaveLength(2);
  });
});
