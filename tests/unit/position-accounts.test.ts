// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  accountConversions,
  accounts,
  categories,
  positionEvents,
  transactions,
  userSettings,
} from "@/db/schema";
import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  createAccount,
  deleteTransaction,
  getAccount,
  recordTransaction,
  setAccountArchived,
  updateAccount,
  updateTransaction,
} from "@/lib/services/accounts";
import {
  createInvestmentInstrument,
  deletePositionEvent,
  getPositionAccountSnapshot,
  recordDividendReinvestment,
  recordInKindTransfer,
  recordMerger,
  recordPositionEvent,
  recordSpinoff,
  recordStockSplit,
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
import { replayPositionQuantities } from "@/lib/investments";
import {
  convertAccountToPositions,
  previewAccountConversion,
} from "@/lib/services/account-conversion";
import { getPositionMovementAttribution } from "@/lib/services/investment-attribution";

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

  test("uses explicit sequence for same-date position replay", () => {
    const quantities = replayPositionQuantities([
      {
        id: "a-sell-sorts-first",
        instrumentId: "instrument-sequenced",
        type: "sell",
        quantity: "4",
        tradeDate: "2026-01-01T12:00:00.000Z",
        eventSequence: 2,
        createdAt: "2026-01-01T12:00:00.000Z",
      },
      {
        id: "z-opening-sorts-last",
        instrumentId: "instrument-sequenced",
        type: "opening_position",
        quantity: "5",
        tradeDate: "2026-01-01T12:00:00.000Z",
        eventSequence: 1,
        createdAt: "2026-01-01T12:00:00.000Z",
      },
    ]);

    expect(quantities.get("instrument-sequenced")).toBe("1");
  });

  test("applies ratio-based stock splits during replay", () => {
    const quantities = replayPositionQuantities([
      {
        id: "opening",
        instrumentId: "instrument-split",
        type: "opening_position",
        quantity: "10",
        tradeDate: "2026-01-01T12:00:00.000Z",
        eventSequence: 1,
        createdAt: "2026-01-01T12:00:00.000Z",
      },
      {
        id: "split",
        instrumentId: "instrument-split",
        type: "split",
        quantity: "0",
        actionRatioNumerator: "3",
        actionRatioDenominator: "2",
        tradeDate: "2026-02-01T12:00:00.000Z",
        eventSequence: 1,
        createdAt: "2026-02-01T12:00:00.000Z",
      },
    ]);

    expect(quantities.get("instrument-split")).toBe("15");
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
    expect(
      getDatabase()
        .query.transactions.findFirst({
          where: and(
            eq(transactions.userId, userId),
            eq(transactions.accountId, accountId),
            eq(transactions.externalId, "derived-2026-01-01-deposit-50.00"),
          ),
        })
        .sync(),
    ).toMatchObject({ amountMinor: 5_000, type: "deposit" });

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
    expect(portable.version).toBe(8);
    expect(portable.investmentInstruments).toHaveLength(2);
    expect(portable.positionEvents).toContainEqual(
      expect.objectContaining({ externalId: "event:opening:ewld" }),
    );
    expect(portable.securityPrices).toHaveLength(2);
    const duplicateSequence = structuredClone(portable);
    const sameAccountEvents = duplicateSequence.positionEvents.filter(
      (event) =>
        event.accountId === duplicateSequence.positionEvents[0].accountId,
    );
    if (sameAccountEvents.length > 1) {
      sameAccountEvents[1].tradeDate = sameAccountEvents[0].tradeDate;
      sameAccountEvents[1].eventSequence = sameAccountEvents[0].eventSequence;
      expect(() => restoreUserData(userId, duplicateSequence)).toThrow(
        "duplicate same-date",
      );
    }
    const invalidGroup = structuredClone(portable);
    const groupedEvent = invalidGroup.positionEvents.find(
      (event) => event.eventGroupId,
    );
    if (groupedEvent) {
      groupedEvent.eventGroupId = crypto.randomUUID();
      expect(() => restoreUserData(userId, invalidGroup)).toThrow(
        /group|reinvestment|transfer|merger/i,
      );
    }
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
    expect(() =>
      recordPositionEvent(userId, {
        accountId,
        instrumentId,
        type: "opening_position",
        quantity: "1",
        feeAmount: "1",
        tradeDate: "2026-01-01",
      }),
    ).toThrow("only to buys and sells");
    expect(() =>
      recordPositionEvent(userId, {
        accountId,
        instrumentId,
        type: "buy",
        quantity: "1",
        unitPrice: "100",
        openingCostBasis: "50",
        tradeDate: "2026-01-01",
      }),
    ).toThrow("only to an opening position");
    expect(() =>
      recordPositionEvent(userId, {
        accountId,
        instrumentId,
        type: "opening_position",
        quantity: "1",
        openingCostBasis: "-1",
        tradeDate: "2026-01-01",
      }),
    ).toThrow("cannot be negative");
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

  test("uses configurable freshness thresholds with detailed issue ranges", () => {
    const accountId = createAccount(userId, {
      name: "Freshness Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Freshness Equity",
      symbol: "FRESH",
      identifierType: "ticker_exchange",
      identifier: "FRESH",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "opening_position",
      quantity: "1",
      tradeDate: "2026-01-01",
    });
    setSecurityPrice(userId, {
      instrumentId,
      price: "100",
      effectiveDate: "2026-01-01",
      source: "statement",
      provenance: "January statement",
    });
    getDatabase()
      .update(userSettings)
      .set({ positionStaleDaysStock: 20 })
      .where(eq(userSettings.userId, userId))
      .run();
    expect(
      getPositionAccountSnapshot(userId, accountId, "2026-01-15T12:00:00.000Z")
        .staleInstrumentIds,
    ).toEqual([]);

    getDatabase()
      .update(userSettings)
      .set({ positionStaleDaysStock: 10 })
      .where(eq(userSettings.userId, userId))
      .run();
    const snapshot = getPositionAccountSnapshot(
      userId,
      accountId,
      "2026-01-15T12:00:00.000Z",
    );
    expect(snapshot.staleInstrumentIds).toEqual([instrumentId]);
    expect(snapshot.issues).toContainEqual({
      type: "stale_price",
      instrumentId,
      instrumentName: "Freshness Equity",
      instrumentSymbol: "FRESH",
      currency: "USD",
      affectedFrom: "2026-01-11T12:00:00.000Z",
      affectedTo: "2026-01-15T12:00:00.000Z",
      lastPriceDate: "2026-01-01T12:00:00.000Z",
      source: "statement",
      provenance: "January statement",
      thresholdDays: 10,
    });
  });

  test("never uses a future price for a historical snapshot", () => {
    const accountId = createAccount(userId, {
      name: "Historical Price Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Historical Price Equity",
      symbol: "PAST",
      identifierType: "ticker_exchange",
      identifier: "PAST",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "opening_position",
      quantity: "2",
      tradeDate: "2026-01-01",
    });
    setSecurityPrice(userId, {
      instrumentId,
      price: "10",
      effectiveDate: "2026-01-01",
    });
    setSecurityPrice(userId, {
      instrumentId,
      price: "100",
      effectiveDate: "2026-02-01",
    });

    expect(
      getPositionAccountSnapshot(userId, accountId, "2026-01-31T23:59:59.999Z")
        .positions[0],
    ).toMatchObject({
      quantity: "2",
      quoteValueMinor: 2_000n,
      price: expect.objectContaining({ price: "10" }),
    });
  });

  test("commits and deletes dividend reinvestment groups atomically", () => {
    const accountId = createAccount(userId, {
      name: "Reinvestment Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Reinvestment Fund",
      symbol: "REIN",
      identifierType: "ticker_exchange",
      identifier: "REIN",
      exchangeMic: "XNAS",
      assetType: "fund",
      quoteCurrency: "USD",
    });
    const idempotencyKey = crypto.randomUUID();
    const groupId = recordDividendReinvestment(userId, {
      accountId,
      instrumentId,
      dividendAmount: "100",
      quantity: "5",
      unitPrice: "20",
      activityDate: "2026-01-01",
      idempotencyKey,
    });
    expect(
      recordDividendReinvestment(userId, {
        accountId,
        instrumentId,
        dividendAmount: "100",
        quantity: "5",
        unitPrice: "20",
        activityDate: "2026-01-01",
        idempotencyKey,
      }),
    ).toBe(groupId);
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 0n,
      positions: [expect.objectContaining({ quantity: "5" })],
    });
    expect(
      getDatabase()
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.eventGroupId, groupId),
          ),
        )
        .all(),
    ).toHaveLength(1);
    const buy = getDatabase()
      .select()
      .from(positionEvents)
      .where(
        and(
          eq(positionEvents.userId, userId),
          eq(positionEvents.eventGroupId, groupId),
        ),
      )
      .get()!;
    deletePositionEvent(userId, buy.id);
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 0n,
      positions: [],
    });
    expect(
      getDatabase()
        .select()
        .from(transactions)
        .where(eq(transactions.eventGroupId, groupId))
        .all(),
    ).toEqual([]);
    const cashGroupId = recordDividendReinvestment(userId, {
      accountId,
      instrumentId,
      dividendAmount: "40",
      quantity: "2",
      unitPrice: "20",
      activityDate: "2026-01-15",
      idempotencyKey: crypto.randomUUID(),
    });
    const groupedCash = getDatabase()
      .select()
      .from(transactions)
      .where(eq(transactions.eventGroupId, cashGroupId))
      .get()!;
    expect(() =>
      updateTransaction(userId, groupedCash.id, {
        type: "dividend",
        amount: "50",
        transactionDate: "2026-01-15",
      }),
    ).toThrow("dedicated workflow");
    deleteTransaction(userId, groupedCash.id);
    expect(
      getDatabase()
        .select()
        .from(positionEvents)
        .where(eq(positionEvents.eventGroupId, cashGroupId))
        .all(),
    ).toEqual([]);
    const ordinaryKey = crypto.randomUUID();
    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "opening_position",
      quantity: "1",
      tradeDate: "2026-02-01",
      idempotencyKey: ordinaryKey,
    });
    expect(() =>
      recordStockSplit(userId, {
        accountId,
        instrumentId,
        numerator: "2",
        denominator: "1",
        actionDate: "2026-03-01",
        idempotencyKey: ordinaryKey,
      }),
    ).toThrow("another operation");
  });

  test("moves positions in kind atomically and rejects oversells", () => {
    const sourceAccountId = createAccount(userId, {
      name: "Transfer Source",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "10",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const destinationAccountId = createAccount(userId, {
      name: "Transfer Destination",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Transfer Equity",
      symbol: "MOVE",
      identifierType: "ticker_exchange",
      identifier: "MOVE",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    recordPositionEvent(userId, {
      accountId: sourceAccountId,
      instrumentId,
      type: "opening_position",
      quantity: "10",
      tradeDate: "2026-01-01",
    });
    const idempotencyKey = crypto.randomUUID();
    const groupId = recordInKindTransfer(userId, {
      sourceAccountId,
      destinationAccountId,
      instrumentId,
      quantity: "4",
      feeAmount: "2",
      transferDate: "2026-02-01",
      idempotencyKey,
    });
    expect(
      recordInKindTransfer(userId, {
        sourceAccountId,
        destinationAccountId,
        instrumentId,
        quantity: "4",
        feeAmount: "2",
        transferDate: "2026-02-01",
        idempotencyKey,
      }),
    ).toBe(groupId);
    expect(
      getPositionAccountSnapshot(userId, sourceAccountId).positions[0].quantity,
    ).toBe("6");
    expect(
      getPositionAccountSnapshot(userId, destinationAccountId).positions[0]
        .quantity,
    ).toBe("4");
    expect(getPositionAccountSnapshot(userId, sourceAccountId).cashMinor).toBe(
      800n,
    );
    expect(() =>
      recordInKindTransfer(userId, {
        sourceAccountId,
        destinationAccountId,
        instrumentId,
        quantity: "7",
        transferDate: "2026-03-01",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow("negative quantity");
    expect(
      getPositionAccountSnapshot(userId, sourceAccountId).positions[0].quantity,
    ).toBe("6");
    expect(() =>
      recordInKindTransfer(userId, {
        sourceAccountId,
        destinationAccountId: createAccount(otherUserId, {
          name: "Foreign Transfer Destination",
          categoryId: otherCategoryId,
          currency: "USD",
          trackingMode: "positions",
          openingValue: "0",
          isIncludedInNetWorth: true,
          openedAt: "2026-01-01",
        }),
        instrumentId,
        quantity: "1",
        transferDate: "2026-04-01",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow("Position account not found");
  });

  test("rolls back grouped deletion when later activity would oversell", () => {
    const accountId = createAccount(userId, {
      name: "Grouped Rollback Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const sourceInstrumentId = createInvestmentInstrument(userId, {
      name: "Rollback Source",
      symbol: "RBKS",
      identifierType: "ticker_exchange",
      identifier: "RBKS",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    const destinationInstrumentId = createInvestmentInstrument(userId, {
      name: "Rollback Result",
      symbol: "RBKR",
      identifierType: "ticker_exchange",
      identifier: "RBKR",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId: sourceInstrumentId,
      type: "opening_position",
      quantity: "10",
      tradeDate: "2026-01-01",
    });
    const groupId = recordMerger(userId, {
      accountId,
      sourceInstrumentId,
      destinationInstrumentId,
      numerator: "1",
      denominator: "1",
      actionDate: "2026-02-01",
      idempotencyKey: crypto.randomUUID(),
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId: destinationInstrumentId,
      type: "sell",
      quantity: "5",
      unitPrice: "10",
      tradeDate: "2026-03-01",
    });
    const mergerEvent = getDatabase()
      .select()
      .from(positionEvents)
      .where(eq(positionEvents.eventGroupId, groupId))
      .get()!;
    expect(() => deletePositionEvent(userId, mergerEvent.id)).toThrow(
      "negative quantity",
    );
    expect(
      getDatabase()
        .select()
        .from(positionEvents)
        .where(eq(positionEvents.eventGroupId, groupId))
        .all(),
    ).toHaveLength(2);
    expect(
      getPositionAccountSnapshot(userId, accountId).positions.find(
        (position) => position.instrument.id === destinationInstrumentId,
      )?.quantity,
    ).toBe("5");
  });

  test("replays split, spin-off, and merger actions", () => {
    const accountId = createAccount(userId, {
      name: "Corporate Action Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const sourceInstrumentId = createInvestmentInstrument(userId, {
      name: "Corporate Source",
      symbol: "CORP",
      identifierType: "ticker_exchange",
      identifier: "CORP",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    const spinoffInstrumentId = createInvestmentInstrument(userId, {
      name: "Spin-off Equity",
      symbol: "SPIN",
      identifierType: "ticker_exchange",
      identifier: "SPIN",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    const mergerInstrumentId = createInvestmentInstrument(userId, {
      name: "Merged Equity",
      symbol: "MRGE",
      identifierType: "ticker_exchange",
      identifier: "MRGE",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId: sourceInstrumentId,
      type: "opening_position",
      quantity: "10",
      tradeDate: "2026-01-01",
    });
    recordStockSplit(userId, {
      accountId,
      instrumentId: sourceInstrumentId,
      numerator: "3",
      denominator: "2",
      actionDate: "2026-02-01",
      idempotencyKey: crypto.randomUUID(),
    });
    recordSpinoff(userId, {
      accountId,
      sourceInstrumentId,
      newInstrumentId: spinoffInstrumentId,
      numerator: "1",
      denominator: "5",
      actionDate: "2026-03-01",
      idempotencyKey: crypto.randomUUID(),
    });
    const mergerGroupId = recordMerger(userId, {
      accountId,
      sourceInstrumentId,
      destinationInstrumentId: mergerInstrumentId,
      numerator: "2",
      denominator: "3",
      actionDate: "2026-04-01",
      idempotencyKey: crypto.randomUUID(),
    });
    const quantities = new Map(
      getPositionAccountSnapshot(userId, accountId).positions.map((row) => [
        row.instrument.id,
        row.quantity,
      ]),
    );
    expect(quantities.get(sourceInstrumentId)).toBeUndefined();
    expect(quantities.get(spinoffInstrumentId)).toBe("3");
    expect(quantities.get(mergerInstrumentId)).toBe("10");

    const mergerEvent = getDatabase()
      .select()
      .from(positionEvents)
      .where(eq(positionEvents.eventGroupId, mergerGroupId))
      .get()!;
    deletePositionEvent(userId, mergerEvent.id);
    const restored = new Map(
      getPositionAccountSnapshot(userId, accountId).positions.map((row) => [
        row.instrument.id,
        row.quantity,
      ]),
    );
    expect(restored.get(sourceInstrumentId)).toBe("15");
    expect(restored.get(mergerInstrumentId)).toBeUndefined();
  });

  test("imports grouped dividend reinvestments atomically", async () => {
    const accountId = createAccount(userId, {
      name: "Imported Reinvestment Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const archive = JSON.stringify({
      format: "wealthboard-investment-history",
      version: 1,
      instruments: [
        {
          external_id: "instrument:grouped-reinvestment",
          name: "Grouped Reinvestment Fund",
          symbol: "GRIF",
          identifier_type: "ticker_exchange",
          identifier: "GRIF",
          exchange_mic: "XNAS",
          asset_type: "fund",
          quote_currency: "USD",
        },
      ],
      position_events: [
        {
          external_id: "event:grouped-reinvestment:buy",
          instrument_external_id: "instrument:grouped-reinvestment",
          type: "buy",
          quantity: "5",
          unit_price: "20",
          trade_currency: "USD",
          cash_effect: "100",
          event_group_id: "group:reinvestment:1",
          trade_date: "2026-01-01",
        },
      ],
      cash_transactions: [
        {
          external_id: "cash:grouped-reinvestment:dividend",
          type: "dividend",
          amount: "100",
          date: "2026-01-01",
          event_group_id: "group:reinvestment:1",
        },
      ],
      prices: [],
    });
    expect(
      previewInvestmentHistory(userId, accountId, archive, "json").canCommit,
    ).toBe(true);
    commitInvestmentHistory(userId, accountId, archive, "json");
    expect(getPositionAccountSnapshot(userId, accountId)).toMatchObject({
      cashMinor: 0n,
      positions: [expect.objectContaining({ quantity: "5" })],
    });
    const event = getDatabase()
      .select()
      .from(positionEvents)
      .where(eq(positionEvents.accountId, accountId))
      .get()!;
    const cash = getDatabase()
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.type, "dividend"),
        ),
      )
      .get()!;
    expect(event.eventGroupId).toBeTruthy();
    expect(cash.eventGroupId).toBe(event.eventGroupId);
    const importedGroupId = event.eventGroupId!;
    expect(
      previewInvestmentHistory(userId, accountId, archive, "json").summary,
    ).toMatchObject({ ready: 0, skippedDuplicates: 3 });

    const expandedSource = JSON.parse(archive) as {
      position_events: Array<Record<string, unknown>>;
    };
    expandedSource.position_events.push({
      external_id: "event:grouped-reinvestment:second-buy",
      instrument_external_id: "instrument:grouped-reinvestment",
      type: "buy",
      quantity: "1",
      unit_price: "20",
      trade_currency: "USD",
      cash_effect: "20",
      event_group_id: "group:reinvestment:1",
      trade_date: "2026-01-01",
    });
    const expandedArchive = JSON.stringify(expandedSource);
    expect(
      previewInvestmentHistory(userId, accountId, expandedArchive, "json")
        .canCommit,
    ).toBe(true);
    commitInvestmentHistory(userId, accountId, expandedArchive, "json");
    expect(
      getDatabase()
        .select()
        .from(positionEvents)
        .where(eq(positionEvents.eventGroupId, importedGroupId))
        .all(),
    ).toHaveLength(2);

    const portable = await exportData(userId);
    const invalidGroup = structuredClone(portable);
    const groupedBuy = invalidGroup.positionEvents.find(
      (row) => row.eventGroupId === importedGroupId,
    )!;
    groupedBuy.eventGroupId = crypto.randomUUID();
    expect(() => restoreUserData(userId, invalidGroup)).toThrow(
      /group|reinvestment/i,
    );

    const malformed = JSON.stringify({
      ...JSON.parse(archive),
      cash_transactions: [],
    });
    const malformedPreview = previewInvestmentHistory(
      userId,
      accountId,
      malformed,
      "json",
    );
    expect(malformedPreview.canCommit).toBe(false);
    expect(malformedPreview.errors).toContainEqual(
      expect.objectContaining({ collection: "event_groups" }),
    );
  });

  test("attributes position-account movement with an exact bridge", () => {
    const accountId = createAccount(userId, {
      name: "Attribution Brokerage",
      categoryId: currentCategoryId(),
      currency: "USD",
      trackingMode: "positions",
      openingValue: "100",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Attribution Equity",
      symbol: "ATTR",
      identifierType: "ticker_exchange",
      identifier: "ATTR",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "opening_position",
      quantity: "10",
      tradeDate: "2026-01-01",
    });
    setSecurityPrice(userId, {
      instrumentId,
      price: "10",
      effectiveDate: "2026-01-01",
    });
    recordTransaction(userId, {
      accountId,
      type: "deposit",
      amount: "50",
      transactionDate: "2026-02-01",
      idempotencyKey: crypto.randomUUID(),
    });
    recordTransaction(userId, {
      accountId,
      type: "dividend",
      amount: "10",
      transactionDate: "2026-02-02",
      idempotencyKey: crypto.randomUUID(),
    });
    recordTransaction(userId, {
      accountId,
      type: "fee",
      amount: "2",
      transactionDate: "2026-02-03",
      idempotencyKey: crypto.randomUUID(),
    });
    recordPositionEvent(userId, {
      accountId,
      instrumentId,
      type: "buy",
      quantity: "2",
      unitPrice: "10",
      tradeDate: "2026-02-04",
    });
    setSecurityPrice(userId, {
      instrumentId,
      price: "12",
      effectiveDate: "2026-02-28",
    });

    expect(
      getPositionMovementAttribution(
        userId,
        accountId,
        "2026-01-01T23:59:59.999Z",
        "2026-02-28T23:59:59.999Z",
      ),
    ).toMatchObject({
      startValueMinor: 20_000n,
      endValueMinor: 28_200n,
      changeMinor: 8_200n,
      externalCashMinor: 5_000n,
      incomeMinor: 1_000n,
      feesMinor: -200n,
      internalTradeCashMinor: -2_000n,
      quantityMovementMinor: 2_000n,
      priceMovementMinor: 2_400n,
      currencyMovementMinor: 0n,
      unattributedMinor: 0n,
      complete: true,
      returnStatus: "unavailable",
    });
  });

  test("converts balance history to an idempotent linked position replacement", async () => {
    const sourceAccountId = createAccount(userId, {
      name: "Legacy Investment Balance",
      categoryId: currentCategoryId(),
      currency: "USD",
      openingValue: "1000",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Converted Equity",
      symbol: "CNVT",
      identifierType: "ticker_exchange",
      identifier: "CNVT",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    const goalId = createGoal(userId, {
      idempotencyKey: crypto.randomUUID(),
      name: "Converted account goal",
      targetAmount: "2000",
      currentAmount: "0",
      currency: "USD",
      targetDate: "2027-01-01",
      linkedAccountId: sourceAccountId,
      icon: "target",
      status: "active",
      priority: 1,
      assumedAnnualReturn: 0,
      plannedContribution: "0",
      frequency: "monthly",
      planStartDate: "2026-01-01",
    });
    const idempotencyKey = crypto.randomUUID();
    const input = {
      sourceAccountId,
      targetName: "Position Investment Replacement",
      conversionDate: "2026-02-01",
      openingCash: "200",
      holdings: [
        {
          instrumentId,
          quantity: "4",
          price: "200",
          openingCostBasis: "700",
          priceSource: "statement",
          priceProvenance: "Conversion statement",
        },
      ],
      idempotencyKey,
    };
    expect(previewAccountConversion(userId, input)).toMatchObject({
      sourceBalanceMinor: 100_000n,
      openingCashMinor: 20_000n,
      positionsMinor: 80_000n,
      projectedTotalMinor: 100_000n,
      differenceMinor: 0n,
    });
    const targetAccountId = convertAccountToPositions(userId, input);
    expect(convertAccountToPositions(userId, input)).toBe(targetAccountId);
    expect(await getAccount(userId, sourceAccountId)).toMatchObject({
      trackingMode: "balance",
      goalId: null,
      archivedAt: "2026-02-01T12:00:00.000Z",
    });
    expect(await getAccount(userId, targetAccountId)).toMatchObject({
      trackingMode: "positions",
      currentValueMinor: 100_000,
      goalId,
    });
    expect(() => setAccountArchived(userId, sourceAccountId, false)).toThrow(
      "converted source account remains archived",
    );
    expect(
      (await listGoals(userId)).find((goal) => goal.id === goalId)
        ?.linkedAccountId,
    ).toBe(targetAccountId);
    expect(
      getDatabase()
        .select()
        .from(accountConversions)
        .where(eq(accountConversions.userId, userId))
        .all(),
    ).toContainEqual(
      expect.objectContaining({
        sourceAccountId,
        targetAccountId,
        sourceBalanceMinor: 100_000,
      }),
    );
    expect(() => previewAccountConversion(otherUserId, input)).toThrow(
      "Active balance account not found",
    );

    const archive = await exportData(userId);
    expect(archive.version).toBe(8);
    expect(archive.accountConversions).toContainEqual(
      expect.objectContaining({ sourceAccountId, targetAccountId }),
    );
    restoreUserData(userId, archive);
    expect(
      getDatabase()
        .select()
        .from(accountConversions)
        .where(eq(accountConversions.userId, userId))
        .all(),
    ).toHaveLength(1);
  });

  test("rejects conversion dates before the latest source activity", () => {
    const sourceAccountId = createAccount(userId, {
      name: "Future Activity Balance",
      categoryId: currentCategoryId(),
      currency: "USD",
      openingValue: "100",
      isIncludedInNetWorth: true,
      openedAt: "2026-01-01",
    });
    recordTransaction(userId, {
      accountId: sourceAccountId,
      type: "deposit",
      amount: "50",
      transactionDate: "2026-03-01",
      idempotencyKey: crypto.randomUUID(),
    });
    const instrumentId = createInvestmentInstrument(userId, {
      name: "Temporal Conversion Equity",
      symbol: "TIME",
      identifierType: "ticker_exchange",
      identifier: "TIME",
      exchangeMic: "XNAS",
      assetType: "stock",
      quoteCurrency: "USD",
    });
    expect(() =>
      previewAccountConversion(userId, {
        sourceAccountId,
        targetName: "Temporal Replacement",
        conversionDate: "2026-02-01",
        openingCash: "0",
        holdings: [{ instrumentId, quantity: "1", price: "100" }],
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow("latest source activity");
    expect(
      getDatabase()
        .query.accountConversions.findFirst({
          where: and(
            eq(accountConversions.userId, userId),
            eq(accountConversions.sourceAccountId, sourceAccountId),
          ),
        })
        .sync(),
    ).toBeUndefined();
  });

  test("upgrades a version 7 archive to version 8 defaults", async () => {
    const current = await exportData(userId);
    const legacy = structuredClone(current) as Record<string, unknown> & {
      version: number;
      settings: Record<string, unknown>;
      transactions: Array<Record<string, unknown>>;
      positionEvents: Array<Record<string, unknown>>;
    };
    legacy.version = 7;
    delete legacy.accountConversions;
    delete legacy.settings.positionStaleDaysStock;
    delete legacy.settings.positionStaleDaysEtf;
    delete legacy.settings.positionStaleDaysFund;
    legacy.transactions = legacy.transactions.map((transaction) => {
      const copy = { ...transaction };
      delete copy.eventGroupId;
      return copy;
    });
    legacy.positionEvents = legacy.positionEvents
      .filter((event) =>
        ["opening_position", "buy", "quantity_adjustment"].includes(
          String(event.type),
        ),
      )
      .map((event) => {
        const copy = { ...event };
        delete copy.relatedInstrumentId;
        delete copy.actionRatioNumerator;
        delete copy.actionRatioDenominator;
        delete copy.eventSequence;
        return copy;
      });

    restoreUserData(userId, legacy);
    const restoredSettings = getDatabase()
      .query.userSettings.findFirst({ where: eq(userSettings.userId, userId) })
      .sync()!;
    expect(restoredSettings).toMatchObject({
      positionStaleDaysStock: 7,
      positionStaleDaysEtf: 7,
      positionStaleDaysFund: 31,
    });
    expect(
      getDatabase()
        .select()
        .from(accountConversions)
        .where(eq(accountConversions.userId, userId))
        .all(),
    ).toEqual([]);
  });
});
