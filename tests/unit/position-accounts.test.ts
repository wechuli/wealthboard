// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { accounts, categories } from "@/db/schema";
import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  createAccount,
  getAccount,
  updateAccount,
} from "@/lib/services/accounts";
import {
  createInvestmentInstrument,
  getPositionAccountSnapshot,
  recordPositionEvent,
  setInvestmentInstrumentArchived,
  setSecurityPrice,
  updatePositionEvent,
} from "@/lib/services/investments";
import {
  commitInvestmentHistory,
  previewInvestmentHistory,
} from "@/lib/services/investment-history-import";
import { exportData, restoreUserData } from "@/lib/services/portability";
import { getDashboardData, getNetWorthAt } from "@/lib/services/analytics";
import { getEstateWorkspace } from "@/lib/services/estate-planning";
import { createGoal, listGoals } from "@/lib/services/goals";
import {
  addExchangeRate,
  listReferencedCurrencies,
} from "@/lib/services/settings";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-position-accounts-"),
);
const databasePath = path.join(workspace, "positions.db");

describe.sequential("position account valuation", () => {
  let userId = "";
  let categoryId = "";
  let otherUserId = "";
  let otherCategoryId = "";

  function currentCategoryId() {
    return getDatabase()
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.userId, userId), eq(categories.slug, "securities")),
      )
      .get()!.id;
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET =
      "unit-test-session-secret-longer-than-32-characters";
    process.env.TZ = "Africa/Nairobi";
    const sqlite = new Database(databasePath);
    sqlite.pragma("foreign_keys = OFF");
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.pragma("foreign_keys = ON");
    expect(sqlite.pragma("foreign_key_check")).toHaveLength(0);
    sqlite.close();
    closeDatabase();
    process.env.DATABASE_PATH = databasePath;

    const user = await registerUser({
      username: "position-owner",
      displayName: "Position Owner",
      password: "position-owner-password",
      baseCurrency: "USD",
    });
    userId = user.userId;
    const other = await registerUser({
      username: "position-other",
      displayName: "Other Position Owner",
      password: "position-other-password",
      baseCurrency: "USD",
    });
    otherUserId = other.userId;
    categoryId = getDatabase()
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.userId, userId), eq(categories.slug, "securities")),
      )
      .get()!.id;
    otherCategoryId = getDatabase()
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.userId, otherUserId),
          eq(categories.slug, "securities"),
        ),
      )
      .get()!.id;
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("derives cash plus fractional positions in exact minor units", async () => {
    const accountId = createAccount(userId, {
      name: "Brokerage",
      categoryId,
      currency: "USD",
      trackingMode: "positions",
      openingValue: "100.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Example World ETF",
      symbol: "EWLD",
      identifierType: "ticker_exchange",
      identifier: "EWLD",
      exchangeMic: "XNAS",
      assetType: "etf",
      quoteCurrency: "USD",
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "opening_position",
      quantity: "10.5",
      tradeDate: "2026-01-01",
    });
    setSecurityPrice(userId, {
      instrumentId,
      price: "145.67",
      effectiveDate: "2026-01-01",
    });

    const snapshot = getPositionAccountSnapshot(userId, accountId);
    expect(snapshot.cashMinor).toBe(10_000n);
    expect(snapshot.positionsMinor).toBe(152_954n);
    expect(snapshot.totalMinor).toBe(162_954n);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.positions[0]).toMatchObject({
      quantity: "10.5",
      quoteValueMinor: 152_954n,
      accountValueMinor: 152_954n,
    });
    expect((await getAccount(userId, accountId))?.currentValueMinor).toBe(
      162_954,
    );
  });

  test("keeps balance accounts on the existing replay path", async () => {
    const accountId = createAccount(userId, {
      name: "Cash",
      categoryId,
      currency: "USD",
      openingValue: "25.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const account = await getAccount(userId, accountId);
    expect(account?.trackingMode).toBe("balance");
    expect(account?.currentValueMinor).toBe(2_500);
  });

  test("rolls back a sale that would make quantity negative", async () => {
    const account = getDatabase()
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.name, "Brokerage")))
      .get()!;
    const instrumentId = getPositionAccountSnapshot(userId, account.id)
      .positions[0].instrument.id;

    expect(() =>
      recordPositionEvent(userId, {
        accountId: account.id,
        instrumentId,
        type: "sell",
        quantity: "11",
        unitPrice: "145.67",
        tradeDate: "2026-02-01",
      }),
    ).toThrow("negative quantity");
    expect(
      getPositionAccountSnapshot(userId, account.id).positions[0].quantity,
    ).toBe("10.5");
  });

  test("corrects events atomically and protects mode and archive invariants", async () => {
    const account = getDatabase()
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.name, "Brokerage")))
      .get()!;
    const position = getPositionAccountSnapshot(userId, account.id)
      .positions[0];
    const eventId = recordPositionEvent(userId, {
      accountId: account.id,
      instrumentId: position.instrument.id,
      type: "sell",
      quantity: "2",
      unitPrice: "145.67",
      tradeDate: "2026-02-01",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      getPositionAccountSnapshot(userId, account.id).positions[0].quantity,
    ).toBe("8.5");

    expect(() =>
      updatePositionEvent(userId, eventId, {
        accountId: account.id,
        instrumentId: position.instrument.id,
        type: "sell",
        quantity: "11",
        unitPrice: "145.67",
        tradeDate: "2026-02-01",
      }),
    ).toThrow("negative quantity");
    expect(
      getPositionAccountSnapshot(userId, account.id).positions[0].quantity,
    ).toBe("8.5");

    updatePositionEvent(userId, eventId, {
      accountId: account.id,
      instrumentId: position.instrument.id,
      type: "sell",
      quantity: "1",
      unitPrice: "145.67",
      tradeDate: "2026-02-01",
    });
    expect(
      getPositionAccountSnapshot(userId, account.id).positions[0].quantity,
    ).toBe("9.5");
    expect(() =>
      setInvestmentInstrumentArchived(userId, position.instrument.id, true),
    ).toThrow("Close every holding");
    expect(() =>
      updateAccount(userId, account.id, {
        name: account.name,
        categoryId: account.categoryId,
        currency: account.currency,
        trackingMode: "balance",
        isIncludedInNetWorth: true,
      }),
    ).toThrow("tracking mode cannot be changed");
  });

  test("denies direct foreign investment IDs", () => {
    const otherAccountId = createAccount(otherUserId, {
      name: "Other Brokerage",
      categoryId: otherCategoryId,
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const otherInstrumentId = createInvestmentInstrument(otherUserId, {
      name: "Other ETF",
      symbol: "OTHR",
      identifierType: "ticker_exchange",
      identifier: "OTHR",
      exchangeMic: "XNAS",
      assetType: "etf",
      quoteCurrency: "USD",
    });
    expect(() => getPositionAccountSnapshot(userId, otherAccountId)).toThrow(
      "Account not found",
    );
    expect(() =>
      recordPositionEvent(userId, {
        accountId: otherAccountId,
        instrumentId: otherInstrumentId,
        type: "opening_position",
        quantity: "1",
        tradeDate: "2026-01-01",
      }),
    ).toThrow("Position account not found");
    expect(() =>
      setSecurityPrice(userId, {
        instrumentId: otherInstrumentId,
        price: "10",
        effectiveDate: "2026-01-01",
      }),
    ).toThrow("Instrument not found");
  });

  test("feeds derived values into net worth, allocation, and estate", async () => {
    const account = getDatabase()
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.name, "Brokerage")))
      .get()!;
    const dashboard = await getDashboardData(userId, "all");
    expect(dashboard.instrumentAllocation).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "EWLD" })]),
    );
    const historical = await getNetWorthAt(
      userId,
      new Date("2026-01-01T12:00:00.000Z"),
    );
    expect(historical.complete).toBe(true);
    expect(historical.netWorth).toBeGreaterThan(0);

    const estate = getEstateWorkspace(
      userId,
      new Date("2026-08-14T12:00:00.000Z"),
    );
    const brokerage = estate.assets.find((asset) => asset.name === "Brokerage");
    expect(brokerage?.currentValueMinor).toBe(
      getPositionAccountSnapshot(userId, account.id).totalMinor.toString(),
    );
    expect(estate.reviewItems).toContainEqual(
      expect.objectContaining({
        code: "stale-security-price",
        accountId: account.id,
      }),
    );
  });

  test("previews, atomically imports, and round-trips position history", async () => {
    const accountId = createAccount(userId, {
      name: "Imported Brokerage",
      categoryId,
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const archive = JSON.stringify({
      format: "wealthboard-investment-history",
      version: 1,
      instruments: [
        {
          external_id: "instrument:ewld",
          name: "Imported World ETF",
          symbol: "IEWD",
          identifier_type: "ticker_exchange",
          identifier: "IEWD",
          exchange_mic: "XNAS",
          asset_type: "etf",
          quote_currency: "USD",
        },
      ],
      position_events: [
        {
          external_id: "event:opening:ewld",
          instrument_external_id: "instrument:ewld",
          type: "opening_position",
          quantity: "2.5",
          unit_price: null,
          trade_currency: "USD",
          fee_amount: null,
          fee_currency: null,
          cash_effect: null,
          applied_exchange_rate: null,
          opening_cost_basis: "200.00",
          trade_date: "2026-01-01",
          settlement_date: null,
          description: "Opening holding",
          notes: null,
        },
      ],
      cash_transactions: [
        {
          external_id: "cash:deposit:1",
          type: "deposit",
          amount: "50.00",
          date: "2026-01-01",
          description: "Broker cash",
          notes: null,
        },
      ],
      prices: [
        {
          external_id: "price:ewld:2026-01-01",
          instrument_external_id: "instrument:ewld",
          price: "100.25",
          effective_date: "2026-01-01",
          source: "statement",
          provenance: "January statement",
        },
      ],
    });

    const preview = previewInvestmentHistory(
      userId,
      accountId,
      archive,
      "json",
    );
    expect(preview.canCommit).toBe(true);
    expect(preview.current.totalMinor).toBe(0);
    expect(preview.projected.totalMinor).toBe(30_063);
    expect((await getAccount(userId, accountId))?.currentValueMinor).toBe(0);

    const result = commitInvestmentHistory(userId, accountId, archive, "json");
    expect(result.summary.imported).toBe(4);
    expect(result.finalBalanceMinor).toBe(30_063);
    expect(getPositionAccountSnapshot(userId, accountId).totalMinor).toBe(
      30_063n,
    );

    const duplicate = previewInvestmentHistory(
      userId,
      accountId,
      archive,
      "json",
    );
    expect(duplicate.canCommit).toBe(true);
    expect(duplicate.summary.ready).toBe(0);
    expect(duplicate.summary.skippedDuplicates).toBe(4);

    const conflict = previewInvestmentHistory(
      userId,
      accountId,
      archive.replace('"price":"100.25"', '"price":"101.00"'),
      "json",
    );
    expect(conflict.canCommit).toBe(false);
    expect(conflict.summary.failed).toBeGreaterThan(0);

    const portable = await exportData(userId);
    expect(portable.version).toBe(7);
    expect(portable.investmentInstruments).toHaveLength(2);
    expect(portable.positionEvents).toContainEqual(
      expect.objectContaining({ externalId: "event:opening:ewld" }),
    );
    expect(portable.securityPrices).toHaveLength(2);
    restoreUserData(userId, portable);
    const restoredAccount = getDatabase()
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.name, "Imported Brokerage"),
        ),
      )
      .get()!;
    expect(restoredAccount.trackingMode).toBe("positions");
    expect(
      getPositionAccountSnapshot(userId, restoredAccount.id).totalMinor,
    ).toBe(30_063n);
  });

  test("requires explicit settlement data for cross-currency trades", () => {
    const accountId = createAccount(userId, {
      name: "KES Brokerage",
      categoryId: currentCategoryId(),
      currency: "KES",
      trackingMode: "positions",
      openingValue: "20000.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "US Equity",
      symbol: "USEQ",
      identifierType: "ticker_exchange",
      identifier: "USEQ",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    addExchangeRate(userId, {
      baseCurrency: "USD",
      quoteCurrency: "KES",
      rate: "130",
      effectiveDate: "2026-01-01",
    });

    expect(() =>
      recordPositionEvent(userId, {
        accountId,
        instrumentId,
        type: "buy",
        quantity: "1",
        unitPrice: "100",
        tradeCurrency: "USD",
        tradeDate: "2026-01-01",
      }),
    ).toThrow(
      "Cross-currency trades require an actual cash effect or applied settlement rate.",
    );
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 2_000_000n,
      positions: [],
    });

    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "buy",
      quantity: "1",
      unitPrice: "100",
      tradeCurrency: "USD",
      feeAmount: "1",
      appliedExchangeRate: "130",
      tradeDate: "2026-01-01",
    });
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 687_000n,
      positions: [expect.objectContaining({ quantity: "1" })],
    });
  });

  test("rejects settlement rates for same-currency trades", () => {
    const accountId = createAccount(userId, {
      name: "Same Currency Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "200.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      externalId: "instrument:scue:manual",
      name: "Same Currency Equity",
      symbol: "SCUE",
      identifierType: "ticker_exchange",
      identifier: "SCUE",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });

    expect(() =>
      recordPositionEvent(userId, {
        accountId,
        instrumentId,
        type: "buy",
        quantity: "1",
        unitPrice: "100",
        tradeCurrency: "USD",
        appliedExchangeRate: "130",
        tradeDate: "2026-01-01",
      }),
    ).toThrow(
      "An applied settlement rate is only valid for cross-currency trades.",
    );
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 20_000n,
      positions: [],
    });

    const preview = previewInvestmentHistory(
      userId,
      accountId,
      JSON.stringify({
        format: "wealthboard-investment-history",
        version: 1,
        instruments: [],
        position_events: [
          {
            external_id: "event:scue:invalid-rate",
            instrument_external_id: "instrument:scue:manual",
            type: "buy",
            quantity: "1",
            unit_price: "100",
            trade_currency: "USD",
            applied_exchange_rate: "130",
            trade_date: "2026-01-01",
          },
        ],
        cash_transactions: [],
        prices: [],
      }),
      "json",
    );
    expect(preview.canCommit).toBe(false);
    expect(preview.errors).toContainEqual(
      expect.objectContaining({
        message:
          "An applied settlement rate is only valid for cross-currency trades.",
      }),
    );
  });

  test("uses an actual cash effect without a reporting exchange rate", () => {
    const accountId = createAccount(userId, {
      name: "TZS Brokerage",
      categoryId: currentCategoryId(),
      currency: "TZS",
      trackingMode: "positions",
      openingValue: "1000.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Uganda Equity",
      symbol: "UGEQ",
      identifierType: "ticker_exchange",
      identifier: "UGEQ",
      exchangeMic: "XUGA",
      assetType: "stock",
      quoteCurrency: "UGX",
    });

    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "buy",
      quantity: "1",
      unitPrice: "1000",
      tradeCurrency: "UGX",
      cashEffect: "50.00",
      tradeDate: "2026-01-01",
    });

    expect(listReferencedCurrencies(userId)).toContain("UGX");
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 95_000n,
      positions: [expect.objectContaining({ quantity: "1" })],
    });
  });

  test("imports actual cash effects without a reporting exchange rate", () => {
    const accountId = createAccount(userId, {
      name: "Imported TZS Brokerage",
      categoryId: currentCategoryId(),
      currency: "TZS",
      trackingMode: "positions",
      openingValue: "1000.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const archive = JSON.stringify({
      format: "wealthboard-investment-history",
      version: 1,
      instruments: [
        {
          external_id: "instrument:ugeq:import",
          name: "Imported Uganda Equity",
          symbol: "IUGE",
          identifier_type: "ticker_exchange",
          identifier: "IUGE",
          exchange_mic: "XUGA",
          asset_type: "stock",
          quote_currency: "UGX",
        },
      ],
      position_events: [
        {
          external_id: "event:ugeq:buy",
          instrument_external_id: "instrument:ugeq:import",
          type: "buy",
          quantity: "1",
          unit_price: "1000",
          trade_currency: "UGX",
          cash_effect: "50.00",
          trade_date: "2026-01-01",
        },
      ],
      cash_transactions: [],
      prices: [],
    });

    const preview = previewInvestmentHistory(
      userId,
      accountId,
      archive,
      "json",
    );
    expect(preview.canCommit).toBe(true);
    expect(preview.projected.cashMinor).toBe(95_000);

    commitInvestmentHistory(userId, accountId, archive, "json");
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 95_000n,
      positions: [expect.objectContaining({ quantity: "1" })],
    });
  });

  test("rebuilds position account caches when exchange rates change", async () => {
    const accountId = createAccount(userId, {
      name: "Rate Rebuild Brokerage",
      categoryId: currentCategoryId(),
      currency: "TZS",
      trackingMode: "positions",
      openingValue: "1000.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Rate Rebuild Equity",
      symbol: "RBUE",
      identifierType: "ticker_exchange",
      identifier: "RBUE",
      exchangeMic: "XUGA",
      assetType: "stock",
      quoteCurrency: "UGX",
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "opening_position",
      quantity: "2",
      tradeCurrency: "UGX",
      tradeDate: "2026-01-01",
    });
    setSecurityPrice(userId, {
      instrumentId,
      price: "1000",
      effectiveDate: "2026-01-01",
    });

    expect(getPositionAccountSnapshot(userId, accountId).complete).toBe(false);
    expect((await getAccount(userId, accountId))?.currentValueMinor).toBe(
      100_000,
    );

    addExchangeRate(userId, {
      baseCurrency: "UGX",
      quoteCurrency: "TZS",
      rate: "0.7",
      effectiveDate: "2026-01-01",
    });

    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      complete: true,
      positionsMinor: 140_000n,
      totalMinor: 240_000n,
    });
    expect((await getAccount(userId, accountId))?.currentValueMinor).toBe(
      240_000,
    );
  });

  test("uses the evaluation date for linked position goal exchange rates", async () => {
    const accountId = createAccount(userId, {
      name: "Historical Goal Brokerage",
      categoryId: currentCategoryId(),
      currency: "KES",
      trackingMode: "positions",
      openingValue: "10000.00",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    addExchangeRate(userId, {
      baseCurrency: "TZS",
      quoteCurrency: "KES",
      rate: "10",
      effectiveDate: "2026-01-01",
    });
    addExchangeRate(userId, {
      baseCurrency: "TZS",
      quoteCurrency: "KES",
      rate: "20",
      effectiveDate: "2026-02-01",
    });
    const goalId = createGoal(userId, {
      idempotencyKey: crypto.randomUUID(),
      name: "Historical linked goal",
      targetAmount: "2000.00",
      currentAmount: "0",
      currency: "TZS",
      targetDate: "2027-01-01",
      linkedAccountId: accountId,
      icon: "target",
      status: "active",
      priority: 1,
      assumedAnnualReturn: 0,
      plannedContribution: "0",
      frequency: "monthly",
      planStartDate: "2026-01-01",
    });

    const goal = (
      await listGoals(userId, new Date("2026-01-15T12:00:00.000Z"))
    ).find((item) => item.id === goalId);
    expect(goal?.valueIncomplete).toBe(false);
    expect(goal?.currentAmountCalculated).toBe(100_000n);
  });
});
