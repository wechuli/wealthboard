import "server-only";

import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  accounts,
  categories,
  contributionFrequencies,
  exchangeRates,
  goalAlertDismissals,
  goalContributionPlans,
  goalMilestones,
  goals,
  goalStatuses,
  idempotencyKeys,
  institutions,
  institutionTypes,
  transactions,
  transactionTypes,
  userSettings,
  valuationSnapshots,
} from "@/db/schema";
import {
  isIsoCurrencyCode,
  normalizeCurrencyCode,
  normalizeEnabledCurrencies,
  parseEnabledCurrencies,
} from "@/lib/currencies";
import {
  isValidTimezone,
  nowIso,
} from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import {
  canonicalizeInstitutionName,
  isHttpUrl,
  normalizeInstitutionName,
} from "@/lib/institutions";
import {
  listTransactionsForExport,
  type TransactionFilters,
} from "@/lib/services/accounts";

const safeInteger = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const nullableText = z.string().max(2000).nullable();
const timestamp = z.string().datetime({ offset: true });
const isoCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isIsoCurrencyCode, "The currency code is invalid.");
const supportedCurrencies = z
  .string()
  .max(1000)
  .refine((value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(
          (currency) =>
            typeof currency === "string" && isIsoCurrencyCode(currency),
        )
      );
    } catch {
      return false;
    }
  }, "The supported currency list is invalid.");
const positiveDecimal = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/)
  .refine(
    (value) => new Decimal(value).gt(0),
    "Exchange rates must be positive.",
  );

const settingsArchiveSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    baseCurrency: isoCurrency,
    supportedCurrencies,
    timezone: z.string().min(1).max(80).refine(isValidTimezone),
    preferredDateFormat: z.string().min(1).max(40),
    appName: z.string().min(1).max(80),
    defaultDashboardPeriod: z.enum(["1m", "3m", "6m", "1y", "all"]),
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

const legacyAccountArchiveSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    description: nullableText,
    categoryId: z.string().min(1),
    institution: z.string().max(100).nullable(),
    accountReference: z.string().max(50).nullable(),
    currency: isoCurrency,
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

const accountArchiveV4Schema = legacyAccountArchiveSchema
  .omit({ institution: true })
  .extend({ institutionId: z.string().min(1).nullable() })
  .strict();

const institutionArchiveSchema = z
  .object({
    id: z.string().min(1),
    name: z
      .string()
      .max(200)
      .transform(canonicalizeInstitutionName)
      .pipe(z.string().min(1).max(100)),
    type: z.enum(institutionTypes),
    websiteUrl: z.string().max(500).refine(isHttpUrl).nullable(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    address: z.string().max(500).nullable(),
    notes: nullableText,
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
    currency: isoCurrency,
    transactionDate: timestamp,
    description: z.string().max(200).nullable(),
    notes: nullableText,
    transferGroupId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const transactionArchiveV5Schema = transactionArchiveSchema
  .extend({ externalId: z.string().min(1).max(200).nullable() })
  .strict();

const valuationArchiveSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    valueMinor: safeInteger,
    currency: isoCurrency,
    valuationDate: timestamp,
    notes: nullableText,
    createdAt: timestamp,
  })
  .strict();

const exchangeRateArchiveSchema = z
  .object({
    id: z.string().min(1),
    baseCurrency: isoCurrency,
    quoteCurrency: isoCurrency,
    rate: positiveDecimal,
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
    currency: isoCurrency,
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

const milestoneArchiveSchema = z
  .object({
    id: z.string().min(1),
    goalId: z.string().min(1),
    name: z.string().min(1).max(100),
    targetAmountMinor: safeInteger,
    targetDate: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const alertDismissalArchiveSchema = z
  .object({
    goalId: z.string().min(1),
    alertKey: z.string().min(1).max(50),
    dismissedAt: timestamp,
  })
  .strict();

const userArchiveV2Schema = z
  .object({
    format: z.literal("wealthboard-user-json"),
    version: z.literal(2),
    exportedAt: timestamp,
    settings: settingsArchiveSchema,
    categories: z.array(categoryArchiveSchema).min(1).max(1000),
    accounts: z.array(legacyAccountArchiveSchema).max(10000),
    transactions: z.array(transactionArchiveSchema).max(100000),
    valuations: z.array(valuationArchiveSchema).max(100000),
    exchangeRates: z.array(exchangeRateArchiveSchema).max(10000),
    goals: z.array(goalArchiveSchema).max(10000),
    goalContributionPlans: z.array(planArchiveSchema).max(10000),
  })
  .strict();

const userArchiveV3Schema = userArchiveV2Schema
  .extend({
    version: z.literal(3),
    goalMilestones: z.array(milestoneArchiveSchema).max(10000),
    goalAlertDismissals: z.array(alertDismissalArchiveSchema).max(10000),
  })
  .strict();

const userArchiveV4Schema = userArchiveV3Schema
  .extend({
    version: z.literal(4),
    institutions: z.array(institutionArchiveSchema).max(10000),
    accounts: z.array(accountArchiveV4Schema).max(10000),
  })
  .strict();

const userArchiveV5Schema = userArchiveV4Schema
  .extend({
    version: z.literal(5),
    transactions: z.array(transactionArchiveV5Schema).max(100000),
  })
  .strict();

function upgradeLegacyArchive(
  archive: z.infer<typeof userArchiveV2Schema | typeof userArchiveV3Schema>,
) {
  const source =
    archive.version === 3
      ? archive
      : {
          ...archive,
          goalMilestones: [],
          goalAlertDismissals: [],
        };
  const institutionsByName = new Map<
    string,
    { name: string; createdAt: string; updatedAt: string }
  >();
  for (const account of [...source.accounts].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const name = canonicalizeInstitutionName(account.institution ?? "");
    if (!name) continue;
    const normalizedName = normalizeInstitutionName(name);
    const existing = institutionsByName.get(normalizedName);
    institutionsByName.set(normalizedName, {
      name: existing && existing.name < name ? existing.name : name,
      createdAt:
        existing && existing.createdAt < account.createdAt
          ? existing.createdAt
          : account.createdAt,
      updatedAt:
        existing && existing.updatedAt > account.updatedAt
          ? existing.updatedAt
          : account.updatedAt,
    });
  }
  const institutionEntries = [...institutionsByName.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const institutionIds = new Map(
    institutionEntries.map(([normalizedName], index) => [
      normalizedName,
      `legacy-institution-${index + 1}`,
    ]),
  );
  const upgradedAccounts = source.accounts.map((row) => {
    const { institution, ...account } = row;
    const institutionName = canonicalizeInstitutionName(institution ?? "");
    return {
      ...account,
      institutionId: institutionName
        ? (institutionIds.get(normalizeInstitutionName(institutionName)) ??
          null)
        : null,
    };
  });

  return {
    ...source,
    version: 4 as const,
    institutions: institutionEntries.map(
      ([normalizedName, institution], index) => ({
        id:
          institutionIds.get(normalizedName) ??
          `legacy-institution-${index + 1}`,
        name: institution.name,
        type: "other" as const,
        websiteUrl: null,
        countryCode: null,
        address: null,
        notes: null,
        archivedAt: null,
        createdAt: institution.createdAt,
        updatedAt: institution.updatedAt,
      }),
    ),
    accounts: upgradedAccounts,
  };
}

function upgradeV4Archive(archive: z.infer<typeof userArchiveV4Schema>) {
  return {
    ...archive,
    version: 5 as const,
    transactions: archive.transactions.map((row) => ({
      ...row,
      externalId: null,
    })),
  };
}

const userArchiveSchema = z
  .union([
    userArchiveV5Schema,
    userArchiveV4Schema,
    userArchiveV3Schema,
    userArchiveV2Schema,
  ])
  .transform((archive) => {
    if (archive.version === 5) return archive;
    if (archive.version === 4) return upgradeV4Archive(archive);
    return upgradeV4Archive(upgradeLegacyArchive(archive));
  });

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
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
    milestoneRows,
    alertDismissalRows,
    institutionRows,
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
    db.select().from(goalMilestones).where(eq(goalMilestones.userId, userId)),
    db
      .select()
      .from(goalAlertDismissals)
      .where(eq(goalAlertDismissals.userId, userId)),
    db.select().from(institutions).where(eq(institutions.userId, userId)),
  ]);

  return {
    format: "wealthboard-user-json" as const,
    version: 5 as const,
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
    institutions: institutionRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      websiteUrl: row.websiteUrl,
      countryCode: row.countryCode,
      address: row.address,
      notes: row.notes,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    accounts: accountRows.map(stripOwner),
    transactions: transactionRows.map(stripOwner),
    valuations: valuationRows.map(stripOwner),
    exchangeRates: rateRows.map(stripOwner),
    goals: goalRows.map(stripOwner),
    goalContributionPlans: planRows.map(stripOwner),
    goalMilestones: milestoneRows.map(stripOwner),
    goalAlertDismissals: alertDismissalRows.map(stripOwner),
  };
}

function uniqueIdMap(rows: Array<{ id: string }>, label: string) {
  const result = new Map<string, string>();
  for (const row of rows) {
    if (result.has(row.id))
      throw new Error(`The archive contains duplicate ${label} IDs.`);
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
  if (!id)
    throw new Error(
      `The archive contains an invalid ${relationship} relationship.`,
    );
  return id;
}

export function restoreUserData(userId: string, input: unknown) {
  const archive = userArchiveSchema.parse(input);
  const baseCurrency = normalizeCurrencyCode(archive.settings.baseCurrency);
  const referencedCurrencies = normalizeEnabledCurrencies([
    ...archive.accounts.map((row) => row.currency),
    ...archive.transactions.map((row) => row.currency),
    ...archive.valuations.map((row) => row.currency),
    ...archive.exchangeRates.flatMap((row) => [
      row.baseCurrency,
      row.quoteCurrency,
    ]),
    ...archive.goals.map((row) => row.currency),
  ]);
  const restoredSettings = {
    ...archive.settings,
    baseCurrency,
    supportedCurrencies: JSON.stringify(
      normalizeEnabledCurrencies(
        parseEnabledCurrencies(archive.settings.supportedCurrencies),
        [baseCurrency, ...referencedCurrencies],
      ),
    ),
  };
  const categoryIds = uniqueIdMap(archive.categories, "category");
  const institutionIds = uniqueIdMap(archive.institutions, "institution");
  const accountIds = uniqueIdMap(archive.accounts, "account");
  const transactionIds = uniqueIdMap(archive.transactions, "transaction");
  const valuationIds = uniqueIdMap(archive.valuations, "valuation");
  const rateIds = uniqueIdMap(archive.exchangeRates, "exchange-rate");
  const goalIds = uniqueIdMap(archive.goals, "goal");
  const planIds = uniqueIdMap(
    archive.goalContributionPlans,
    "contribution-plan",
  );
  const milestoneIds = uniqueIdMap(archive.goalMilestones, "milestone");

  const normalizedInstitutionNames = new Set<string>();
  for (const institution of archive.institutions) {
    const normalizedName = normalizeInstitutionName(institution.name);
    if (normalizedInstitutionNames.has(normalizedName)) {
      throw new Error("The archive contains duplicate institution names.");
    }
    normalizedInstitutionNames.add(normalizedName);
  }

  for (const account of archive.accounts) {
    requiredMappedId(categoryIds, account.categoryId, "account category");
    if (account.institutionId) {
      requiredMappedId(
        institutionIds,
        account.institutionId,
        "account institution",
      );
    }
    if (account.goalId)
      requiredMappedId(goalIds, account.goalId, "account goal");
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
      throw new Error(
        "The archive links more than one goal to the same account.",
      );
    }
    linkedAccounts.add(goal.linkedAccountId);
  }
  for (const plan of archive.goalContributionPlans) {
    requiredMappedId(goalIds, plan.goalId, "contribution-plan goal");
  }
  for (const milestone of archive.goalMilestones) {
    requiredMappedId(goalIds, milestone.goalId, "milestone goal");
  }
  for (const dismissal of archive.goalAlertDismissals) {
    requiredMappedId(goalIds, dismissal.goalId, "alert-dismissal goal");
  }

  const db = getDatabase();
  db.transaction((tx) => {
    const existingSettings = tx.query.userSettings
      .findFirst({
        where: eq(userSettings.userId, userId),
        columns: { id: true },
      })
      .sync();
    if (!existingSettings) throw new Error("User settings are unavailable.");

    tx.delete(goalAlertDismissals)
      .where(eq(goalAlertDismissals.userId, userId))
      .run();
    tx.delete(goalMilestones).where(eq(goalMilestones.userId, userId)).run();
    tx.delete(goalContributionPlans)
      .where(eq(goalContributionPlans.userId, userId))
      .run();
    tx.delete(goals).where(eq(goals.userId, userId)).run();
    tx.delete(transactions).where(eq(transactions.userId, userId)).run();
    tx.delete(valuationSnapshots)
      .where(eq(valuationSnapshots.userId, userId))
      .run();
    tx.delete(accounts).where(eq(accounts.userId, userId)).run();
    tx.delete(institutions).where(eq(institutions.userId, userId)).run();
    tx.delete(categories).where(eq(categories.userId, userId)).run();
    tx.delete(exchangeRates).where(eq(exchangeRates.userId, userId)).run();
    tx.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId)).run();

    tx.update(userSettings)
      .set({ ...restoredSettings, updatedAt: nowIso() })
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
    if (archive.institutions.length) {
      tx.insert(institutions)
        .values(
          archive.institutions.map((row) => ({
            ...row,
            id: requiredMappedId(institutionIds, row.id, "institution"),
            userId,
            normalizedName: normalizeInstitutionName(row.name),
          })),
        )
        .run();
    }
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
            institutionId: row.institutionId
              ? requiredMappedId(
                  institutionIds,
                  row.institutionId,
                  "account institution",
                )
              : null,
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
              ? requiredMappedId(
                  accountIds,
                  row.linkedAccountId,
                  "goal account",
                )
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
    if (archive.exchangeRates.length) {
      tx.insert(exchangeRates)
        .values(
          archive.exchangeRates.map((row) => ({
            ...row,
            id: requiredMappedId(rateIds, row.id, "exchange rate"),
            userId,
          })),
        )
        .run();
    }
    if (archive.goalContributionPlans.length) {
      tx.insert(goalContributionPlans)
        .values(
          archive.goalContributionPlans.map((row) => ({
            ...row,
            id: requiredMappedId(planIds, row.id, "contribution plan"),
            userId,
            goalId: requiredMappedId(
              goalIds,
              row.goalId,
              "contribution-plan goal",
            ),
          })),
        )
        .run();
    }
    if (archive.goalMilestones.length) {
      tx.insert(goalMilestones)
        .values(
          archive.goalMilestones.map((row) => ({
            ...row,
            id: requiredMappedId(milestoneIds, row.id, "milestone"),
            userId,
            goalId: requiredMappedId(goalIds, row.goalId, "milestone goal"),
          })),
        )
        .run();
    }
    if (archive.goalAlertDismissals.length) {
      tx.insert(goalAlertDismissals)
        .values(
          archive.goalAlertDismissals.map((row) => ({
            ...row,
            userId,
            goalId: requiredMappedId(
              goalIds,
              row.goalId,
              "alert-dismissal goal",
            ),
          })),
        )
        .run();
    }
  });

  return {
    institutions: archive.institutions.length,
    accounts: archive.accounts.length,
    transactions: archive.transactions.length,
    goals: archive.goals.length,
    milestones: archive.goalMilestones.length,
  };
}

export async function transactionCsv(
  userId: string,
  filters: TransactionFilters = { sort: "newest" },
) {
  const rows = (await listTransactionsForExport(userId, filters)).map(
    (row) => ({
      id: row.id,
      external_id: row.externalId,
      account_id: row.accountId,
      account_name: row.accountName,
      type: row.type,
      amount_minor: row.amountMinor,
      currency: row.currency,
      date: row.transactionDate,
      description: row.description,
      notes: row.notes,
      transfer_group_id: row.transferGroupId,
    }),
  );
  return toCsv(rows);
}

export async function accountCsv(userId: string) {
  const rows = await getDatabase()
    .select({
      id: accounts.id,
      name: accounts.name,
      category: categories.name,
      institution: institutions.name,
      institution_archived_at: institutions.archivedAt,
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
      and(
        eq(accounts.userId, categories.userId),
        eq(accounts.categoryId, categories.id),
      ),
    )
    .leftJoin(
      institutions,
      and(
        eq(accounts.userId, institutions.userId),
        eq(accounts.institutionId, institutions.id),
      ),
    )
    .where(eq(accounts.userId, userId));
  return toCsv(rows);
}
