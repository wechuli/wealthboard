import "server-only";

import Decimal from "decimal.js";
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  investmentInstruments,
  positionEvents,
  positionReconciliations,
  securityPrices,
  userSettings,
  type InvestmentAssetType,
  type InvestmentIdentifierType,
  type PositionEventType,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import {
  calculateQuoteValueMinor,
  canonicalDecimal,
  convertMinorWithAppliedRate,
  replayPositionQuantities,
} from "@/lib/investments";
import { convertMinor, parseMoney } from "@/lib/money";
import { recalculateAccountBalance } from "@/lib/services/accounts";
import { calculatePositionAccountSnapshot } from "@/lib/services/investment-valuation";
import { requireEnabledCurrency } from "@/lib/services/settings";

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
type Client = DatabaseClient | TransactionClient;

function assertNotFutureDate(userId: string, value: string, client: Client) {
  const timezone =
    client.query.userSettings
      .findFirst({ where: eq(userSettings.userId, userId) })
      .sync()?.timezone ?? "UTC";
  if (value > dateInputForTimezone(timezone)) {
    throw new Error("Financial activity cannot be dated in the future.");
  }
}

function checkedNumber(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("The calculated value is outside the supported range.");
  }
  return number;
}

export type InstrumentInput = {
  externalId?: string;
  name: string;
  symbol?: string;
  identifierType: InvestmentIdentifierType;
  identifier?: string;
  exchangeMic?: string;
  assetType: InvestmentAssetType;
  quoteCurrency: string;
};

export function createInvestmentInstrument(
  userId: string,
  input: InstrumentInput,
  client: Client = getDatabase(),
) {
  const quoteCurrency = requireEnabledCurrency(
    userId,
    input.quoteCurrency,
    client,
  );
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("Enter an instrument name.");
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  client
    .insert(investmentInstruments)
    .values({
      id,
      userId,
      externalId: input.externalId?.trim() || `manual:${id}`,
      name,
      symbol: input.symbol?.trim().toUpperCase() || null,
      identifierType: input.identifierType,
      identifier: input.identifier?.trim().toUpperCase() || null,
      exchangeMic: input.exchangeMic?.trim().toUpperCase() || null,
      assetType: input.assetType,
      quoteCurrency,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

export function listInvestmentInstruments(
  userId: string,
  options: { includeArchived?: boolean } = {},
) {
  const db = getDatabase();
  return db
    .select()
    .from(investmentInstruments)
    .where(
      options.includeArchived
        ? eq(investmentInstruments.userId, userId)
        : and(
            eq(investmentInstruments.userId, userId),
            isNull(investmentInstruments.archivedAt),
          ),
    )
    .all();
}

export function getInvestmentInstrument(userId: string, instrumentId: string) {
  return getDatabase()
    .query.investmentInstruments.findFirst({
      where: and(
        eq(investmentInstruments.userId, userId),
        eq(investmentInstruments.id, instrumentId),
      ),
    })
    .sync();
}

export function updateInvestmentInstrument(
  userId: string,
  instrumentId: string,
  input: InstrumentInput,
) {
  const db = getDatabase();
  db.transaction((tx) => {
    const existing = tx.query.investmentInstruments
      .findFirst({
        where: and(
          eq(investmentInstruments.userId, userId),
          eq(investmentInstruments.id, instrumentId),
        ),
      })
      .sync();
    if (!existing) throw new Error("Instrument not found.");
    const quoteCurrency = requireEnabledCurrency(
      userId,
      input.quoteCurrency,
      tx,
    );
    if (quoteCurrency !== existing.quoteCurrency) {
      const hasHistory =
        Boolean(
          tx.query.positionEvents
            .findFirst({
              where: and(
                eq(positionEvents.userId, userId),
                eq(positionEvents.instrumentId, instrumentId),
              ),
              columns: { id: true },
            })
            .sync(),
        ) ||
        Boolean(
          tx.query.securityPrices
            .findFirst({
              where: and(
                eq(securityPrices.userId, userId),
                eq(securityPrices.instrumentId, instrumentId),
              ),
              columns: { id: true },
            })
            .sync(),
        );
      if (hasHistory) {
        throw new Error(
          "Instrument quote currency cannot change after activity exists.",
        );
      }
    }
    const name = input.name.trim();
    if (!name || name.length > 100)
      throw new Error("Enter an instrument name.");
    tx.update(investmentInstruments)
      .set({
        externalId: input.externalId?.trim() || existing.externalId,
        name,
        symbol: input.symbol?.trim().toUpperCase() || null,
        identifierType: input.identifierType,
        identifier: input.identifier?.trim().toUpperCase() || null,
        exchangeMic: input.exchangeMic?.trim().toUpperCase() || null,
        assetType: input.assetType,
        quoteCurrency,
        updatedAt: nowIso(),
      })
      .where(
        and(
          eq(investmentInstruments.userId, userId),
          eq(investmentInstruments.id, instrumentId),
        ),
      )
      .run();
  });
}

export function setInvestmentInstrumentArchived(
  userId: string,
  instrumentId: string,
  archived: boolean,
) {
  const db = getDatabase();
  db.transaction((tx) => {
    const instrument = tx.query.investmentInstruments
      .findFirst({
        where: and(
          eq(investmentInstruments.userId, userId),
          eq(investmentInstruments.id, instrumentId),
        ),
      })
      .sync();
    if (!instrument) throw new Error("Instrument not found.");
    if (archived) {
      const events = tx
        .select()
        .from(positionEvents)
        .where(
          and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.instrumentId, instrumentId),
          ),
        )
        .all();
      for (const accountId of new Set(events.map((event) => event.accountId))) {
        const quantities = replayPositionQuantities(
          events.filter((event) => event.accountId === accountId),
        );
        if ((quantities.get(instrumentId) ?? "0") !== "0") {
          throw new Error(
            "Close every holding before archiving this instrument.",
          );
        }
      }
    }
    tx.update(investmentInstruments)
      .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
      .where(
        and(
          eq(investmentInstruments.userId, userId),
          eq(investmentInstruments.id, instrumentId),
        ),
      )
      .run();
  });
}

export type PositionEventInput = {
  accountId: string;
  instrumentId: string;
  type: PositionEventType;
  quantity: string;
  unitPrice?: string;
  tradeCurrency?: string;
  feeAmount?: string;
  feeCurrency?: string;
  cashEffect?: string;
  appliedExchangeRate?: string;
  openingCostBasis?: string;
  tradeDate: string;
  settlementDate?: string;
  externalId?: string;
  eventGroupId?: string;
  idempotencyKey?: string;
  description?: string;
  notes?: string;
};

function savePositionEvent(
  userId: string,
  input: PositionEventInput,
  eventId?: string,
) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.tradeDate, db);
  if (input.settlementDate)
    assertNotFutureDate(userId, input.settlementDate, db);
  return db.transaction((tx) => {
    const existingEvent = eventId
      ? tx.query.positionEvents
          .findFirst({
            where: and(
              eq(positionEvents.userId, userId),
              eq(positionEvents.id, eventId),
            ),
          })
          .sync()
      : undefined;
    if (eventId && !existingEvent) throw new Error("Position event not found.");
    if (existingEvent && existingEvent.accountId !== input.accountId) {
      throw new Error("A position event cannot move between accounts.");
    }
    if (!existingEvent && input.idempotencyKey) {
      const duplicate = tx.query.positionEvents
        .findFirst({
          where: and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.idempotencyKey, input.idempotencyKey),
          ),
        })
        .sync();
      if (duplicate) return duplicate.id;
    }
    const account = tx.query.accounts
      .findFirst({
        where: and(
          eq(accounts.userId, userId),
          eq(accounts.id, input.accountId),
          isNull(accounts.archivedAt),
        ),
      })
      .sync();
    if (!account || account.trackingMode !== "positions") {
      throw new Error("Position account not found.");
    }
    const instrument = tx.query.investmentInstruments
      .findFirst({
        where: and(
          eq(investmentInstruments.userId, userId),
          eq(investmentInstruments.id, input.instrumentId),
          isNull(investmentInstruments.archivedAt),
        ),
      })
      .sync();
    if (!instrument) throw new Error("Instrument not found.");

    const quantity = canonicalDecimal(input.quantity, {
      label: "quantity",
      allowNegative: input.type === "quantity_adjustment",
    });
    const tradeCurrency = requireEnabledCurrency(
      userId,
      input.tradeCurrency || instrument.quoteCurrency,
      tx,
    );
    const unitPrice = input.unitPrice
      ? canonicalDecimal(input.unitPrice, { label: "unit price" })
      : null;
    if ((input.type === "buy" || input.type === "sell") && !unitPrice) {
      throw new Error("Enter the execution price.");
    }
    const grossAmountMinor = unitPrice
      ? checkedNumber(
          calculateQuoteValueMinor(
            new Decimal(quantity).abs().toString(),
            unitPrice,
            tradeCurrency,
          ),
        )
      : null;
    const feeCurrency = input.feeAmount
      ? requireEnabledCurrency(userId, input.feeCurrency || tradeCurrency, tx)
      : null;
    const feeAmountMinor = input.feeAmount
      ? parseMoney(input.feeAmount, feeCurrency!)
      : null;
    if (feeAmountMinor != null && feeAmountMinor < 0) {
      throw new Error("Fee cannot be negative.");
    }
    const appliedExchangeRate = input.appliedExchangeRate
      ? canonicalDecimal(input.appliedExchangeRate, {
          label: "applied exchange rate",
        })
      : null;
    const rates = tx
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.userId, userId))
      .all();
    const tradeDate = dateInputToUtc(input.tradeDate);
    const convertToAccount = (amountMinor: number, fromCurrency: string) =>
      appliedExchangeRate && fromCurrency === tradeCurrency
        ? convertMinorWithAppliedRate(
            amountMinor,
            fromCurrency,
            account.currency,
            appliedExchangeRate,
          )
        : convertMinor(
            amountMinor,
            fromCurrency,
            account.currency,
            rates,
            tradeDate,
          );
    const grossAccountMinor = grossAmountMinor
      ? convertToAccount(grossAmountMinor, tradeCurrency)
      : 0n;
    const feeAccountMinor = feeAmountMinor
      ? convertToAccount(feeAmountMinor, feeCurrency!)
      : 0n;
    let cashEffectMinor = 0n;
    if (input.type === "buy" || input.type === "sell") {
      if (input.cashEffect) {
        const actual = BigInt(parseMoney(input.cashEffect, account.currency));
        if (actual <= 0n)
          throw new Error("Cash effect must be greater than zero.");
        cashEffectMinor = input.type === "buy" ? -actual : actual;
      } else {
        cashEffectMinor =
          input.type === "buy"
            ? -(grossAccountMinor + feeAccountMinor)
            : grossAccountMinor - feeAccountMinor;
      }
    }
    const openingCostBasisMinor = input.openingCostBasis
      ? parseMoney(input.openingCostBasis, account.currency)
      : null;
    const id = existingEvent?.id ?? crypto.randomUUID();
    const timestamp = nowIso();
    const values = {
      instrumentId: instrument.id,
      type: input.type,
      quantity,
      unitPrice,
      tradeCurrency,
      grossAmountMinor,
      feeAmountMinor,
      feeCurrency,
      cashEffectMinor: checkedNumber(cashEffectMinor),
      appliedExchangeRate,
      openingCostBasisMinor,
      tradeDate,
      settlementDate: input.settlementDate
        ? dateInputToUtc(input.settlementDate)
        : null,
      externalId: input.externalId?.trim() || null,
      eventGroupId: input.eventGroupId || null,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      updatedAt: timestamp,
    } satisfies Partial<typeof positionEvents.$inferInsert>;
    if (existingEvent) {
      tx.update(positionEvents)
        .set(values)
        .where(
          and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.id, existingEvent.id),
          ),
        )
        .run();
    } else {
      tx.insert(positionEvents)
        .values({
          id,
          userId,
          accountId: account.id,
          ...values,
          idempotencyKey: input.idempotencyKey || null,
          createdAt: timestamp,
        })
        .run();
    }
    replayPositionQuantities(
      tx
        .select()
        .from(positionEvents)
        .where(
          and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.accountId, account.id),
          ),
        )
        .all(),
    );
    recalculateAccountBalance(userId, tx, account.id);
    return id;
  });
}

export function recordPositionEvent(userId: string, input: PositionEventInput) {
  return savePositionEvent(userId, input);
}

export function updatePositionEvent(
  userId: string,
  eventId: string,
  input: PositionEventInput,
) {
  return savePositionEvent(userId, input, eventId);
}

export function getPositionEvent(userId: string, eventId: string) {
  return getDatabase()
    .query.positionEvents.findFirst({
      where: and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.id, eventId),
      ),
    })
    .sync();
}

export function deletePositionEvent(userId: string, eventId: string) {
  const db = getDatabase();
  db.transaction((tx) => {
    const event = tx.query.positionEvents
      .findFirst({
        where: and(
          eq(positionEvents.userId, userId),
          eq(positionEvents.id, eventId),
        ),
      })
      .sync();
    if (!event) throw new Error("Position event not found.");
    tx.delete(positionEvents)
      .where(
        and(eq(positionEvents.userId, userId), eq(positionEvents.id, eventId)),
      )
      .run();
    replayPositionQuantities(
      tx
        .select()
        .from(positionEvents)
        .where(
          and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.accountId, event.accountId),
          ),
        )
        .all(),
    );
    recalculateAccountBalance(userId, tx, event.accountId);
  });
}

export type SecurityPriceInput = {
  instrumentId: string;
  externalId?: string;
  price: string;
  effectiveDate: string;
  source?: string;
  provenance?: string;
};

export function setSecurityPrice(userId: string, input: SecurityPriceInput) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.effectiveDate, db);
  return db.transaction((tx) => {
    const instrument = tx.query.investmentInstruments
      .findFirst({
        where: and(
          eq(investmentInstruments.userId, userId),
          eq(investmentInstruments.id, input.instrumentId),
          isNull(investmentInstruments.archivedAt),
        ),
      })
      .sync();
    if (!instrument) throw new Error("Instrument not found.");
    const price = canonicalDecimal(input.price, { label: "unit price" });
    const effectiveDate = dateInputToUtc(input.effectiveDate);
    const existing = tx.query.securityPrices
      .findFirst({
        where: and(
          eq(securityPrices.userId, userId),
          eq(securityPrices.instrumentId, instrument.id),
          eq(securityPrices.effectiveDate, effectiveDate),
        ),
      })
      .sync();
    const timestamp = nowIso();
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
      tx.update(securityPrices)
        .set({
          externalId: input.externalId?.trim() || existing.externalId,
          price,
          source: input.source?.trim() || "manual",
          provenance: input.provenance?.trim() || null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(securityPrices.userId, userId),
            eq(securityPrices.id, existing.id),
          ),
        )
        .run();
    } else {
      tx.insert(securityPrices)
        .values({
          id,
          userId,
          instrumentId: instrument.id,
          externalId: input.externalId?.trim() || null,
          price,
          currency: instrument.quoteCurrency,
          effectiveDate,
          source: input.source?.trim() || "manual",
          provenance: input.provenance?.trim() || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }
    const affectedAccounts = tx
      .select({ accountId: positionEvents.accountId })
      .from(positionEvents)
      .where(
        and(
          eq(positionEvents.userId, userId),
          eq(positionEvents.instrumentId, instrument.id),
        ),
      )
      .all();
    for (const accountId of new Set(
      affectedAccounts.map((row) => row.accountId),
    )) {
      recalculateAccountBalance(userId, tx, accountId);
    }
    return id;
  });
}

export function deleteSecurityPrice(userId: string, priceId: string) {
  const db = getDatabase();
  db.transaction((tx) => {
    const price = tx.query.securityPrices
      .findFirst({
        where: and(
          eq(securityPrices.userId, userId),
          eq(securityPrices.id, priceId),
        ),
      })
      .sync();
    if (!price) throw new Error("Security price not found.");
    tx.delete(securityPrices)
      .where(
        and(eq(securityPrices.userId, userId), eq(securityPrices.id, priceId)),
      )
      .run();
    const affectedAccounts = tx
      .select({ accountId: positionEvents.accountId })
      .from(positionEvents)
      .where(
        and(
          eq(positionEvents.userId, userId),
          eq(positionEvents.instrumentId, price.instrumentId),
        ),
      )
      .all();
    for (const accountId of new Set(
      affectedAccounts.map((row) => row.accountId),
    )) {
      recalculateAccountBalance(userId, tx, accountId);
    }
  });
}

export function getPositionAccountSnapshot(
  userId: string,
  accountId: string,
  throughDate?: string,
) {
  return calculatePositionAccountSnapshot(
    userId,
    getDatabase(),
    accountId,
    throughDate,
  );
}

export function listPositionEvents(userId: string, accountId: string) {
  return getDatabase()
    .select()
    .from(positionEvents)
    .where(
      and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.accountId, accountId),
      ),
    )
    .all();
}

export function listSecurityPrices(userId: string, instrumentIds: string[]) {
  if (!instrumentIds.length) return [];
  return getDatabase()
    .select()
    .from(securityPrices)
    .where(
      and(
        eq(securityPrices.userId, userId),
        inArray(securityPrices.instrumentId, instrumentIds),
      ),
    )
    .all();
}

export function recordPositionReconciliation(
  userId: string,
  input: {
    accountId: string;
    observationDate: string;
    reportedCash?: string;
    reportedTotal: string;
    notes?: string;
  },
) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.observationDate, db);
  return db.transaction((tx) => {
    const account = tx.query.accounts
      .findFirst({
        where: and(
          eq(accounts.userId, userId),
          eq(accounts.id, input.accountId),
          eq(accounts.trackingMode, "positions"),
        ),
      })
      .sync();
    if (!account) throw new Error("Position account not found.");
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    tx.insert(positionReconciliations)
      .values({
        id,
        userId,
        accountId: account.id,
        observationDate: dateInputToUtc(input.observationDate),
        reportedCashMinor: input.reportedCash
          ? parseMoney(input.reportedCash, account.currency)
          : null,
        reportedTotalMinor: parseMoney(input.reportedTotal, account.currency),
        notes: input.notes?.trim() || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return id;
  });
}

export function listPositionReconciliations(userId: string, accountId: string) {
  return getDatabase()
    .select()
    .from(positionReconciliations)
    .where(
      and(
        eq(positionReconciliations.userId, userId),
        eq(positionReconciliations.accountId, accountId),
      ),
    )
    .all();
}

export function deletePositionReconciliation(
  userId: string,
  reconciliationId: string,
) {
  const result = getDatabase()
    .delete(positionReconciliations)
    .where(
      and(
        eq(positionReconciliations.userId, userId),
        eq(positionReconciliations.id, reconciliationId),
      ),
    )
    .run();
  if (!result.changes) throw new Error("Reconciliation not found.");
}
