import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  investmentInstruments,
  positionEvents,
  securityPrices,
  transactions,
  userSettings,
} from "@/db/schema";
import { replayBalance, type FinancialEvent } from "@/lib/finance";
import {
  calculateQuoteValueMinor,
  replayPositionQuantities,
} from "@/lib/investments";
import { convertMinor, MissingExchangeRateError } from "@/lib/money";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
export type InvestmentClient = DatabaseClient | TransactionClient;

type FreshnessSettings = Pick<
  typeof userSettings.$inferSelect,
  "positionStaleDaysStock" | "positionStaleDaysEtf" | "positionStaleDaysFund"
>;

function staleAfterDays(
  settings: FreshnessSettings,
  assetType: "stock" | "etf" | "fund",
) {
  if (assetType === "stock") return settings.positionStaleDaysStock;
  if (assetType === "etf") return settings.positionStaleDaysEtf;
  return settings.positionStaleDaysFund;
}

function isStale(priceDate: string, asOf: string, days: number) {
  return (
    new Date(asOf).getTime() - new Date(priceDate).getTime() >
    days * 24 * 60 * 60 * 1000
  );
}

function addDays(value: string, days: number) {
  return new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
}

export type PositionDataIssue = {
  type: "missing_price" | "missing_rate" | "stale_price";
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  currency: string;
  affectedFrom: string;
  affectedTo: string;
  lastPriceDate: string | null;
  source: string | null;
  provenance: string | null;
  thresholdDays: number | null;
};

export function calculatePositionAccountSnapshot(
  userId: string,
  client: InvestmentClient,
  accountId: string,
  throughDate = nowIso(),
) {
  const account = client.query.accounts
    .findFirst({
      where: and(eq(accounts.userId, userId), eq(accounts.id, accountId)),
    })
    .sync();
  if (!account) throw new Error("Account not found.");
  if (account.trackingMode !== "positions") {
    throw new Error("This account does not track positions.");
  }
  const freshness = client.query.userSettings
    .findFirst({
      where: eq(userSettings.userId, userId),
      columns: {
        positionStaleDaysStock: true,
        positionStaleDaysEtf: true,
        positionStaleDaysFund: true,
      },
    })
    .sync();
  if (!freshness) throw new Error("User settings are unavailable.");

  const transactionRows = client
    .select({
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      date: transactions.transactionDate,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
        lte(transactions.transactionDate, throughDate),
      ),
    )
    .all();
  const eventRows = client
    .select()
    .from(positionEvents)
    .where(
      and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.accountId, accountId),
        lte(positionEvents.tradeDate, throughDate),
      ),
    )
    .all();
  const cashEvents: FinancialEvent[] = transactionRows.map((row) => ({
    kind: "transaction",
    ...row,
  }));
  const transactionCashMinor = replayBalance(cashEvents, throughDate);
  const tradeCashMinor = eventRows.reduce(
    (total, event) => total + BigInt(event.cashEffectMinor),
    0n,
  );
  const cashMinor = transactionCashMinor + tradeCashMinor;
  const quantities = replayPositionQuantities(eventRows, throughDate);
  const instrumentIds = [...quantities.entries()]
    .filter(([, quantity]) => quantity !== "0")
    .map(([instrumentId]) => instrumentId);
  const instrumentRows = instrumentIds.length
    ? client
        .select()
        .from(investmentInstruments)
        .where(
          and(
            eq(investmentInstruments.userId, userId),
            inArray(investmentInstruments.id, instrumentIds),
          ),
        )
        .all()
    : [];
  const priceRows = instrumentIds.length
    ? client
        .select()
        .from(securityPrices)
        .where(
          and(
            eq(securityPrices.userId, userId),
            inArray(securityPrices.instrumentId, instrumentIds),
            lte(securityPrices.effectiveDate, throughDate),
          ),
        )
        .all()
    : [];
  const rates = client
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .all();

  let positionsMinor = 0n;
  const missingPrices: string[] = [];
  const missingCurrencies = new Set<string>();
  const issues: PositionDataIssue[] = [];
  const positions = instrumentRows.map((instrument) => {
    const quantity = quantities.get(instrument.id) ?? "0";
    const exposureFrom =
      eventRows
        .filter((row) => row.instrumentId === instrument.id)
        .sort(
          (left, right) =>
            left.tradeDate.localeCompare(right.tradeDate) ||
            left.eventSequence - right.eventSequence ||
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )[0]?.tradeDate ?? throughDate;
    const price = priceRows
      .filter((row) => row.instrumentId === instrument.id)
      .sort((left, right) =>
        right.effectiveDate.localeCompare(left.effectiveDate),
      )[0];
    if (!price) {
      missingPrices.push(instrument.id);
      issues.push({
        type: "missing_price",
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        instrumentSymbol: instrument.symbol,
        currency: instrument.quoteCurrency,
        affectedFrom: exposureFrom,
        affectedTo: throughDate,
        lastPriceDate: null,
        source: null,
        provenance: null,
        thresholdDays: null,
      });
      return {
        instrument,
        quantity,
        price: null,
        quoteValueMinor: null,
        accountValueMinor: null,
        stale: false,
      };
    }
    const quoteValueMinor = calculateQuoteValueMinor(
      quantity,
      price.price,
      price.currency,
    );
    let accountValueMinor: bigint | null = null;
    try {
      accountValueMinor = convertMinor(
        quoteValueMinor,
        price.currency,
        account.currency,
        rates,
        throughDate,
      );
      positionsMinor += accountValueMinor;
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
      missingCurrencies.add(price.currency);
      issues.push({
        type: "missing_rate",
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        instrumentSymbol: instrument.symbol,
        currency: price.currency,
        affectedFrom: exposureFrom,
        affectedTo: throughDate,
        lastPriceDate: price.effectiveDate,
        source: price.source,
        provenance: price.provenance,
        thresholdDays: null,
      });
    }
    const thresholdDays = staleAfterDays(freshness, instrument.assetType);
    const stale = isStale(price.effectiveDate, throughDate, thresholdDays);
    if (stale) {
      issues.push({
        type: "stale_price",
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        instrumentSymbol: instrument.symbol,
        currency: price.currency,
        affectedFrom: addDays(price.effectiveDate, thresholdDays),
        affectedTo: throughDate,
        lastPriceDate: price.effectiveDate,
        source: price.source,
        provenance: price.provenance,
        thresholdDays,
      });
    }
    return {
      instrument,
      quantity,
      price,
      quoteValueMinor,
      accountValueMinor,
      stale,
    };
  });

  return {
    account,
    asOf: throughDate,
    cashMinor,
    positionsMinor,
    totalMinor: cashMinor + positionsMinor,
    complete: missingPrices.length === 0 && missingCurrencies.size === 0,
    missingPrices,
    missingCurrencies: [...missingCurrencies],
    issues,
    staleInstrumentIds: positions
      .filter((position) => position.stale)
      .map((position) => position.instrument.id),
    positions,
  };
}
