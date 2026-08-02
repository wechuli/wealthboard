import "server-only";

import { desc, eq } from "drizzle-orm";

import { exchangeRates, userSettings } from "@/db/schema";
import { dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

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
  const result = getDatabase()
    .update(userSettings)
    .set({
      ...input,
      supportedCurrencies: JSON.stringify(input.supportedCurrencies),
      updatedAt: nowIso(),
    })
    .where(eq(userSettings.userId, userId))
    .run();
  if (result.changes !== 1) throw new Error("Settings could not be updated.");
}

export function addExchangeRate(
  userId: string,
  input: { baseCurrency: string; quoteCurrency: string; rate: string; effectiveDate: string },
) {
  if (input.baseCurrency === input.quoteCurrency) throw new Error("Choose two different currencies.");
  if (!/^\d+(?:\.\d+)?$/.test(input.rate) || Number(input.rate) <= 0) {
    throw new Error("Enter a positive decimal exchange rate.");
  }
  const timestamp = nowIso();
  getDatabase()
    .insert(exchangeRates)
    .values({
      id: crypto.randomUUID(),
      userId,
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
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
}

export async function listExchangeRates(userId: string) {
  return getDatabase()
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .orderBy(desc(exchangeRates.effectiveDate));
}
