import { describe, expect, it, vi } from "vitest";

import { buildEstateViewWorkspace } from "./estate-view-model";
import type { Account, EstateWorkspace, Overview } from "./types";

describe("buildEstateViewWorkspace", () => {
  it("joins directives and allocations into the original estate UI shape", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
    const estate = {
      plan: null,
      beneficiaries: [
        {
          id: "beneficiary-1",
          kind: "person",
          name: "Jordan Example",
          relationship: "Child",
          contactSummary: null,
          notes: null,
          archivedAt: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      directives: [
        {
          id: "directive-1",
          estatePlanId: "plan-1",
          accountId: "account-1",
          accountName: "Home",
          currency: "KES",
          currentValueMinor: "100000",
          isLiability: false,
          accountArchivedAt: null,
          isIncluded: true,
          ownershipShareBps: 5000,
          transferContext: "estate",
          distributionMethod: "sell_and_divide",
          documentReference: null,
          notes: null,
          reviewedAt: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      allocations: [
        {
          id: "allocation-1",
          estatePlanId: "plan-1",
          directiveId: "directive-1",
          beneficiaryId: "beneficiary-1",
          tier: "primary",
          allocationBps: 10000,
          notes: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      residuaryAllocations: [],
      snapshots: [],
      currentValuesComplete: true,
      currentValuesWarning: "",
    } as EstateWorkspace;
    const accounts = [
      {
        id: "account-1",
        categoryId: "category-1",
        name: "Home",
        currency: "KES",
        trackingMode: "balance",
        currentValueMinor: "100000",
        isLiability: false,
        isIncludedInNetWorth: true,
        categoryName: "Property",
      },
    ] as Account[];
    const settings = {
      displayName: "Casey Example",
      appName: "Wealthboard",
      baseCurrency: "KES",
      timezone: "Africa/Nairobi",
      preferredDateFormat: "medium",
      defaultDashboardPeriod: "1y",
    } as Overview["settings"];

    const result = buildEstateViewWorkspace(estate, accounts, settings);

    expect(result.valueAsOfDate).toBe("2026-09-20");
    expect(result.assets[0]).toMatchObject({
      name: "Home",
      estateValueMinor: "50000",
      estateValueBaseMinor: "50000",
      primaryAllocatedBps: 10000,
    });
    expect(result.assets[0]?.allocations[0]).toMatchObject({
      beneficiaryName: "Jordan Example",
      amountMinor: "50000",
    });
    expect(result.totals).toMatchObject({
      grossAssetsBaseMinor: "50000",
      netEstateBaseMinor: "50000",
      complete: true,
    });
    expect(result.mathematicallyComplete).toBe(true);
    expect(result.reviewItems).toContainEqual({
      code: "plan-not-reviewed",
      message: "Record when you last reviewed this plan.",
      severity: "warning",
    });
    vi.useRealTimers();
  });
});