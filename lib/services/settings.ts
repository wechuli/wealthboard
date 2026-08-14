import "server-only";

import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";

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
import { dateInputToUtc, nowIso } from "@/lib/dates";
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
  },
) {
  const db = getDatabase();
  const current = getCurrencyConfiguration(userId, db);
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
      updatedAt: nowIso(),
    })
    .where(eq(userSettings.userId, userId))
    .run();
  if (result.changes !== 1) throw new Error("Settings could not be updated.");
}

export function addExchangeRate(
  userId: string,
  input: {
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    effectiveDate: string;
  },
) {
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
    tx.insert(exchangeRates)
      .values({
        id: crypto.randomUUID(),
        userId,
        baseCurrency,
        quoteCurrency,
        rate: input.rate,
        effectiveDate: dateInputToUtc(input.effectiveDate),
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

    const positionAccounts = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.trackingMode, "positions"),
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
  });
}

export async function listExchangeRates(userId: string) {
  return getDatabase()
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .orderBy(desc(exchangeRates.effectiveDate));
}
