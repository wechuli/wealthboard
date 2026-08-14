// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { categories } from "@/db/schema";
import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { normalizeInstitutionName } from "@/lib/institutions";
import {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "@/lib/services/accounts";
import { getDashboardData } from "@/lib/services/analytics";
import {
  createInstitution,
  getInstitution,
  listInstitutions,
  setInstitutionArchived,
  updateInstitution,
} from "@/lib/services/institutions";
import {
  accountCsv,
  exportData,
  restoreUserData,
} from "@/lib/services/portability";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-institutions-"),
);
const databasePath = path.join(workspace, "institutions.db");

const institutionInput = {
  name: "KCB Bank",
  type: "bank" as const,
  websiteUrl: "https://ke.kcbgroup.com",
  countryCode: "KE",
  address: "Kencom House",
  notes: "Primary banking provider",
};

describe.sequential("institution directory and account linking", () => {
  let aliceId = "";
  let bobId = "";
  let aliceCategoryId = "";
  let bobCategoryId = "";
  let institutionId = "";
  let primaryAccountId = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET =
      "unit-test-session-secret-longer-than-32-characters";
    process.env.TZ = "Africa/Nairobi";

    const sqlite = new Database(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    expect(sqlite.pragma("foreign_key_check")).toHaveLength(0);
    sqlite.close();
    process.env.DATABASE_PATH = databasePath;

    ({ userId: aliceId } = await registerUser({
      username: "institution-alice",
      displayName: "Alice Institution",
      password: "correct-horse-battery-staple",
    }));
    ({ userId: bobId } = await registerUser({
      username: "institution-bob",
      displayName: "Bob Institution",
      password: "correct-horse-battery-staple",
    }));

    aliceCategoryId = getDatabase()
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.userId, aliceId))
      .get()!.id;
    bobCategoryId = getDatabase()
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.userId, bobId))
      .get()!.id;
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("normalizes names while keeping directories isolated", async () => {
    expect(normalizeInstitutionName("  KCB\t    Bank\u00a0")).toBe("kcb bank");
    expect(normalizeInstitutionName("ＫＣＢ\u00a0Bank")).toBe("ＫＣＢ bank");
    institutionId = createInstitution(aliceId, institutionInput);
    const bobInstitutionId = createInstitution(bobId, institutionInput);

    expect(() =>
      createInstitution(aliceId, {
        ...institutionInput,
        name: "  kcb   bank  ",
      }),
    ).toThrow("already exists");
    expect(() =>
      createInstitution(aliceId, {
        ...institutionInput,
        name: "Invalid website",
        websiteUrl: "javascript:alert('invalid')",
      }),
    ).toThrow();
    expect((await listInstitutions(aliceId)).map((row) => row.id)).toEqual([
      institutionId,
    ]);
    expect((await listInstitutions(bobId)).map((row) => row.id)).toEqual([
      bobInstitutionId,
    ]);
    await expect(getInstitution(bobId, institutionId)).resolves.toBeUndefined();
    expect(() =>
      updateInstitution(bobId, institutionId, {
        ...institutionInput,
        name: "Foreign rename",
      }),
    ).toThrow("not found");
    expect(() => setInstitutionArchived(bobId, institutionId, true)).toThrow(
      "not found",
    );
  });

  test("enforces owned active links and preserves archived existing links", async () => {
    primaryAccountId = createAccount(aliceId, {
      name: "Alice Primary",
      categoryId: aliceCategoryId,
      institutionId,
      currency: "KES",
      openingValue: "1000",
      isIncludedInNetWorth: true,
    });
    createAccount(aliceId, {
      name: "Alice Reserve",
      categoryId: aliceCategoryId,
      institutionId,
      currency: "KES",
      openingValue: "500",
      isIncludedInNetWorth: true,
    });
    const bobInstitutionId = (await listInstitutions(bobId))[0].id;
    expect(() =>
      createAccount(aliceId, {
        name: "Foreign provider",
        categoryId: aliceCategoryId,
        institutionId: bobInstitutionId,
        currency: "KES",
        openingValue: "1",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("unavailable");

    setInstitutionArchived(aliceId, institutionId, true);
    expect(await listInstitutions(aliceId)).toEqual([]);
    expect(
      (await listInstitutions(aliceId, { includeArchived: true }))[0]
        .accountCount,
    ).toBe(2);
    expect(() =>
      createAccount(aliceId, {
        name: "Archived provider",
        categoryId: aliceCategoryId,
        institutionId,
        currency: "KES",
        openingValue: "1",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("unavailable");

    updateAccount(aliceId, primaryAccountId, {
      name: "Alice Primary Updated",
      categoryId: aliceCategoryId,
      institutionId,
      currency: "KES",
      costBasis: "900",
      isIncludedInNetWorth: true,
    });
    await expect(getAccount(aliceId, primaryAccountId)).resolves.toMatchObject({
      institutionId,
      institutionName: "KCB Bank",
      institutionArchivedAt: expect.any(String),
    });

    expect(() =>
      createAccount(bobId, {
        name: "Wrong category owner",
        categoryId: aliceCategoryId,
        currency: "KES",
        openingValue: "1",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("category is unavailable");
    expect(await listAccounts(bobId)).toHaveLength(0);
    expect(bobCategoryId).not.toBe(aliceCategoryId);
  });

  test("renames reports without rewriting account relationships", async () => {
    updateInstitution(aliceId, institutionId, {
      ...institutionInput,
      name: "KCB Group",
    });

    const accountsAfterRename = await listAccounts(aliceId);
    expect(accountsAfterRename).toHaveLength(2);
    expect(
      accountsAfterRename.every(
        (account) =>
          account.institutionId === institutionId &&
          account.institutionName === "KCB Group",
      ),
    ).toBe(true);
    expect((await getDashboardData(aliceId)).institutionAllocation).toEqual([
      { name: "KCB Group (archived)", value: 150_000 },
    ]);
    const csv = await accountCsv(aliceId);
    expect(csv).toContain("institution_archived_at");
    expect(csv).toContain("KCB Group");
  });

  test("round-trips v8 and upgrades normalized v3 institution strings", async () => {
    const archive = await exportData(aliceId);
    expect(archive.version).toBe(8);
    expect(archive.institutions).toMatchObject([
      {
        name: "KCB Group",
        type: "bank",
        websiteUrl: "https://ke.kcbgroup.com",
        countryCode: "KE",
      },
    ]);
    expect(JSON.stringify(archive)).not.toContain('"userId"');

    const invalidNameArchive = structuredClone(archive);
    invalidNameArchive.institutions[0].name = "\u00a0";
    expect(() => restoreUserData(aliceId, invalidNameArchive)).toThrow();
    const invalidWebsiteArchive = structuredClone(archive);
    invalidWebsiteArchive.institutions[0].websiteUrl =
      "javascript:alert('invalid')";
    expect(() => restoreUserData(aliceId, invalidWebsiteArchive)).toThrow();
    const emptyRelationshipArchive = structuredClone(archive);
    emptyRelationshipArchive.accounts[0].institutionId = "";
    expect(() => restoreUserData(aliceId, emptyRelationshipArchive)).toThrow();
    expect(await listAccounts(aliceId)).toHaveLength(2);

    restoreUserData(aliceId, archive);
    const roundTrippedInstitutions = await listInstitutions(aliceId, {
      includeArchived: true,
    });
    expect(roundTrippedInstitutions).toHaveLength(1);
    expect(roundTrippedInstitutions[0]).toMatchObject({
      name: "KCB Group",
      archivedAt: expect.any(String),
      accountCount: 2,
    });

    const legacy = structuredClone(archive) as Record<string, unknown> & {
      accounts: Array<Record<string, unknown>>;
      transactions: Array<Record<string, unknown>>;
      settings: Record<string, unknown>;
    };
    const institutionNameById = new Map(
      archive.institutions.map((institution) => [
        institution.id,
        institution.name,
      ]),
    );
    legacy.version = 3;
    delete legacy.accountConversions;
    delete legacy.settings.positionStaleDaysStock;
    delete legacy.settings.positionStaleDaysEtf;
    delete legacy.settings.positionStaleDaysFund;
    delete legacy.investmentInstruments;
    delete legacy.positionEvents;
    delete legacy.securityPrices;
    delete legacy.positionReconciliations;
    delete legacy.institutions;
    delete legacy.beneficiaries;
    delete legacy.estatePlans;
    delete legacy.estateAccountDirectives;
    delete legacy.estateAllocations;
    delete legacy.estateResiduaryAllocations;
    delete legacy.estatePlanSnapshots;
    legacy.accounts = legacy.accounts.map((account, index) => {
      const institutionIdValue = account.institutionId;
      const legacyAccount = { ...account };
      delete legacyAccount.institutionId;
      delete legacyAccount.trackingMode;
      return {
        ...legacyAccount,
        institution:
          index === 0
            ? institutionNameById.get(String(institutionIdValue))
            : "  kcb   group  ",
      };
    });
    legacy.transactions = legacy.transactions.map((transaction) => {
      const legacyTransaction = { ...transaction };
      delete legacyTransaction.externalId;
      delete legacyTransaction.eventGroupId;
      return legacyTransaction;
    });

    restoreUserData(aliceId, legacy);
    const upgradedInstitutions = await listInstitutions(aliceId, {
      includeArchived: true,
    });
    expect(upgradedInstitutions).toHaveLength(1);
    expect(upgradedInstitutions[0]).toMatchObject({
      name: "KCB Group",
      type: "other",
      archivedAt: null,
      accountCount: 2,
    });
    const upgradedAccounts = await listAccounts(aliceId);
    expect(
      new Set(upgradedAccounts.map((account) => account.institutionId)),
    ).toEqual(new Set([upgradedInstitutions[0].id]));

    const versionTwo = structuredClone(legacy);
    versionTwo.version = 2;
    delete versionTwo.goalMilestones;
    delete versionTwo.goalAlertDismissals;
    restoreUserData(aliceId, versionTwo);
    expect(
      await listInstitutions(aliceId, { includeArchived: true }),
    ).toMatchObject([{ name: "KCB Group", type: "other", accountCount: 2 }]);
  });
});
