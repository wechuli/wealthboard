import "server-only";

import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  accountConversions,
  accounts,
  beneficiaries,
  beneficiaryKinds,
  categories,
  contributionFrequencies,
  estateAccountDirectives,
  estateAllocations,
  estateAllocationTiers,
  estateDistributionMethods,
  estatePlans,
  estatePlanSnapshots,
  estateResiduaryAllocations,
  estateTransferContexts,
  exchangeRates,
  goalAlertDismissals,
  goalContributionPlans,
  goalMilestones,
  goals,
  goalStatuses,
  idempotencyKeys,
  institutions,
  institutionTypes,
  investmentAssetTypes,
  investmentIdentifierTypes,
  investmentInstruments,
  positionEventTypes,
  positionEvents,
  positionReconciliations,
  securityPrices,
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
import { isValidTimezone, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import {
  canonicalizeInstitutionName,
  isHttpUrl,
  normalizeInstitutionName,
} from "@/lib/institutions";
import {
  listTransactionsForExport,
  recalculateAccountBalance,
  type TransactionFilters,
} from "@/lib/services/accounts";
import { replayPositionQuantities } from "@/lib/investments";

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

const settingsArchiveV8Schema = settingsArchiveSchema
  .extend({
    positionStaleDaysStock: z.number().int().min(1).max(3650),
    positionStaleDaysEtf: z.number().int().min(1).max(3650),
    positionStaleDaysFund: z.number().int().min(1).max(3650),
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

const accountArchiveV7Schema = accountArchiveV4Schema
  .extend({ trackingMode: z.enum(["balance", "positions"]) })
  .strict();

const investmentInstrumentArchiveSchema = z
  .object({
    id: z.string().min(1),
    externalId: z.string().min(1).max(200).nullable(),
    name: z.string().min(1).max(100),
    symbol: z.string().max(30).nullable(),
    identifierType: z.enum(investmentIdentifierTypes),
    identifier: z.string().max(100).nullable(),
    exchangeMic: z.string().max(20).nullable(),
    assetType: z.enum(investmentAssetTypes),
    quoteCurrency: isoCurrency,
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const signedDecimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .refine((value) => !new Decimal(value).isZero(), "Quantity cannot be zero.");

const positionEventArchiveV7Schema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    instrumentId: z.string().min(1),
    type: z.enum(["opening_position", "buy", "sell", "quantity_adjustment"]),
    quantity: signedDecimal,
    unitPrice: positiveDecimal.nullable(),
    tradeCurrency: isoCurrency,
    grossAmountMinor: safeInteger.nullable(),
    feeAmountMinor: safeInteger.nullable(),
    feeCurrency: isoCurrency.nullable(),
    cashEffectMinor: safeInteger,
    appliedExchangeRate: positiveDecimal.nullable(),
    openingCostBasisMinor: safeInteger.nullable(),
    tradeDate: timestamp,
    settlementDate: timestamp.nullable(),
    externalId: z.string().min(1).max(200).nullable(),
    eventGroupId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    description: z.string().max(200).nullable(),
    notes: nullableText,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);

const positionEventArchiveV8Schema = positionEventArchiveV7Schema
  .omit({ type: true, quantity: true })
  .extend({
    relatedInstrumentId: z.string().min(1).nullable(),
    type: z.enum(positionEventTypes),
    quantity: decimal,
    actionRatioNumerator: positiveDecimal.nullable(),
    actionRatioDenominator: positiveDecimal.nullable(),
    eventSequence: z.number().int().min(1),
  })
  .strict();

const accountConversionArchiveSchema = z
  .object({
    id: z.string().min(1),
    sourceAccountId: z.string().min(1),
    targetAccountId: z.string().min(1),
    conversionDate: timestamp,
    sourceBalanceMinor: safeInteger,
    idempotencyKey: z.string().min(1),
    createdAt: timestamp,
  })
  .strict();

const securityPriceArchiveSchema = z
  .object({
    id: z.string().min(1),
    instrumentId: z.string().min(1),
    externalId: z.string().min(1).max(200).nullable(),
    price: positiveDecimal,
    currency: isoCurrency,
    effectiveDate: timestamp,
    source: z.string().min(1).max(100),
    provenance: z.string().max(500).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const positionReconciliationArchiveSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    observationDate: timestamp,
    reportedCashMinor: safeInteger.nullable(),
    reportedTotalMinor: safeInteger,
    notes: nullableText,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
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

const transactionArchiveV8Schema = transactionArchiveV5Schema
  .extend({ eventGroupId: z.string().nullable() })
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

const beneficiaryArchiveSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(beneficiaryKinds),
    name: z.string().min(1).max(120),
    relationship: z.string().max(80).nullable(),
    contactSummary: z.string().max(300).nullable(),
    notes: nullableText,
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const estatePlanArchiveSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(120),
    jurisdiction: z.string().max(120).nullable(),
    lastReviewedDate: timestamp.nullable(),
    reviewReminderDate: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const estateDirectiveArchiveSchema = z
  .object({
    id: z.string().min(1),
    estatePlanId: z.string().min(1),
    accountId: z.string().min(1),
    isIncluded: z.boolean(),
    ownershipShareBps: z.number().int().min(1).max(10000),
    transferContext: z.enum(estateTransferContexts),
    distributionMethod: z.enum(estateDistributionMethods),
    documentReference: z.string().max(300).nullable(),
    notes: nullableText,
    reviewedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const estateAllocationArchiveSchema = z
  .object({
    id: z.string().min(1),
    estatePlanId: z.string().min(1),
    directiveId: z.string().min(1),
    beneficiaryId: z.string().min(1),
    tier: z.enum(estateAllocationTiers),
    allocationBps: z.number().int().min(1).max(10000),
    notes: nullableText,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const estateResiduaryArchiveSchema = z
  .object({
    id: z.string().min(1),
    estatePlanId: z.string().min(1),
    beneficiaryId: z.string().min(1),
    tier: z.enum(estateAllocationTiers),
    allocationBps: z.number().int().min(1).max(10000),
    notes: nullableText,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const estateSnapshotArchiveSchema = z
  .object({
    id: z.string().min(1),
    estatePlanId: z.string().min(1),
    version: z.literal(1),
    title: z.string().min(1).max(120),
    valueAsOfDate: z.string().date(),
    baseCurrency: isoCurrency,
    content: z.string().min(1).max(5_000_000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: timestamp,
  })
  .strict()
  .superRefine((row, context) => {
    const hash = createHash("sha256").update(row.content).digest("hex");
    if (hash !== row.contentHash) {
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "The estate snapshot integrity hash is invalid.",
      });
    }
    try {
      const content = JSON.parse(row.content) as Record<string, unknown>;
      if (
        row.content.includes('"userId"') ||
        content.format !== "wealthboard-estate-summary" ||
        content.version !== 1 ||
        !Array.isArray(content.assets) ||
        !Array.isArray(content.beneficiaries) ||
        !Array.isArray(content.reviewItems)
      ) {
        throw new Error("Invalid estate snapshot content.");
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "The estate snapshot content is invalid.",
      });
    }
  });

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

const userArchiveV6Schema = userArchiveV5Schema
  .extend({
    version: z.literal(6),
    beneficiaries: z.array(beneficiaryArchiveSchema).max(10000),
    estatePlans: z.array(estatePlanArchiveSchema).max(1),
    estateAccountDirectives: z.array(estateDirectiveArchiveSchema).max(10000),
    estateAllocations: z.array(estateAllocationArchiveSchema).max(100000),
    estateResiduaryAllocations: z
      .array(estateResiduaryArchiveSchema)
      .max(10000),
    estatePlanSnapshots: z.array(estateSnapshotArchiveSchema).max(1000),
  })
  .strict();

const userArchiveV7Schema = userArchiveV6Schema
  .extend({
    version: z.literal(7),
    accounts: z.array(accountArchiveV7Schema).max(10000),
    investmentInstruments: z
      .array(investmentInstrumentArchiveSchema)
      .max(10000),
    positionEvents: z.array(positionEventArchiveV7Schema).max(100000),
    securityPrices: z.array(securityPriceArchiveSchema).max(100000),
    positionReconciliations: z
      .array(positionReconciliationArchiveSchema)
      .max(10000),
  })
  .strict();

const userArchiveV8Schema = userArchiveV7Schema
  .extend({
    version: z.literal(8),
    settings: settingsArchiveV8Schema,
    transactions: z.array(transactionArchiveV8Schema).max(100000),
    positionEvents: z.array(positionEventArchiveV8Schema).max(100000),
    accountConversions: z.array(accountConversionArchiveSchema).max(10000),
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

function upgradeV5Archive(archive: z.infer<typeof userArchiveV5Schema>) {
  return {
    ...archive,
    version: 6 as const,
    beneficiaries: [],
    estatePlans: [],
    estateAccountDirectives: [],
    estateAllocations: [],
    estateResiduaryAllocations: [],
    estatePlanSnapshots: [],
  };
}

function upgradeV6Archive(archive: z.infer<typeof userArchiveV6Schema>) {
  return {
    ...archive,
    version: 7 as const,
    accounts: archive.accounts.map((account) => ({
      ...account,
      trackingMode: "balance" as const,
    })),
    investmentInstruments: [],
    positionEvents: [],
    securityPrices: [],
    positionReconciliations: [],
  };
}

function upgradeV7Archive(archive: z.infer<typeof userArchiveV7Schema>) {
  const sequenceByAccountDate = new Map<string, number>();
  const orderedEvents = [...archive.positionEvents].sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const eventSequences = new Map<string, number>();
  for (const event of orderedEvents) {
    const key = `${event.accountId}:${event.tradeDate}`;
    const sequence = (sequenceByAccountDate.get(key) ?? 0) + 1;
    sequenceByAccountDate.set(key, sequence);
    eventSequences.set(event.id, sequence);
  }
  return {
    ...archive,
    version: 8 as const,
    settings: {
      ...archive.settings,
      positionStaleDaysStock: 7,
      positionStaleDaysEtf: 7,
      positionStaleDaysFund: 31,
    },
    transactions: archive.transactions.map((row) => ({
      ...row,
      eventGroupId: null,
    })),
    positionEvents: archive.positionEvents.map((row) => ({
      ...row,
      relatedInstrumentId: null,
      actionRatioNumerator: null,
      actionRatioDenominator: null,
      eventSequence: eventSequences.get(row.id) ?? 0,
      eventGroupId: null,
    })),
    accountConversions: [],
  };
}

const userArchiveSchema = z
  .union([
    userArchiveV8Schema,
    userArchiveV7Schema,
    userArchiveV6Schema,
    userArchiveV5Schema,
    userArchiveV4Schema,
    userArchiveV3Schema,
    userArchiveV2Schema,
  ])
  .transform((archive) => {
    if (archive.version === 8) return archive;
    if (archive.version === 7) return upgradeV7Archive(archive);
    if (archive.version === 6)
      return upgradeV7Archive(upgradeV6Archive(archive));
    if (archive.version === 5)
      return upgradeV7Archive(upgradeV6Archive(upgradeV5Archive(archive)));
    if (archive.version === 4)
      return upgradeV7Archive(
        upgradeV6Archive(upgradeV5Archive(upgradeV4Archive(archive))),
      );
    return upgradeV7Archive(
      upgradeV6Archive(
        upgradeV5Archive(upgradeV4Archive(upgradeLegacyArchive(archive))),
      ),
    );
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
    beneficiaryRows,
    estatePlanRows,
    estateDirectiveRows,
    estateAllocationRows,
    estateResiduaryRows,
    estateSnapshotRows,
    instrumentRows,
    positionEventRows,
    securityPriceRows,
    positionReconciliationRows,
    accountConversionRows,
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
    db.select().from(beneficiaries).where(eq(beneficiaries.userId, userId)),
    db.select().from(estatePlans).where(eq(estatePlans.userId, userId)),
    db
      .select()
      .from(estateAccountDirectives)
      .where(eq(estateAccountDirectives.userId, userId)),
    db
      .select()
      .from(estateAllocations)
      .where(eq(estateAllocations.userId, userId)),
    db
      .select()
      .from(estateResiduaryAllocations)
      .where(eq(estateResiduaryAllocations.userId, userId)),
    db
      .select()
      .from(estatePlanSnapshots)
      .where(eq(estatePlanSnapshots.userId, userId)),
    db
      .select()
      .from(investmentInstruments)
      .where(eq(investmentInstruments.userId, userId)),
    db.select().from(positionEvents).where(eq(positionEvents.userId, userId)),
    db.select().from(securityPrices).where(eq(securityPrices.userId, userId)),
    db
      .select()
      .from(positionReconciliations)
      .where(eq(positionReconciliations.userId, userId)),
    db
      .select()
      .from(accountConversions)
      .where(eq(accountConversions.userId, userId)),
  ]);

  return {
    format: "wealthboard-user-json" as const,
    version: 8 as const,
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
      positionStaleDaysStock: settings.positionStaleDaysStock,
      positionStaleDaysEtf: settings.positionStaleDaysEtf,
      positionStaleDaysFund: settings.positionStaleDaysFund,
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
    beneficiaries: beneficiaryRows.map(stripOwner),
    estatePlans: estatePlanRows.map(stripOwner),
    estateAccountDirectives: estateDirectiveRows.map(stripOwner),
    estateAllocations: estateAllocationRows.map(stripOwner),
    estateResiduaryAllocations: estateResiduaryRows.map(stripOwner),
    estatePlanSnapshots: estateSnapshotRows.map(stripOwner),
    investmentInstruments: instrumentRows.map(stripOwner),
    positionEvents: positionEventRows.map(stripOwner),
    securityPrices: securityPriceRows.map(stripOwner),
    positionReconciliations: positionReconciliationRows.map(stripOwner),
    accountConversions: accountConversionRows.map(stripOwner),
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
    ...archive.investmentInstruments.map((row) => row.quoteCurrency),
    ...archive.positionEvents.flatMap((row) =>
      [row.tradeCurrency, row.feeCurrency].filter(
        (currency): currency is string => Boolean(currency),
      ),
    ),
    ...archive.securityPrices.map((row) => row.currency),
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
  const beneficiaryIds = uniqueIdMap(archive.beneficiaries, "beneficiary");
  const estatePlanIds = uniqueIdMap(archive.estatePlans, "estate plan");
  const estateDirectiveIds = uniqueIdMap(
    archive.estateAccountDirectives,
    "estate directive",
  );
  const estateAllocationIds = uniqueIdMap(
    archive.estateAllocations,
    "estate allocation",
  );
  const estateResiduaryIds = uniqueIdMap(
    archive.estateResiduaryAllocations,
    "estate residual allocation",
  );
  const estateSnapshotIds = uniqueIdMap(
    archive.estatePlanSnapshots,
    "estate snapshot",
  );
  const instrumentIds = uniqueIdMap(
    archive.investmentInstruments,
    "investment instrument",
  );
  const positionEventIds = uniqueIdMap(
    archive.positionEvents,
    "position event",
  );
  const securityPriceIds = uniqueIdMap(
    archive.securityPrices,
    "security price",
  );
  const positionReconciliationIds = uniqueIdMap(
    archive.positionReconciliations,
    "position reconciliation",
  );
  const accountConversionIds = uniqueIdMap(
    archive.accountConversions,
    "account conversion",
  );
  const eventGroupIds = new Map(
    [
      ...new Set(
        [...archive.positionEvents, ...archive.transactions]
          .map((row) => row.eventGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ].map((id) => [id, crypto.randomUUID()]),
  );

  const normalizedInstitutionNames = new Set<string>();
  for (const institution of archive.institutions) {
    const normalizedName = normalizeInstitutionName(institution.name);
    if (normalizedInstitutionNames.has(normalizedName)) {
      throw new Error("The archive contains duplicate institution names.");
    }
    normalizedInstitutionNames.add(normalizedName);
  }
  const accountById = new Map(archive.accounts.map((row) => [row.id, row]));

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
    if (accountById.get(valuation.accountId)?.trackingMode === "positions") {
      throw new Error(
        "The archive contains an absolute valuation for a position account.",
      );
    }
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
  const directiveById = new Map(
    archive.estateAccountDirectives.map((row) => [row.id, row]),
  );
  const allocationTotals = new Map<string, number>();
  for (const directive of archive.estateAccountDirectives) {
    requiredMappedId(
      estatePlanIds,
      directive.estatePlanId,
      "estate directive plan",
    );
    requiredMappedId(
      accountIds,
      directive.accountId,
      "estate directive account",
    );
    if (
      directive.isIncluded &&
      accountById.get(directive.accountId)?.isLiability
    ) {
      throw new Error(
        "The archive assigns a liability to estate beneficiaries.",
      );
    }
  }
  for (const allocation of archive.estateAllocations) {
    requiredMappedId(
      estatePlanIds,
      allocation.estatePlanId,
      "estate allocation plan",
    );
    requiredMappedId(
      estateDirectiveIds,
      allocation.directiveId,
      "estate allocation directive",
    );
    requiredMappedId(
      beneficiaryIds,
      allocation.beneficiaryId,
      "estate allocation beneficiary",
    );
    const directive = directiveById.get(allocation.directiveId)!;
    if (directive.estatePlanId !== allocation.estatePlanId) {
      throw new Error(
        "The archive contains an invalid estate allocation plan relationship.",
      );
    }
    const key = `${allocation.directiveId}:${allocation.tier}`;
    const total = (allocationTotals.get(key) ?? 0) + allocation.allocationBps;
    if (total > 10000) {
      throw new Error("The archive contains estate allocations over 100%.");
    }
    allocationTotals.set(key, total);
  }
  for (const allocation of archive.estateResiduaryAllocations) {
    requiredMappedId(
      estatePlanIds,
      allocation.estatePlanId,
      "estate residual plan",
    );
    requiredMappedId(
      beneficiaryIds,
      allocation.beneficiaryId,
      "estate residual beneficiary",
    );
    const key = `${allocation.estatePlanId}:${allocation.tier}`;
    const total = (allocationTotals.get(key) ?? 0) + allocation.allocationBps;
    if (total > 10000) {
      throw new Error("The archive contains residual allocations over 100%.");
    }
    allocationTotals.set(key, total);
  }
  for (const snapshot of archive.estatePlanSnapshots) {
    requiredMappedId(
      estatePlanIds,
      snapshot.estatePlanId,
      "estate snapshot plan",
    );
  }
  const instrumentById = new Map(
    archive.investmentInstruments.map((row) => [row.id, row]),
  );
  const eventSequences = new Set<string>();
  for (const event of archive.positionEvents) {
    requiredMappedId(accountIds, event.accountId, "position-event account");
    requiredMappedId(
      instrumentIds,
      event.instrumentId,
      "position-event instrument",
    );
    if (event.relatedInstrumentId) {
      requiredMappedId(
        instrumentIds,
        event.relatedInstrumentId,
        "position-event related instrument",
      );
    }
    if (accountById.get(event.accountId)?.trackingMode !== "positions") {
      throw new Error(
        "The archive links a position event to a balance account.",
      );
    }
    const sequenceKey = `${event.accountId}:${event.tradeDate}:${event.eventSequence}`;
    if (eventSequences.has(sequenceKey)) {
      throw new Error(
        "The archive contains duplicate same-date position-event sequences.",
      );
    }
    eventSequences.add(sequenceKey);
    const quantity = new Decimal(event.quantity);
    if (
      event.type === "quantity_adjustment"
        ? quantity.isZero()
        : event.type === "split"
          ? !quantity.isZero()
          : !quantity.isPositive()
    ) {
      throw new Error("The archive contains a negative position quantity.");
    }
    if (
      event.type === "split" &&
      (!event.actionRatioNumerator || !event.actionRatioDenominator)
    ) {
      throw new Error("The archive contains a split without a valid ratio.");
    }
    if (
      (event.type === "spinoff" ||
        event.type === "merger_in" ||
        event.type === "merger_out") &&
      (!event.relatedInstrumentId ||
        !event.actionRatioNumerator ||
        !event.actionRatioDenominator ||
        event.relatedInstrumentId === event.instrumentId)
    ) {
      throw new Error(
        "The archive contains an invalid related-instrument action.",
      );
    }
    if (
      (event.type === "transfer_in" ||
        event.type === "transfer_out" ||
        event.type === "merger_in" ||
        event.type === "merger_out") &&
      !event.eventGroupId
    ) {
      throw new Error(
        "The archive contains an ungrouped paired position event.",
      );
    }
  }
  const eventsByGroup = new Map<string, typeof archive.positionEvents>();
  const cashByGroup = new Map<string, typeof archive.transactions>();
  for (const event of archive.positionEvents) {
    if (!event.eventGroupId) continue;
    eventsByGroup.set(event.eventGroupId, [
      ...(eventsByGroup.get(event.eventGroupId) ?? []),
      event,
    ]);
  }
  for (const transaction of archive.transactions) {
    if (!transaction.eventGroupId) continue;
    cashByGroup.set(transaction.eventGroupId, [
      ...(cashByGroup.get(transaction.eventGroupId) ?? []),
      transaction,
    ]);
  }
  for (const groupId of new Set([
    ...eventsByGroup.keys(),
    ...cashByGroup.keys(),
  ])) {
    const groupEvents = eventsByGroup.get(groupId) ?? [];
    const groupCash = cashByGroup.get(groupId) ?? [];
    const groupDates = new Set([
      ...groupEvents.map((event) => event.tradeDate),
      ...groupCash.map((transaction) => transaction.transactionDate),
    ]);
    if (groupDates.size !== 1) {
      throw new Error("The archive contains a group spanning multiple dates.");
    }
    const transferOut = groupEvents.filter(
      (event) => event.type === "transfer_out",
    );
    const transferIn = groupEvents.filter(
      (event) => event.type === "transfer_in",
    );
    if (transferOut.length || transferIn.length) {
      if (
        groupEvents.length !== 2 ||
        transferOut.length !== 1 ||
        transferIn.length !== 1 ||
        transferOut[0].accountId === transferIn[0].accountId ||
        transferOut[0].instrumentId !== transferIn[0].instrumentId ||
        transferOut[0].quantity !== transferIn[0].quantity ||
        groupCash.some((transaction) => transaction.type !== "fee")
      ) {
        throw new Error(
          "The archive contains an invalid in-kind transfer group.",
        );
      }
      continue;
    }
    const mergerOut = groupEvents.filter(
      (event) => event.type === "merger_out",
    );
    const mergerIn = groupEvents.filter((event) => event.type === "merger_in");
    if (mergerOut.length || mergerIn.length) {
      if (
        groupEvents.length !== 2 ||
        mergerOut.length !== 1 ||
        mergerIn.length !== 1 ||
        mergerOut[0].accountId !== mergerIn[0].accountId ||
        mergerOut[0].relatedInstrumentId !== mergerIn[0].instrumentId ||
        mergerIn[0].relatedInstrumentId !== mergerOut[0].instrumentId ||
        mergerOut[0].actionRatioNumerator !==
          mergerIn[0].actionRatioNumerator ||
        mergerOut[0].actionRatioDenominator !==
          mergerIn[0].actionRatioDenominator ||
        groupCash.length !== 0
      ) {
        throw new Error("The archive contains an invalid merger group.");
      }
      continue;
    }
    if (groupCash.length) {
      if (
        groupCash.length !== 1 ||
        groupCash[0].type !== "dividend" ||
        groupEvents.length < 1 ||
        groupEvents.some(
          (event) =>
            event.type !== "buy" || event.accountId !== groupCash[0].accountId,
        )
      ) {
        throw new Error("The archive contains an invalid reinvestment group.");
      }
      continue;
    }
    if (
      groupEvents.length !== 1 ||
      !["split", "spinoff"].includes(groupEvents[0].type)
    ) {
      throw new Error("The archive contains an incomplete position group.");
    }
  }
  replayPositionQuantities(archive.positionEvents);
  for (const price of archive.securityPrices) {
    requiredMappedId(
      instrumentIds,
      price.instrumentId,
      "security-price instrument",
    );
    if (
      instrumentById.get(price.instrumentId)?.quoteCurrency !== price.currency
    ) {
      throw new Error(
        "The archive contains a price in the wrong instrument currency.",
      );
    }
  }
  for (const reconciliation of archive.positionReconciliations) {
    requiredMappedId(
      accountIds,
      reconciliation.accountId,
      "position-reconciliation account",
    );
    if (
      accountById.get(reconciliation.accountId)?.trackingMode !== "positions"
    ) {
      throw new Error(
        "The archive links a reconciliation to a balance account.",
      );
    }
  }
  for (const conversion of archive.accountConversions) {
    requiredMappedId(
      accountIds,
      conversion.sourceAccountId,
      "account-conversion source",
    );
    requiredMappedId(
      accountIds,
      conversion.targetAccountId,
      "account-conversion target",
    );
    if (
      accountById.get(conversion.sourceAccountId)?.trackingMode !== "balance" ||
      accountById.get(conversion.targetAccountId)?.trackingMode !==
        "positions" ||
      !accountById.get(conversion.sourceAccountId)?.archivedAt ||
      conversion.sourceAccountId === conversion.targetAccountId
    ) {
      throw new Error("The archive contains an invalid account conversion.");
    }
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

    tx.delete(accountConversions)
      .where(eq(accountConversions.userId, userId))
      .run();
    tx.delete(estatePlanSnapshots)
      .where(eq(estatePlanSnapshots.userId, userId))
      .run();
    tx.delete(estateAllocations)
      .where(eq(estateAllocations.userId, userId))
      .run();
    tx.delete(estateResiduaryAllocations)
      .where(eq(estateResiduaryAllocations.userId, userId))
      .run();
    tx.delete(estateAccountDirectives)
      .where(eq(estateAccountDirectives.userId, userId))
      .run();
    tx.delete(estatePlans).where(eq(estatePlans.userId, userId)).run();
    tx.delete(beneficiaries).where(eq(beneficiaries.userId, userId)).run();
    tx.delete(positionReconciliations)
      .where(eq(positionReconciliations.userId, userId))
      .run();
    tx.delete(securityPrices).where(eq(securityPrices.userId, userId)).run();
    tx.delete(positionEvents).where(eq(positionEvents.userId, userId)).run();
    tx.delete(investmentInstruments)
      .where(eq(investmentInstruments.userId, userId))
      .run();
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
    if (archive.accountConversions.length) {
      tx.insert(accountConversions)
        .values(
          archive.accountConversions.map((row) => ({
            ...row,
            id: requiredMappedId(
              accountConversionIds,
              row.id,
              "account conversion",
            ),
            userId,
            sourceAccountId: requiredMappedId(
              accountIds,
              row.sourceAccountId,
              "account-conversion source",
            ),
            targetAccountId: requiredMappedId(
              accountIds,
              row.targetAccountId,
              "account-conversion target",
            ),
          })),
        )
        .run();
    }
    if (archive.investmentInstruments.length) {
      tx.insert(investmentInstruments)
        .values(
          archive.investmentInstruments.map((row) => ({
            ...row,
            id: requiredMappedId(
              instrumentIds,
              row.id,
              "investment instrument",
            ),
            userId,
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
            eventGroupId: row.eventGroupId
              ? eventGroupIds.get(row.eventGroupId)!
              : null,
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
    if (archive.positionEvents.length) {
      tx.insert(positionEvents)
        .values(
          archive.positionEvents.map((row) => ({
            ...row,
            id: requiredMappedId(positionEventIds, row.id, "position event"),
            userId,
            accountId: requiredMappedId(
              accountIds,
              row.accountId,
              "position-event account",
            ),
            instrumentId: requiredMappedId(
              instrumentIds,
              row.instrumentId,
              "position-event instrument",
            ),
            relatedInstrumentId: row.relatedInstrumentId
              ? requiredMappedId(
                  instrumentIds,
                  row.relatedInstrumentId,
                  "position-event related instrument",
                )
              : null,
            eventGroupId: row.eventGroupId
              ? eventGroupIds.get(row.eventGroupId)!
              : null,
          })),
        )
        .run();
    }
    if (archive.securityPrices.length) {
      tx.insert(securityPrices)
        .values(
          archive.securityPrices.map((row) => ({
            ...row,
            id: requiredMappedId(securityPriceIds, row.id, "security price"),
            userId,
            instrumentId: requiredMappedId(
              instrumentIds,
              row.instrumentId,
              "security-price instrument",
            ),
          })),
        )
        .run();
    }
    if (archive.positionReconciliations.length) {
      tx.insert(positionReconciliations)
        .values(
          archive.positionReconciliations.map((row) => ({
            ...row,
            id: requiredMappedId(
              positionReconciliationIds,
              row.id,
              "position reconciliation",
            ),
            userId,
            accountId: requiredMappedId(
              accountIds,
              row.accountId,
              "position-reconciliation account",
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
    if (archive.beneficiaries.length) {
      tx.insert(beneficiaries)
        .values(
          archive.beneficiaries.map((row) => ({
            ...row,
            id: requiredMappedId(beneficiaryIds, row.id, "beneficiary"),
            userId,
          })),
        )
        .run();
    }
    if (archive.estatePlans.length) {
      tx.insert(estatePlans)
        .values(
          archive.estatePlans.map((row) => ({
            ...row,
            id: requiredMappedId(estatePlanIds, row.id, "estate plan"),
            userId,
          })),
        )
        .run();
    }
    if (archive.estateAccountDirectives.length) {
      tx.insert(estateAccountDirectives)
        .values(
          archive.estateAccountDirectives.map((row) => ({
            ...row,
            id: requiredMappedId(
              estateDirectiveIds,
              row.id,
              "estate directive",
            ),
            userId,
            estatePlanId: requiredMappedId(
              estatePlanIds,
              row.estatePlanId,
              "estate directive plan",
            ),
            accountId: requiredMappedId(
              accountIds,
              row.accountId,
              "estate directive account",
            ),
          })),
        )
        .run();
    }
    if (archive.estateAllocations.length) {
      tx.insert(estateAllocations)
        .values(
          archive.estateAllocations.map((row) => ({
            ...row,
            id: requiredMappedId(
              estateAllocationIds,
              row.id,
              "estate allocation",
            ),
            userId,
            estatePlanId: requiredMappedId(
              estatePlanIds,
              row.estatePlanId,
              "estate allocation plan",
            ),
            directiveId: requiredMappedId(
              estateDirectiveIds,
              row.directiveId,
              "estate allocation directive",
            ),
            beneficiaryId: requiredMappedId(
              beneficiaryIds,
              row.beneficiaryId,
              "estate allocation beneficiary",
            ),
          })),
        )
        .run();
    }
    if (archive.estateResiduaryAllocations.length) {
      tx.insert(estateResiduaryAllocations)
        .values(
          archive.estateResiduaryAllocations.map((row) => ({
            ...row,
            id: requiredMappedId(
              estateResiduaryIds,
              row.id,
              "estate residual allocation",
            ),
            userId,
            estatePlanId: requiredMappedId(
              estatePlanIds,
              row.estatePlanId,
              "estate residual plan",
            ),
            beneficiaryId: requiredMappedId(
              beneficiaryIds,
              row.beneficiaryId,
              "estate residual beneficiary",
            ),
          })),
        )
        .run();
    }
    if (archive.estatePlanSnapshots.length) {
      tx.insert(estatePlanSnapshots)
        .values(
          archive.estatePlanSnapshots.map((row) => ({
            ...row,
            id: requiredMappedId(estateSnapshotIds, row.id, "estate snapshot"),
            userId,
            estatePlanId: requiredMappedId(
              estatePlanIds,
              row.estatePlanId,
              "estate snapshot plan",
            ),
          })),
        )
        .run();
    }
    for (const account of archive.accounts) {
      recalculateAccountBalance(
        userId,
        tx,
        requiredMappedId(accountIds, account.id, "account"),
      );
    }
  });

  return {
    institutions: archive.institutions.length,
    accounts: archive.accounts.length,
    transactions: archive.transactions.length,
    goals: archive.goals.length,
    milestones: archive.goalMilestones.length,
    beneficiaries: archive.beneficiaries.length,
    estatePlans: archive.estatePlans.length,
    estateSnapshots: archive.estatePlanSnapshots.length,
    investmentInstruments: archive.investmentInstruments.length,
    positionEvents: archive.positionEvents.length,
    securityPrices: archive.securityPrices.length,
    positionReconciliations: archive.positionReconciliations.length,
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
