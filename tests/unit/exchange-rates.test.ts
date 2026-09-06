// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { categories, exchangeRates } from "@/db/schema";

import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createAccount } from "@/lib/services/accounts";
import { getDashboardData } from "@/lib/services/analytics";
import { convertMinor } from "@/lib/money";
import {
  addExchangeRate,
  deleteExchangeRate,
  listExchangeRateGroups,
  listExchangeRates,
} from "@/lib/services/settings";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wealthboard-rates-"));
let ownerId: string;
let otherId: string;

beforeAll(async () => {
  process.env.SESSION_SECRET =
    "exchange-rate-tests-secret-longer-than-32-characters";
  const databasePath = path.join(workspace, "rates.db");
  const sqlite = new Database(databasePath);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve("db/migrations") });
  sqlite.close();
  closeDatabase();
  process.env.DATABASE_PATH = databasePath;
  ownerId = (
    await registerUser({
      username: "rate-owner",
      displayName: "Rate Owner",
      password: "fictional-rate-password",
      baseCurrency: "KES",
    })
  ).userId;
  otherId = (
    await registerUser({
      username: "rate-other",
      displayName: "Rate Other",
      password: "fictional-rate-password",
      baseCurrency: "KES",
    })
  ).userId;
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("preserves dated rates, corrects entries, prevents inverse duplicates, and scopes deletion", async () => {
  const pair = { baseCurrency: "USD", quoteCurrency: "KES" };
  addExchangeRate(ownerId, {
    ...pair,
    rate: "130",
    effectiveDate: "2026-01-01",
  });
  addExchangeRate(ownerId, {
    ...pair,
    rate: "129",
    effectiveDate: "2026-02-01",
  });
  const rates = await listExchangeRates(ownerId);
  expect(rates).toHaveLength(2);
  expect(convertMinor(100n, "USD", "KES", rates, "2026-01-15")).toBe(13000n);
  expect(convertMinor(12900n, "KES", "USD", rates, "2026-02-15")).toBe(100n);
  expect(() =>
    addExchangeRate(ownerId, {
      baseCurrency: "KES",
      quoteCurrency: "USD",
      rate: "0.01",
      effectiveDate: "2026-03-01",
    }),
  ).toThrow("inverse is calculated automatically");
  expect(() =>
    addExchangeRate(otherId, {
      ...pair,
      id: rates[0].id,
      rate: "1",
      effectiveDate: "2026-02-01",
    }),
  ).toThrow("not found");
  expect(() => deleteExchangeRate(otherId, rates[0].id)).toThrow("not found");
  expect(await listExchangeRates(ownerId)).toEqual(rates);
  expect(() =>
    addExchangeRate(ownerId, {
      ...pair,
      id: rates[0].id,
      rate: "128",
      effectiveDate: "2026-01-01",
    }),
  ).toThrow("already exists");
  addExchangeRate(ownerId, {
    ...pair,
    id: rates[0].id,
    rate: "128",
    effectiveDate: "2026-02-02",
  });
  expect(await listExchangeRates(ownerId)).toHaveLength(2);
  expect(
    convertMinor(100n, "USD", "KES", await listExchangeRates(ownerId)),
  ).toBe(12800n);
  addExchangeRate(ownerId, {
    ...pair,
    rate: "127",
    effectiveDate: "2026-02-02",
  });
  expect(await listExchangeRates(ownerId)).toHaveLength(2);
  deleteExchangeRate(ownerId, rates[0].id);
  expect(
    convertMinor(100n, "USD", "KES", await listExchangeRates(ownerId)),
  ).toBe(13000n);
  deleteExchangeRate(ownerId, rates[1].id);
  expect(() => convertMinor(100n, "USD", "KES", [])).toThrow(
    "No exchange rate",
  );
});

test("separates missing history from current missing and stale rates", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-06T08:00:00.000Z"));
  try {
    const category = getDatabase()
      .select()
      .from(categories)
      .where(eq(categories.userId, ownerId))
      .get()!;
    createAccount(ownerId, {
      name: "Dollar savings",
      categoryId: category.id,
      currency: "USD",
      openingValue: "100",
      openedAt: "2026-01-01",
      isIncludedInNetWorth: true,
    });
    const pair = { baseCurrency: "USD", quoteCurrency: "KES" };
    const missing = await getDashboardData(ownerId, "all");
    expect(missing.currentComplete).toBe(false);
    expect(missing.currentRateIssues).toEqual([{ ...pair, status: "missing" }]);
    addExchangeRate(ownerId, {
      ...pair,
      rate: "130",
      effectiveDate: "2026-09-01",
    });
    const fresh = await getDashboardData(ownerId, "all");
    expect(fresh.currentComplete).toBe(true);
    expect(fresh.currentRateIssues).toEqual([]);
    expect(fresh.totals.netWorth).toBe(1_300_000n);
    expect(fresh.historyComplete).toBe(false);
    expect(fresh.historicalRateGaps).toEqual([
      expect.objectContaining({
        ...pair,
        affectedFrom: "2026-01-01T12:00:00.000Z",
      }),
    ]);
    addExchangeRate(ownerId, {
      ...pair,
      rate: "125",
      effectiveDate: "2026-01-01",
    });
    expect((await getDashboardData(ownerId, "all")).historicalRateGaps).toEqual(
      [],
    );
    const latest = (await listExchangeRates(ownerId))[0];
    addExchangeRate(ownerId, {
      ...pair,
      id: latest.id,
      rate: "129",
      effectiveDate: "2026-08-05",
    });
    const stale = await getDashboardData(ownerId, "all");
    expect(stale.currentComplete).toBe(true);
    expect(stale.totals.netWorth).toBe(1_290_000n);
    expect(stale.currentRateIssues).toEqual([
      {
        ...pair,
        status: "stale",
        rate: "129",
        effectiveDate: "2026-08-05T12:00:00.000Z",
      },
    ]);
    expect((await getDashboardData(otherId)).currentRateIssues).toEqual([]);
    expect((await getDashboardData(otherId)).historicalRateGaps).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("groups legacy inverse entries without discarding history or selecting future rates", async () => {
  addExchangeRate(otherId, {
    baseCurrency: "USD",
    quoteCurrency: "KES",
    rate: "130",
    effectiveDate: "2026-01-01",
  });
  const inverseId = crypto.randomUUID();
  getDatabase()
    .insert(exchangeRates)
    .values({
      id: inverseId,
      userId: otherId,
      baseCurrency: "KES",
      quoteCurrency: "USD",
      rate: "0.01",
      effectiveDate: "2026-02-01T12:00:00.000Z",
      source: "manual",
      createdAt: "2026-02-01T12:00:00.000Z",
    })
    .run();
  addExchangeRate(otherId, {
    baseCurrency: "USD",
    quoteCurrency: "KES",
    rate: "140",
    effectiveDate: "2027-01-01",
  });
  const groups = await listExchangeRateGroups(otherId, "2026-02-15");
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    key: "KES/USD",
    needsReview: true,
    status: "Up to date",
    latest: { id: inverseId },
  });
  expect(groups[0].history).toHaveLength(3);
  expect(groups[0].latest).not.toHaveProperty("userId");
  addExchangeRate(otherId, {
    id: inverseId,
    baseCurrency: "KES",
    quoteCurrency: "USD",
    rate: "0.02",
    effectiveDate: "2026-02-01",
  });
  expect(
    convertMinor(
      100n,
      "USD",
      "KES",
      await listExchangeRates(otherId),
      "2026-02-15",
    ),
  ).toBe(5000n);
  deleteExchangeRate(otherId, inverseId);
  const corrected = await listExchangeRateGroups(otherId, "2026-02-15");
  expect(corrected[0]).toMatchObject({
    needsReview: false,
    latest: { rate: "130" },
  });
  expect(corrected[0].history).toHaveLength(2);
});
