import type { Account, EstateWorkspace, Overview } from "./types";

type EstateBeneficiary = EstateWorkspace["beneficiaries"][number];
type EstateAllocation = EstateWorkspace["allocations"][number];
type EstateResiduaryAllocation =
  EstateWorkspace["residuaryAllocations"][number];

export type EstateReviewItem = {
  code: string;
  message: string;
  severity: "blocking" | "warning";
  accountId?: string;
};

export type EstateAllocationView = EstateAllocation & {
  beneficiaryName: string;
  beneficiaryArchivedAt: string | null;
  amountMinor: string;
};

export type EstateAssetView = {
  id: string;
  name: string;
  categoryName: string;
  institutionName?: string;
  accountReference?: string;
  currency: string;
  archivedAt?: string;
  directiveId: string | null;
  isIncluded: boolean;
  ownershipShareBps: number;
  transferContext:
    | "estate"
    | "joint_survivorship"
    | "provider_designation"
    | "trust_entity"
    | "unknown";
  distributionMethod:
    | "transfer_asset"
    | "sell_and_divide"
    | "cash_equivalent"
    | "undecided";
  documentReference: string | null;
  notes: string | null;
  reviewedAt: string | null;
  estateValueMinor: string;
  estateValueBaseMinor: string | null;
  primaryAllocatedBps: number;
  contingentAllocatedBps: number;
  unallocatedBps: number;
  allocations: EstateAllocationView[];
  residualAllocations: Array<
    EstateResiduaryAllocation & {
      beneficiaryName: string;
      beneficiaryArchivedAt: string | null;
      effectiveAccountBps: number;
      amountMinor: string;
    }
  >;
};

export type EstateViewWorkspace = {
  plan: NonNullable<EstateWorkspace["plan"]>;
  ownerDisplayName: string;
  baseCurrency: string;
  timezone: string;
  preferredDateFormat: string;
  valueAsOfDate: string;
  beneficiaries: EstateBeneficiary[];
  assets: EstateAssetView[];
  liabilities: Array<{
    id: string;
    name: string;
    categoryName: string;
    currency: string;
    valueMinor: string;
  }>;
  residuaryAllocations: Array<
    EstateResiduaryAllocation & {
      beneficiaryName: string;
      beneficiaryArchivedAt: string | null;
    }
  >;
  snapshots: EstateWorkspace["snapshots"];
  totals: {
    grossAssetsBaseMinor: string;
    liabilitiesBaseMinor: string;
    netEstateBaseMinor: string;
    complete: boolean;
  };
  beneficiaryTotals: Array<{
    beneficiaryId: string;
    beneficiaryName: string;
    amountBaseMinor: string;
    incomplete: boolean;
  }>;
  reviewItems: EstateReviewItem[];
  mathematicallyComplete: boolean;
};

function apportion(amountMinor: string, basisPoints: number) {
  const amount = BigInt(amountMinor);
  const product = amount * BigInt(basisPoints);
  return ((product + (product >= 0n ? 5_000n : -5_000n)) / 10_000n).toString();
}

export function buildEstateViewWorkspace(
  estate: EstateWorkspace,
  accounts: Account[],
  settings: Overview["settings"],
): EstateViewWorkspace {
  const beneficiaries = new Map(
    estate.beneficiaries.map((beneficiary) => [beneficiary.id, beneficiary]),
  );
  const reviewItems: EstateReviewItem[] = [];
  const residuaryPrimaryTotal = estate.residuaryAllocations
    .filter((allocation) => allocation.tier === "primary")
    .reduce((total, allocation) => total + allocation.allocationBps, 0);
  const residuaryContingentTotal = estate.residuaryAllocations
    .filter((allocation) => allocation.tier === "contingent")
    .reduce((total, allocation) => total + allocation.allocationBps, 0);

  if (!estate.beneficiaries.some((beneficiary) => !beneficiary.archivedAt)) {
    reviewItems.push({
      code: "no-beneficiaries",
      message: "Add at least one active beneficiary.",
      severity: "blocking",
    });
  }
  if (
    estate.residuaryAllocations.some(
      (allocation) => beneficiaries.get(allocation.beneficiaryId)?.archivedAt,
    )
  ) {
    reviewItems.push({
      code: "archived-residual-beneficiary",
      message: "A residual allocation references an archived beneficiary.",
      severity: "blocking",
    });
  }
  if (residuaryPrimaryTotal > 0 && residuaryPrimaryTotal !== 10_000) {
    reviewItems.push({
      code: "residue-incomplete",
      message: "Primary residual allocations must total 100% when used.",
      severity: "blocking",
    });
  }
  if (residuaryContingentTotal > 0 && residuaryContingentTotal !== 10_000) {
    reviewItems.push({
      code: "residue-contingent-incomplete",
      message: "Contingent residual allocations must total 100% when used.",
      severity: "blocking",
    });
  }
  const assets = accounts
    .filter((account) => !account.isLiability && !account.archivedAt)
    .map((account): EstateAssetView => {
      const directive = estate.directives.find(
        (item) => item.accountId === account.id,
      );
      const allocations = directive
        ? estate.allocations.filter(
            (allocation) => allocation.directiveId === directive.id,
          )
        : [];
      const primaryAllocatedBps = allocations
        .filter((allocation) => allocation.tier === "primary")
        .reduce((total, allocation) => total + allocation.allocationBps, 0);
      const contingentAllocatedBps = allocations
        .filter((allocation) => allocation.tier === "contingent")
        .reduce((total, allocation) => total + allocation.allocationBps, 0);
      const unallocatedBps = Math.max(0, 10_000 - primaryAllocatedBps);
      const ownershipShareBps = directive?.ownershipShareBps ?? 10_000;
      const estateValueMinor = apportion(
        account.currentValueMinor,
        ownershipShareBps,
      );
      const isIncluded = directive?.isIncluded ?? account.isIncludedInNetWorth;

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
        primaryAllocatedBps < 10_000 &&
        residuaryPrimaryTotal !== 10_000
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
        contingentAllocatedBps !== 10_000
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
      if (isIncluded && BigInt(account.currentValueMinor) === 0n) {
        reviewItems.push({
          code: "zero-value",
          message: `${account.name} currently has a zero value.`,
          severity: "warning",
          accountId: account.id,
        });
      }
      if (
        isIncluded &&
        directive?.distributionMethod === "transfer_asset" &&
        allocations.filter((allocation) => allocation.tier === "primary")
          .length > 1
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
        allocations.some(
          (allocation) =>
            beneficiaries.get(allocation.beneficiaryId)?.archivedAt,
        )
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
        archivedAt: account.archivedAt,
        directiveId: directive?.id ?? null,
        isIncluded,
        ownershipShareBps,
        transferContext: directive?.transferContext ?? "unknown",
        distributionMethod: directive?.distributionMethod ?? "undecided",
        documentReference: directive?.documentReference ?? null,
        notes: directive?.notes ?? null,
        reviewedAt: directive?.reviewedAt ?? null,
        estateValueMinor,
        estateValueBaseMinor:
          account.currency === settings.baseCurrency ? estateValueMinor : null,
        primaryAllocatedBps,
        contingentAllocatedBps,
        unallocatedBps,
        allocations: allocations.map((allocation) => ({
          ...allocation,
          beneficiaryName:
            beneficiaries.get(allocation.beneficiaryId)?.name ??
            "Unknown beneficiary",
          beneficiaryArchivedAt:
            beneficiaries.get(allocation.beneficiaryId)?.archivedAt ?? null,
          amountMinor: apportion(estateValueMinor, allocation.allocationBps),
        })),
        residualAllocations: estate.residuaryAllocations
          .filter((allocation) => allocation.tier === "primary")
          .map((allocation) => {
            const effectiveAccountBps =
              (unallocatedBps * allocation.allocationBps) / 10_000;
            return {
              ...allocation,
              beneficiaryName:
                beneficiaries.get(allocation.beneficiaryId)?.name ??
                "Unknown beneficiary",
              beneficiaryArchivedAt:
                beneficiaries.get(allocation.beneficiaryId)?.archivedAt ?? null,
              effectiveAccountBps,
              amountMinor: apportion(estateValueMinor, effectiveAccountBps),
            };
          }),
      };
    });
  const liabilities = accounts
    .filter((account) => account.isLiability && !account.archivedAt)
    .map((account) => ({
      id: account.id,
      name: account.name,
      categoryName: account.categoryName,
      currency: account.currency,
      valueMinor: account.currentValueMinor,
    }));
  if (liabilities.length) {
    reviewItems.push({
      code: "liabilities-review",
      message:
        "Review how debts, secured claims, taxes, and estate expenses may affect actual gifts.",
      severity: "warning",
    });
  }
  if (!estate.plan?.lastReviewedDate) {
    reviewItems.push({
      code: "plan-not-reviewed",
      message: "Record when you last reviewed this plan.",
      severity: "warning",
    });
  }
  const grossAssets = assets
    .filter(
      (asset) => asset.isIncluded && asset.currency === settings.baseCurrency,
    )
    .reduce((total, asset) => total + BigInt(asset.estateValueMinor), 0n);
  const liabilitiesTotal = liabilities
    .filter((liability) => liability.currency === settings.baseCurrency)
    .reduce((total, liability) => total + BigInt(liability.valueMinor), 0n);
  const complete =
    estate.currentValuesComplete &&
    assets.every(
      (asset) => !asset.isIncluded || asset.currency === settings.baseCurrency,
    ) &&
    liabilities.every(
      (liability) => liability.currency === settings.baseCurrency,
    );
  const beneficiaryTotals = estate.beneficiaries.map((beneficiary) => {
    const amount = assets.reduce((total, asset) => {
      if (asset.currency !== settings.baseCurrency) return total;
      const direct = asset.allocations
        .filter(
          (allocation) =>
            allocation.beneficiaryId === beneficiary.id &&
            allocation.tier === "primary",
        )
        .reduce((sum, allocation) => sum + BigInt(allocation.amountMinor), 0n);
      const residual = asset.residualAllocations
        .filter((allocation) => allocation.beneficiaryId === beneficiary.id)
        .reduce((sum, allocation) => sum + BigInt(allocation.amountMinor), 0n);
      return total + direct + residual;
    }, 0n);
    return {
      beneficiaryId: beneficiary.id,
      beneficiaryName: beneficiary.name,
      amountBaseMinor: amount.toString(),
      incomplete: !complete,
    };
  });

  return {
    plan: estate.plan ?? {
      id: "",
      title: "My estate plan",
      jurisdiction: null,
      lastReviewedDate: null,
      reviewReminderDate: null,
      createdAt: "",
      updatedAt: "",
    },
    ownerDisplayName: settings.displayName,
    baseCurrency: settings.baseCurrency,
    timezone: settings.timezone,
    preferredDateFormat: settings.preferredDateFormat,
    valueAsOfDate: new Date().toISOString().slice(0, 10),
    beneficiaries: estate.beneficiaries,
    assets,
    liabilities,
    residuaryAllocations: estate.residuaryAllocations.map((allocation) => ({
      ...allocation,
      beneficiaryName:
        beneficiaries.get(allocation.beneficiaryId)?.name ??
        "Unknown beneficiary",
      beneficiaryArchivedAt:
        beneficiaries.get(allocation.beneficiaryId)?.archivedAt ?? null,
    })),
    snapshots: estate.snapshots,
    totals: {
      grossAssetsBaseMinor: grossAssets.toString(),
      liabilitiesBaseMinor: liabilitiesTotal.toString(),
      netEstateBaseMinor: (grossAssets - liabilitiesTotal).toString(),
      complete,
    },
    beneficiaryTotals,
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
