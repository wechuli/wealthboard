import "server-only";

import Decimal from "decimal.js";
import { and, eq, gt, inArray, lte } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  investmentInstruments,
  positionEvents,
  transactions,
  userSettings,
} from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { calculateQuoteValueMinor } from "@/lib/investments";
import { convertMinor, MissingExchangeRateError } from "@/lib/money";
import { calculatePositionAccountSnapshot } from "@/lib/services/investment-valuation";

export type PositionMovementAttribution = {
  accountId: string;
  currency: string;
  from: string;
  to: string;
  startValueMinor: bigint;
  endValueMinor: bigint;
  changeMinor: bigint;
  externalCashMinor: bigint;
  incomeMinor: bigint;
  feesMinor: bigint;
  cashAdjustmentsMinor: bigint;
  internalTradeCashMinor: bigint;
  quantityMovementMinor: bigint;
  priceMovementMinor: bigint;
  currencyMovementMinor: bigint;
  unattributedMinor: bigint;
  complete: boolean;
  methodology: "position_bridge_v1";
  returnStatus: "unavailable";
  returnMessage: string;
  issues: ReturnType<typeof calculatePositionAccountSnapshot>["issues"];
};

function eventInPeriod(value: string, from: string, to: string) {
  return value > from && value <= to;
}

export function getPositionMovementAttribution(
  userId: string,
  accountId: string,
  from: string,
  to: string,
): PositionMovementAttribution {
  if (from >= to)
    throw new Error(
      "Choose a movement period with an end date after its start.",
    );
  const db = getDatabase();
  const account = db.query.accounts
    .findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.id, accountId),
        eq(accounts.trackingMode, "positions"),
      ),
    })
    .sync();
  if (!account) throw new Error("Position account not found.");
  const start = calculatePositionAccountSnapshot(userId, db, accountId, from);
  const end = calculatePositionAccountSnapshot(userId, db, accountId, to);
  const transactionRows = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
        gt(transactions.transactionDate, from),
        lte(transactions.transactionDate, to),
      ),
    )
    .all();
  const eventRows = db
    .select()
    .from(positionEvents)
    .where(
      and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.accountId, accountId),
        lte(positionEvents.tradeDate, to),
      ),
    )
    .all();
  const periodEvents = eventRows.filter((event) =>
    eventInPeriod(event.tradeDate, from, to),
  );
  const instrumentIds = new Set([
    ...start.positions.map((position) => position.instrument.id),
    ...end.positions.map((position) => position.instrument.id),
    ...periodEvents.map((event) => event.instrumentId),
  ]);
  const instruments = instrumentIds.size
    ? db
        .select()
        .from(investmentInstruments)
        .where(
          and(
            eq(investmentInstruments.userId, userId),
            inArray(investmentInstruments.id, [...instrumentIds]),
          ),
        )
        .all()
    : [];
  const rates = db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .all();
  const startByInstrument = new Map(
    start.positions.map((position) => [position.instrument.id, position]),
  );
  const endByInstrument = new Map(
    end.positions.map((position) => [position.instrument.id, position]),
  );

  let externalCashMinor = 0n;
  let incomeMinor = 0n;
  let feesMinor = 0n;
  let cashAdjustmentsMinor = 0n;
  for (const transaction of transactionRows) {
    const amount = BigInt(transaction.amountMinor);
    if (
      transaction.type === "opening_balance" ||
      transaction.type === "deposit"
    ) {
      externalCashMinor += amount;
    } else if (transaction.type === "withdrawal") {
      externalCashMinor -= amount;
    } else if (transaction.type === "transfer") {
      externalCashMinor += amount;
    } else if (
      transaction.type === "interest" ||
      transaction.type === "dividend"
    ) {
      incomeMinor += amount;
    } else if (transaction.type === "fee") {
      feesMinor -= amount;
    } else if (transaction.type === "manual_adjustment") {
      cashAdjustmentsMinor += amount;
    }
  }
  const internalTradeCashMinor = periodEvents.reduce(
    (total, event) => total + BigInt(event.cashEffectMinor),
    0n,
  );

  let quantityMovementMinor = 0n;
  let priceMovementMinor = 0n;
  let instrumentCurrencyMovementMinor = 0n;
  let complete =
    start.complete &&
    end.complete &&
    start.staleInstrumentIds.length === 0 &&
    end.staleInstrumentIds.length === 0;
  for (const instrument of instruments) {
    const startPosition = startByInstrument.get(instrument.id);
    const endPosition = endByInstrument.get(instrument.id);
    const startQuantity = new Decimal(startPosition?.quantity ?? 0);
    const endQuantity = new Decimal(endPosition?.quantity ?? 0);
    if (startQuantity.isZero() && endQuantity.isZero()) continue;
    const startPrice = startPosition?.price ?? null;
    const endPrice = endPosition?.price ?? null;
    if (
      (startQuantity.isPositive() && !startPrice) ||
      (endQuantity.isPositive() && !endPrice)
    ) {
      complete = false;
      continue;
    }
    const baselinePrice = startPrice ?? endPrice;
    if (!baselinePrice) continue;
    try {
      const startValue = startPrice
        ? convertMinor(
            calculateQuoteValueMinor(
              startQuantity.toString(),
              startPrice.price,
              startPrice.currency,
            ),
            startPrice.currency,
            account.currency,
            rates,
            from,
          )
        : 0n;
      const endValue = endPrice
        ? convertMinor(
            calculateQuoteValueMinor(
              endQuantity.toString(),
              endPrice.price,
              endPrice.currency,
            ),
            endPrice.currency,
            account.currency,
            rates,
            to,
          )
        : 0n;
      const quantityMovement = convertMinor(
        calculateQuoteValueMinor(
          endQuantity.minus(startQuantity).toString(),
          baselinePrice.price,
          baselinePrice.currency,
        ),
        baselinePrice.currency,
        account.currency,
        rates,
        startPrice ? from : to,
      );
      const priceMovement =
        startPrice && endPrice
          ? convertMinor(
              calculateQuoteValueMinor(
                endQuantity.toString(),
                new Decimal(endPrice.price).minus(startPrice.price).toString(),
                endPrice.currency,
              ),
              endPrice.currency,
              account.currency,
              rates,
              from,
            )
          : 0n;
      quantityMovementMinor += quantityMovement;
      priceMovementMinor += priceMovement;
      instrumentCurrencyMovementMinor +=
        endValue - startValue - quantityMovement - priceMovement;
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
      complete = false;
    }
  }

  const changeMinor = end.totalMinor - start.totalMinor;
  const attributed =
    externalCashMinor +
    incomeMinor +
    feesMinor +
    cashAdjustmentsMinor +
    internalTradeCashMinor +
    quantityMovementMinor +
    priceMovementMinor +
    instrumentCurrencyMovementMinor;
  return {
    accountId,
    currency: account.currency,
    from,
    to,
    startValueMinor: start.totalMinor,
    endValueMinor: end.totalMinor,
    changeMinor,
    externalCashMinor,
    incomeMinor,
    feesMinor,
    cashAdjustmentsMinor,
    internalTradeCashMinor,
    quantityMovementMinor,
    priceMovementMinor,
    currencyMovementMinor: instrumentCurrencyMovementMinor,
    unattributedMinor: changeMinor - attributed,
    complete,
    methodology: "position_bridge_v1",
    returnStatus: "unavailable",
    returnMessage:
      "Annualized return is unavailable until cash-flow-aware TWR methodology is implemented.",
    issues: [...start.issues, ...end.issues],
  };
}

export function getPortfolioPositionMovementAttribution(
  userId: string,
  from?: string,
  to = nowIso(),
) {
  const db = getDatabase();
  const settings = db.query.userSettings
    .findFirst({ where: eq(userSettings.userId, userId) })
    .sync();
  if (!settings) throw new Error("User settings are unavailable.");
  const accountRows = db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.trackingMode, "positions"),
        eq(accounts.isIncludedInNetWorth, true),
      ),
    )
    .all();
  const periodStart =
    from ??
    accountRows
      .map((account) => account.openedAt ?? account.createdAt)
      .sort()[0] ??
    to;
  const rates = db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .all();
  const accountAttributions = accountRows.map((account) =>
    getPositionMovementAttribution(userId, account.id, periodStart, to),
  );
  const convertComponent = (value: bigint, currency: string, date: string) =>
    convertMinor(value, currency, settings.baseCurrency, rates, date);
  let complete = accountAttributions.every((row) => row.complete);
  let startValueMinor = 0n;
  let endValueMinor = 0n;
  const components = {
    externalCashMinor: 0n,
    incomeMinor: 0n,
    feesMinor: 0n,
    cashAdjustmentsMinor: 0n,
    internalTradeCashMinor: 0n,
    quantityMovementMinor: 0n,
    priceMovementMinor: 0n,
  };
  for (const attribution of accountAttributions) {
    try {
      startValueMinor += convertComponent(
        attribution.startValueMinor,
        attribution.currency,
        periodStart,
      );
      endValueMinor += convertComponent(
        attribution.endValueMinor,
        attribution.currency,
        to,
      );
      for (const key of Object.keys(components) as Array<
        keyof typeof components
      >) {
        components[key] += convertComponent(
          attribution[key],
          attribution.currency,
          to,
        );
      }
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
      complete = false;
    }
  }
  const changeMinor = endValueMinor - startValueMinor;
  const nonCurrencyTotal = Object.values(components).reduce(
    (total, value) => total + value,
    0n,
  );
  return {
    currency: settings.baseCurrency,
    from: periodStart,
    to,
    startValueMinor,
    endValueMinor,
    changeMinor,
    ...components,
    currencyMovementMinor: changeMinor - nonCurrencyTotal,
    unattributedMinor: 0n,
    complete,
    methodology: "position_bridge_v1" as const,
    returnStatus: "unavailable" as const,
    returnMessage:
      "Annualized return is unavailable until cash-flow-aware TWR methodology is implemented.",
    accounts: accountAttributions,
  };
}
