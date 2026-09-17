import "server-only";

import Decimal from "decimal.js";
import { and, desc, eq, isNull } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  goals,
  investmentInstruments,
  positionEvents,
  securityPrices,
  transactions,
  userSettings,
  valuationSnapshots,
} from "@/db/schema";
import {
  isCatalogCurrencyCode,
  isIsoCurrencyCode,
  normalizeCurrencyCode,
  normalizeEnabledCurrencies,
  parseEnabledCurrencies,
} from "@/lib/currencies";
import { dateInputToUtc, isExchangeRateStale, nowIso } from "@/lib/dates";
import { exchangeRateSchema } from "@/lib/validation";
import { exchangeRatePairKey } from "@/lib/services/exchange-rate-status";
import { getDatabase } from "@/lib/db";
import { calculatePositionAccountSnapshot } from "@/lib/services/investment-valuation";

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
type Client = DatabaseClient | TransactionClient;

export function listReferencedCurrencies(
  userId: string,
  client: Client = getDatabase(),
) {
  const values = [
    ...client
      .selectDistinct({ currency: accounts.currency })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: transactions.currency })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: valuationSnapshots.currency })
      .from(valuationSnapshots)
      .where(eq(valuationSnapshots.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: goals.currency })
      .from(goals)
      .where(eq(goals.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: exchangeRates.baseCurrency })
      .from(exchangeRates)
      .where(eq(exchangeRates.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: exchangeRates.quoteCurrency })
      .from(exchangeRates)
      .where(eq(exchangeRates.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: investmentInstruments.quoteCurrency })
      .from(investmentInstruments)
      .where(eq(investmentInstruments.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: positionEvents.tradeCurrency })
      .from(positionEvents)
      .where(eq(positionEvents.userId, userId))
      .all()
      .map((row) => row.currency),
    ...client
      .selectDistinct({ currency: positionEvents.feeCurrency })
      .from(positionEvents)
      .where(eq(positionEvents.userId, userId))
      .all()
      .flatMap((row) => (row.currency ? [row.currency] : [])),
    ...client
      .selectDistinct({ currency: securityPrices.currency })
      .from(securityPrices)
      .where(eq(securityPrices.userId, userId))
      .all()
      .map((row) => row.currency),
  ];
  return normalizeEnabledCurrencies(values);
}

export function getCurrencyConfiguration(
  userId: string,
  client: Client = getDatabase(),
) {
  const settings = client.query.userSettings
    .findFirst({ where: eq(userSettings.userId, userId) })
    .sync();
  if (!settings) throw new Error("User currency settings are unavailable.");
  const baseCurrency = normalizeCurrencyCode(settings.baseCurrency);
  if (!isIsoCurrencyCode(baseCurrency)) {
    throw new Error("The configured base currency is invalid.");
  }
  const referencedCurrencies = listReferencedCurrencies(userId, client);
  const enabledCurrencies = normalizeEnabledCurrencies(
    parseEnabledCurrencies(settings.supportedCurrencies),
    [baseCurrency, ...referencedCurrencies],
  );
  return { baseCurrency, enabledCurrencies, referencedCurrencies };
}

export function requireEnabledCurrency(
  userId: string,
  currency: string,
  client: Client = getDatabase(),
) {
  const code = normalizeCurrencyCode(currency);
  if (!isIsoCurrencyCode(code)) throw new Error("Choose a valid currency.");
  if (
    !getCurrencyConfiguration(userId, client).enabledCurrencies.includes(code)
  ) {
    throw new Error(`${code} is not enabled in your currency settings.`);
  }
  return code;
}

export function updateSettings(
  userId: string,
  input: {
    displayName: string;
    appName: string;
    baseCurrency: string;
    supportedCurrencies: string[];
    timezone: string;
    preferredDateFormat: string;
    defaultDashboardPeriod: string;
    sessionTimeoutMinutes: number;
    defaultGoalReturnBps: number;
    positionStaleDaysStock?: number;
    positionStaleDaysEtf?: number;
    positionStaleDaysFund?: number;
  },
) {
  const db = getDatabase();
  const current = getCurrencyConfiguration(userId, db);
  const currentSettings = db.query.userSettings
    .findFirst({ where: eq(userSettings.userId, userId) })
    .sync();
  if (!currentSettings) throw new Error("User settings are unavailable.");
  const baseCurrency = normalizeCurrencyCode(input.baseCurrency);
  const requested = input.supportedCurrencies.map(normalizeCurrencyCode);
  const legacyCurrencies = new Set(
    current.enabledCurrencies.filter(
      (currency) => !isCatalogCurrencyCode(currency),
    ),
  );
  for (const currency of [baseCurrency, ...requested]) {
    if (!isIsoCurrencyCode(currency))
      throw new Error("Choose a valid currency.");
    if (!isCatalogCurrencyCode(currency) && !legacyCurrencies.has(currency)) {
      throw new Error(`${currency} is not available in the currency catalog.`);
    }
  }
  const supportedCurrencies = normalizeEnabledCurrencies(requested, [
    baseCurrency,
  ]);
  const disabledInUse = current.referencedCurrencies.filter(
    (currency) => !supportedCurrencies.includes(currency),
  );
  if (disabledInUse.length) {
    throw new Error(
      `Cannot disable currencies still in use: ${disabledInUse.join(", ")}.`,
    );
  }

  const result = db
    .update(userSettings)
    .set({
      ...input,
      baseCurrency,
      supportedCurrencies: JSON.stringify(supportedCurrencies),
      positionStaleDaysStock:
        input.positionStaleDaysStock ?? currentSettings.positionStaleDaysStock,
      positionStaleDaysEtf:
        input.positionStaleDaysEtf ?? currentSettings.positionStaleDaysEtf,
      positionStaleDaysFund:
        input.positionStaleDaysFund ?? currentSettings.positionStaleDaysFund,
      updatedAt: nowIso(),
    })
    .where(eq(userSettings.userId, userId))
    .run();
  if (result.changes !== 1) throw new Error("Settings could not be updated.");
}

export function addExchangeRate(
  userId: string,
  rawInput: {
    id?: string;
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    effectiveDate: string;
  },
) {
  const input = exchangeRateSchema.parse(rawInput);
  const db = getDatabase();
  const baseCurrency = requireEnabledCurrency(userId, input.baseCurrency, db);
  const quoteCurrency = requireEnabledCurrency(userId, input.quoteCurrency, db);
  if (baseCurrency === quoteCurrency)
    throw new Error("Choose two different currencies.");
  if (!/^\d+(?:\.\d+)?$/.test(input.rate) || new Decimal(input.rate).lte(0)) {
    throw new Error("Enter a positive decimal exchange rate.");
  }
  const timestamp = nowIso();
  db.transaction((tx) => {
    const effectiveDate = dateInputToUtc(input.effectiveDate);
    const existing = input.id
      ? tx.query.exchangeRates
          .findFirst({
            where: and(
              eq(exchangeRates.userId, userId),
              eq(exchangeRates.id, input.id),
            ),
          })
          .sync()
      : undefined;
    if (input.id && !existing) throw new Error("Exchange rate not found.");
    if (
      existing &&
      (existing.baseCurrency !== baseCurrency ||
        existing.quoteCurrency !== quoteCurrency)
    ) {
      throw new Error(
        "The currency pair cannot be changed when correcting a rate.",
      );
    }
    const pairRates = tx
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.userId, userId))
      .all();
    const sameDirection = pairRates.some(
      (rate) =>
        rate.baseCurrency === baseCurrency &&
        rate.quoteCurrency === quoteCurrency,
    );
    const reverseDirection = pairRates.some(
      (rate) =>
        rate.baseCurrency === quoteCurrency &&
        rate.quoteCurrency === baseCurrency,
    );
    if (!sameDirection && reverseDirection) {
      throw new Error(
        `Use the existing ${quoteCurrency}/${baseCurrency} pair. Its inverse is calculated automatically.`,
      );
    }
    if (existing) {
      const collision = pairRates.some(
        (rate) =>
          rate.id !== existing.id &&
          rate.baseCurrency === baseCurrency &&
          rate.quoteCurrency === quoteCurrency &&
          rate.effectiveDate === effectiveDate,
      );
      if (collision)
        throw new Error(
          "A rate already exists for this date. Edit that entry instead.",
        );
      tx.update(exchangeRates)
        .set({ rate: input.rate, effectiveDate, source: "manual" })
        .where(
          and(
            eq(exchangeRates.userId, userId),
            eq(exchangeRates.id, existing.id),
          ),
        )
        .run();
    } else {
      tx.insert(exchangeRates)
        .values({
          id: crypto.randomUUID(),
          userId,
          baseCurrency,
          quoteCurrency,
          rate: input.rate,
          effectiveDate,
          source: "manual",
          createdAt: timestamp,
        })
        .onConflictDoUpdate({
          target: [
            exchangeRates.userId,
            exchangeRates.baseCurrency,
            exchangeRates.quoteCurrency,
            exchangeRates.effectiveDate,
          ],
          set: { rate: input.rate, source: "manual", createdAt: timestamp },
        })
        .run();
    }
    recalculatePositionValues(userId, tx, timestamp);
  });
}

export function deleteExchangeRate(userId: string, id: string) {
  getDatabase().transaction((tx) => {
    const result = tx
      .delete(exchangeRates)
      .where(and(eq(exchangeRates.userId, userId), eq(exchangeRates.id, id)))
      .run();
    if (result.changes !== 1) throw new Error("Exchange rate not found.");
    recalculatePositionValues(userId, tx, nowIso());
  });
}

function recalculatePositionValues(
  userId: string,
  tx: TransactionClient,
  timestamp: string,
) {
  const positionAccounts = tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.trackingMode, "positions"),
        isNull(accounts.archivedAt),
      ),
    )
    .all();
  for (const account of positionAccounts) {
    const value = calculatePositionAccountSnapshot(
      userId,
      tx,
      account.id,
    ).totalMinor;
    const currentValueMinor = Number(value);
    if (!Number.isSafeInteger(currentValueMinor)) {
      throw new Error("The calculated value is outside the supported range.");
    }
    tx.update(accounts)
      .set({ currentValueMinor, updatedAt: timestamp })
      .where(and(eq(accounts.userId, userId), eq(accounts.id, account.id)))
      .run();
  }
}

export async function listExchangeRates(userId: string) {
  return getDatabase()
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .orderBy(desc(exchangeRates.effectiveDate));
}

export async function listExchangeRateGroups(userId: string, today: string) {
  const rows = await listExchangeRates(userId);
  const groups = new Map<
    string,
    Array<{
      id: string;
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      effectiveDate: string;
      source: string;
    }>
  >();
  for (const row of rows) {
    const key = exchangeRatePairKey(row.baseCurrency, row.quoteCurrency);
    const history = groups.get(key) ?? [];
    history.push({
      id: row.id,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rate: row.rate,
      effectiveDate: row.effectiveDate,
      source: row.source,
    });
    groups.set(key, history);
  }
  return [...groups].map(([key, history]) => {
    const latest =
      history.find((rate) => rate.effectiveDate.slice(0, 10) <= today) ??
      history[0];
    return {
      key,
      latest,
      history,
      status:
        latest.effectiveDate.slice(0, 10) > today
          ? "Scheduled"
          : isExchangeRateStale(latest.effectiveDate, today)
            ? "Over a month old"
            : "Up to date",
      needsReview: new Set(history.map((rate) => rate.baseCurrency)).size > 1,
    };
  });
}
