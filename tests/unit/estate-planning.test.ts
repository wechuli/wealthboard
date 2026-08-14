// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { categories, estateAllocations } from "@/db/schema";
import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createAccount, updateAccount } from "@/lib/services/accounts";
import {
  apportionMinorUnits,
  createBeneficiary,
  createEstatePlanSnapshot,
  deleteEstatePlanSnapshot,
  ensureEstatePlan,
  getEstatePlanSnapshot,
  getEstateWorkspace,
  setBeneficiaryArchived,
  updateBeneficiary,
  upsertEstateAllocation,
  upsertEstateDirective,
  upsertResiduaryAllocation,
} from "@/lib/services/estate-planning";
import { exportData, restoreUserData } from "@/lib/services/portability";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wealthboard-estate-"));
const databasePath = path.join(workspace, "estate.db");

describe.sequential("estate planning", () => {
  let aliceId = "";
  let bobId = "";
  let aliceAssetId = "";
  let aliceLiabilityId = "";
  let aliceLiabilityCategoryId = "";
  let alicePrimaryId = "";
  let aliceAlternateId = "";
  let directiveId = "";

  beforeAll(async () => {
    const sqlite = new Database(databasePath);
    sqlite.pragma("foreign_keys = OFF");
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.pragma("foreign_keys = ON");
    expect(sqlite.pragma("foreign_key_check")).toHaveLength(0);
    sqlite.close();
    process.env.DATABASE_PATH = databasePath;
    process.env.SESSION_SECRET =
      "estate-test-session-secret-longer-than-32-characters";

    aliceId = (
      await registerUser({
        username: "estate-alice",
        displayName: "Alice Estate",
        password: "alice-estate-password-123",
      })
    ).userId;
    bobId = (
      await registerUser({
        username: "estate-bob",
        displayName: "Bob Estate",
        password: "bob-estate-password-12345",
      })
    ).userId;

    const db = getDatabase();
    const savingsCategoryId = db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.userId, aliceId), eq(categories.slug, "savings")),
      )
      .get()!.id;
    aliceLiabilityCategoryId = db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.userId, aliceId), eq(categories.slug, "liability")),
      )
      .get()!.id;
    aliceAssetId = createAccount(aliceId, {
      name: "Family savings",
      categoryId: savingsCategoryId,
      currency: "KES",
      openingValue: "100.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    aliceLiabilityId = createAccount(aliceId, {
      name: "Estate loan",
      categoryId: aliceLiabilityCategoryId,
      currency: "KES",
      openingValue: "20.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("keeps beneficiaries and plans owner scoped", () => {
    expect(ensureEstatePlan(aliceId).id).not.toBe(ensureEstatePlan(bobId).id);
    alicePrimaryId = createBeneficiary(aliceId, {
      kind: "person",
      name: "Amina Example",
      relationship: "Child",
    });
    aliceAlternateId = createBeneficiary(aliceId, {
      kind: "trust",
      name: "Education Trust",
    });

    expect(() =>
      updateBeneficiary(bobId, alicePrimaryId, {
        kind: "person",
        name: "Foreign edit",
      }),
    ).toThrow("Beneficiary not found");
    expect(getEstateWorkspace(bobId).beneficiaries).toEqual([]);
    expect(
      getEstateWorkspace(aliceId).beneficiaries.map((row) => row.name),
    ).toEqual(["Amina Example", "Education Trust"]);
  });

  test("apportions minor units without overstating split or residual gifts", () => {
    const direct = apportionMinorUnits(
      1n,
      [
        { key: "beneficiary-a", numerator: 5_000n },
        { key: "beneficiary-b", numerator: 5_000n },
      ],
      10_000n,
    );
    expect([...direct.values()].sort()).toEqual([0n, 1n]);
    expect([...direct.values()].reduce((sum, amount) => sum + amount, 0n)).toBe(
      1n,
    );

    const primaryAndResidue = apportionMinorUnits(
      1n,
      [
        { key: "primary", numerator: 50_000_000n },
        { key: "residue", numerator: 50_000_000n },
      ],
      100_000_000n,
    );
    expect([...primaryAndResidue.values()].sort()).toEqual([0n, 1n]);
    expect(
      [...primaryAndResidue.values()].reduce((sum, amount) => sum + amount, 0n),
    ).toBe(1n);
  });

  test("rejects liabilities and foreign accounts as estate directives", () => {
    expect(() =>
      upsertEstateDirective(aliceId, aliceLiabilityId, {
        isIncluded: true,
        ownershipShareBps: 10_000,
        transferContext: "estate",
        distributionMethod: "sell_and_divide",
      }),
    ).toThrow("Liabilities cannot be assigned");
    expect(() =>
      upsertEstateDirective(bobId, aliceAssetId, {
        isIncluded: true,
        ownershipShareBps: 10_000,
        transferContext: "estate",
        distributionMethod: "sell_and_divide",
      }),
    ).toThrow("asset is unavailable");
  });

  test("enforces exact allocation limits transactionally", () => {
    directiveId = upsertEstateDirective(aliceId, aliceAssetId, {
      isIncluded: true,
      ownershipShareBps: 5_000,
      transferContext: "estate",
      distributionMethod: "sell_and_divide",
      reviewedAt: "2026-08-11",
    });
    expect(() =>
      updateAccount(aliceId, aliceAssetId, {
        name: "Family savings",
        categoryId: aliceLiabilityCategoryId,
        currency: "KES",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("Exclude this account from the estate plan");
    upsertEstateAllocation(aliceId, directiveId, {
      beneficiaryId: alicePrimaryId,
      tier: "primary",
      allocationBps: 6_000,
    });
    expect(() =>
      upsertEstateAllocation(aliceId, directiveId, {
        beneficiaryId: aliceAlternateId,
        tier: "primary",
        allocationBps: 5_000,
      }),
    ).toThrow("cannot exceed 100%");
    expect(
      getDatabase()
        .select()
        .from(estateAllocations)
        .where(eq(estateAllocations.userId, aliceId))
        .all(),
    ).toHaveLength(1);

    upsertEstateAllocation(aliceId, directiveId, {
      beneficiaryId: aliceAlternateId,
      tier: "primary",
      allocationBps: 4_000,
    });
    const estate = getEstateWorkspace(
      aliceId,
      new Date("2026-08-11T10:00:00.000Z"),
    );
    expect(estate.assets[0]).toMatchObject({
      estateValueMinor: "5000",
      primaryAllocatedBps: 10_000,
      unallocatedBps: 0,
    });
    expect(estate.totals).toMatchObject({
      grossAssetsBaseMinor: "5000",
      liabilitiesBaseMinor: "2000",
      netEstateBaseMinor: "3000",
      complete: true,
    });
    expect(estate.beneficiaryTotals).toEqual([
      expect.objectContaining({
        beneficiaryId: alicePrimaryId,
        amountBaseMinor: "3000",
      }),
      expect.objectContaining({
        beneficiaryId: aliceAlternateId,
        amountBaseMinor: "2000",
      }),
    ]);
    expect(estate.mathematicallyComplete).toBe(true);
  });

  test("uses residue for unallocated shares and blocks archived recipients from new gifts", () => {
    upsertEstateAllocation(aliceId, directiveId, {
      beneficiaryId: alicePrimaryId,
      tier: "primary",
      allocationBps: 5_000,
    });
    upsertResiduaryAllocation(aliceId, {
      beneficiaryId: aliceAlternateId,
      tier: "primary",
      allocationBps: 10_000,
    });
    const estate = getEstateWorkspace(
      aliceId,
      new Date("2026-08-11T10:00:00.000Z"),
    );
    expect(estate.assets[0].unallocatedBps).toBe(1_000);
    expect(estate.assets[0].residualAllocations[0]).toMatchObject({
      beneficiaryId: aliceAlternateId,
      effectiveAccountBps: 1_000,
      amountMinor: "500",
    });

    setBeneficiaryArchived(aliceId, aliceAlternateId, true);
    const archivedRecipientPlan = getEstateWorkspace(
      aliceId,
      new Date("2026-08-11T10:00:00.000Z"),
    );
    expect(archivedRecipientPlan.reviewItems).toContainEqual(
      expect.objectContaining({
        code: "archived-residual-beneficiary",
        severity: "blocking",
      }),
    );
    expect(archivedRecipientPlan.mathematicallyComplete).toBe(false);
    expect(() =>
      upsertEstateAllocation(aliceId, directiveId, {
        beneficiaryId: aliceAlternateId,
        tier: "contingent",
        allocationBps: 10_000,
      }),
    ).toThrow("beneficiary is unavailable");
  });

  test("creates immutable owner-scoped snapshots with integrity hashes", () => {
    const snapshotId = createEstatePlanSnapshot(
      aliceId,
      new Date("2026-08-11T10:00:00.000Z"),
    );
    const before = getEstatePlanSnapshot(aliceId, snapshotId)!;
    expect(before.content.format).toBe("wealthboard-estate-summary");
    expect(before.content.assets[0].estateValueMinor).toBe("5000");
    expect(before.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(getEstatePlanSnapshot(bobId, snapshotId)).toBeUndefined();

    upsertEstateDirective(aliceId, aliceAssetId, {
      isIncluded: true,
      ownershipShareBps: 10_000,
      transferContext: "estate",
      distributionMethod: "sell_and_divide",
    });
    expect(
      getEstatePlanSnapshot(aliceId, snapshotId)!.content.assets[0]
        .estateValueMinor,
    ).toBe("5000");
    expect(() => deleteEstatePlanSnapshot(bobId, snapshotId)).toThrow(
      "Estate summary not found",
    );
    deleteEstatePlanSnapshot(aliceId, snapshotId);
    expect(getEstatePlanSnapshot(aliceId, snapshotId)).toBeUndefined();
  });

  test("round-trips estate relationships in v7 and upgrades v5 with an empty plan", async () => {
    setBeneficiaryArchived(aliceId, aliceAlternateId, false);
    const snapshotId = createEstatePlanSnapshot(
      aliceId,
      new Date("2026-08-11T11:00:00.000Z"),
    );
    const archive = await exportData(aliceId);
    expect(archive.version).toBe(7);
    expect(archive.beneficiaries).toHaveLength(2);
    expect(archive.estateAccountDirectives).toHaveLength(1);
    expect(archive.estateAllocations).toHaveLength(2);
    expect(archive.estatePlanSnapshots).toContainEqual(
      expect.objectContaining({ id: snapshotId }),
    );
    expect(archive.estatePlanSnapshots[0].content).not.toContain('"userId"');
    expect(JSON.stringify(archive)).not.toContain('"userId"');

    restoreUserData(aliceId, archive);
    const restored = getEstateWorkspace(aliceId);
    expect(restored.beneficiaries.map((row) => row.name)).toEqual([
      "Amina Example",
      "Education Trust",
    ]);
    expect(restored.assets[0].allocations).toHaveLength(2);
    expect(restored.snapshots).toHaveLength(1);

    const versionFive = structuredClone(archive) as Record<string, unknown> & {
      accounts: Array<Record<string, unknown>>;
    };
    versionFive.version = 5;
    delete versionFive.investmentInstruments;
    delete versionFive.positionEvents;
    delete versionFive.securityPrices;
    delete versionFive.positionReconciliations;
    delete versionFive.beneficiaries;
    delete versionFive.estatePlans;
    delete versionFive.estateAccountDirectives;
    delete versionFive.estateAllocations;
    delete versionFive.estateResiduaryAllocations;
    delete versionFive.estatePlanSnapshots;
    versionFive.accounts = versionFive.accounts.map((account) => {
      const legacyAccount = { ...account };
      delete legacyAccount.trackingMode;
      return legacyAccount;
    });
    restoreUserData(aliceId, versionFive);
    const upgraded = getEstateWorkspace(aliceId);
    expect(upgraded.beneficiaries).toEqual([]);
    expect(upgraded.assets[0].directiveId).toBeNull();
    expect(upgraded.snapshots).toEqual([]);
  });
});
