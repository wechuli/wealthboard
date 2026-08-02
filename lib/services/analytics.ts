import "server-only";

import { asc, desc, eq, getTableColumns, isNull } from "drizzle-orm";

import {
  accounts,
  categories,
  exchangeRates,
  goals,
  transactions,
  valuationSnapshots,
} from "@/db/schema";
import {
  addUtcDays,
  addUtcMonths,
  endOfUtcDay,
  startOfUtcDay,
} from "@/lib/dates";
import {
  calculateFlowMetrics,
  replayBalance,
  transactionEffect,
  type FinancialEvent,
} from "@/lib/finance";
import { getDatabase } from "@/lib/db";
import {
  convertMinor,
  MissingExchangeRateError,
  safeChartNumber,
} from "@/lib/money";
import Decimal from "decimal.js";

type HistoryRange = "1m" | "3m" | "6m" | "1y" | "all";

function eventMap() {
  const db = getDatabase();
  const transactionRows = db.select().from(transactions).all();
  const valuationRows = db.select().from(valuationSnapshots).all();
  const map = new Map<string, FinancialEvent[]>();
  for (const row of transactionRows) {
    const list = map.get(row.accountId) ?? [];
    list.push({
      kind: "transaction",
      type: row.type,
      amountMinor: row.amountMinor,
      date: row.transactionDate,
      createdAt: row.createdAt,
    });
    map.set(row.accountId, list);
  }
  for (const row of valuationRows) {
    const list = map.get(row.accountId) ?? [];
    list.push({
      kind: "valuation",
      valueMinor: row.valueMinor,
      date: row.valuationDate,
      createdAt: row.createdAt,
    });
    map.set(row.accountId, list);
  }
  return map;
}

function rangeStart(range: HistoryRange, earliest: Date, now: Date) {
  if (range === "all") return earliest;
  const days = { "1m": 30, "3m": 90, "6m": 183, "1y": 365 }[range];
  return addUtcDays(now, -days);
}

export async function getNetWorthHistory(range: HistoryRange = "1y") {
  const db = getDatabase();
  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.isIncludedInNetWorth, true));
  if (accountRows.length === 0) return [];
  const rates = await db.select().from(exchangeRates);
  const settings = await db.query.userSettings.findFirst();
  if (!settings) throw new Error("Settings unavailable.");
  const events = eventMap();
  const allDates = [...events.values()].flat().map((event) => new Date(event.date));
  const currentTime = new Date();
  const today = startOfUtcDay(currentTime);
  const earliest = allDates.length
    ? startOfUtcDay(new Date(Math.min(...allDates.map((date) => date.getTime()))))
    : today;
  let cursor = rangeStart(range, earliest, today);
  const step = range === "all" || range === "1y" || range === "6m" ? "month" : "day";
  const points: Array<{ date: string; netWorth: number; assets: number; liabilities: number }> =
    [];

  while (cursor <= today) {
    const evaluationDate = endOfUtcDay(cursor);
    points.push(
      getHistoricalPoint(
        evaluationDate,
        accountRows,
        events,
        rates,
        settings.baseCurrency,
      ),
    );
    cursor = step === "month" ? addUtcMonths(cursor, 1) : addUtcDays(cursor, 1);
  }
  const lastPoint = points.at(-1);
  if (!lastPoint || lastPoint.date.slice(0, 10) !== currentTime.toISOString().slice(0, 10)) {
    points.push(
      getHistoricalPoint(
        endOfUtcDay(currentTime),
        accountRows,
        events,
        rates,
        settings.baseCurrency,
      ),
    );
  }
  return points;
}

function getHistoricalPoint(
  date: Date,
  accountRows: Array<typeof accounts.$inferSelect>,
  events: Map<string, FinancialEvent[]>,
  rates: Array<typeof exchangeRates.$inferSelect>,
  baseCurrency: string,
) {
  let assetTotal = 0n;
  let liabilityTotal = 0n;
  for (const account of accountRows) {
    if (account.archivedAt && account.archivedAt <= date.toISOString()) continue;
    const localValue = replayBalance(events.get(account.id) ?? [], date.toISOString());
    try {
      const converted = convertMinor(
        localValue,
        account.currency,
        baseCurrency,
        rates,
        date.toISOString(),
      );
      if (account.isLiability) liabilityTotal += converted;
      else assetTotal += converted;
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
    }

  }
  return {
    date: date.toISOString(),
    assets: safeChartNumber(assetTotal),
    liabilities: safeChartNumber(liabilityTotal),
    netWorth: safeChartNumber(assetTotal - liabilityTotal),
  };
}

export async function getNetWorthAt(date: Date) {
  const db = getDatabase();
  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.isIncludedInNetWorth, true));
  const [rates, settings] = await Promise.all([
    db.select().from(exchangeRates),
    db.query.userSettings.findFirst(),
  ]);
  if (!settings) throw new Error("Settings unavailable.");
  return getHistoricalPoint(
    endOfUtcDay(date),
    accountRows,
    eventMap(),
    rates,
    settings.baseCurrency,
  );
}

export async function getDashboardData(range: HistoryRange = "1y") {
  const db = getDatabase();
  const settings = await db.query.userSettings.findFirst();
  if (!settings) throw new Error("Settings unavailable.");
  const accountRows = await db
    .select({
      ...getTableColumns(accounts),
      categoryName: categories.name,
      categoryIsLiquid: categories.isLiquid,
      categoryIsInvestible: categories.isInvestible,
    })
    .from(accounts)
    .innerJoin(categories, eq(accounts.categoryId, categories.id))
    .where(isNull(accounts.archivedAt));
  const rateRows = await db.select().from(exchangeRates);
  const transactionRows = await db
    .select({
      ...getTableColumns(transactions),
      accountName: accounts.name,
      isLiability: accounts.isLiability,
      isIncludedInNetWorth: accounts.isIncludedInNetWorth,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(isNull(accounts.archivedAt))
    .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt));
  const valuationRows = await db
    .select({
      ...getTableColumns(valuationSnapshots),
      accountName: accounts.name,
    })
    .from(valuationSnapshots)
    .innerJoin(accounts, eq(valuationSnapshots.accountId, accounts.id))
    .where(isNull(accounts.archivedAt))
    .orderBy(desc(valuationSnapshots.valuationDate), desc(valuationSnapshots.createdAt));

  let assetsTotal = 0n;
  let liabilitiesTotal = 0n;
  let liquidTotal = 0n;
  let investibleTotal = 0n;
  const missingRates = new Set<string>();
  const currentAsOf = endOfUtcDay(new Date()).toISOString();
  const allocationMap = new Map<string, bigint>();
  const investibleAllocationMap = new Map<string, bigint>();
  const institutionMap = new Map<string, bigint>();
  const currencyMap = new Map<string, bigint>();

  for (const account of accountRows) {
    if (!account.isIncludedInNetWorth) continue;
    try {
      const value = convertMinor(
        account.currentValueMinor,
        account.currency,
        settings.baseCurrency,
        rateRows,
        currentAsOf,
      );
      if (account.isLiability) liabilitiesTotal += value;
      else assetsTotal += value;
      if (!account.isLiability && account.categoryIsLiquid) liquidTotal += value;
      if (!account.isLiability && account.categoryIsInvestible) investibleTotal += value;
      if (!account.isLiability) {
        allocationMap.set(
          account.categoryName,
          (allocationMap.get(account.categoryName) ?? 0n) + value,
        );
        const institution = account.institution || "Unspecified";
        institutionMap.set(institution, (institutionMap.get(institution) ?? 0n) + value);
        currencyMap.set(
          account.currency,
          (currencyMap.get(account.currency) ?? 0n) + value,
        );
        if (account.categoryIsInvestible) {
          investibleAllocationMap.set(
            account.categoryName,
            (investibleAllocationMap.get(account.categoryName) ?? 0n) + value,
          );
        }
      }
    } catch (error) {
      if (error instanceof MissingExchangeRateError) missingRates.add(account.currency);
      else throw error;
    }
  }

  let contributions = 0n;
  let withdrawals = 0n;
  let income = 0n;
  let fees = 0n;
  let capitalGrowth = 0n;
  for (const transaction of transactionRows) {
    if (transaction.isLiability || !transaction.isIncludedInNetWorth) continue;
    try {
      const value = convertMinor(
        Math.abs(transaction.amountMinor),
        transaction.currency,
        settings.baseCurrency,
        rateRows,
        transaction.transactionDate,
      );
      const flow = calculateFlowMetrics([{ type: transaction.type, amountMinor: value }]);
      contributions += flow.contributions;
      withdrawals += flow.withdrawals;
      income += flow.interest + flow.dividends;
      fees += flow.fees;
      capitalGrowth += flow.realizedGrowth;
    } catch (error) {
      if (error instanceof MissingExchangeRateError) missingRates.add(transaction.currency);
      else throw error;
    }

  }

  const events = eventMap();
  for (const account of accountRows) {
    if (account.isLiability || !account.isIncludedInNetWorth) continue;
    let balance = 0n;
    const ordered = [...(events.get(account.id) ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
    );
    for (const event of ordered) {
      if (event.kind === "valuation") {
        const delta = BigInt(event.valueMinor) - balance;
        try {
          capitalGrowth += convertMinor(
            delta,
            account.currency,
            settings.baseCurrency,
            rateRows,
            event.date,
          );
        } catch (error) {
          if (error instanceof MissingExchangeRateError) {
            missingRates.add(account.currency);
          } else {
            throw error;
          }
        }
        balance = BigInt(event.valueMinor);
      } else {
        balance += transactionEffect(event.type, event.amountMinor);
      }
    }
  }

  const recentActivity = [
    ...transactionRows.slice(0, 12).map((row) => ({
      id: row.id,
      kind: "transaction" as const,
      type: row.type,
      accountName: row.accountName,
      amountMinor: row.amountMinor,
      currency: row.currency,
      date: row.transactionDate,
      description: row.description,
    })),
    ...valuationRows.slice(0, 12).map((row) => ({
      id: row.id,
      kind: "valuation" as const,
      type: "valuation" as const,
      accountName: row.accountName,
      amountMinor: row.valueMinor,
      currency: row.currency,
      date: row.valuationDate,
      description: row.notes,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const history = await getNetWorthHistory(range);
  const goalsCount = await db.select().from(goals);
  const toAllocation = (map: Map<string, bigint>) =>
    [...map.entries()]
      .map(([name, value]) => ({ name, value: safeChartNumber(value) }))
      .sort((a, b) => b.value - a.value);

  return {
    settings,
    totals: {
      assets: assetsTotal,
      liabilities: liabilitiesTotal,
      netWorth: assetsTotal - liabilitiesTotal,
      liquid: liquidTotal,
      investible: investibleTotal,
      contributions,
      withdrawals,
      income,
      fees,
      capitalGrowth,
    },
    allocation: toAllocation(allocationMap),
    investibleAllocation: toAllocation(investibleAllocationMap),
    institutionAllocation: toAllocation(institutionMap),
    currencyAllocation: toAllocation(currencyMap),
    history,
    recentActivity,
    missingRates: [...missingRates],
    accountCount: accountRows.length,
    goalCount: goalsCount.length,
  };
}

export async function getAccountAnalytics(accountId: string) {
  const db = getDatabase();
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!account) return null;
  const rows = await db.query.transactions.findMany({
    where: eq(transactions.accountId, accountId),
    orderBy: [asc(transactions.transactionDate)],
  });
  const values = await db.query.valuationSnapshots.findMany({
    where: eq(valuationSnapshots.accountId, accountId),
    orderBy: [asc(valuationSnapshots.valuationDate)],
  });
  const metrics = calculateFlowMetrics(rows);
  const opening = rows.find((row) => row.type === "opening_balance");
  const openingAmount = opening ? BigInt(Math.abs(opening.amountMinor)) : 0n;
  const contributionBasis =
    account.costBasisMinor == null
      ? metrics.contributions
      : BigInt(account.costBasisMinor) + metrics.contributions - openingAmount;
  const estimatedGain =
    BigInt(account.currentValueMinor) -
    contributionBasis -
    metrics.transfersIn +
    metrics.withdrawals +
    metrics.transfersOut;
  const events: FinancialEvent[] = [
    ...rows.map((row) => ({
      kind: "transaction" as const,
      type: row.type,
      amountMinor: row.amountMinor,
      date: row.transactionDate,
      createdAt: row.createdAt,
    })),
    ...values.map((row) => ({
      kind: "valuation" as const,
      valueMinor: row.valueMinor,
      date: row.valuationDate,
      createdAt: row.createdAt,
    })),
  ];
  const points = [...events]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((event) => ({
      date: event.date,
      value: safeChartNumber(replayBalance(events, event.date)),
    }));
  return { account, metrics, estimatedGain, history: points };
}

export function valuationGrowthForEvents(events: FinancialEvent[]) {
  let balance = 0n;
  let growth = 0n;
  for (const event of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    if (event.kind === "valuation") {
      growth += BigInt(event.valueMinor) - balance;
      balance = BigInt(event.valueMinor);
    } else {
      balance += transactionEffect(event.type, event.amountMinor);
    }
  }
  return growth;
}

export async function getAccountComparisons() {
  const db = getDatabase();
  const accountRows = await db
    .select()
    .from(accounts)
    .where(isNull(accounts.archivedAt))
    .orderBy(asc(accounts.name));
  const output = [];
  for (const account of accountRows) {
    const rows = await db.query.transactions.findMany({
      where: eq(transactions.accountId, account.id),
      orderBy: [asc(transactions.transactionDate)],
    });
    const metrics = calculateFlowMetrics(rows);
    const opening = rows.find((row) => row.type === "opening_balance");
    const start = opening ? BigInt(opening.amountMinor) : 0n;
    const ending = BigInt(account.currentValueMinor);
    const netFlows =
      metrics.contributions -
      start +
      metrics.transfersIn -
      metrics.withdrawals -
      metrics.transfersOut;
    const income = metrics.interest + metrics.dividends + metrics.realizedGrowth - metrics.fees;
    const firstDate = rows[0] ? new Date(rows[0].transactionDate) : new Date(account.createdAt);
    const days = Math.max(
      1,
      Math.floor((Date.now() - firstDate.getTime()) / 86_400_000),
    );
    let simpleAnnualized: string | null = null;
    let effectiveAnnualized: string | null = null;
    if (start > 0n && days >= 30) {
      const gain = ending - start - netFlows;
      const periodReturn = new Decimal(gain.toString()).div(start.toString());
      simpleAnnualized = periodReturn.mul(new Decimal(365).div(days)).mul(100).toFixed(2);
      if (periodReturn.greaterThan("-1") && days >= 90) {
        effectiveAnnualized = periodReturn
          .plus(1)
          .pow(new Decimal(365).div(days))
          .minus(1)
          .mul(100)
          .toFixed(2);
      }
    }
    output.push({
      id: account.id,
      name: account.name,
      currency: account.currency,
      startingBalance: start,
      endingBalance: ending,
      deposits: metrics.contributions - start,
      withdrawals: metrics.withdrawals,
      netIncome: income,
      days,
      simpleAnnualized,
      effectiveAnnualized,
    });
  }
  return output;
}
