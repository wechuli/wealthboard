import "dotenv/config";

import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";

import {
  accounts,
  categories,
  exchangeRates,
  goalContributionPlans,
  goals,
  transactions,
  userSettings,
} from "../db/schema";
import { CATEGORY_SEEDS } from "../lib/constants";

if (process.env.DEMO_DATA !== "true") {
  throw new Error("Demo seeding is disabled. Set DEMO_DATA=true to opt in.");
}

const password = process.env.INITIAL_ADMIN_PASSWORD;
if (!password || password.length < 10) {
  throw new Error("Set INITIAL_ADMIN_PASSWORD to at least 10 characters.");
}

const databasePath = path.resolve(process.env.DATABASE_PATH ?? "./data/worthboard.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite);
const timestamp = new Date().toISOString();

if (!db.select().from(userSettings).limit(1).get()) {
  db.insert(userSettings)
    .values({
      id: "single-user",
      displayName: "Demo Owner",
      passwordHash: await bcrypt.hash(password, 12),
      baseCurrency: "KES",
      supportedCurrencies: '["KES","USD"]',
      timezone: process.env.TZ || "Africa/Nairobi",
      preferredDateFormat: "dd MMM yyyy",
      appName: "Worthboard",
      defaultDashboardPeriod: "1y",
      sessionTimeoutMinutes: 10080,
      sessionVersion: 1,
      defaultGoalReturnBps: 800,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

for (const [name, slug, icon, assetOrLiability, isLiquid, isInvestible] of CATEGORY_SEEDS) {
  db.insert(categories)
    .values({
      id: `category-${slug}`,
      name,
      slug,
      icon,
      displayOrder: CATEGORY_SEEDS.findIndex((item) => item[1] === slug),
      assetOrLiability,
      isLiquid,
      isInvestible,
      isArchived: false,
      isSystem: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();
}

db.insert(exchangeRates)
  .values({
    id: crypto.randomUUID(),
    baseCurrency: "USD",
    quoteCurrency: "KES",
    rate: "130",
    effectiveDate: "2025-01-01T12:00:00.000Z",
    source: "demo",
    createdAt: timestamp,
  })
  .onConflictDoNothing()
  .run();

const demoAccounts = [
  ["Zimele Fixed Income Fund", "fixed-income", "KES", 457_691_800, "Zimele"],
  ["Madison Money Market Fund", "money-market-fund", "KES", 139_600_000, "Madison"],
  ["KCB Car Fund", "money-market-fund", "KES", 11_961_700, "KCB"],
  ["Interactive Brokers VWRA", "securities", "USD", 411_100, "Interactive Brokers"],
  ["Southern Bypass Land", "land-real-estate", "KES", 500_000_000, null],
  ["Honda Fit", "vehicle", "KES", 75_000_000, null],
] as const;

const accountIds = new Map<string, string>();
for (const [name, categorySlug, currency, value, institution] of demoAccounts) {
  const existing = db.select().from(accounts).where(eq(accounts.name, name)).get();
  if (existing) {
    accountIds.set(name, existing.id);
    continue;
  }
  const id = crypto.randomUUID();
  const category = db
    .select()
    .from(categories)
    .where(eq(categories.slug, categorySlug))
    .get();
  if (!category) throw new Error(`Missing demo category ${categorySlug}.`);
  db.insert(accounts)
    .values({
      id,
      name,
      categoryId: category.id,
      institution,
      currency,
      currentValueMinor: value,
      isLiability: false,
      isIncludedInNetWorth: true,
      openedAt: "2025-01-01T12:00:00.000Z",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  db.insert(transactions)
    .values({
      id: crypto.randomUUID(),
      accountId: id,
      type: "opening_balance",
      amountMinor: value,
      currency,
      transactionDate: "2025-01-01T12:00:00.000Z",
      description: "Fictional demo opening balance",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  accountIds.set(name, id);
}

if (!db.select().from(goals).where(eq(goals.name, "2028 Family Car")).get()) {
  const goalId = crypto.randomUUID();
  const carFund = accountIds.get("KCB Car Fund");
  db.insert(goals)
    .values({
      id: goalId,
      name: "2028 Family Car",
      description: "Fictional demonstration goal",
      targetAmountMinor: 325_000_000,
      currentAmountMinor: 0,
      currency: "KES",
      targetDate: "2028-07-01T12:00:00.000Z",
      linkedAccountId: carFund,
      icon: "Target",
      status: "active",
      priority: 1,
      assumedAnnualReturnBps: 800,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  db.insert(goalContributionPlans)
    .values({
      id: crypto.randomUUID(),
      goalId,
      plannedContributionMinor: 12_000_000,
      frequency: "monthly",
      startDate: "2026-01-01T12:00:00.000Z",
      endDate: "2028-07-01T12:00:00.000Z",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  if (carFund) {
    db.update(accounts)
      .set({ goalId, updatedAt: timestamp })
      .where(eq(accounts.id, carFund))
      .run();
  }
}

sqlite.close();
console.log("Fictional Worthboard demo data seeded.");
