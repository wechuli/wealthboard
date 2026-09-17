// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";

import { accounts, categories, positionEvents } from "@/db/schema";
import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase, getSqlite } from "@/lib/db";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  listArchivedAccounts,
  listTransactions,
  recordTransaction,
  recordValuation,
  setAccountArchived,
} from "@/lib/services/accounts";
import {
  getAccountAnalytics,
  getDashboardData,
  getNetWorthAt,
  getNetWorthHistory,
} from "@/lib/services/analytics";
import { getEstateWorkspace } from "@/lib/services/estate-planning";
import { createGoal, listGoals } from "@/lib/services/goals";
import { accountCsv, exportData } from "@/lib/services/portability";
import { recordTransfer } from "@/lib/services/transfers";
import {
  createInvestmentInstrument,
  deleteInvestmentInstrument,
  deletePositionEvent,
  getInvestmentInstrument,
  getPositionAccountSnapshot,
  recordInKindTransfer,
  recordPositionEvent,
  recordPositionReconciliation,
  setInvestmentInstrumentArchived,
  setSecurityPrice,
} from "@/lib/services/investments";
import { convertAccountToPositions } from "@/lib/services/account-conversion";

const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-lifecycle-"),
);
let ownerId: string;
let otherId: string;
let categoryId: string;

beforeAll(async () => {
  process.env.SESSION_SECRET =
    "account-lifecycle-test-secret-over-32-characters";
  const databasePath = path.join(workspace, "lifecycle.db");
  const sqlite = new Database(databasePath);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve("db/migrations") });
  sqlite.close();
  closeDatabase();
  process.env.DATABASE_PATH = databasePath;
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T08:00:00.000Z"));
  const fixtureId = crypto.randomUUID().slice(0, 8);
  ownerId = (
    await registerUser({
      username: `lifecycle-owner-${fixtureId}`,
      displayName: "Lifecycle Owner",
      password: "fictional-lifecycle-password",
      baseCurrency: "USD",
    })
  ).userId;
  otherId = (
    await registerUser({
      username: `lifecycle-other-${fixtureId}`,
      displayName: "Lifecycle Other",
      password: "fictional-other-password",
      baseCurrency: "USD",
    })
  ).userId;
  categoryId = getDatabase()
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.userId, ownerId), eq(categories.slug, "securities")),
    )
    .get()!.id;
});

test.each([false, true])(
  "deletes an unattached instrument and its prices without crossing users (archived: %s)",
  async (archived) => {
    const input = {
      name: "Unused Instrument",
      externalId: "unused-instrument",
      identifierType: "custom" as const,
      assetType: "etf" as const,
      quoteCurrency: "USD",
    };
    const instrumentId = createInvestmentInstrument(ownerId, input);
    const foreignId = createInvestmentInstrument(otherId, input);
    for (const [userId, targetId] of [
      [ownerId, instrumentId],
      [otherId, foreignId],
    ]) {
      setSecurityPrice(userId, {
        instrumentId: targetId,
        price: "10",
        effectiveDate: "2026-01-01",
      });
    }
    if (archived) setInvestmentInstrumentArchived(ownerId, instrumentId, true);
    const before = await exportData(ownerId);
    const foreignBefore = await exportData(otherId);
    expect(() => deleteInvestmentInstrument(otherId, instrumentId)).toThrow(
      "Instrument not found.",
    );
    expect(() =>
      deleteInvestmentInstrument(ownerId, crypto.randomUUID()),
    ).toThrow("Instrument not found.");
    expect(await exportData(ownerId)).toEqual(before);

    deleteInvestmentInstrument(ownerId, instrumentId);
    expect(getInvestmentInstrument(ownerId, instrumentId)).toBeUndefined();
    const after = await exportData(ownerId);
    expect(after.investmentInstruments).toEqual([]);
    expect(after.securityPrices).toEqual([]);
    expect(await exportData(otherId)).toEqual(foreignBefore);
    expect(getSqlite().pragma("foreign_key_check")).toHaveLength(0);
    expect(() => createInvestmentInstrument(ownerId, input)).not.toThrow();
  },
);

test.each(["active", "closed", "archived"] as const)(
  "protects instrument history in a %s account until the account is deleted",
  async (state) => {
    const accountName = `Instrument ${state} Account`;
    const accountId = createAccount(ownerId, {
      name: accountName,
      categoryId,
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      openedAt: "2026-01-01",
      isIncludedInNetWorth: true,
    });
    const instrumentId = createInvestmentInstrument(ownerId, {
      name: "Attached Instrument",
      identifierType: "custom",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    recordPositionEvent(ownerId, {
      accountId,
      instrumentId,
      type: "opening_position",
      quantity: "2",
      tradeDate: "2026-01-01",
    });
    setSecurityPrice(ownerId, {
      instrumentId,
      price: "10",
      effectiveDate: "2026-01-01",
    });
    if (state === "closed") {
      recordPositionEvent(ownerId, {
        accountId,
        instrumentId,
        type: "sell",
        quantity: "2",
        unitPrice: "10",
        tradeDate: "2026-01-02",
      });
      setInvestmentInstrumentArchived(ownerId, instrumentId, true);
    }
    if (state === "archived") setAccountArchived(ownerId, accountId, true);
    const before = await exportData(ownerId);
    expect(() => deleteInvestmentInstrument(ownerId, instrumentId)).toThrow(
      "still linked to account history",
    );
    expect(await exportData(ownerId)).toEqual(before);
    setAccountArchived(ownerId, accountId, true);
    deleteAccount(ownerId, accountId, accountName);
    expect(() =>
      deleteInvestmentInstrument(ownerId, instrumentId),
    ).not.toThrow();
    expect(getInvestmentInstrument(ownerId, instrumentId)).toBeUndefined();
    expect(getSqlite().pragma("foreign_key_check")).toHaveLength(0);
  },
);

test("protects an instrument referenced only by related corporate-action history", async () => {
  const accountId = createAccount(ownerId, {
    name: "Related Instrument Account",
    categoryId,
    currency: "USD",
    trackingMode: "positions",
    openingValue: "0",
    openedAt: "2026-01-01",
    isIncludedInNetWorth: true,
  });
  const [sourceId, destinationId] = [
    "Related Source",
    "Related Destination",
  ].map((name) =>
    createInvestmentInstrument(ownerId, {
      name,
      identifierType: "custom",
      assetType: "stock",
      quoteCurrency: "USD",
    }),
  );
  getDatabase()
    .insert(positionEvents)
    .values({
      id: crypto.randomUUID(),
      userId: ownerId,
      accountId,
      instrumentId: destinationId,
      relatedInstrumentId: sourceId,
      type: "spinoff",
      quantity: "1",
      tradeCurrency: "USD",
      tradeDate: "2026-01-01T12:00:00.000Z",
      createdAt: "2026-01-01T12:00:00.000Z",
      updatedAt: "2026-01-01T12:00:00.000Z",
    })
    .run();
  const before = await exportData(ownerId);
  expect(() => deleteInvestmentInstrument(ownerId, sourceId)).toThrow(
    "still linked to account history",
  );
  expect(await exportData(ownerId)).toEqual(before);
  expect(getSqlite().pragma("foreign_key_check")).toHaveLength(0);
});

test.each(["balance", "positions"] as const)(
  "permanently deletes an archived %s account without deleting shared instruments or goals",
  async (trackingMode) => {
    const name = `Delete ${trackingMode} Account`;
    const accountId = createAccount(ownerId, {
      name,
      categoryId,
      currency: "USD",
      trackingMode,
      openingValue: "100",
      openedAt: "2026-01-01",
      isIncludedInNetWorth: true,
    });
    recordTransaction(ownerId, {
      accountId,
      type: "deposit",
      amount: "50",
      transactionDate: "2026-01-02",
      idempotencyKey: crypto.randomUUID(),
    });
    if (trackingMode === "positions") {
      const instrumentId = createInvestmentInstrument(ownerId, {
        name: "Retained Reference Instrument",
        identifierType: "custom",
        assetType: "stock",
        quoteCurrency: "USD",
      });
      recordPositionEvent(ownerId, {
        accountId,
        instrumentId,
        type: "opening_position",
        quantity: "2",
        tradeDate: "2026-01-01",
      });
      setSecurityPrice(ownerId, {
        instrumentId,
        price: "10",
        effectiveDate: "2026-01-01",
      });
      recordPositionReconciliation(ownerId, {
        accountId,
        observationDate: "2026-01-02",
        reportedTotal: "170",
      });
    } else {
      recordValuation(ownerId, {
        accountId,
        value: "200",
        valuationDate: "2026-01-03",
        idempotencyKey: crypto.randomUUID(),
      });
    }
    const goalId = createGoal(ownerId, {
      name: `Retained ${trackingMode} Goal`,
      targetAmount: "1000",
      currency: "USD",
      targetDate: "2027-01-01",
      linkedAccountId: accountId,
      icon: "Target",
      status: "active",
      priority: 1,
      assumedAnnualReturn: 0,
      plannedContribution: "0",
      frequency: "monthly",
      planStartDate: "2026-01-01",
    });
    expect(() => deleteAccount(ownerId, accountId, name)).toThrow(
      "Archive the account",
    );
    setAccountArchived(ownerId, accountId, true);
    const before = await exportData(ownerId);
    const otherBefore = await exportData(otherId);
    expect(() => deleteAccount(otherId, accountId, name)).toThrow("not found");
    expect(() => deleteAccount(ownerId, accountId, "wrong name")).toThrow(
      "exactly",
    );
    expect(await exportData(ownerId)).toEqual(before);
    deleteAccount(ownerId, accountId, name);
    const after = await exportData(ownerId);
    expect(after.accounts.some((row) => row.id === accountId)).toBe(false);
    expect(after.transactions.some((row) => row.accountId === accountId)).toBe(
      false,
    );
    expect(after.valuations.some((row) => row.accountId === accountId)).toBe(
      false,
    );
    expect(
      after.positionEvents.some((row) => row.accountId === accountId),
    ).toBe(false);
    expect(
      after.positionReconciliations.some((row) => row.accountId === accountId),
    ).toBe(false);
    expect(after.investmentInstruments).toEqual(before.investmentInstruments);
    expect(after.securityPrices).toEqual(before.securityPrices);
    expect(after.goals.find((goal) => goal.id === goalId)).toMatchObject({
      linkedAccountId: null,
      currentAmountMinor: 0,
    });
    expect(await exportData(otherId)).toEqual(otherBefore);
    expect(getSqlite().pragma("foreign_key_check")).toHaveLength(0);
  },
);

test("refuses permanent deletion while another account has a linked transfer", async () => {
  const accountIds = ["Transfer Source", "Transfer Destination"].map((name) =>
    createAccount(ownerId, {
      name,
      categoryId,
      currency: "USD",
      openingValue: "100",
      openedAt: "2026-01-01",
      isIncludedInNetWorth: true,
    }),
  );
  recordTransfer(ownerId, {
    fromAccountId: accountIds[0],
    toAccountId: accountIds[1],
    amount: "25",
    transactionDate: "2026-01-02",
    idempotencyKey: crypto.randomUUID(),
  });
  setAccountArchived(ownerId, accountIds[0], true);
  const before = await exportData(ownerId);
  expect(() =>
    deleteAccount(ownerId, accountIds[0], "Transfer Source"),
  ).toThrow("Remove linked transfers");
  expect(await exportData(ownerId)).toEqual(before);
  expect((await getAccount(ownerId, accountIds[1]))?.currentValueMinor).toBe(
    12_500,
  );
});

afterEach(() => vi.useRealTimers());

test("freezes archived position values and rebuilds them only on restore", async () => {
  const accountId = createAccount(ownerId, {
    name: "Frozen Position Account",
    categoryId,
    currency: "USD",
    trackingMode: "positions",
    openingValue: "50",
    openedAt: "2026-01-01",
    isIncludedInNetWorth: true,
  });
  const instrumentId = createInvestmentInstrument(ownerId, {
    name: "Frozen Holding",
    identifierType: "custom",
    assetType: "stock",
    quoteCurrency: "USD",
  });
  recordPositionEvent(ownerId, {
    accountId,
    instrumentId,
    type: "opening_position",
    quantity: "10",
    tradeDate: "2026-01-01",
  });
  setSecurityPrice(ownerId, {
    instrumentId,
    price: "10",
    effectiveDate: "2026-01-01",
  });
  setAccountArchived(ownerId, accountId, true);
  setSecurityPrice(ownerId, {
    instrumentId,
    price: "20",
    effectiveDate: "2026-09-01",
  });
  expect(
    (await getAccount(ownerId, accountId, { includeArchived: true }))
      ?.currentValueMinor,
  ).toBe(15_000);
  expect(() => getPositionAccountSnapshot(ownerId, accountId)).toThrow(
    "not found",
  );
  const archivedDashboard = await getDashboardData(ownerId);
  expect(archivedDashboard.totals.netWorth).toBe(0n);
  expect(archivedDashboard.recentActivity).toEqual([]);
  expect(archivedDashboard.history).toEqual([]);
  setAccountArchived(ownerId, accountId, false);
  expect((await getAccount(ownerId, accountId))?.currentValueMinor).toBe(
    25_000,
  );
});

test("protects in-kind transfer groups until they are removed from the other account", async () => {
  const [sourceId, destinationId] = [
    "In-kind Source",
    "In-kind Destination",
  ].map((name) =>
    createAccount(ownerId, {
      name,
      categoryId,
      currency: "USD",
      trackingMode: "positions",
      openingValue: "100",
      openedAt: "2026-01-01",
      isIncludedInNetWorth: true,
    }),
  );
  const instrumentId = createInvestmentInstrument(ownerId, {
    name: "Transfer Holding",
    identifierType: "custom",
    assetType: "stock",
    quoteCurrency: "USD",
  });
  recordPositionEvent(ownerId, {
    accountId: sourceId,
    instrumentId,
    type: "opening_position",
    quantity: "5",
    tradeDate: "2026-01-01",
  });
  setSecurityPrice(ownerId, {
    instrumentId,
    price: "10",
    effectiveDate: "2026-01-01",
  });
  const groupId = recordInKindTransfer(ownerId, {
    sourceAccountId: sourceId,
    destinationAccountId: destinationId,
    instrumentId,
    quantity: "2",
    transferDate: "2026-02-01",
    feeAmount: "1",
    idempotencyKey: crypto.randomUUID(),
  });
  setAccountArchived(ownerId, sourceId, true);
  const before = await exportData(ownerId);
  expect(() => deleteAccount(ownerId, sourceId, "In-kind Source")).toThrow(
    "Remove linked transfers",
  );
  expect(await exportData(ownerId)).toEqual(before);
  const receivingEvent = before.positionEvents.find(
    (event) =>
      event.accountId === destinationId && event.eventGroupId === groupId,
  )!;
  deletePositionEvent(ownerId, receivingEvent.id);
  deleteAccount(ownerId, sourceId, "In-kind Source");
  expect(getPositionAccountSnapshot(ownerId, destinationId).totalMinor).toBe(
    10_000n,
  );
  expect(getSqlite().pragma("foreign_key_check")).toHaveLength(0);
});

test("deletes a converted source without changing its active replacement", async () => {
  const sourceId = createAccount(ownerId, {
    name: "Converted Source",
    categoryId,
    currency: "USD",
    openingValue: "100",
    openedAt: "2026-01-01",
    isIncludedInNetWorth: true,
  });
  const instrumentId = createInvestmentInstrument(ownerId, {
    name: "Converted Holding",
    identifierType: "custom",
    assetType: "stock",
    quoteCurrency: "USD",
  });
  const targetId = convertAccountToPositions(ownerId, {
    sourceAccountId: sourceId,
    targetName: "Retained Replacement",
    conversionDate: "2026-02-01",
    openingCash: "0",
    holdings: [
      { instrumentId, quantity: "10", price: "10", priceSource: "manual" },
    ],
    idempotencyKey: crypto.randomUUID(),
  });
  const before = await getAccount(ownerId, targetId);
  deleteAccount(ownerId, sourceId, "Converted Source");
  expect(await getAccount(ownerId, targetId)).toEqual(before);
  expect((await exportData(ownerId)).accountConversions).toEqual([]);
  expect(getSqlite().pragma("foreign_key_check")).toHaveLength(0);
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("archived accounts stop contributing to every live view and historical total", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T08:00:00.000Z"));
  try {
    const activeId = createAccount(ownerId, {
      name: "Retained Account",
      categoryId,
      currency: "USD",
      openingValue: "200",
      openedAt: "2026-01-01",
      isIncludedInNetWorth: true,
    });
    const archivedId = createAccount(ownerId, {
      name: "Hidden Account",
      categoryId,
      currency: "USD",
      openingValue: "100",
      openedAt: "2025-01-01",
      isIncludedInNetWorth: true,
    });
    recordTransaction(ownerId, {
      accountId: archivedId,
      type: "deposit",
      amount: "50",
      transactionDate: "2026-08-01",
      idempotencyKey: crypto.randomUUID(),
    });
    const goalId = createGoal(ownerId, {
      name: "Retained Goal",
      targetAmount: "1000",
      currency: "USD",
      targetDate: "2027-01-01",
      linkedAccountId: archivedId,
      icon: "Target",
      status: "active",
      priority: 1,
      assumedAnnualReturn: 0,
      plannedContribution: "0",
      frequency: "monthly",
      planStartDate: "2026-01-01",
    });
    expect(() => setAccountArchived(otherId, archivedId, true)).toThrow(
      "not found",
    );
    setAccountArchived(ownerId, archivedId, true);

    const dashboard = await getDashboardData(ownerId);
    expect(dashboard.totals.netWorth).toBe(20_000n);
    expect(dashboard.totals.contributions).toBe(20_000n);
    expect(
      dashboard.recentActivity.every(
        (row) => row.accountName !== "Hidden Account",
      ),
    ).toBe(true);
    expect(await getNetWorthAt(ownerId, new Date("2026-08-17"))).toMatchObject({
      netWorth: 20_000,
      complete: true,
    });
    expect((await getNetWorthHistory(ownerId, "all"))[0].date).toBe(
      "2026-01-01T23:59:59.999Z",
    );
    expect((await listAccounts(ownerId)).map((row) => row.id)).toEqual([
      activeId,
    ]);
    expect(
      (await listTransactions(ownerId)).every(
        (row) => row.accountId !== archivedId,
      ),
    ).toBe(true);
    expect(await getAccount(ownerId, archivedId)).toBeUndefined();
    expect(
      (await listArchivedAccounts(ownerId)).map((account) => account.id),
    ).toEqual([archivedId]);
    expect(await listArchivedAccounts(otherId)).toEqual([]);
    expect(await accountCsv(ownerId)).not.toContain("Hidden Account");
    expect(await getAccountAnalytics(ownerId, archivedId)).toBeNull();
    expect(
      (await listGoals(ownerId)).find((goal) => goal.id === goalId),
    ).toMatchObject({
      accountName: null,
      currentAmountCalculated: 0n,
    });
    expect(
      getEstateWorkspace(ownerId).assets.some(
        (asset) => asset.id === archivedId,
      ),
    ).toBe(false);
    expect((await exportData(ownerId)).accounts).toContainEqual(
      expect.objectContaining({
        id: archivedId,
        archivedAt: expect.any(String),
      }),
    );

    setAccountArchived(ownerId, archivedId, false);
    expect(await getAccount(ownerId, archivedId)).toBeDefined();
    expect((await getDashboardData(ownerId)).totals.netWorth).toBe(35_000n);
    expect(
      getDatabase()
        .select()
        .from(accounts)
        .where(eq(accounts.userId, otherId))
        .all(),
    ).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
