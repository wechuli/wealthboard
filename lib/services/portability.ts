import "server-only";

import { and, eq } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { z } from "zod";

import {
  accounts,
  categories,
  contributionFrequencies,
  exchangeRates,
  goalContributionPlans,
  goals,
  goalStatuses,
  idempotencyKeys,
  transactions,
  transactionTypes,
  userSettings,
  valuationSnapshots,
  type TransactionType,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { parseMoney } from "@/lib/money";
import { recalculateAccountBalance } from "@/lib/services/accounts";

const safeInteger = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const nullableText = z.string().max(2000).nullable();
const timestamp = z.string().datetime({ offset: true });

const settingsArchiveSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    supportedCurrencies: z.string().max(1000),
    timezone: z.string().min(1).max(80),
    preferredDateFormat: z.string().min(1).max(40),
    appName: z.string().min(1).max(80),
    defaultDashboardPeriod: z.string().min(1).max(20),
    sessionTimeoutMinutes: z.number().int().min(15).max(525600),
    defaultGoalReturnBps: z.number().int().min(0).max(10000),
  })
  .strict();

const categoryArchiveSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    slug: z.string().min(1).max(100),
    icon: z.string().min(1).max(50),
    displayOrder: z.number().int(),
    assetOrLiability: z.enum(["asset", "liability"]),
    description: nullableText,
    isLiquid: z.boolean(),
    isInvestible: z.boolean(),
    isArchived: z.boolean(),
    isSystem: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const accountArchiveSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    description: nullableText,
    categoryId: z.string().min(1),
    institution: z.string().max(100).nullable(),
    accountReference: z.string().max(50).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    currentValueMinor: safeInteger,
    costBasisMinor: safeInteger.nullable(),
    isLiability: z.boolean(),
    isIncludedInNetWorth: z.boolean(),
    goalId: z.string().nullable(),
    notes: nullableText,
    openedAt: timestamp.nullable(),
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const transactionArchiveSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    type: z.enum(transactionTypes),
    amountMinor: safeInteger,
    currency: z.string().regex(/^[A-Z]{3}$/),
    transactionDate: timestamp,
    description: z.string().max(200).nullable(),
    notes: nullableText,
    transferGroupId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const valuationArchiveSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    valueMinor: safeInteger,
    currency: z.string().regex(/^[A-Z]{3}$/),
    valuationDate: timestamp,
    notes: nullableText,
    createdAt: timestamp,
  })
  .strict();

const exchangeRateArchiveSchema = z
  .object({
    id: z.string().min(1),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    quoteCurrency: z.string().regex(/^[A-Z]{3}$/),
    rate: z.string().regex(/^\d+(?:\.\d+)?$/),
    effectiveDate: timestamp,
    source: z.string().min(1).max(100),
    createdAt: timestamp,
  })
  .strict();

const goalArchiveSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    description: nullableText,
    targetAmountMinor: safeInteger,
    currentAmountMinor: safeInteger,
    currency: z.string().regex(/^[A-Z]{3}$/),
    targetDate: timestamp,
    linkedAccountId: z.string().nullable(),
    icon: z.string().min(1).max(50),
    status: z.enum(goalStatuses),
    priority: z.number().int().min(0).max(100),
    assumedAnnualReturnBps: z.number().int().min(0).max(10000),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const planArchiveSchema = z
  .object({
    id: z.string().min(1),
    goalId: z.string().min(1),
    plannedContributionMinor: safeInteger,
    frequency: z.enum(contributionFrequencies),
    startDate: timestamp,
    endDate: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const userArchiveSchema = z
  .object({
    format: z.literal("worthboard-user-json"),
    version: z.literal(2),
    exportedAt: timestamp,
    settings: settingsArchiveSchema,
    categories: z.array(categoryArchiveSchema).min(1).max(1000),
    accounts: z.array(accountArchiveSchema).max(10000),
    transactions: z.array(transactionArchiveSchema).max(100000),
    valuations: z.array(valuationArchiveSchema).max(100000),
    exchangeRates: z.array(exchangeRateArchiveSchema).min(1).max(10000),
    goals: z.array(goalArchiveSchema).max(10000),
    goalContributionPlans: z.array(planArchiveSchema).max(10000),
  })
  .strict();

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

function stripOwner<T extends { userId: unknown }>(row: T): Omit<T, "userId"> {
  const result: Partial<T> = { ...row };
  delete result.userId;
  return result as Omit<T, "userId">;
}

export async function exportData(userId: string) {
  const db = getDatabase();
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (!settings) throw new Error("User settings are unavailable.");

  const [
    categoryRows,
    accountRows,
    transactionRows,
    valuationRows,
    rateRows,
    goalRows,
    planRows,
  ] = await Promise.all([
    db.select().from(categories).where(eq(categories.userId, userId)),
    db.select().from(accounts).where(eq(accounts.userId, userId)),
    db.select().from(transactions).where(eq(transactions.userId, userId)),
    db
      .select()
      .from(valuationSnapshots)
      .where(eq(valuationSnapshots.userId, userId)),
    db.select().from(exchangeRates).where(eq(exchangeRates.userId, userId)),
    db.select().from(goals).where(eq(goals.userId, userId)),
    db
      .select()
      .from(goalContributionPlans)
      .where(eq(goalContributionPlans.userId, userId)),
  ]);

  return {
    format: "worthboard-user-json" as const,
    version: 2 as const,
    exportedAt: nowIso(),
    settings: {
      displayName: settings.displayName,
      baseCurrency: settings.baseCurrency,
      supportedCurrencies: settings.supportedCurrencies,
      timezone: settings.timezone,
      preferredDateFormat: settings.preferredDateFormat,
      appName: settings.appName,
      defaultDashboardPeriod: settings.defaultDashboardPeriod,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      defaultGoalReturnBps: settings.defaultGoalReturnBps,
    },
    categories: categoryRows.map(stripOwner),
    accounts: accountRows.map(stripOwner),
    transactions: transactionRows.map(stripOwner),
    valuations: valuationRows.map(stripOwner),
    exchangeRates: rateRows.map(stripOwner),
    goals: goalRows.map(stripOwner),
    goalContributionPlans: planRows.map(stripOwner),
  };
}

function uniqueIdMap(rows: Array<{ id: string }>, label: string) {
  const result = new Map<string, string>();
  for (const row of rows) {
    if (result.has(row.id)) throw new Error(`The archive contains duplicate ${label} IDs.`);
    result.set(row.id, crypto.randomUUID());
  }
  return result;
}

function requiredMappedId(
  mapping: Map<string, string>,
  sourceId: string,
  relationship: string,
) {
  const id = mapping.get(sourceId);
  if (!id) throw new Error(`The archive contains an invalid ${relationship} relationship.`);
  return id;
}

export function restoreUserData(userId: string, input: unknown) {
  const archive = userArchiveSchema.parse(input);
  const categoryIds = uniqueIdMap(archive.categories, "category");
  const accountIds = uniqueIdMap(archive.accounts, "account");
  const transactionIds = uniqueIdMap(archive.transactions, "transaction");
  const valuationIds = uniqueIdMap(archive.valuations, "valuation");
  const rateIds = uniqueIdMap(archive.exchangeRates, "exchange-rate");
  const goalIds = uniqueIdMap(archive.goals, "goal");
  const planIds = uniqueIdMap(archive.goalContributionPlans, "contribution-plan");

  for (const account of archive.accounts) {
    requiredMappedId(categoryIds, account.categoryId, "account category");
    if (account.goalId) requiredMappedId(goalIds, account.goalId, "account goal");
  }
  for (const transaction of archive.transactions) {
    requiredMappedId(accountIds, transaction.accountId, "transaction account");
  }
  for (const valuation of archive.valuations) {
    requiredMappedId(accountIds, valuation.accountId, "valuation account");
  }
  const linkedAccounts = new Set<string>();
  for (const goal of archive.goals) {
    if (!goal.linkedAccountId) continue;
    requiredMappedId(accountIds, goal.linkedAccountId, "goal account");
    if (linkedAccounts.has(goal.linkedAccountId)) {
      throw new Error("The archive links more than one goal to the same account.");
    }
    linkedAccounts.add(goal.linkedAccountId);
  }
  for (const plan of archive.goalContributionPlans) {
    requiredMappedId(goalIds, plan.goalId, "contribution-plan goal");
  }

  const db = getDatabase();
  db.transaction((tx) => {
    const existingSettings = tx.query.userSettings
      .findFirst({ where: eq(userSettings.userId, userId), columns: { id: true } })
      .sync();
    if (!existingSettings) throw new Error("User settings are unavailable.");

    tx.delete(goalContributionPlans)
      .where(eq(goalContributionPlans.userId, userId))
      .run();
    tx.delete(goals).where(eq(goals.userId, userId)).run();
    tx.delete(transactions).where(eq(transactions.userId, userId)).run();
    tx.delete(valuationSnapshots)
      .where(eq(valuationSnapshots.userId, userId))
      .run();
    tx.delete(accounts).where(eq(accounts.userId, userId)).run();
    tx.delete(categories).where(eq(categories.userId, userId)).run();
    tx.delete(exchangeRates).where(eq(exchangeRates.userId, userId)).run();
    tx.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId)).run();

    tx.update(userSettings)
      .set({ ...archive.settings, updatedAt: nowIso() })
      .where(eq(userSettings.userId, userId))
      .run();
    tx.insert(categories)
      .values(
        archive.categories.map((row) => ({
          ...row,
          id: requiredMappedId(categoryIds, row.id, "category"),
          userId,
        })),
      )
      .run();
    if (archive.accounts.length) {
      tx.insert(accounts)
        .values(
          archive.accounts.map((row) => ({
            ...row,
            id: requiredMappedId(accountIds, row.id, "account"),
            userId,
            categoryId: requiredMappedId(
              categoryIds,
              row.categoryId,
              "account category",
            ),
            goalId: row.goalId
              ? requiredMappedId(goalIds, row.goalId, "account goal")
              : null,
          })),
        )
        .run();
    }
    if (archive.goals.length) {
      tx.insert(goals)
        .values(
          archive.goals.map((row) => ({
            ...row,
            id: requiredMappedId(goalIds, row.id, "goal"),
            userId,
            linkedAccountId: row.linkedAccountId
              ? requiredMappedId(accountIds, row.linkedAccountId, "goal account")
              : null,
          })),
        )
        .run();
    }
    if (archive.transactions.length) {
      tx.insert(transactions)
        .values(
          archive.transactions.map((row) => ({
            ...row,
            id: requiredMappedId(transactionIds, row.id, "transaction"),
            userId,
            accountId: requiredMappedId(
              accountIds,
              row.accountId,
              "transaction account",
            ),
          })),
        )
        .run();
    }
    if (archive.valuations.length) {
      tx.insert(valuationSnapshots)
        .values(
          archive.valuations.map((row) => ({
            ...row,
            id: requiredMappedId(valuationIds, row.id, "valuation"),
            userId,
            accountId: requiredMappedId(
              accountIds,
              row.accountId,
              "valuation account",
            ),
          })),
        )
        .run();
    }
    tx.insert(exchangeRates)
      .values(
        archive.exchangeRates.map((row) => ({
          ...row,
          id: requiredMappedId(rateIds, row.id, "exchange rate"),
          userId,
        })),
      )
      .run();
    if (archive.goalContributionPlans.length) {
      tx.insert(goalContributionPlans)
        .values(
          archive.goalContributionPlans.map((row) => ({
            ...row,
            id: requiredMappedId(planIds, row.id, "contribution plan"),
            userId,
            goalId: requiredMappedId(goalIds, row.goalId, "contribution-plan goal"),
          })),
        )
        .run();
    }
  });

  return {
    accounts: archive.accounts.length,
    transactions: archive.transactions.length,
    goals: archive.goals.length,
  };
}

type CsvTransaction = {
  account_id?: string;
  account_name?: string;
  type?: string;
  amount?: string;
  currency?: string;
  date?: string;
  description?: string;
  notes?: string;
};

export function importTransactionsCsv(userId: string, content: string) {
  const parsed = parse(content, {
    columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as CsvTransaction[];
  if (!parsed.length) throw new Error("The CSV contains no transaction rows.");
  if (parsed.length > 10_000) throw new Error("Import is limited to 10,000 rows at a time.");

  const db = getDatabase();
  const accountRows = db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .all();
  const timezone =
    db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) }).sync()
      ?.timezone ??
    process.env.TZ ??
    "Africa/Nairobi";
  const prepared = parsed.map((row, index) => {
    const matchingNames = row.account_name
      ? accountRows.filter(
          (item) => item.name.toLowerCase() === row.account_name?.toLowerCase(),
        )
      : [];
    if (!row.account_id && matchingNames.length > 1) {
      throw new Error(
        `Row ${index + 2}: account name is ambiguous; provide account_id.`,
      );
    }
    const account = row.account_id
      ? accountRows.find((item) => item.id === row.account_id)
      : matchingNames[0];
    if (!account) throw new Error(`Row ${index + 2}: account was not found.`);
    if (!row.type || !transactionTypes.includes(row.type as TransactionType)) {
      throw new Error(`Row ${index + 2}: unsupported transaction type.`);
    }
    if (row.type === "opening_balance" || row.type === "transfer") {
      throw new Error(`Row ${index + 2}: opening balances and transfers cannot be imported.`);
    }
    if (!row.date) throw new Error(`Row ${index + 2}: date is required.`);
    if (row.date > dateInputForTimezone(timezone)) {
      throw new Error(`Row ${index + 2}: financial activity cannot be future-dated.`);
    }
    const currency = (row.currency || account.currency).toUpperCase();
    if (currency !== account.currency) {
      throw new Error(`Row ${index + 2}: currency must match ${account.name}.`);
    }
    const amountMinor = parseMoney(row.amount || "", currency);
    if (row.type !== "manual_adjustment" && amountMinor <= 0) {
      throw new Error(`Row ${index + 2}: amount must be positive.`);
    }
    return {
      account,
      type: row.type as TransactionType,
      amountMinor,
      currency,
      transactionDate: dateInputToUtc(row.date),
      description: row.description,
      notes: row.notes,
    };
  });

  const affected = new Set(prepared.map((row) => row.account.id));
  const createdAt = nowIso();
  db.transaction((tx) => {
    tx.insert(transactions)
      .values(
        prepared.map((row) => ({
          id: crypto.randomUUID(),
          userId,
          accountId: row.account.id,
          type: row.type,
          amountMinor: row.amountMinor,
          currency: row.currency,
          transactionDate: row.transactionDate,
          description: row.description,
          notes: row.notes,
          idempotencyKey: crypto.randomUUID(),
          createdAt,
          updatedAt: createdAt,
        })),
      )
      .run();
    for (const accountId of affected) {
      recalculateAccountBalance(userId, tx, accountId);
    }
  });
  return prepared.length;
}

export async function transactionCsv(userId: string) {
  const rows = await getDatabase()
    .select({
      id: transactions.id,
      account_id: transactions.accountId,
      account_name: accounts.name,
      type: transactions.type,
      amount_minor: transactions.amountMinor,
      currency: transactions.currency,
      date: transactions.transactionDate,
      description: transactions.description,
      notes: transactions.notes,
      transfer_group_id: transactions.transferGroupId,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(
        eq(transactions.userId, accounts.userId),
        eq(transactions.accountId, accounts.id),
      ),
    )
    .where(eq(transactions.userId, userId));
  return toCsv(rows);
}

export async function accountCsv(userId: string) {
  const rows = await getDatabase()
    .select({
      id: accounts.id,
      name: accounts.name,
      category: categories.name,
      institution: accounts.institution,
      currency: accounts.currency,
      current_value_minor: accounts.currentValueMinor,
      cost_basis_minor: accounts.costBasisMinor,
      is_liability: accounts.isLiability,
      included_in_net_worth: accounts.isIncludedInNetWorth,
      archived_at: accounts.archivedAt,
    })
    .from(accounts)
    .innerJoin(
      categories,
      and(eq(accounts.userId, categories.userId), eq(accounts.categoryId, categories.id)),
    )
    .where(eq(accounts.userId, userId));
  return toCsv(rows);
}
