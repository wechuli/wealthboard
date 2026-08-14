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
  transactions,
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

const ORDINARY_POSITION_EVENT_TYPES = new Set<PositionEventType>([
  "opening_position",
  "buy",
  "sell",
  "quantity_adjustment",
]);

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

function nextEventSequence(
  tx: TransactionClient,
  userId: string,
  accountId: string,
  tradeDate: string,
) {
  const rows = tx
    .select({ eventSequence: positionEvents.eventSequence })
    .from(positionEvents)
    .where(
      and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.accountId, accountId),
        eq(positionEvents.tradeDate, tradeDate),
      ),
    )
    .all();
  return (
    rows.reduce((maximum, row) => Math.max(maximum, row.eventSequence), 0) + 1
  );
}

function savePositionEvent(
  userId: string,
  input: PositionEventInput,
  eventId?: string,
  transactionClient?: TransactionClient,
  options: { eventGroupId?: string; allowGrouped?: boolean } = {},
) {
  const db = getDatabase();
  if (!ORDINARY_POSITION_EVENT_TYPES.has(input.type)) {
    throw new Error("Use the dedicated workflow for this position activity.");
  }
  const validationClient = transactionClient ?? db;
  assertNotFutureDate(userId, input.tradeDate, validationClient);
  if (input.settlementDate)
    assertNotFutureDate(userId, input.settlementDate, validationClient);
  const persist = (tx: TransactionClient) => {
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
    if (
      existingEvent &&
      (!ORDINARY_POSITION_EVENT_TYPES.has(existingEvent.type) ||
        (existingEvent.eventGroupId && !options.allowGrouped))
    ) {
      throw new Error("Use the dedicated workflow for grouped activity.");
    }
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
    if (
      (input.feeAmount || input.cashEffect) &&
      input.type !== "buy" &&
      input.type !== "sell"
    ) {
      throw new Error(
        "Fees and settlement amounts apply only to buys and sells.",
      );
    }
    if (feeAmountMinor != null && feeAmountMinor < 0) {
      throw new Error("Fee cannot be negative.");
    }
    const appliedExchangeRate = input.appliedExchangeRate
      ? canonicalDecimal(input.appliedExchangeRate, {
          label: "applied exchange rate",
        })
      : null;
    if (
      appliedExchangeRate &&
      ((input.type !== "buy" && input.type !== "sell") ||
        tradeCurrency === account.currency)
    ) {
      throw new Error(
        "An applied settlement rate is only valid for cross-currency trades.",
      );
    }
    if (
      (input.type === "buy" || input.type === "sell") &&
      tradeCurrency !== account.currency &&
      !input.cashEffect &&
      !appliedExchangeRate
    ) {
      throw new Error(
        "Cross-currency trades require an actual cash effect or applied settlement rate.",
      );
    }
    const tradeDate = dateInputToUtc(input.tradeDate);
    let cashEffectMinor = 0n;
    if (input.type === "buy" || input.type === "sell") {
      if (input.cashEffect) {
        const actual = BigInt(parseMoney(input.cashEffect, account.currency));
        if (actual <= 0n)
          throw new Error("Cash effect must be greater than zero.");
        cashEffectMinor = input.type === "buy" ? -actual : actual;
      } else {
        const rates = tx
          .select()
          .from(exchangeRates)
          .where(eq(exchangeRates.userId, userId))
          .all();
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
        cashEffectMinor =
          input.type === "buy"
            ? -(grossAccountMinor + feeAccountMinor)
            : grossAccountMinor - feeAccountMinor;
      }
    }
    const openingCostBasisMinor = input.openingCostBasis
      ? parseMoney(input.openingCostBasis, account.currency)
      : null;
    if (input.openingCostBasis && input.type !== "opening_position") {
      throw new Error(
        "Opening cost basis applies only to an opening position.",
      );
    }
    if (openingCostBasisMinor != null && openingCostBasisMinor < 0) {
      throw new Error("Opening cost basis cannot be negative.");
    }
    const id = existingEvent?.id ?? crypto.randomUUID();
    const timestamp = nowIso();
    const eventSequence =
      existingEvent?.tradeDate === tradeDate
        ? existingEvent.eventSequence
        : nextEventSequence(tx, userId, account.id, tradeDate);
    const values = {
      instrumentId: instrument.id,
      relatedInstrumentId: null,
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
      actionRatioNumerator: null,
      actionRatioDenominator: null,
      tradeDate,
      eventSequence,
      settlementDate: input.settlementDate
        ? dateInputToUtc(input.settlementDate)
        : null,
      externalId: input.externalId?.trim() || null,
      eventGroupId: options.eventGroupId ?? existingEvent?.eventGroupId ?? null,
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
  };
  return transactionClient
    ? persist(transactionClient)
    : db.transaction(persist);
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

function requirePositionAccount(
  tx: TransactionClient,
  userId: string,
  accountId: string,
) {
  const account = tx.query.accounts
    .findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.id, accountId),
        eq(accounts.trackingMode, "positions"),
        isNull(accounts.archivedAt),
      ),
    })
    .sync();
  if (!account) throw new Error("Position account not found.");
  return account;
}

function requireInstrument(
  tx: TransactionClient,
  userId: string,
  instrumentId: string,
) {
  const instrument = tx.query.investmentInstruments
    .findFirst({
      where: and(
        eq(investmentInstruments.userId, userId),
        eq(investmentInstruments.id, instrumentId),
        isNull(investmentInstruments.archivedAt),
      ),
    })
    .sync();
  if (!instrument) throw new Error("Instrument not found.");
  return instrument;
}

function accountPositionEvents(
  tx: TransactionClient,
  userId: string,
  accountId: string,
) {
  return tx
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

function validateAndRecalculatePositionAccount(
  tx: TransactionClient,
  userId: string,
  accountId: string,
) {
  replayPositionQuantities(accountPositionEvents(tx, userId, accountId));
  recalculateAccountBalance(userId, tx, accountId);
}

function idempotentPositionEvent(
  tx: TransactionClient,
  userId: string,
  idempotencyKey: string,
) {
  return tx.query.positionEvents
    .findFirst({
      where: and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.idempotencyKey, idempotencyKey),
      ),
    })
    .sync();
}

function existingGroupOrConflict(
  event: typeof positionEvents.$inferSelect,
  matchesOperation: boolean,
) {
  if (!event.eventGroupId || !matchesOperation) {
    throw new Error("This request key was already used for another operation.");
  }
  return event.eventGroupId;
}

function positionQuantityAt(
  tx: TransactionClient,
  userId: string,
  accountId: string,
  instrumentId: string,
  throughDate: string,
) {
  return new Decimal(
    replayPositionQuantities(
      accountPositionEvents(tx, userId, accountId),
      throughDate,
    ).get(instrumentId) ?? "0",
  );
}

function positiveRatio(numeratorInput: string, denominatorInput: string) {
  const numerator = canonicalDecimal(numeratorInput, {
    label: "ratio numerator",
  });
  const denominator = canonicalDecimal(denominatorInput, {
    label: "ratio denominator",
  });
  return { numerator, denominator };
}

function insertSpecialPositionEvent(
  tx: TransactionClient,
  input: {
    userId: string;
    accountId: string;
    instrumentId: string;
    relatedInstrumentId?: string;
    type: Exclude<
      PositionEventType,
      "opening_position" | "buy" | "sell" | "quantity_adjustment"
    >;
    quantity: string;
    tradeCurrency: string;
    tradeDate: string;
    eventGroupId: string;
    idempotencyKey?: string;
    actionRatioNumerator?: string;
    actionRatioDenominator?: string;
    description: string;
    notes?: string;
  },
) {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  tx.insert(positionEvents)
    .values({
      id,
      userId: input.userId,
      accountId: input.accountId,
      instrumentId: input.instrumentId,
      relatedInstrumentId: input.relatedInstrumentId ?? null,
      type: input.type,
      quantity: input.quantity,
      unitPrice: null,
      tradeCurrency: input.tradeCurrency,
      grossAmountMinor: null,
      feeAmountMinor: null,
      feeCurrency: null,
      cashEffectMinor: 0,
      appliedExchangeRate: null,
      openingCostBasisMinor: null,
      actionRatioNumerator: input.actionRatioNumerator ?? null,
      actionRatioDenominator: input.actionRatioDenominator ?? null,
      tradeDate: input.tradeDate,
      eventSequence: nextEventSequence(
        tx,
        input.userId,
        input.accountId,
        input.tradeDate,
      ),
      settlementDate: null,
      externalId: null,
      eventGroupId: input.eventGroupId,
      idempotencyKey: input.idempotencyKey ?? null,
      description: input.description,
      notes: input.notes?.trim() || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
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
    const groupedEvents = event.eventGroupId
      ? tx
          .select()
          .from(positionEvents)
          .where(
            and(
              eq(positionEvents.userId, userId),
              eq(positionEvents.eventGroupId, event.eventGroupId),
            ),
          )
          .all()
      : [event];
    const affectedAccountIds = new Set(
      groupedEvents.map((row) => row.accountId),
    );
    if (event.eventGroupId) {
      const groupedCash = tx
        .select({ accountId: transactions.accountId })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.eventGroupId, event.eventGroupId),
          ),
        )
        .all();
      for (const row of groupedCash) affectedAccountIds.add(row.accountId);
      tx.delete(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.eventGroupId, event.eventGroupId),
          ),
        )
        .run();
      tx.delete(positionEvents)
        .where(
          and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.eventGroupId, event.eventGroupId),
          ),
        )
        .run();
    } else {
      tx.delete(positionEvents)
        .where(
          and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.id, eventId),
          ),
        )
        .run();
    }
    for (const accountId of affectedAccountIds) {
      validateAndRecalculatePositionAccount(tx, userId, accountId);
    }
  });
}

export function recordDividendReinvestment(
  userId: string,
  input: {
    accountId: string;
    instrumentId: string;
    dividendAmount: string;
    quantity: string;
    unitPrice: string;
    tradeCurrency?: string;
    feeAmount?: string;
    feeCurrency?: string;
    cashEffect?: string;
    appliedExchangeRate?: string;
    activityDate: string;
    idempotencyKey: string;
    notes?: string;
  },
) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.activityDate, db);
  return db.transaction((tx) => {
    const duplicate = idempotentPositionEvent(tx, userId, input.idempotencyKey);
    if (duplicate) {
      return existingGroupOrConflict(
        duplicate,
        duplicate.type === "buy" &&
          duplicate.accountId === input.accountId &&
          duplicate.instrumentId === input.instrumentId,
      );
    }
    const account = requirePositionAccount(tx, userId, input.accountId);
    const dividendAmountMinor = parseMoney(
      input.dividendAmount,
      account.currency,
    );
    if (dividendAmountMinor <= 0) {
      throw new Error("Dividend amount must be greater than zero.");
    }
    const eventGroupId = crypto.randomUUID();
    const activityDate = dateInputToUtc(input.activityDate);
    const timestamp = nowIso();
    tx.insert(transactions)
      .values({
        id: crypto.randomUUID(),
        userId,
        accountId: account.id,
        type: "dividend",
        amountMinor: dividendAmountMinor,
        currency: account.currency,
        transactionDate: activityDate,
        description: "Dividend reinvestment income",
        notes: input.notes?.trim() || null,
        externalId: null,
        transferGroupId: null,
        eventGroupId,
        idempotencyKey: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    savePositionEvent(
      userId,
      {
        accountId: account.id,
        instrumentId: input.instrumentId,
        type: "buy",
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        tradeCurrency: input.tradeCurrency,
        feeAmount: input.feeAmount,
        feeCurrency: input.feeCurrency,
        cashEffect: input.cashEffect,
        appliedExchangeRate: input.appliedExchangeRate,
        tradeDate: input.activityDate,
        idempotencyKey: input.idempotencyKey,
        description: "Dividend reinvestment purchase",
        notes: input.notes,
      },
      undefined,
      tx,
      { eventGroupId, allowGrouped: true },
    );
    return eventGroupId;
  });
}

export function recordInKindTransfer(
  userId: string,
  input: {
    sourceAccountId: string;
    destinationAccountId: string;
    instrumentId: string;
    quantity: string;
    transferDate: string;
    feeAmount?: string;
    idempotencyKey: string;
    notes?: string;
  },
) {
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new Error("Choose two different position accounts.");
  }
  const db = getDatabase();
  assertNotFutureDate(userId, input.transferDate, db);
  return db.transaction((tx) => {
    const duplicate = idempotentPositionEvent(tx, userId, input.idempotencyKey);
    if (duplicate) {
      return existingGroupOrConflict(
        duplicate,
        duplicate.type === "transfer_out" &&
          duplicate.accountId === input.sourceAccountId &&
          duplicate.instrumentId === input.instrumentId,
      );
    }
    const source = requirePositionAccount(tx, userId, input.sourceAccountId);
    const destination = requirePositionAccount(
      tx,
      userId,
      input.destinationAccountId,
    );
    const instrument = requireInstrument(tx, userId, input.instrumentId);
    const quantity = canonicalDecimal(input.quantity, { label: "quantity" });
    const transferDate = dateInputToUtc(input.transferDate);
    const eventGroupId = crypto.randomUUID();
    insertSpecialPositionEvent(tx, {
      userId,
      accountId: source.id,
      instrumentId: instrument.id,
      type: "transfer_out",
      quantity,
      tradeCurrency: instrument.quoteCurrency,
      tradeDate: transferDate,
      eventGroupId,
      idempotencyKey: input.idempotencyKey,
      description: `In-kind transfer to ${destination.name}`,
      notes: input.notes,
    });
    insertSpecialPositionEvent(tx, {
      userId,
      accountId: destination.id,
      instrumentId: instrument.id,
      type: "transfer_in",
      quantity,
      tradeCurrency: instrument.quoteCurrency,
      tradeDate: transferDate,
      eventGroupId,
      description: `In-kind transfer from ${source.name}`,
      notes: input.notes,
    });
    if (input.feeAmount) {
      const feeAmountMinor = parseMoney(input.feeAmount, source.currency);
      if (feeAmountMinor <= 0)
        throw new Error("Fee must be greater than zero.");
      const timestamp = nowIso();
      tx.insert(transactions)
        .values({
          id: crypto.randomUUID(),
          userId,
          accountId: source.id,
          type: "fee",
          amountMinor: feeAmountMinor,
          currency: source.currency,
          transactionDate: transferDate,
          description: "In-kind transfer fee",
          notes: input.notes?.trim() || null,
          externalId: null,
          transferGroupId: null,
          eventGroupId,
          idempotencyKey: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }
    validateAndRecalculatePositionAccount(tx, userId, source.id);
    validateAndRecalculatePositionAccount(tx, userId, destination.id);
    return eventGroupId;
  });
}

export function recordStockSplit(
  userId: string,
  input: {
    accountId: string;
    instrumentId: string;
    numerator: string;
    denominator: string;
    actionDate: string;
    idempotencyKey: string;
    notes?: string;
  },
) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.actionDate, db);
  return db.transaction((tx) => {
    const duplicate = idempotentPositionEvent(tx, userId, input.idempotencyKey);
    if (duplicate) {
      return existingGroupOrConflict(
        duplicate,
        duplicate.type === "split" &&
          duplicate.accountId === input.accountId &&
          duplicate.instrumentId === input.instrumentId,
      );
    }
    const account = requirePositionAccount(tx, userId, input.accountId);
    const instrument = requireInstrument(tx, userId, input.instrumentId);
    const { numerator, denominator } = positiveRatio(
      input.numerator,
      input.denominator,
    );
    const actionDate = dateInputToUtc(input.actionDate);
    if (
      !positionQuantityAt(
        tx,
        userId,
        account.id,
        instrument.id,
        actionDate,
      ).isPositive()
    ) {
      throw new Error("The account has no position to split on that date.");
    }
    const eventGroupId = crypto.randomUUID();
    insertSpecialPositionEvent(tx, {
      userId,
      accountId: account.id,
      instrumentId: instrument.id,
      type: "split",
      quantity: "0",
      tradeCurrency: instrument.quoteCurrency,
      tradeDate: actionDate,
      eventGroupId,
      idempotencyKey: input.idempotencyKey,
      actionRatioNumerator: numerator,
      actionRatioDenominator: denominator,
      description: `${numerator}:${denominator} stock split`,
      notes: input.notes,
    });
    validateAndRecalculatePositionAccount(tx, userId, account.id);
    return eventGroupId;
  });
}

export function recordSpinoff(
  userId: string,
  input: {
    accountId: string;
    sourceInstrumentId: string;
    newInstrumentId: string;
    numerator: string;
    denominator: string;
    actionDate: string;
    idempotencyKey: string;
    notes?: string;
  },
) {
  if (input.sourceInstrumentId === input.newInstrumentId) {
    throw new Error("Choose a different spin-off instrument.");
  }
  const db = getDatabase();
  assertNotFutureDate(userId, input.actionDate, db);
  return db.transaction((tx) => {
    const duplicate = idempotentPositionEvent(tx, userId, input.idempotencyKey);
    if (duplicate) {
      return existingGroupOrConflict(
        duplicate,
        duplicate.type === "spinoff" &&
          duplicate.accountId === input.accountId &&
          duplicate.instrumentId === input.newInstrumentId &&
          duplicate.relatedInstrumentId === input.sourceInstrumentId,
      );
    }
    const account = requirePositionAccount(tx, userId, input.accountId);
    const source = requireInstrument(tx, userId, input.sourceInstrumentId);
    const destination = requireInstrument(tx, userId, input.newInstrumentId);
    const { numerator, denominator } = positiveRatio(
      input.numerator,
      input.denominator,
    );
    const actionDate = dateInputToUtc(input.actionDate);
    const sourceQuantity = positionQuantityAt(
      tx,
      userId,
      account.id,
      source.id,
      actionDate,
    );
    if (!sourceQuantity.isPositive()) {
      throw new Error("The source position is unavailable on that date.");
    }
    const quantity = sourceQuantity.mul(numerator).div(denominator).toString();
    const eventGroupId = crypto.randomUUID();
    insertSpecialPositionEvent(tx, {
      userId,
      accountId: account.id,
      instrumentId: destination.id,
      relatedInstrumentId: source.id,
      type: "spinoff",
      quantity,
      tradeCurrency: destination.quoteCurrency,
      tradeDate: actionDate,
      eventGroupId,
      idempotencyKey: input.idempotencyKey,
      actionRatioNumerator: numerator,
      actionRatioDenominator: denominator,
      description: `Spin-off from ${source.name}`,
      notes: input.notes,
    });
    validateAndRecalculatePositionAccount(tx, userId, account.id);
    return eventGroupId;
  });
}

export function recordMerger(
  userId: string,
  input: {
    accountId: string;
    sourceInstrumentId: string;
    destinationInstrumentId: string;
    numerator: string;
    denominator: string;
    actionDate: string;
    idempotencyKey: string;
    notes?: string;
  },
) {
  if (input.sourceInstrumentId === input.destinationInstrumentId) {
    throw new Error("Choose a different merger instrument.");
  }
  const db = getDatabase();
  assertNotFutureDate(userId, input.actionDate, db);
  return db.transaction((tx) => {
    const duplicate = idempotentPositionEvent(tx, userId, input.idempotencyKey);
    if (duplicate) {
      return existingGroupOrConflict(
        duplicate,
        duplicate.type === "merger_out" &&
          duplicate.accountId === input.accountId &&
          duplicate.instrumentId === input.sourceInstrumentId &&
          duplicate.relatedInstrumentId === input.destinationInstrumentId,
      );
    }
    const account = requirePositionAccount(tx, userId, input.accountId);
    const source = requireInstrument(tx, userId, input.sourceInstrumentId);
    const destination = requireInstrument(
      tx,
      userId,
      input.destinationInstrumentId,
    );
    const { numerator, denominator } = positiveRatio(
      input.numerator,
      input.denominator,
    );
    const actionDate = dateInputToUtc(input.actionDate);
    const sourceQuantity = positionQuantityAt(
      tx,
      userId,
      account.id,
      source.id,
      actionDate,
    );
    if (!sourceQuantity.isPositive()) {
      throw new Error("The source position is unavailable on that date.");
    }
    const destinationQuantity = sourceQuantity
      .mul(numerator)
      .div(denominator)
      .toString();
    const eventGroupId = crypto.randomUUID();
    insertSpecialPositionEvent(tx, {
      userId,
      accountId: account.id,
      instrumentId: source.id,
      relatedInstrumentId: destination.id,
      type: "merger_out",
      quantity: sourceQuantity.toString(),
      tradeCurrency: source.quoteCurrency,
      tradeDate: actionDate,
      eventGroupId,
      idempotencyKey: input.idempotencyKey,
      actionRatioNumerator: numerator,
      actionRatioDenominator: denominator,
      description: `Surrendered in merger with ${destination.name}`,
      notes: input.notes,
    });
    insertSpecialPositionEvent(tx, {
      userId,
      accountId: account.id,
      instrumentId: destination.id,
      relatedInstrumentId: source.id,
      type: "merger_in",
      quantity: destinationQuantity,
      tradeCurrency: destination.quoteCurrency,
      tradeDate: actionDate,
      eventGroupId,
      actionRatioNumerator: numerator,
      actionRatioDenominator: denominator,
      description: `Received in merger from ${source.name}`,
      notes: input.notes,
    });
    validateAndRecalculatePositionAccount(tx, userId, account.id);
    return eventGroupId;
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

export function listPositionCashTransactions(
  userId: string,
  accountId: string,
) {
  return getDatabase()
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
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
