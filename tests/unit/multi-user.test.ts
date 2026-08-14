// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { accounts, categories, exchangeRates, users } from "@/db/schema";
import {
  authenticateUser,
  changeUserPassword,
  registerUser,
} from "@/lib/auth/users";
import { getSettings } from "@/lib/bootstrap";
import {
  DEFAULT_ENABLED_CURRENCIES,
  parseEnabledCurrencies,
} from "@/lib/currencies";
import { closeDatabase, getDatabase } from "@/lib/db";
import { requiredMonthlyContribution } from "@/lib/finance";
import {
  createAccount,
  getAccount,
  listAccounts,
  recordTransaction,
} from "@/lib/services/accounts";
import { getDashboardData } from "@/lib/services/analytics";
import {
  createGoal,
  createGoalMilestone,
  deleteGoalMilestone,
  dismissGoalAlert,
  getGoal,
  listGoalAlerts,
  listGoalMilestones,
  listGoals,
} from "@/lib/services/goals";
import { exportData, restoreUserData } from "@/lib/services/portability";
import { previewAccountHistory } from "@/lib/services/account-history-import";
import {
  addExchangeRate,
  listExchangeRates,
  updateSettings,
} from "@/lib/services/settings";
import { recordTransfer } from "@/lib/services/transfers";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-multi-user-"),
);
const freshDatabase = path.join(workspace, "fresh.db");

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

async function setCurrencies(
  userId: string,
  baseCurrency: string,
  supportedCurrencies: string[],
) {
  const settings = await getSettings(userId);
  updateSettings(userId, {
    displayName: settings.displayName,
    appName: settings.appName,
    baseCurrency,
    supportedCurrencies,
    timezone: settings.timezone,
    preferredDateFormat: settings.preferredDateFormat,
    defaultDashboardPeriod: settings.defaultDashboardPeriod,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    defaultGoalReturnBps: settings.defaultGoalReturnBps,
  });
}

describe.sequential("multi-user persistence and isolation", () => {
  let aliceId = "";
  let bobId = "";
  let aliceCategoryId = "";
  let bobCategoryId = "";
  let aliceAccountId = "";
  let bobAccountId = "";

  beforeAll(() => {
    process.env.SESSION_SECRET =
      "unit-test-session-secret-longer-than-32-characters";
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
    const regional = await registerUser({
      username: "regional-user",
      displayName: "Regional Example",
      password: "regional-password-12345",
      baseCurrency: "TZS",
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
    ).toHaveLength(0);
    const regionalArchive = await exportData(regional.userId);
    expect(regionalArchive.exchangeRates).toEqual([]);
    restoreUserData(regional.userId, regionalArchive);
    expect((await getSettings(regional.userId)).baseCurrency).toBe("TZS");
    const aliceSettings = await getSettings(aliceId);
    expect(aliceSettings.displayName).toBe("Alice Example");
    expect(aliceSettings.baseCurrency).toBe("KES");
    expect(parseEnabledCurrencies(aliceSettings.supportedCurrencies)).toEqual(
      DEFAULT_ENABLED_CURRENCIES,
    );
    expect((await getSettings(bobId)).displayName).toBe("Bob Example");
    const regionalSettings = await getSettings(regional.userId);
    expect(regionalSettings.baseCurrency).toBe("TZS");
    expect(
      parseEnabledCurrencies(regionalSettings.supportedCurrencies),
    ).toEqual(DEFAULT_ENABLED_CURRENCIES);
    expect(
      db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.userId, regional.userId))
        .all(),
    ).toHaveLength(0);
  });

  test("login failures do not distinguish unknown users from bad passwords", async () => {
    await expect(
      authenticateUser("alice", "wrong-password"),
    ).resolves.toBeNull();
    await expect(
      authenticateUser("unknown", "wrong-password"),
    ).resolves.toBeNull();
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
      .where(
        and(eq(categories.userId, aliceId), eq(categories.slug, "savings")),
      )
      .get()!.id;
    bobCategoryId = db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, bobId), eq(categories.slug, "savings")))
      .get()!.id;

    expect(() =>
      createAccount(aliceId, {
        name: "Disabled currency account",
        categoryId: aliceCategoryId,
        currency: "EUR",
        openingValue: "1",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("EUR is not enabled");
    expect(() =>
      createAccount(aliceId, {
        name: "Invalid currency account",
        categoryId: aliceCategoryId,
        currency: "ZZZ",
        openingValue: "1",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("valid currency");
    expect(() =>
      createGoal(aliceId, {
        name: "Disabled currency goal",
        targetAmount: "1000",
        currency: "EUR",
        targetDate: "2028-07-01",
        icon: "Target",
        status: "active",
        priority: 1,
        assumedAnnualReturn: 8,
        plannedContribution: "10",
        frequency: "monthly",
        planStartDate: "2026-01-01",
      }),
    ).toThrow("EUR is not enabled");
    expect(() =>
      addExchangeRate(aliceId, {
        baseCurrency: "EUR",
        quoteCurrency: "KES",
        rate: "150",
        effectiveDate: "2025-01-01",
      }),
    ).toThrow("EUR is not enabled");

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

    const planStartDate = new Date().toISOString().slice(0, 10);
    const target = new Date(`${planStartDate}T12:00:00.000Z`);
    target.setUTCFullYear(target.getUTCFullYear() + 1);
    const rateAwareGoalId = createGoal(aliceId, {
      name: "Rate-aware goal",
      targetAmount: "2200",
      currentAmount: "1000",
      currency: "KES",
      targetDate: target.toISOString().slice(0, 10),
      icon: "Target",
      status: "active",
      priority: 1,
      assumedAnnualReturn: 12,
      plannedContribution: "0",
      frequency: "monthly",
      planStartDate,
    });
    const rateAwareGoal = await getGoal(aliceId, rateAwareGoalId);
    expect(rateAwareGoal).toBeDefined();
    expect(await getGoal(bobId, rateAwareGoalId)).toBeUndefined();
    expect(rateAwareGoal!.requiredMonthly).toBeLessThan(
      requiredMonthlyContribution(
        rateAwareGoal!.currentAmountCalculated,
        rateAwareGoal!.targetAmountMinor,
        new Date(rateAwareGoal!.targetDate),
        0,
      ),
    );

    const alertRegressionNow = new Date("2026-08-03T20:00:00.000Z");
    const alertRegressionGoalId = createGoal(aliceId, {
      name: "Interest-aware alert regression",
      targetAmount: "4000000",
      currentAmount: "300000",
      currency: "KES",
      targetDate: "2028-08-03",
      icon: "Target",
      status: "active",
      priority: 1,
      assumedAnnualReturn: 8,
      plannedContribution: "142000",
      frequency: "monthly",
      planStartDate: "2026-08-03",
      planEndDate: "2028-08-03",
    });
    const alertRegressionGoal = await getGoal(
      aliceId,
      alertRegressionGoalId,
      alertRegressionNow,
    );
    expect(alertRegressionGoal).toMatchObject({
      requiredMonthly: 14_067_432n,
      currentPlannedMonthly: 14_200_000n,
    });
    expect(alertRegressionGoal!.tracking).not.toBe("behind");
    expect(
      (await listGoalAlerts(aliceId, alertRegressionNow)).map(
        (alert) => alert.goalId,
      ),
    ).not.toContain(alertRegressionGoalId);

    const reachedMilestoneId = createGoalMilestone(aliceId, rateAwareGoalId, {
      name: "First checkpoint",
      targetAmount: "500",
      targetDate: planStartDate,
    });
    const overdueDate = new Date(`${planStartDate}T12:00:00.000Z`);
    overdueDate.setUTCDate(overdueDate.getUTCDate() - 1);
    createGoalMilestone(aliceId, rateAwareGoalId, {
      name: "Overdue checkpoint",
      targetAmount: "1500",
      targetDate: overdueDate.toISOString().slice(0, 10),
    });
    createGoalMilestone(aliceId, rateAwareGoalId, {
      name: "Final checkpoint",
      targetAmount: "1800",
      targetDate: target.toISOString().slice(0, 10),
    });
    expect(() =>
      createGoalMilestone(bobId, rateAwareGoalId, {
        name: "Foreign checkpoint",
        targetAmount: "100",
      }),
    ).toThrow("Goal not found");
    expect(await listGoalMilestones(bobId, rateAwareGoalId)).toEqual([]);

    const milestoneNow = new Date(`${planStartDate}T23:59:59.999Z`);
    const milestones = await listGoalMilestones(
      aliceId,
      rateAwareGoalId,
      milestoneNow,
    );
    expect(
      milestones.map((milestone) => ({
        name: milestone.name,
        status: milestone.status,
        progress: milestone.progressPercent,
      })),
    ).toEqual([
      { name: "First checkpoint", status: "reached", progress: "100" },
      { name: "Overdue checkpoint", status: "overdue", progress: "66.7" },
      { name: "Final checkpoint", status: "upcoming", progress: "55.6" },
    ]);
    expect(() =>
      deleteGoalMilestone(bobId, rateAwareGoalId, reachedMilestoneId),
    ).toThrow("Milestone not found");
    deleteGoalMilestone(aliceId, rateAwareGoalId, reachedMilestoneId);
    expect(
      await listGoalMilestones(aliceId, rateAwareGoalId, milestoneNow),
    ).toHaveLength(2);

    const alertNow = new Date(`${planStartDate}T12:00:00.000Z`);
    expect(
      (await listGoalAlerts(aliceId, alertNow)).map((alert) => alert.goalId),
    ).toContain(rateAwareGoalId);
    expect(await listGoalAlerts(bobId, alertNow)).toEqual([]);
    expect(() => dismissGoalAlert(bobId, rateAwareGoalId, alertNow)).toThrow(
      "Goal not found",
    );
    dismissGoalAlert(aliceId, rateAwareGoalId, alertNow);
    expect(
      (await listGoalAlerts(aliceId, alertNow)).map((alert) => alert.goalId),
    ).not.toContain(rateAwareGoalId);
    const nextMonth = new Date(alertNow);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    expect(
      (await listGoalAlerts(aliceId, nextMonth)).map((alert) => alert.goalId),
    ).toContain(rateAwareGoalId);

    expect(() =>
      previewAccountHistory(
        bobId,
        aliceAccountId,
        "external_id,type,amount,date,description,notes\nforeign-1,deposit,10,2025-02-01,,",
        "csv",
      ),
    ).toThrow("Account not found");

    const [aliceDashboard, bobDashboard] = await Promise.all([
      getDashboardData(aliceId),
      getDashboardData(bobId),
    ]);
    expect(aliceDashboard.totals.netWorth).toBe(10000n);
    expect(bobDashboard.totals.netWorth).toBe(20000n);
    expect(aliceDashboard.accountCount).toBe(1);
    expect(bobDashboard.accountCount).toBe(1);

    await setCurrencies(aliceId, "KES", [...DEFAULT_ENABLED_CURRENCIES, "EUR"]);
    expect(() =>
      addExchangeRate(bobId, {
        baseCurrency: "EUR",
        quoteCurrency: "KES",
        rate: "160",
        effectiveDate: "2025-01-01",
      }),
    ).toThrow("EUR is not enabled");
    await setCurrencies(bobId, "KES", [...DEFAULT_ENABLED_CURRENCIES, "EUR"]);
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

    await setCurrencies(aliceId, "USD", ["KES", "EUR", "TZS", "UGX"]);
    const updatedAliceSettings = await getSettings(aliceId);
    expect(updatedAliceSettings.baseCurrency).toBe("USD");
    expect(
      parseEnabledCurrencies(updatedAliceSettings.supportedCurrencies),
    ).toEqual(["KES", "EUR", "TZS", "UGX", "USD"]);
    expect((await getSettings(bobId)).baseCurrency).toBe("KES");
    await expect(
      setCurrencies(aliceId, "USD", ["USD", "EUR", "TZS", "UGX"]),
    ).rejects.toThrow("still in use: KES");

    const incompleteDashboard = await getDashboardData(aliceId);
    expect(incompleteDashboard.historyComplete).toBe(false);
    expect(incompleteDashboard.historicalMissingRates).toContain("KES");
    expect(incompleteDashboard.missingRates).toContain("KES");
    expect(incompleteDashboard.totals.netWorth).toBe(0n);

    addExchangeRate(aliceId, {
      baseCurrency: "USD",
      quoteCurrency: "KES",
      rate: "130",
      effectiveDate: "2025-01-01",
    });

    const aliceAccount = await getAccount(aliceId, aliceAccountId);
    expect(aliceAccount).toMatchObject({
      currency: "KES",
      currentValueMinor: 10_000,
    });
    const completeDashboard = await getDashboardData(aliceId);
    expect(completeDashboard.historyComplete).toBe(true);
    expect(completeDashboard.historicalMissingRates).toEqual([]);
    expect(completeDashboard.totals.netWorth).toBe(77n);
    expect((await getDashboardData(bobId)).totals.netWorth).toBe(20_000n);
  });

  test("exports, restores, and imported owner fields cannot cross users", async () => {
    const archive = await exportData(aliceId);
    expect(archive.version).toBe(8);
    expect(archive.goalMilestones).toHaveLength(2);
    expect(archive.goalAlertDismissals).toHaveLength(1);
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
    const restoredSettings = await getSettings(aliceId);
    expect(restoredSettings.baseCurrency).toBe("USD");
    expect(
      parseEnabledCurrencies(restoredSettings.supportedCurrencies),
    ).toEqual(expect.arrayContaining(["USD", "KES", "TZS", "UGX", "EUR"]));
    expect(
      (await listAccounts(aliceId)).map((account) => account.name),
    ).toEqual(["Alice Savings"]);
    expect((await listAccounts(bobId)).map((account) => account.name)).toEqual([
      "Bob Savings",
    ]);
    const restoredGoal = (await listGoals(aliceId)).find(
      (goal) => goal.name === "Rate-aware goal",
    );
    expect(restoredGoal).toBeDefined();
    expect(
      (await listGoalMilestones(aliceId, restoredGoal!.id)).map(
        (milestone) => milestone.name,
      ),
    ).toEqual(["Overdue checkpoint", "Final checkpoint"]);
    expect(
      (await listGoalAlerts(aliceId)).map((alert) => alert.goalId),
    ).not.toContain(restoredGoal!.id);

    const versionTwoArchive = structuredClone(archive) as Record<
      string,
      unknown
    > & {
      accounts: Array<Record<string, unknown>>;
      transactions: Array<Record<string, unknown>>;
      settings: Record<string, unknown>;
    };
    versionTwoArchive.version = 2;
    delete versionTwoArchive.accountConversions;
    delete versionTwoArchive.settings.positionStaleDaysStock;
    delete versionTwoArchive.settings.positionStaleDaysEtf;
    delete versionTwoArchive.settings.positionStaleDaysFund;
    delete versionTwoArchive.investmentInstruments;
    delete versionTwoArchive.positionEvents;
    delete versionTwoArchive.securityPrices;
    delete versionTwoArchive.positionReconciliations;
    delete versionTwoArchive.institutions;
    delete versionTwoArchive.goalMilestones;
    delete versionTwoArchive.goalAlertDismissals;
    delete versionTwoArchive.beneficiaries;
    delete versionTwoArchive.estatePlans;
    delete versionTwoArchive.estateAccountDirectives;
    delete versionTwoArchive.estateAllocations;
    delete versionTwoArchive.estateResiduaryAllocations;
    delete versionTwoArchive.estatePlanSnapshots;
    versionTwoArchive.accounts = versionTwoArchive.accounts.map((account) => {
      const legacyAccount = { ...account };
      delete legacyAccount.institutionId;
      delete legacyAccount.trackingMode;
      return { ...legacyAccount, institution: null };
    });
    versionTwoArchive.transactions = versionTwoArchive.transactions.map(
      (transaction) => {
        const legacyTransaction = { ...transaction };
        delete legacyTransaction.externalId;
        delete legacyTransaction.eventGroupId;
        return legacyTransaction;
      },
    );
    restoreUserData(aliceId, versionTwoArchive);
    const legacyRestoredGoal = (await listGoals(aliceId)).find(
      (goal) => goal.name === "Rate-aware goal",
    );
    expect(legacyRestoredGoal).toBeDefined();
    expect(await listGoalMilestones(aliceId, legacyRestoredGoal!.id)).toEqual(
      [],
    );

    const malicious = structuredClone(archive) as typeof archive & {
      accounts: Array<(typeof archive.accounts)[number] & { userId?: string }>;
    };
    malicious.accounts[0].userId = bobId;
    expect(() => restoreUserData(aliceId, malicious)).toThrow();
    expect((await listAccounts(bobId)).map((account) => account.name)).toEqual([
      "Bob Savings",
    ]);
  });
});
