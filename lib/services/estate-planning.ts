import "server-only";

import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { and, asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";

import {
  accounts,
  beneficiaries,
  categories,
  estateAccountDirectives,
  estateAllocations,
  estatePlans,
  estatePlanSnapshots,
  estateResiduaryAllocations,
  exchangeRates,
  institutions,
  transactions,
  userSettings,
  valuationSnapshots,
  type BeneficiaryKind,
  type EstateAllocationTier,
  type EstateDistributionMethod,
  type EstateTransferContext,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { convertMinor, MissingExchangeRateError } from "@/lib/money";

const FULL_ALLOCATION_BPS = 10_000;
const STALE_AFTER_DAYS = 365;

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
type Client = DatabaseClient | TransactionClient;

export class EstatePlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstatePlanningError";
  }
}

type BeneficiaryInput = {
  kind: BeneficiaryKind;
  name: string;
  relationship?: string;
  contactSummary?: string;
  notes?: string;
};

type PlanInput = {
  title: string;
  jurisdiction?: string;
  lastReviewedDate?: string;
  reviewReminderDate?: string;
};

type DirectiveInput = {
  isIncluded: boolean;
  ownershipShareBps: number;
  transferContext: EstateTransferContext;
  distributionMethod: EstateDistributionMethod;
  documentReference?: string;
  notes?: string;
  reviewedAt?: string;
};

type AllocationInput = {
  beneficiaryId: string;
  tier: EstateAllocationTier;
  allocationBps: number;
  notes?: string;
};

function requireBasisPoints(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0 || value > FULL_ALLOCATION_BPS) {
    throw new EstatePlanningError(`${label} must be between 0.01% and 100%.`);
  }
}

function scaleByBasisPoints(amountMinor: number | bigint, basisPoints: number) {
  return BigInt(
    new Decimal(amountMinor.toString())
      .mul(basisPoints)
      .div(FULL_ALLOCATION_BPS)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toFixed(0),
  );
}

export function apportionMinorUnits(
  amountMinor: number | bigint,
  entries: Array<{ key: string; numerator: bigint }>,
  denominator: bigint,
) {
  if (denominator <= 0n || entries.some((entry) => entry.numerator < 0n)) {
    throw new EstatePlanningError("Allocation weights are invalid.");
  }
  const sign = BigInt(amountMinor) < 0n ? -1n : 1n;
  const absoluteAmount = BigInt(amountMinor) * sign;
  const totalNumerator = entries.reduce(
    (total, entry) => total + entry.numerator,
    0n,
  );
  if (totalNumerator > denominator) {
    throw new EstatePlanningError("Allocation weights cannot exceed 100%.");
  }

  const targetProduct = absoluteAmount * totalNumerator;
  const target =
    targetProduct / denominator +
    ((targetProduct % denominator) * 2n >= denominator ? 1n : 0n);
  const parts = entries.map((entry) => {
    const product = absoluteAmount * entry.numerator;
    return {
      key: entry.key,
      amount: product / denominator,
      remainder: product % denominator,
    };
  });
  let undistributed =
    target - parts.reduce((total, part) => total + part.amount, 0n);
  const ranked = [...parts].sort((left, right) =>
    left.remainder === right.remainder
      ? left.key.localeCompare(right.key)
      : left.remainder > right.remainder
        ? -1
        : 1,
  );
  for (const part of ranked) {
    if (undistributed === 0n) break;
    part.amount += 1n;
    undistributed -= 1n;
  }
  return new Map(parts.map((part) => [part.key, part.amount * sign]));
}

function requirePlan(client: Client, userId: string) {
  const plan = client.query.estatePlans
    .findFirst({ where: eq(estatePlans.userId, userId) })
    .sync();
  if (!plan) throw new EstatePlanningError("Estate plan not found.");
  return plan;
}

export function ensureEstatePlan(userId: string) {
  const db = getDatabase();
  const existing = db.query.estatePlans
    .findFirst({ where: eq(estatePlans.userId, userId) })
    .sync();
  if (existing) return existing;

  const timestamp = nowIso();
  const id = crypto.randomUUID();
  db.insert(estatePlans)
    .values({
      id,
      userId,
      title: "My estate plan",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return db.query.estatePlans
    .findFirst({
      where: and(eq(estatePlans.userId, userId), eq(estatePlans.id, id)),
    })
    .sync()!;
}

export function createBeneficiary(userId: string, input: BeneficiaryInput) {
  const timestamp = nowIso();
  const id = crypto.randomUUID();
  getDatabase()
    .insert(beneficiaries)
    .values({
      id,
      userId,
      kind: input.kind,
      name: input.name,
      relationship: input.relationship || null,
      contactSummary: input.contactSummary || null,
      notes: input.notes || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

export function updateBeneficiary(
  userId: string,
  beneficiaryId: string,
  input: BeneficiaryInput,
) {
  const result = getDatabase()
    .update(beneficiaries)
    .set({
      kind: input.kind,
      name: input.name,
      relationship: input.relationship || null,
      contactSummary: input.contactSummary || null,
      notes: input.notes || null,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(beneficiaries.userId, userId),
        eq(beneficiaries.id, beneficiaryId),
      ),
    )
    .run();
  if (!result.changes) throw new EstatePlanningError("Beneficiary not found.");
}

export function setBeneficiaryArchived(
  userId: string,
  beneficiaryId: string,
  archived: boolean,
) {
  const result = getDatabase()
    .update(beneficiaries)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(
      and(
        eq(beneficiaries.userId, userId),
        eq(beneficiaries.id, beneficiaryId),
      ),
    )
    .run();
  if (!result.changes) throw new EstatePlanningError("Beneficiary not found.");
}

export function updateEstatePlan(userId: string, input: PlanInput) {
  const plan = ensureEstatePlan(userId);
  getDatabase()
    .update(estatePlans)
    .set({
      title: input.title,
      jurisdiction: input.jurisdiction || null,
      lastReviewedDate: input.lastReviewedDate
        ? dateInputToUtc(input.lastReviewedDate)
        : null,
      reviewReminderDate: input.reviewReminderDate
        ? dateInputToUtc(input.reviewReminderDate)
        : null,
      updatedAt: nowIso(),
    })
    .where(and(eq(estatePlans.userId, userId), eq(estatePlans.id, plan.id)))
    .run();
}

export function upsertEstateDirective(
  userId: string,
  accountId: string,
  input: DirectiveInput,
) {
  requireBasisPoints(input.ownershipShareBps, "Ownership share");
  return getDatabase().transaction((tx) => {
    const plan = requirePlan(tx, userId);
    const account = tx.query.accounts
      .findFirst({
        where: and(eq(accounts.userId, userId), eq(accounts.id, accountId)),
      })
      .sync();
    if (!account || account.archivedAt) {
      throw new EstatePlanningError("The selected asset is unavailable.");
    }
    if (account.isLiability) {
      throw new EstatePlanningError(
        "Liabilities cannot be assigned to beneficiaries.",
      );
    }

    const existing = tx.query.estateAccountDirectives
      .findFirst({
        where: and(
          eq(estateAccountDirectives.userId, userId),
          eq(estateAccountDirectives.estatePlanId, plan.id),
          eq(estateAccountDirectives.accountId, accountId),
        ),
      })
      .sync();
    const timestamp = nowIso();
    const values = {
      isIncluded: input.isIncluded,
      ownershipShareBps: input.ownershipShareBps,
      transferContext: input.transferContext,
      distributionMethod: input.distributionMethod,
      documentReference: input.documentReference || null,
      notes: input.notes || null,
      reviewedAt: input.reviewedAt ? dateInputToUtc(input.reviewedAt) : null,
      updatedAt: timestamp,
    };
    if (existing) {
      tx.update(estateAccountDirectives)
        .set(values)
        .where(
          and(
            eq(estateAccountDirectives.userId, userId),
            eq(estateAccountDirectives.id, existing.id),
          ),
        )
        .run();
      return existing.id;
    }
    const id = crypto.randomUUID();
    tx.insert(estateAccountDirectives)
      .values({
        id,
        userId,
        estatePlanId: plan.id,
        accountId,
        ...values,
        createdAt: timestamp,
      })
      .run();
    return id;
  });
}

function allocationTotal(
  client: Client,
  userId: string,
  directiveId: string,
  tier: EstateAllocationTier,
  excludedId?: string,
) {
  return client
    .select({
      id: estateAllocations.id,
      allocationBps: estateAllocations.allocationBps,
    })
    .from(estateAllocations)
    .where(
      and(
        eq(estateAllocations.userId, userId),
        eq(estateAllocations.directiveId, directiveId),
        eq(estateAllocations.tier, tier),
      ),
    )
    .all()
    .filter((row) => row.id !== excludedId)
    .reduce((sum, row) => sum + row.allocationBps, 0);
}

function requireAvailableBeneficiary(
  client: Client,
  userId: string,
  beneficiaryId: string,
) {
  const beneficiary = client.query.beneficiaries
    .findFirst({
      where: and(
        eq(beneficiaries.userId, userId),
        eq(beneficiaries.id, beneficiaryId),
        isNull(beneficiaries.archivedAt),
      ),
    })
    .sync();
  if (!beneficiary) {
    throw new EstatePlanningError("The selected beneficiary is unavailable.");
  }
  return beneficiary;
}

export function upsertEstateAllocation(
  userId: string,
  directiveId: string,
  input: AllocationInput,
) {
  requireBasisPoints(input.allocationBps, "Allocation");
  return getDatabase().transaction((tx) => {
    const plan = requirePlan(tx, userId);
    const directive = tx.query.estateAccountDirectives
      .findFirst({
        where: and(
          eq(estateAccountDirectives.userId, userId),
          eq(estateAccountDirectives.estatePlanId, plan.id),
          eq(estateAccountDirectives.id, directiveId),
        ),
      })
      .sync();
    if (!directive || !directive.isIncluded) {
      throw new EstatePlanningError("Estate asset directive not found.");
    }
    requireAvailableBeneficiary(tx, userId, input.beneficiaryId);

    const existing = tx.query.estateAllocations
      .findFirst({
        where: and(
          eq(estateAllocations.userId, userId),
          eq(estateAllocations.directiveId, directiveId),
          eq(estateAllocations.beneficiaryId, input.beneficiaryId),
          eq(estateAllocations.tier, input.tier),
        ),
      })
      .sync();
    const total =
      allocationTotal(tx, userId, directiveId, input.tier, existing?.id) +
      input.allocationBps;
    if (total > FULL_ALLOCATION_BPS) {
      throw new EstatePlanningError(
        `${input.tier === "primary" ? "Primary" : "Contingent"} allocations cannot exceed 100%.`,
      );
    }

    const timestamp = nowIso();
    if (existing) {
      tx.update(estateAllocations)
        .set({
          allocationBps: input.allocationBps,
          notes: input.notes || null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(estateAllocations.userId, userId),
            eq(estateAllocations.id, existing.id),
          ),
        )
        .run();
      return existing.id;
    }
    const id = crypto.randomUUID();
    tx.insert(estateAllocations)
      .values({
        id,
        userId,
        estatePlanId: plan.id,
        directiveId,
        beneficiaryId: input.beneficiaryId,
        tier: input.tier,
        allocationBps: input.allocationBps,
        notes: input.notes || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return id;
  });
}

export function deleteEstateAllocation(userId: string, allocationId: string) {
  const result = getDatabase()
    .delete(estateAllocations)
    .where(
      and(
        eq(estateAllocations.userId, userId),
        eq(estateAllocations.id, allocationId),
      ),
    )
    .run();
  if (!result.changes) throw new EstatePlanningError("Allocation not found.");
}

export function upsertResiduaryAllocation(
  userId: string,
  input: AllocationInput,
) {
  requireBasisPoints(input.allocationBps, "Allocation");
  return getDatabase().transaction((tx) => {
    const plan = requirePlan(tx, userId);
    requireAvailableBeneficiary(tx, userId, input.beneficiaryId);
    const existing = tx.query.estateResiduaryAllocations
      .findFirst({
        where: and(
          eq(estateResiduaryAllocations.userId, userId),
          eq(estateResiduaryAllocations.estatePlanId, plan.id),
          eq(estateResiduaryAllocations.beneficiaryId, input.beneficiaryId),
          eq(estateResiduaryAllocations.tier, input.tier),
        ),
      })
      .sync();
    const otherTotal = tx
      .select({
        id: estateResiduaryAllocations.id,
        allocationBps: estateResiduaryAllocations.allocationBps,
      })
      .from(estateResiduaryAllocations)
      .where(
        and(
          eq(estateResiduaryAllocations.userId, userId),
          eq(estateResiduaryAllocations.estatePlanId, plan.id),
          eq(estateResiduaryAllocations.tier, input.tier),
        ),
      )
      .all()
      .filter((row) => row.id !== existing?.id)
      .reduce((sum, row) => sum + row.allocationBps, 0);
    if (otherTotal + input.allocationBps > FULL_ALLOCATION_BPS) {
      throw new EstatePlanningError(
        `${input.tier === "primary" ? "Primary" : "Contingent"} residual allocations cannot exceed 100%.`,
      );
    }

    const timestamp = nowIso();
    if (existing) {
      tx.update(estateResiduaryAllocations)
        .set({
          allocationBps: input.allocationBps,
          notes: input.notes || null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(estateResiduaryAllocations.userId, userId),
            eq(estateResiduaryAllocations.id, existing.id),
          ),
        )
        .run();
      return existing.id;
    }
    const id = crypto.randomUUID();
    tx.insert(estateResiduaryAllocations)
      .values({
        id,
        userId,
        estatePlanId: plan.id,
        beneficiaryId: input.beneficiaryId,
        tier: input.tier,
        allocationBps: input.allocationBps,
        notes: input.notes || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return id;
  });
}

export function deleteResiduaryAllocation(
  userId: string,
  allocationId: string,
) {
  const result = getDatabase()
    .delete(estateResiduaryAllocations)
    .where(
      and(
        eq(estateResiduaryAllocations.userId, userId),
        eq(estateResiduaryAllocations.id, allocationId),
      ),
    )
    .run();
  if (!result.changes) {
    throw new EstatePlanningError("Residual allocation not found.");
  }
}

function latestActivityByAccount(userId: string) {
  const db = getDatabase();
  const dates = new Map<string, string>();
  const transactionDates = db
    .select({
      accountId: transactions.accountId,
      date: sql<string>`max(${transactions.transactionDate})`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.accountId)
    .all();
  const valuationDates = db
    .select({
      accountId: valuationSnapshots.accountId,
      date: sql<string>`max(${valuationSnapshots.valuationDate})`,
    })
    .from(valuationSnapshots)
    .where(eq(valuationSnapshots.userId, userId))
    .groupBy(valuationSnapshots.accountId)
    .all();
  for (const row of [...transactionDates, ...valuationDates]) {
    const current = dates.get(row.accountId);
    if (row.date && (!current || row.date > current))
      dates.set(row.accountId, row.date);
  }
  return dates;
}

export type EstateReviewItem = {
  code: string;
  message: string;
  severity: "blocking" | "warning";
  accountId?: string;
};

export function getEstateWorkspace(userId: string, now = new Date()) {
  const db = getDatabase();
  const plan = ensureEstatePlan(userId);
  const settings = db.query.userSettings
    .findFirst({ where: eq(userSettings.userId, userId) })
    .sync();
  if (!settings)
    throw new EstatePlanningError("User settings are unavailable.");

  const beneficiaryRows = db
    .select()
    .from(beneficiaries)
    .where(eq(beneficiaries.userId, userId))
    .orderBy(asc(beneficiaries.archivedAt), asc(beneficiaries.name))
    .all();
  const accountRows = db
    .select({
      ...getTableColumns(accounts),
      categoryName: categories.name,
      institutionName: institutions.name,
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
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.name))
    .all();
  const directiveRows = db
    .select()
    .from(estateAccountDirectives)
    .where(
      and(
        eq(estateAccountDirectives.userId, userId),
        eq(estateAccountDirectives.estatePlanId, plan.id),
      ),
    )
    .all();
  const allocationRows = db
    .select()
    .from(estateAllocations)
    .where(
      and(
        eq(estateAllocations.userId, userId),
        eq(estateAllocations.estatePlanId, plan.id),
      ),
    )
    .all();
  const residueRows = db
    .select()
    .from(estateResiduaryAllocations)
    .where(
      and(
        eq(estateResiduaryAllocations.userId, userId),
        eq(estateResiduaryAllocations.estatePlanId, plan.id),
      ),
    )
    .all();
  const rateRows = db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .all();
  const snapshotRows = db
    .select({
      id: estatePlanSnapshots.id,
      title: estatePlanSnapshots.title,
      valueAsOfDate: estatePlanSnapshots.valueAsOfDate,
      baseCurrency: estatePlanSnapshots.baseCurrency,
      contentHash: estatePlanSnapshots.contentHash,
      generatedAt: estatePlanSnapshots.generatedAt,
    })
    .from(estatePlanSnapshots)
    .where(eq(estatePlanSnapshots.userId, userId))
    .orderBy(desc(estatePlanSnapshots.generatedAt))
    .all();

  const directiveByAccount = new Map(
    directiveRows.map((row) => [row.accountId, row]),
  );
  const beneficiaryById = new Map(beneficiaryRows.map((row) => [row.id, row]));
  const activityByAccount = latestActivityByAccount(userId);
  const valueAsOfDate = dateInputForTimezone(settings.timezone, now);
  const rateAsOf = `${valueAsOfDate}T23:59:59.999Z`;
  const staleCutoff = new Date(now);
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - STALE_AFTER_DAYS);
  const reviewItems: EstateReviewItem[] = [];
  const residualPrimary = residueRows.filter((row) => row.tier === "primary");
  const residualPrimaryTotal = residualPrimary.reduce(
    (sum, row) => sum + row.allocationBps,
    0,
  );
  const residualContingentTotal = residueRows
    .filter((row) => row.tier === "contingent")
    .reduce((sum, row) => sum + row.allocationBps, 0);

  if (!beneficiaryRows.some((row) => !row.archivedAt)) {
    reviewItems.push({
      code: "no-beneficiaries",
      message: "Add at least one active beneficiary.",
      severity: "blocking",
    });
  }
  if (
    residueRows.some(
      (row) => beneficiaryById.get(row.beneficiaryId)?.archivedAt,
    )
  ) {
    reviewItems.push({
      code: "archived-residual-beneficiary",
      message: "A residual allocation references an archived beneficiary.",
      severity: "blocking",
    });
  }
  if (
    residualPrimaryTotal > 0 &&
    residualPrimaryTotal !== FULL_ALLOCATION_BPS
  ) {
    reviewItems.push({
      code: "residue-incomplete",
      message: "Primary residual allocations must total 100% when used.",
      severity: "blocking",
    });
  }
  if (
    residualContingentTotal > 0 &&
    residualContingentTotal !== FULL_ALLOCATION_BPS
  ) {
    reviewItems.push({
      code: "residue-contingent-incomplete",
      message: "Contingent residual allocations must total 100% when used.",
      severity: "blocking",
    });
  }

  let grossAssetsBaseMinor = 0n;
  let liabilitiesBaseMinor = 0n;
  let totalsComplete = true;
  const beneficiaryTotals = new Map<
    string,
    { amountBaseMinor: bigint; incomplete: boolean }
  >();
  for (const beneficiary of beneficiaryRows) {
    beneficiaryTotals.set(beneficiary.id, {
      amountBaseMinor: 0n,
      incomplete: false,
    });
  }

  const assetRows = accountRows
    .filter((account) => !account.isLiability)
    .map((account) => {
      const directive = directiveByAccount.get(account.id);
      const isIncluded =
        directive?.isIncluded ??
        (!account.archivedAt && account.isIncludedInNetWorth);
      const ownershipShareBps =
        directive?.ownershipShareBps ?? FULL_ALLOCATION_BPS;
      const estateValueMinor = isIncluded
        ? scaleByBasisPoints(account.currentValueMinor, ownershipShareBps)
        : 0n;
      let estateValueBaseMinor: bigint | null = null;
      if (isIncluded) {
        try {
          estateValueBaseMinor = convertMinor(
            estateValueMinor,
            account.currency,
            settings.baseCurrency,
            rateRows,
            rateAsOf,
          );
          grossAssetsBaseMinor += estateValueBaseMinor;
        } catch (error) {
          if (!(error instanceof MissingExchangeRateError)) throw error;
          totalsComplete = false;
          reviewItems.push({
            code: "missing-rate",
            message: `Add an exchange rate for ${account.currency}/${settings.baseCurrency} to value ${account.name}.`,
            severity: "blocking",
            accountId: account.id,
          });
        }
      }

      const rows = directive
        ? allocationRows.filter((row) => row.directiveId === directive.id)
        : [];
      const primaryRows = rows.filter((row) => row.tier === "primary");
      const contingentRows = rows.filter((row) => row.tier === "contingent");
      const primaryAllocatedBps = primaryRows.reduce(
        (sum, row) => sum + row.allocationBps,
        0,
      );
      const contingentAllocatedBps = contingentRows.reduce(
        (sum, row) => sum + row.allocationBps,
        0,
      );
      const unallocatedBps = Math.max(
        0,
        FULL_ALLOCATION_BPS - primaryAllocatedBps,
      );
      const primaryWeights = [
        ...primaryRows.map((row) => ({
          key: `allocation:${row.id}`,
          numerator: BigInt(row.allocationBps) * BigInt(FULL_ALLOCATION_BPS),
        })),
        ...residualPrimary.map((row) => ({
          key: `residual:${row.id}`,
          numerator: BigInt(unallocatedBps) * BigInt(row.allocationBps),
        })),
      ];
      const primarySourceAmounts = apportionMinorUnits(
        estateValueMinor,
        primaryWeights,
        BigInt(FULL_ALLOCATION_BPS) ** 2n,
      );
      const primaryBaseAmounts =
        estateValueBaseMinor === null
          ? null
          : apportionMinorUnits(
              estateValueBaseMinor,
              primaryWeights,
              BigInt(FULL_ALLOCATION_BPS) ** 2n,
            );
      const contingentWeights = contingentRows.map((row) => ({
        key: `allocation:${row.id}`,
        numerator: BigInt(row.allocationBps),
      }));
      const contingentSourceAmounts = apportionMinorUnits(
        estateValueMinor,
        contingentWeights,
        BigInt(FULL_ALLOCATION_BPS),
      );
      const contingentBaseAmounts =
        estateValueBaseMinor === null
          ? null
          : apportionMinorUnits(
              estateValueBaseMinor,
              contingentWeights,
              BigInt(FULL_ALLOCATION_BPS),
            );
      const allocationView = rows.map((row) => {
        const beneficiary = beneficiaryById.get(row.beneficiaryId)!;
        const key = `allocation:${row.id}`;
        const sourceAmounts =
          row.tier === "primary"
            ? primarySourceAmounts
            : contingentSourceAmounts;
        const baseAmounts =
          row.tier === "primary" ? primaryBaseAmounts : contingentBaseAmounts;
        const amountMinor = sourceAmounts.get(key) ?? 0n;
        const amountBaseMinor =
          baseAmounts === null ? null : (baseAmounts.get(key) ?? 0n);
        if (row.tier === "primary") {
          const total = beneficiaryTotals.get(row.beneficiaryId)!;
          if (amountBaseMinor === null) total.incomplete = true;
          else total.amountBaseMinor += amountBaseMinor;
        }
        return {
          ...row,
          beneficiaryName: beneficiary.name,
          beneficiaryKind: beneficiary.kind,
          beneficiaryArchivedAt: beneficiary.archivedAt,
          amountMinor: amountMinor.toString(),
          amountBaseMinor: amountBaseMinor?.toString() ?? null,
        };
      });
      const residualView = residualPrimary.map((row) => {
        const beneficiary = beneficiaryById.get(row.beneficiaryId)!;
        const residualShareBps = new Decimal(unallocatedBps)
          .mul(row.allocationBps)
          .div(FULL_ALLOCATION_BPS)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
          .toNumber();
        const key = `residual:${row.id}`;
        const amountMinor = primarySourceAmounts.get(key) ?? 0n;
        const amountBaseMinor =
          primaryBaseAmounts === null
            ? null
            : (primaryBaseAmounts.get(key) ?? 0n);
        const total = beneficiaryTotals.get(row.beneficiaryId)!;
        if (amountBaseMinor === null) total.incomplete = true;
        else total.amountBaseMinor += amountBaseMinor;
        return {
          ...row,
          beneficiaryName: beneficiary.name,
          beneficiaryKind: beneficiary.kind,
          beneficiaryArchivedAt: beneficiary.archivedAt,
          effectiveAccountBps: residualShareBps,
          amountMinor: amountMinor.toString(),
          amountBaseMinor: amountBaseMinor?.toString() ?? null,
        };
      });

      if (isIncluded && !directive) {
        reviewItems.push({
          code: "asset-unconfigured",
          message: `Review estate ownership and distribution for ${account.name}.`,
          severity: "blocking",
          accountId: account.id,
        });
      }
      if (
        isIncluded &&
        primaryAllocatedBps < FULL_ALLOCATION_BPS &&
        residualPrimaryTotal !== FULL_ALLOCATION_BPS
      ) {
        reviewItems.push({
          code: "allocation-incomplete",
          message: `${account.name} has ${(unallocatedBps / 100).toFixed(2)}% without a complete primary or residual allocation.`,
          severity: "blocking",
          accountId: account.id,
        });
      }
      if (
        isIncluded &&
        contingentAllocatedBps > 0 &&
        contingentAllocatedBps !== FULL_ALLOCATION_BPS
      ) {
        reviewItems.push({
          code: "contingent-incomplete",
          message: `Contingent allocations for ${account.name} must total 100% when used.`,
          severity: "blocking",
          accountId: account.id,
        });
      }
      if (isIncluded && directive?.transferContext === "unknown") {
        reviewItems.push({
          code: "transfer-context-unknown",
          message: `Confirm how ${account.name} is legally held or designated.`,
          severity: "warning",
          accountId: account.id,
        });
      }
      if (isIncluded && directive?.distributionMethod === "undecided") {
        reviewItems.push({
          code: "distribution-undecided",
          message: `Choose how ${account.name} should be distributed.`,
          severity: "warning",
          accountId: account.id,
        });
      }
      if (isIncluded && account.currentValueMinor === 0) {
        reviewItems.push({
          code: "zero-value",
          message: `${account.name} currently has a zero value.`,
          severity: "warning",
          accountId: account.id,
        });
      }
      const latestActivityAt =
        activityByAccount.get(account.id) ?? account.createdAt;
      if (isIncluded && new Date(latestActivityAt) < staleCutoff) {
        reviewItems.push({
          code: "stale-value",
          message: `Review the value of ${account.name}; its latest financial activity is over one year old.`,
          severity: "warning",
          accountId: account.id,
        });
      }
      if (account.archivedAt && directive?.isIncluded) {
        reviewItems.push({
          code: "archived-asset",
          message: `${account.name} is archived but remains in the estate plan.`,
          severity: "blocking",
          accountId: account.id,
        });
      }
      if (
        isIncluded &&
        directive?.distributionMethod === "transfer_asset" &&
        primaryRows.length > 1
      ) {
        reviewItems.push({
          code: "shared-title-review",
          message: `${account.name} is assigned for transfer to multiple beneficiaries; confirm shared title is practical.`,
          severity: "warning",
          accountId: account.id,
        });
      }
      if (
        isIncluded &&
        (allocationView.some((row) => row.beneficiaryArchivedAt) ||
          residualView.some((row) => row.beneficiaryArchivedAt))
      ) {
        reviewItems.push({
          code: "archived-beneficiary",
          message: `${account.name} references an archived beneficiary.`,
          severity: "blocking",
          accountId: account.id,
        });
      }

      return {
        id: account.id,
        name: account.name,
        categoryName: account.categoryName,
        institutionName: account.institutionName,
        accountReference: account.accountReference,
        currency: account.currency,
        currentValueMinor: String(account.currentValueMinor),
        archivedAt: account.archivedAt,
        latestActivityAt,
        directiveId: directive?.id ?? null,
        isIncluded,
        ownershipShareBps,
        transferContext: directive?.transferContext ?? "unknown",
        distributionMethod: directive?.distributionMethod ?? "undecided",
        documentReference: directive?.documentReference ?? null,
        notes: directive?.notes ?? null,
        reviewedAt: directive?.reviewedAt ?? null,
        estateValueMinor: estateValueMinor.toString(),
        estateValueBaseMinor: estateValueBaseMinor?.toString() ?? null,
        primaryAllocatedBps,
        contingentAllocatedBps,
        unallocatedBps,
        allocations: allocationView,
        residualAllocations: residualView,
      };
    });

  const liabilityRows = accountRows
    .filter((account) => account.isLiability && !account.archivedAt)
    .map((account) => {
      let valueBaseMinor: bigint | null = null;
      try {
        valueBaseMinor = convertMinor(
          account.currentValueMinor,
          account.currency,
          settings.baseCurrency,
          rateRows,
          rateAsOf,
        );
        liabilitiesBaseMinor += valueBaseMinor;
      } catch (error) {
        if (!(error instanceof MissingExchangeRateError)) throw error;
        totalsComplete = false;
        reviewItems.push({
          code: "liability-missing-rate",
          message: `Add an exchange rate for ${account.currency}/${settings.baseCurrency} to value liability ${account.name}.`,
          severity: "blocking",
          accountId: account.id,
        });
      }
      return {
        id: account.id,
        name: account.name,
        categoryName: account.categoryName,
        institutionName: account.institutionName,
        currency: account.currency,
        valueMinor: String(account.currentValueMinor),
        valueBaseMinor: valueBaseMinor?.toString() ?? null,
      };
    });
  if (liabilityRows.length) {
    reviewItems.push({
      code: "liabilities-review",
      message:
        "Review how debts, secured claims, taxes, and estate expenses may affect actual gifts.",
      severity: "warning",
    });
  }
  if (!plan.lastReviewedDate) {
    reviewItems.push({
      code: "plan-not-reviewed",
      message: "Record when you last reviewed this plan.",
      severity: "warning",
    });
  }

  return {
    plan,
    ownerDisplayName: settings.displayName,
    baseCurrency: settings.baseCurrency,
    timezone: settings.timezone,
    preferredDateFormat: settings.preferredDateFormat,
    valueAsOfDate,
    beneficiaries: beneficiaryRows,
    assets: assetRows,
    liabilities: liabilityRows,
    residuaryAllocations: residueRows.map((row) => ({
      ...row,
      beneficiaryName: beneficiaryById.get(row.beneficiaryId)!.name,
      beneficiaryArchivedAt: beneficiaryById.get(row.beneficiaryId)!.archivedAt,
    })),
    snapshots: snapshotRows,
    totals: {
      grossAssetsBaseMinor: grossAssetsBaseMinor.toString(),
      liabilitiesBaseMinor: liabilitiesBaseMinor.toString(),
      netEstateBaseMinor: (
        grossAssetsBaseMinor - liabilitiesBaseMinor
      ).toString(),
      complete: totalsComplete,
    },
    beneficiaryTotals: beneficiaryRows.map((beneficiary) => ({
      beneficiaryId: beneficiary.id,
      beneficiaryName: beneficiary.name,
      amountBaseMinor: beneficiaryTotals
        .get(beneficiary.id)!
        .amountBaseMinor.toString(),
      incomplete: beneficiaryTotals.get(beneficiary.id)!.incomplete,
    })),
    reviewItems,
    mathematicallyComplete: !reviewItems.some(
      (item) =>
        item.severity === "blocking" &&
        [
          "no-beneficiaries",
          "asset-unconfigured",
          "allocation-incomplete",
          "contingent-incomplete",
          "residue-incomplete",
          "residue-contingent-incomplete",
          "archived-beneficiary",
          "archived-residual-beneficiary",
          "archived-asset",
        ].includes(item.code),
    ),
  };
}

export type EstateWorkspace = ReturnType<typeof getEstateWorkspace>;

export type EstateSnapshotContent = ReturnType<typeof estateSnapshotContent>;

function estateSnapshotContent(
  workspace: ReturnType<typeof getEstateWorkspace>,
  generatedAt: string,
) {
  return {
    format: "wealthboard-estate-summary" as const,
    version: 1 as const,
    generatedAt,
    valueAsOfDate: workspace.valueAsOfDate,
    ownerDisplayName: workspace.ownerDisplayName,
    plan: {
      title: workspace.plan.title,
      jurisdiction: workspace.plan.jurisdiction,
      lastReviewedDate: workspace.plan.lastReviewedDate,
      reviewReminderDate: workspace.plan.reviewReminderDate,
    },
    baseCurrency: workspace.baseCurrency,
    totals: workspace.totals,
    beneficiaries: workspace.beneficiaries.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      relationship: row.relationship,
      contactSummary: row.contactSummary,
      notes: row.notes,
      archivedAt: row.archivedAt,
    })),
    assets: workspace.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      categoryName: asset.categoryName,
      institutionName: asset.institutionName,
      accountReference: asset.accountReference,
      currency: asset.currency,
      archivedAt: asset.archivedAt,
      latestActivityAt: asset.latestActivityAt,
      isIncluded: asset.isIncluded,
      ownershipShareBps: asset.ownershipShareBps,
      transferContext: asset.transferContext,
      distributionMethod: asset.distributionMethod,
      documentReference: asset.documentReference,
      notes: asset.notes,
      reviewedAt: asset.reviewedAt,
      estateValueMinor: asset.estateValueMinor,
      estateValueBaseMinor: asset.estateValueBaseMinor,
      primaryAllocatedBps: asset.primaryAllocatedBps,
      contingentAllocatedBps: asset.contingentAllocatedBps,
      unallocatedBps: asset.unallocatedBps,
      allocations: asset.allocations.map((allocation) => ({
        id: allocation.id,
        beneficiaryId: allocation.beneficiaryId,
        beneficiaryName: allocation.beneficiaryName,
        beneficiaryKind: allocation.beneficiaryKind,
        beneficiaryArchivedAt: allocation.beneficiaryArchivedAt,
        tier: allocation.tier,
        allocationBps: allocation.allocationBps,
        notes: allocation.notes,
        amountMinor: allocation.amountMinor,
        amountBaseMinor: allocation.amountBaseMinor,
      })),
      residualAllocations: asset.residualAllocations.map((allocation) => ({
        id: allocation.id,
        beneficiaryId: allocation.beneficiaryId,
        beneficiaryName: allocation.beneficiaryName,
        beneficiaryKind: allocation.beneficiaryKind,
        beneficiaryArchivedAt: allocation.beneficiaryArchivedAt,
        tier: allocation.tier,
        allocationBps: allocation.allocationBps,
        notes: allocation.notes,
        effectiveAccountBps: allocation.effectiveAccountBps,
        amountMinor: allocation.amountMinor,
        amountBaseMinor: allocation.amountBaseMinor,
      })),
    })),
    liabilities: workspace.liabilities,
    residuaryAllocations: workspace.residuaryAllocations.map((allocation) => ({
      id: allocation.id,
      beneficiaryId: allocation.beneficiaryId,
      beneficiaryName: allocation.beneficiaryName,
      beneficiaryArchivedAt: allocation.beneficiaryArchivedAt,
      tier: allocation.tier,
      allocationBps: allocation.allocationBps,
      notes: allocation.notes,
    })),
    beneficiaryTotals: workspace.beneficiaryTotals,
    reviewItems: workspace.reviewItems,
    mathematicallyComplete: workspace.mathematicallyComplete,
    disclaimer:
      "This Estate Planning Summary is a planning record, not a legally executed will. It does not transfer ownership or replace locally valid legal documents and provider designations.",
  };
}

export function createEstatePlanSnapshot(userId: string, now = new Date()) {
  const workspace = getEstateWorkspace(userId, now);
  const generatedAt = now.toISOString();
  const content = JSON.stringify(estateSnapshotContent(workspace, generatedAt));
  const contentHash = createHash("sha256").update(content).digest("hex");
  const id = crypto.randomUUID();
  getDatabase()
    .insert(estatePlanSnapshots)
    .values({
      id,
      userId,
      estatePlanId: workspace.plan.id,
      version: 1,
      title: workspace.plan.title,
      valueAsOfDate: workspace.valueAsOfDate,
      baseCurrency: workspace.baseCurrency,
      content,
      contentHash,
      generatedAt,
    })
    .run();
  return id;
}

export function getEstatePlanSnapshot(userId: string, snapshotId: string) {
  const row = getDatabase()
    .query.estatePlanSnapshots.findFirst({
      where: and(
        eq(estatePlanSnapshots.userId, userId),
        eq(estatePlanSnapshots.id, snapshotId),
      ),
    })
    .sync();
  if (!row) return undefined;
  const actualHash = createHash("sha256").update(row.content).digest("hex");
  if (actualHash !== row.contentHash) {
    throw new EstatePlanningError(
      "The estate summary snapshot failed its integrity check.",
    );
  }
  return {
    ...row,
    content: JSON.parse(row.content) as EstateSnapshotContent,
  };
}

export function deleteEstatePlanSnapshot(userId: string, snapshotId: string) {
  const result = getDatabase()
    .delete(estatePlanSnapshots)
    .where(
      and(
        eq(estatePlanSnapshots.userId, userId),
        eq(estatePlanSnapshots.id, snapshotId),
      ),
    )
    .run();
  if (!result.changes)
    throw new EstatePlanningError("Estate summary not found.");
}
