import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
} from "drizzle-orm";

import {
  accounts,
  categories,
  exchangeRates,
  goals,
  investmentInstruments,
  institutions,
  positionEvents,
  securityPrices,
  transactions,
  userSettings,
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
import { TRANSACTION_LABELS } from "@/lib/constants";
import {
  convertMinor,
  MissingExchangeRateError,
  safeChartNumber,
} from "@/lib/money";
import Decimal from "decimal.js";
import { calculatePositionAccountSnapshot } from "@/lib/services/investment-valuation";
import { calculateQuoteValueMinor } from "@/lib/investments";

type HistoryRange = "1m" | "3m" | "6m" | "1y" | "all";

function eventMap(userId: string) {
  const db = getDatabase();
  const transactionRows = db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .all();
  const valuationRows = db
    .select()
    .from(valuationSnapshots)
    .where(eq(valuationSnapshots.userId, userId))
    .all();
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

export async function getNetWorthHistory(
  userId: string,
  range: HistoryRange = "1y",
) {
  const db = getDatabase();
  const accountRows = await db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.isIncludedInNetWorth, true)),
    );
  if (accountRows.length === 0) return [];
  const rates = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId));
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (!settings) throw new Error("Settings unavailable.");
  const events = eventMap(userId);
  const [positionDateRows, priceDateRows] = await Promise.all([
    db
      .select({ date: positionEvents.tradeDate })
      .from(positionEvents)
      .where(eq(positionEvents.userId, userId)),
    db
      .select({ date: securityPrices.effectiveDate })
      .from(securityPrices)
      .where(eq(securityPrices.userId, userId)),
  ]);
  const allDates = [
    ...[...events.values()].flat().map((event) => event.date),
    ...positionDateRows.map((row) => row.date),
    ...priceDateRows.map((row) => row.date),
  ].map((date) => new Date(date));
  const currentTime = new Date();
  const today = startOfUtcDay(currentTime);
  const earliest = allDates.length
    ? startOfUtcDay(
        new Date(Math.min(...allDates.map((date) => date.getTime()))),
      )
    : today;
  let cursor = rangeStart(range, earliest, today);
  const step =
    range === "all" || range === "1y" || range === "6m" ? "month" : "day";
  const points: Array<{
    date: string;
    netWorth: number;
    assets: number;
    liabilities: number;
    complete: boolean;
    missingCurrencies: string[];
  }> = [];

  while (cursor <= today) {
    const evaluationDate = endOfUtcDay(cursor);
    points.push(
      getHistoricalPoint(
        userId,
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
  if (
    !lastPoint ||
    lastPoint.date.slice(0, 10) !== currentTime.toISOString().slice(0, 10)
  ) {
    points.push(
      getHistoricalPoint(
        userId,
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
  userId: string,
  date: Date,
  accountRows: Array<typeof accounts.$inferSelect>,
  events: Map<string, FinancialEvent[]>,
  rates: Array<typeof exchangeRates.$inferSelect>,
  baseCurrency: string,
) {
  let assetTotal = 0n;
  let liabilityTotal = 0n;
  const missingCurrencies = new Set<string>();
  const missingPrices = new Set<string>();
  const stalePrices = new Set<string>();
  for (const account of accountRows) {
    if (account.archivedAt && account.archivedAt <= date.toISOString())
      continue;
    const positionSnapshot =
      account.trackingMode === "positions"
        ? calculatePositionAccountSnapshot(
            userId,
            getDatabase(),
            account.id,
            date.toISOString(),
          )
        : null;
    const localValue = positionSnapshot
      ? positionSnapshot.totalMinor
      : replayBalance(events.get(account.id) ?? [], date.toISOString());
    for (const instrumentId of positionSnapshot?.missingPrices ?? []) {
      missingPrices.add(instrumentId);
    }
    for (const currency of positionSnapshot?.missingCurrencies ?? []) {
      missingCurrencies.add(currency);
    }
    for (const instrumentId of positionSnapshot?.staleInstrumentIds ?? []) {
      stalePrices.add(instrumentId);
    }
    if (localValue === 0n) continue;
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
      missingCurrencies.add(account.currency);
    }
  }
  return {
    date: date.toISOString(),
    assets: safeChartNumber(assetTotal),
    liabilities: safeChartNumber(liabilityTotal),
    netWorth: safeChartNumber(assetTotal - liabilityTotal),
    complete: missingCurrencies.size === 0 && missingPrices.size === 0,
    missingCurrencies: [...missingCurrencies],
    missingPrices: [...missingPrices],
    stalePrices: [...stalePrices],
  };
}

export async function getNetWorthAt(userId: string, date: Date) {
  const db = getDatabase();
  const accountRows = await db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.userId, userId), eq(accounts.isIncludedInNetWorth, true)),
    );
  const [rates, settings] = await Promise.all([
    db.select().from(exchangeRates).where(eq(exchangeRates.userId, userId)),
    db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) }),
  ]);
  if (!settings) throw new Error("Settings unavailable.");
  return getHistoricalPoint(
    userId,
    endOfUtcDay(date),
    accountRows,
    eventMap(userId),
    rates,
    settings.baseCurrency,
  );
}

export async function getDashboardData(
  userId: string,
  range: HistoryRange = "1y",
) {
  const db = getDatabase();
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (!settings) throw new Error("Settings unavailable.");
  const accountRows = await db
    .select({
      ...getTableColumns(accounts),
      categoryName: categories.name,
      categoryIsLiquid: categories.isLiquid,
      categoryIsInvestible: categories.isInvestible,
      institutionName: institutions.name,
      institutionArchivedAt: institutions.archivedAt,
    })
    .from(accounts)
    .innerJoin(
      categories,
      and(
        eq(accounts.categoryId, categories.id),
        eq(accounts.userId, categories.userId),
      ),
    )
    .leftJoin(
      institutions,
      and(
        eq(accounts.institutionId, institutions.id),
        eq(accounts.userId, institutions.userId),
      ),
    )
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)));
  const rateRows = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId));
  const transactionRows = await db
    .select({
      ...getTableColumns(transactions),
      accountName: accounts.name,
      isLiability: accounts.isLiability,
      isIncludedInNetWorth: accounts.isIncludedInNetWorth,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(
        eq(transactions.accountId, accounts.id),
        eq(transactions.userId, accounts.userId),
      ),
    )
    .where(and(eq(transactions.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt));
  const valuationRows = await db
    .select({
      ...getTableColumns(valuationSnapshots),
      accountName: accounts.name,
    })
    .from(valuationSnapshots)
    .innerJoin(
      accounts,
      and(
        eq(valuationSnapshots.accountId, accounts.id),
        eq(valuationSnapshots.userId, accounts.userId),
      ),
    )
    .where(
      and(eq(valuationSnapshots.userId, userId), isNull(accounts.archivedAt)),
    )
    .orderBy(
      desc(valuationSnapshots.valuationDate),
      desc(valuationSnapshots.createdAt),
    );
  const positionActivityRows = await db
    .select({
      ...getTableColumns(positionEvents),
      accountName: accounts.name,
      accountCurrency: accounts.currency,
      instrumentName: investmentInstruments.name,
      instrumentSymbol: investmentInstruments.symbol,
    })
    .from(positionEvents)
    .innerJoin(
      accounts,
      and(
        eq(positionEvents.accountId, accounts.id),
        eq(positionEvents.userId, accounts.userId),
      ),
    )
    .innerJoin(
      investmentInstruments,
      and(
        eq(positionEvents.instrumentId, investmentInstruments.id),
        eq(positionEvents.userId, investmentInstruments.userId),
      ),
    )
    .where(and(eq(positionEvents.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(desc(positionEvents.tradeDate), desc(positionEvents.createdAt));
  const securityPriceActivityRows = await db
    .select({
      ...getTableColumns(securityPrices),
      instrumentName: investmentInstruments.name,
      instrumentSymbol: investmentInstruments.symbol,
    })
    .from(securityPrices)
    .innerJoin(
      investmentInstruments,
      and(
        eq(securityPrices.instrumentId, investmentInstruments.id),
        eq(securityPrices.userId, investmentInstruments.userId),
      ),
    )
    .where(eq(securityPrices.userId, userId))
    .orderBy(
      desc(securityPrices.effectiveDate),
      desc(securityPrices.createdAt),
    );

  let assetsTotal = 0n;
  let liabilitiesTotal = 0n;
  let liquidTotal = 0n;
  let investibleTotal = 0n;
  const missingRates = new Set<string>();
  const missingPrices = new Set<string>();
  const stalePrices = new Set<string>();
  const currentAsOf = endOfUtcDay(new Date()).toISOString();
  const allocationMap = new Map<string, bigint>();
  const investibleAllocationMap = new Map<string, bigint>();
  const institutionMap = new Map<string, bigint>();
  const currencyMap = new Map<string, bigint>();
  const instrumentAllocationMap = new Map<string, bigint>();

  for (const account of accountRows) {
    if (!account.isIncludedInNetWorth) continue;
    try {
      const positionSnapshot =
        account.trackingMode === "positions"
          ? calculatePositionAccountSnapshot(
              userId,
              db,
              account.id,
              currentAsOf,
            )
          : null;
      for (const instrumentId of positionSnapshot?.missingPrices ?? []) {
        missingPrices.add(instrumentId);
      }
      for (const currency of positionSnapshot?.missingCurrencies ?? []) {
        missingRates.add(currency);
      }
      for (const instrumentId of positionSnapshot?.staleInstrumentIds ?? []) {
        stalePrices.add(instrumentId);
      }
      for (const position of positionSnapshot?.positions ?? []) {
        if (position.accountValueMinor == null) continue;
        const positionBaseValue = convertMinor(
          position.accountValueMinor,
          account.currency,
          settings.baseCurrency,
          rateRows,
          currentAsOf,
        );
        const label = position.instrument.symbol || position.instrument.name;
        instrumentAllocationMap.set(
          label,
          (instrumentAllocationMap.get(label) ?? 0n) + positionBaseValue,
        );
      }
      const value = convertMinor(
        positionSnapshot?.totalMinor ?? account.currentValueMinor,
        account.currency,
        settings.baseCurrency,
        rateRows,
        currentAsOf,
      );
      if (account.isLiability) liabilitiesTotal += value;
      else assetsTotal += value;
      if (!account.isLiability && account.categoryIsLiquid)
        liquidTotal += value;
      if (!account.isLiability && account.categoryIsInvestible)
        investibleTotal += value;
      if (!account.isLiability) {
        allocationMap.set(
          account.categoryName,
          (allocationMap.get(account.categoryName) ?? 0n) + value,
        );
        const institution = account.institutionName
          ? `${account.institutionName}${account.institutionArchivedAt ? " (archived)" : ""}`
          : "Unspecified";
        institutionMap.set(
          institution,
          (institutionMap.get(institution) ?? 0n) + value,
        );
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
      if (error instanceof MissingExchangeRateError)
        missingRates.add(account.currency);
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
      const flow = calculateFlowMetrics([
        { type: transaction.type, amountMinor: value },
      ]);
      contributions += flow.contributions;
      withdrawals += flow.withdrawals;
      income += flow.interest + flow.dividends;
      fees += flow.fees;
      capitalGrowth += flow.realizedGrowth;
    } catch (error) {
      if (error instanceof MissingExchangeRateError)
        missingRates.add(transaction.currency);
      else throw error;
    }
  }

  const events = eventMap(userId);
  for (const account of accountRows) {
    if (account.isLiability || !account.isIncludedInNetWorth) continue;
    let balance = 0n;
    const ordered = [...(events.get(account.id) ?? [])].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
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
      label: TRANSACTION_LABELS[row.type],
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
      label: "Valuation update",
    })),
    ...positionActivityRows.slice(0, 12).map((row) => ({
      id: row.id,
      kind: "position" as const,
      type: row.type,
      accountName: row.accountName,
      amountMinor: row.cashEffectMinor,
      currency: row.accountCurrency,
      date: row.tradeDate,
      description: row.description,
      label: `${
        row.type === "opening_position"
          ? "Opening position"
          : row.type === "quantity_adjustment"
            ? "Quantity adjustment"
            : row.type === "buy"
              ? "Buy"
              : "Sell"
      } · ${row.instrumentSymbol || row.instrumentName}`,
    })),
    ...securityPriceActivityRows.slice(0, 12).map((row) => ({
      id: row.id,
      kind: "price" as const,
      type: "security_price" as const,
      accountName: row.instrumentSymbol || row.instrumentName,
      amountMinor: safeChartNumber(
        calculateQuoteValueMinor("1", row.price, row.currency),
      ),
      currency: row.currency,
      date: row.effectiveDate,
      description: row.provenance,
      label: "Security price update",
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const history = await getNetWorthHistory(userId, range);
  const historicalMissingRates = [
    ...new Set(history.flatMap((point) => point.missingCurrencies)),
  ];
  for (const currency of historicalMissingRates) missingRates.add(currency);
  const goalsCount = await db
    .select()
    .from(goals)
    .where(eq(goals.userId, userId));
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
    instrumentAllocation: toAllocation(instrumentAllocationMap),
    history,
    historyComplete: history.every((point) => point.complete),
    historicalMissingRates,
    recentActivity,
    missingRates: [...missingRates],
    missingPrices: [...missingPrices],
    stalePrices: [...stalePrices],
    accountCount: accountRows.length,
    goalCount: goalsCount.length,
  };
}

export async function getAccountAnalytics(userId: string, accountId: string) {
  const db = getDatabase();
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.id, accountId)),
  });
  if (!account) return null;
  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.userId, userId),
      eq(transactions.accountId, accountId),
    ),
    orderBy: [asc(transactions.transactionDate)],
  });
  const values = await db.query.valuationSnapshots.findMany({
    where: and(
      eq(valuationSnapshots.userId, userId),
      eq(valuationSnapshots.accountId, accountId),
    ),
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
  if (account.trackingMode === "positions") {
    const positionRows = await db.query.positionEvents.findMany({
      where: and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.accountId, accountId),
      ),
      orderBy: [asc(positionEvents.tradeDate)],
    });
    const instrumentIds = [
      ...new Set(positionRows.map((row) => row.instrumentId)),
    ];
    const priceRows = instrumentIds.length
      ? await db
          .select()
          .from(securityPrices)
          .where(
            and(
              eq(securityPrices.userId, userId),
              inArray(securityPrices.instrumentId, instrumentIds),
            ),
          )
      : [];
    const sourceDates = [
      ...rows.map((row) => row.transactionDate),
      ...positionRows.map((row) => row.tradeDate),
      ...priceRows.map((row) => row.effectiveDate),
    ].sort();
    const history = [...new Set(sourceDates)].map((date) => ({
      date,
      value: safeChartNumber(
        calculatePositionAccountSnapshot(userId, db, accountId, date)
          .totalMinor,
      ),
    }));
    return {
      account,
      metrics,
      estimatedGain,
      history,
      positionSnapshot: calculatePositionAccountSnapshot(userId, db, accountId),
    };
  }
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
  for (const event of [...events].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (event.kind === "valuation") {
      growth += BigInt(event.valueMinor) - balance;
      balance = BigInt(event.valueMinor);
    } else {
      balance += transactionEffect(event.type, event.amountMinor);
    }
  }
  return growth;
}

export async function getAccountComparisons(userId: string) {
  const db = getDatabase();
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.name));
  const output = [];
  for (const account of accountRows) {
    const rows = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, account.id),
      ),
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
    const income =
      metrics.interest +
      metrics.dividends +
      metrics.realizedGrowth -
      metrics.fees;
    const firstDate = rows[0]
      ? new Date(rows[0].transactionDate)
      : new Date(account.createdAt);
    const days = Math.max(
      1,
      Math.floor((Date.now() - firstDate.getTime()) / 86_400_000),
    );
    let simpleAnnualized: string | null = null;
    let effectiveAnnualized: string | null = null;
    if (account.trackingMode === "balance" && start > 0n && days >= 30) {
      const gain = ending - start - netFlows;
      const periodReturn = new Decimal(gain.toString()).div(start.toString());
      simpleAnnualized = periodReturn
        .mul(new Decimal(365).div(days))
        .mul(100)
        .toFixed(2);
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
