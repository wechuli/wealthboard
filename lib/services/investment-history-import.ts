import "server-only";

import Decimal from "decimal.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { z } from "zod";

import {
  accounts,
  exchangeRates,
  investmentInstruments,
  positionEvents,
  securityPrices,
  transactions,
  userSettings,
  type InvestmentInstrument,
  type PositionEvent,
  type SecurityPrice,
  type TransactionType,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { transactionEffect } from "@/lib/finance";
import {
  applyPositionEventQuantity,
  calculateQuoteValueMinor,
  canonicalDecimal,
  convertMinorWithAppliedRate,
  orderPositionEvents,
  replayPositionQuantities,
} from "@/lib/investments";
import {
  convertMinor,
  MissingExchangeRateError,
  parseMoney,
} from "@/lib/money";
import { recalculateAccountBalance } from "@/lib/services/accounts";
import {
  calculatePositionAccountSnapshot,
  type PositionDataIssue,
} from "@/lib/services/investment-valuation";
import { requireEnabledCurrency } from "@/lib/services/settings";

export const INVESTMENT_HISTORY_MAX_BYTES = 5 * 1024 * 1024;
export const INVESTMENT_HISTORY_MAX_RECORDS = 10_000;

const nullableText = z.string().max(2000).nullable().optional();
const optionalString = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => value?.trim() || undefined);
const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

const sourceInstrumentSchema = z
  .object({
    external_id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(100),
    symbol: optionalString(30),
    identifier_type: z.enum(["isin", "ticker_exchange", "custom"]),
    identifier: optionalString(100),
    exchange_mic: optionalString(20),
    asset_type: z.enum(["stock", "etf", "fund"]),
    quote_currency: z.string().trim().length(3),
  })
  .strict();

const sourceEventSchema = z
  .object({
    external_id: z.string().trim().min(1).max(200),
    instrument_external_id: z.string().trim().min(1).max(200),
    type: z.enum(["opening_position", "buy", "sell", "quantity_adjustment"]),
    quantity: decimalString,
    unit_price: decimalString.nullable().optional(),
    trade_currency: z.string().trim().length(3),
    fee_amount: decimalString.nullable().optional(),
    fee_currency: z.string().trim().length(3).nullable().optional(),
    cash_effect: decimalString.nullable().optional(),
    applied_exchange_rate: decimalString.nullable().optional(),
    opening_cost_basis: decimalString.nullable().optional(),
    event_group_id: optionalString(200),
    trade_date: z.string().date(),
    settlement_date: z.string().date().nullable().optional(),
    description: optionalString(200),
    notes: nullableText,
  })
  .strict();

const sourceCashSchema = z
  .object({
    external_id: z.string().trim().min(1).max(200),
    type: z.enum([
      "deposit",
      "withdrawal",
      "interest",
      "dividend",
      "fee",
      "manual_adjustment",
    ]),
    amount: decimalString,
    date: z.string().date(),
    event_group_id: optionalString(200),
    description: optionalString(200),
    notes: nullableText,
  })
  .strict();

const sourcePriceSchema = z
  .object({
    external_id: z.string().trim().min(1).max(200),
    instrument_external_id: z.string().trim().min(1).max(200),
    price: decimalString,
    effective_date: z.string().date(),
    source: z.string().trim().min(1).max(100),
    provenance: optionalString(500),
  })
  .strict();

const envelopeSchema = z
  .object({
    format: z.literal("wealthboard-investment-history"),
    version: z.literal(1),
    instruments: z.array(sourceInstrumentSchema).default([]),
    position_events: z.array(sourceEventSchema).default([]),
    cash_transactions: z.array(sourceCashSchema).default([]),
    prices: z.array(sourcePriceSchema).default([]),
  })
  .strict();

type SourceEnvelope = z.infer<typeof envelopeSchema>;
type SourceInstrument = z.infer<typeof sourceInstrumentSchema>;
type SourceEvent = z.infer<typeof sourceEventSchema>;
type SourceCash = z.infer<typeof sourceCashSchema>;
type SourcePrice = z.infer<typeof sourcePriceSchema>;

const HOLDINGS_HEADERS = [
  "instrument_external_id",
  "event_external_id",
  "price_external_id",
  "instrument_name",
  "symbol",
  "identifier_type",
  "identifier",
  "exchange_mic",
  "asset_type",
  "quote_currency",
  "quantity",
  "unit_price",
  "price_date",
  "opening_cost_basis",
  "notes",
] as const;
const TRADE_HEADERS = [
  "external_id",
  "instrument_external_id",
  "type",
  "quantity",
  "unit_price",
  "trade_currency",
  "fee_amount",
  "fee_currency",
  "cash_effect",
  "applied_exchange_rate",
  "trade_date",
  "settlement_date",
  "description",
  "notes",
] as const;
const CASH_HEADERS = [
  "external_id",
  "type",
  "amount",
  "date",
  "description",
  "notes",
] as const;
const PRICE_HEADERS = [
  "external_id",
  "instrument_external_id",
  "price",
  "effective_date",
  "source",
  "provenance",
] as const;

export type InvestmentImportError = {
  collection: string;
  row: number;
  externalId: string | null;
  message: string;
};

export class InvestmentHistoryFileError extends Error {}
export class InvestmentHistoryAccessError extends Error {}

type PreparedInvestment = {
  account: typeof accounts.$inferSelect;
  instruments: Array<typeof investmentInstruments.$inferInsert>;
  events: Array<typeof positionEvents.$inferInsert>;
  cash: Array<typeof transactions.$inferInsert>;
  prices: Array<typeof securityPrices.$inferInsert>;
  errors: InvestmentImportError[];
  skippedDuplicates: number;
  sourceRecords: number;
  dateRange: { from: string; to: string } | null;
  instrumentChanges: Array<{
    instrumentId: string;
    externalId: string | null;
    name: string;
    symbol: string | null;
    resolution: "existing" | "new";
    currentQuantity: string;
    projectedQuantity: string;
    quantityChange: string;
  }>;
  eventChanges: Array<{
    externalId: string | null;
    instrumentId: string;
    instrumentName: string;
    instrumentSymbol: string | null;
    type: string;
    tradeDate: string;
    eventSequence: number;
    beforeQuantity: string;
    afterQuantity: string;
  }>;
  priceChanges: Array<{
    externalId: string | null;
    instrumentId: string;
    instrumentName: string;
    instrumentSymbol: string | null;
    price: string;
    currency: string;
    source: string;
    affectedFrom: string;
    affectedTo: string;
    affectedToExclusive: boolean;
  }>;
  projected: {
    cashMinor: bigint;
    positionsMinor: bigint;
    totalMinor: bigint;
    complete: boolean;
    missingPrices: string[];
    missingCurrencies: string[];
    staleInstrumentIds: string[];
    issues: PositionDataIssue[];
  };
};

function fileError(message: string): never {
  throw new InvestmentHistoryFileError(message);
}

function parseCsvRows(content: string) {
  const rows = parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Array<Record<string, string>>;
  if (!rows.length) fileError("The CSV file is empty.");
  return rows;
}

function hasExactHeaders(
  row: Record<string, string>,
  expected: readonly string[],
) {
  const keys = Object.keys(row);
  return (
    keys.length === expected.length &&
    expected.every((header) => keys.includes(header))
  );
}

function emptyToNull(value: string | undefined) {
  return value?.trim() ? value.trim() : undefined;
}

function parseCsvEnvelope(content: string): SourceEnvelope {
  const rows = parseCsvRows(content);
  const first = rows[0];
  if (hasExactHeaders(first, HOLDINGS_HEADERS)) {
    return envelopeSchema.parse({
      format: "wealthboard-investment-history",
      version: 1,
      instruments: rows.map(
        (row): SourceInstrument => ({
          external_id: row.instrument_external_id,
          name: row.instrument_name,
          symbol: emptyToNull(row.symbol),
          identifier_type:
            row.identifier_type as SourceInstrument["identifier_type"],
          identifier: emptyToNull(row.identifier),
          exchange_mic: emptyToNull(row.exchange_mic),
          asset_type: row.asset_type as SourceInstrument["asset_type"],
          quote_currency: row.quote_currency,
        }),
      ),
      position_events: rows.map(
        (row): SourceEvent => ({
          external_id: row.event_external_id,
          instrument_external_id: row.instrument_external_id,
          type: "opening_position",
          quantity: row.quantity,
          unit_price: null,
          trade_currency: row.quote_currency,
          fee_amount: null,
          fee_currency: null,
          cash_effect: null,
          applied_exchange_rate: null,
          opening_cost_basis: emptyToNull(row.opening_cost_basis),
          event_group_id: undefined,
          trade_date: row.price_date,
          settlement_date: null,
          description: "Imported opening position",
          notes: emptyToNull(row.notes),
        }),
      ),
      cash_transactions: [],
      prices: rows.map(
        (row): SourcePrice => ({
          external_id: row.price_external_id,
          instrument_external_id: row.instrument_external_id,
          price: row.unit_price,
          effective_date: row.price_date,
          source: "import",
          provenance: "Investment History v1 opening holdings",
        }),
      ),
    });
  }
  if (hasExactHeaders(first, TRADE_HEADERS)) {
    return envelopeSchema.parse({
      format: "wealthboard-investment-history",
      version: 1,
      instruments: [],
      position_events: rows.map((row) => ({
        external_id: row.external_id,
        instrument_external_id: row.instrument_external_id,
        type: row.type,
        quantity: row.quantity,
        unit_price: emptyToNull(row.unit_price),
        trade_currency: row.trade_currency,
        fee_amount: emptyToNull(row.fee_amount),
        fee_currency: emptyToNull(row.fee_currency),
        cash_effect: emptyToNull(row.cash_effect),
        applied_exchange_rate: emptyToNull(row.applied_exchange_rate),
        opening_cost_basis: null,
        event_group_id: undefined,
        trade_date: row.trade_date,
        settlement_date: emptyToNull(row.settlement_date),
        description: emptyToNull(row.description),
        notes: emptyToNull(row.notes),
      })),
      cash_transactions: [],
      prices: [],
    });
  }
  if (hasExactHeaders(first, CASH_HEADERS)) {
    return envelopeSchema.parse({
      format: "wealthboard-investment-history",
      version: 1,
      instruments: [],
      position_events: [],
      cash_transactions: rows.map((row) => ({
        external_id: row.external_id,
        type: row.type,
        amount: row.amount,
        date: row.date,
        event_group_id: undefined,
        description: emptyToNull(row.description),
        notes: emptyToNull(row.notes),
      })),
      prices: [],
    });
  }
  if (hasExactHeaders(first, PRICE_HEADERS)) {
    return envelopeSchema.parse({
      format: "wealthboard-investment-history",
      version: 1,
      instruments: [],
      position_events: [],
      cash_transactions: [],
      prices: rows.map((row) => ({
        external_id: row.external_id,
        instrument_external_id: row.instrument_external_id,
        price: row.price,
        effective_date: row.effective_date,
        source: row.source,
        provenance: emptyToNull(row.provenance),
      })),
    });
  }
  fileError("The CSV headers do not match an Investment History v1 template.");
}

export function parseInvestmentHistoryFile(
  content: string,
  format: "csv" | "json",
) {
  if (Buffer.byteLength(content, "utf8") > INVESTMENT_HISTORY_MAX_BYTES) {
    fileError("Investment history import is limited to 5 MB.");
  }
  let envelope: SourceEnvelope;
  try {
    envelope =
      format === "csv"
        ? parseCsvEnvelope(content)
        : envelopeSchema.parse(JSON.parse(content));
  } catch (error) {
    if (error instanceof InvestmentHistoryFileError) throw error;
    fileError(
      error instanceof Error
        ? `The investment-history file is invalid: ${error.message}`
        : "The investment-history file is invalid.",
    );
  }
  const total =
    envelope.instruments.length +
    envelope.position_events.length +
    envelope.cash_transactions.length +
    envelope.prices.length;
  if (!total) fileError("The investment-history file contains no records.");
  if (total > INVESTMENT_HISTORY_MAX_RECORDS) {
    fileError("Investment history import is limited to 10,000 records.");
  }
  return envelope;
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function checkedNumber(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(
      "A calculated import value is outside the supported range.",
    );
  }
  return number;
}

function accountForImport(userId: string) {
  return (accountId: string) => {
    const account = getDatabase()
      .query.accounts.findFirst({
        where: and(
          eq(accounts.userId, userId),
          eq(accounts.id, accountId),
          eq(accounts.trackingMode, "positions"),
          isNull(accounts.archivedAt),
        ),
      })
      .sync();
    if (!account)
      throw new InvestmentHistoryAccessError("Position account not found.");
    return account;
  };
}

function prepareInvestmentHistory(
  userId: string,
  accountId: string,
  envelope: SourceEnvelope,
): PreparedInvestment {
  const db = getDatabase();
  const account = accountForImport(userId)(accountId);
  const settings = db.query.userSettings
    .findFirst({ where: eq(userSettings.userId, userId) })
    .sync();
  if (!settings) throw new Error("User settings are unavailable.");
  const today = dateInputForTimezone(settings.timezone);
  const errors: InvestmentImportError[] = [];
  const groupedEvents = new Map<string, SourceEvent[]>();
  const groupedCash = new Map<string, SourceCash[]>();
  for (const event of envelope.position_events) {
    if (!event.event_group_id) continue;
    groupedEvents.set(event.event_group_id, [
      ...(groupedEvents.get(event.event_group_id) ?? []),
      event,
    ]);
  }
  for (const cash of envelope.cash_transactions) {
    if (!cash.event_group_id) continue;
    groupedCash.set(cash.event_group_id, [
      ...(groupedCash.get(cash.event_group_id) ?? []),
      cash,
    ]);
  }
  const externalGroupIds = new Set([
    ...groupedEvents.keys(),
    ...groupedCash.keys(),
  ]);
  const eventGroupIds = new Map(
    [...externalGroupIds].map((externalId) => [
      externalId,
      crypto.randomUUID(),
    ]),
  );
  for (const externalId of externalGroupIds) {
    const eventRows = groupedEvents.get(externalId) ?? [];
    const cashRows = groupedCash.get(externalId) ?? [];
    const dates = new Set([
      ...eventRows.map((row) => row.trade_date),
      ...cashRows.map((row) => row.date),
    ]);
    if (
      eventRows.length < 1 ||
      eventRows.some((row) => row.type !== "buy") ||
      cashRows.length !== 1 ||
      cashRows[0].type !== "dividend" ||
      dates.size !== 1
    ) {
      errors.push({
        collection: "event_groups",
        row: 0,
        externalId,
        message:
          "A reinvestment group requires one dividend and one or more buys on the same date.",
      });
    }
  }
  let skippedDuplicates = 0;
  const timestampBase = Date.now();
  const existingInstruments = db
    .select()
    .from(investmentInstruments)
    .where(eq(investmentInstruments.userId, userId))
    .all();
  const existingInstrumentByExternal = new Map(
    existingInstruments
      .filter((row) => row.externalId)
      .map((row) => [row.externalId!, row]),
  );
  const instrumentDuplicates = duplicateValues(
    envelope.instruments.map((row) => row.external_id),
  );
  const instruments: Array<typeof investmentInstruments.$inferInsert> = [];
  const instrumentByExternal = new Map<string, InvestmentInstrument>(
    existingInstrumentByExternal,
  );

  envelope.instruments.forEach((source, index) => {
    if (instrumentDuplicates.has(source.external_id)) {
      errors.push({
        collection: "instruments",
        row: index + 1,
        externalId: source.external_id,
        message: "Instrument external ID occurs more than once in this file.",
      });
      return;
    }
    try {
      const quoteCurrency = requireEnabledCurrency(
        userId,
        source.quote_currency,
        db,
      );
      const existing = existingInstrumentByExternal.get(source.external_id);
      if (existing) {
        const identical =
          existing.name === source.name &&
          existing.symbol === (source.symbol?.toUpperCase() ?? null) &&
          existing.identifierType === source.identifier_type &&
          existing.identifier === (source.identifier?.toUpperCase() ?? null) &&
          existing.exchangeMic ===
            (source.exchange_mic?.toUpperCase() ?? null) &&
          existing.assetType === source.asset_type &&
          existing.quoteCurrency === quoteCurrency;
        if (!identical)
          throw new Error(
            "Instrument external ID conflicts with an existing instrument.",
          );
        skippedDuplicates += 1;
        return;
      }
      const id = crypto.randomUUID();
      const row: typeof investmentInstruments.$inferInsert = {
        id,
        userId,
        externalId: source.external_id,
        name: source.name,
        symbol: source.symbol?.toUpperCase() ?? null,
        identifierType: source.identifier_type,
        identifier: source.identifier?.toUpperCase() ?? null,
        exchangeMic: source.exchange_mic?.toUpperCase() ?? null,
        assetType: source.asset_type,
        quoteCurrency,
        createdAt: new Date(timestampBase + index).toISOString(),
        updatedAt: new Date(timestampBase + index).toISOString(),
      };
      instruments.push(row);
      instrumentByExternal.set(source.external_id, row as InvestmentInstrument);
    } catch (error) {
      errors.push({
        collection: "instruments",
        row: index + 1,
        externalId: source.external_id,
        message:
          error instanceof Error ? error.message : "Instrument is invalid.",
      });
    }
  });

  const existingEvents = db
    .select()
    .from(positionEvents)
    .where(
      and(
        eq(positionEvents.userId, userId),
        eq(positionEvents.accountId, accountId),
      ),
    )
    .all();
  const existingEventByExternal = new Map(
    existingEvents
      .filter((row) => row.externalId)
      .map((row) => [row.externalId!, row]),
  );
  const eventDuplicates = duplicateValues(
    envelope.position_events.map((row) => row.external_id),
  );
  const rates = db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .all();
  const events: Array<typeof positionEvents.$inferInsert> = [];
  const sequenceByDate = new Map<string, number>();
  for (const event of existingEvents) {
    sequenceByDate.set(
      event.tradeDate,
      Math.max(sequenceByDate.get(event.tradeDate) ?? 0, event.eventSequence),
    );
  }

  envelope.position_events.forEach((source, index) => {
    if (eventDuplicates.has(source.external_id)) {
      errors.push({
        collection: "position_events",
        row: index + 1,
        externalId: source.external_id,
        message:
          "Position-event external ID occurs more than once in this file.",
      });
      return;
    }
    try {
      if (
        source.trade_date > today ||
        (source.settlement_date && source.settlement_date > today)
      ) {
        throw new Error("Position activity cannot be dated in the future.");
      }
      const instrument = instrumentByExternal.get(
        source.instrument_external_id,
      );
      if (!instrument) throw new Error("Referenced instrument was not found.");
      const quantity = canonicalDecimal(source.quantity, {
        label: "quantity",
        allowNegative: source.type === "quantity_adjustment",
      });
      const tradeCurrency = requireEnabledCurrency(
        userId,
        source.trade_currency,
        db,
      );
      const unitPrice = source.unit_price
        ? canonicalDecimal(source.unit_price, { label: "unit price" })
        : null;
      if ((source.type === "buy" || source.type === "sell") && !unitPrice) {
        throw new Error("Buy and sell events require a unit price.");
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
      const feeCurrency = source.fee_amount
        ? requireEnabledCurrency(
            userId,
            source.fee_currency || tradeCurrency,
            db,
          )
        : null;
      const feeAmountMinor = source.fee_amount
        ? parseMoney(source.fee_amount, feeCurrency!)
        : null;
      if (
        (source.fee_amount || source.cash_effect) &&
        source.type !== "buy" &&
        source.type !== "sell"
      ) {
        throw new Error(
          "Fees and settlement amounts apply only to buys and sells.",
        );
      }
      if (feeAmountMinor != null && feeAmountMinor < 0)
        throw new Error("Fee cannot be negative.");
      const appliedExchangeRate = source.applied_exchange_rate
        ? canonicalDecimal(source.applied_exchange_rate, {
            label: "applied exchange rate",
          })
        : null;
      if (
        appliedExchangeRate &&
        ((source.type !== "buy" && source.type !== "sell") ||
          tradeCurrency === account.currency)
      ) {
        throw new Error(
          "An applied settlement rate is only valid for cross-currency trades.",
        );
      }
      if (
        (source.type === "buy" || source.type === "sell") &&
        tradeCurrency !== account.currency &&
        !source.cash_effect &&
        !appliedExchangeRate
      ) {
        throw new Error(
          "Cross-currency trades require cash_effect or applied_exchange_rate.",
        );
      }
      const tradeDate = dateInputToUtc(source.trade_date);
      let cashEffectMinor = 0n;
      if (source.type === "buy" || source.type === "sell") {
        if (source.cash_effect) {
          const actual = BigInt(
            parseMoney(source.cash_effect, account.currency),
          );
          if (actual <= 0n)
            throw new Error("Cash effect must be greater than zero.");
          cashEffectMinor = source.type === "buy" ? -actual : actual;
        } else {
          const convertToAccount = (
            amountMinor: number,
            fromCurrency: string,
          ) =>
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
            source.type === "buy"
              ? -(grossAccountMinor + feeAccountMinor)
              : grossAccountMinor - feeAccountMinor;
        }
      }
      const existing = existingEventByExternal.get(source.external_id);
      if (existing) {
        const identical =
          existing.instrumentId === instrument.id &&
          existing.type === source.type &&
          existing.quantity === quantity &&
          existing.unitPrice === unitPrice &&
          existing.tradeCurrency === tradeCurrency &&
          existing.cashEffectMinor === checkedNumber(cashEffectMinor) &&
          existing.tradeDate === tradeDate;
        if (!identical)
          throw new Error(
            "Position-event external ID conflicts with an existing event.",
          );
        skippedDuplicates += 1;
        return;
      }
      const createdAt = new Date(
        timestampBase + envelope.instruments.length + index,
      ).toISOString();
      const eventSequence = (sequenceByDate.get(tradeDate) ?? 0) + 1;
      sequenceByDate.set(tradeDate, eventSequence);
      if (source.opening_cost_basis && source.type !== "opening_position") {
        throw new Error(
          "Opening cost basis applies only to an opening position.",
        );
      }
      const openingCostBasisMinor = source.opening_cost_basis
        ? parseMoney(source.opening_cost_basis, account.currency)
        : null;
      if (openingCostBasisMinor != null && openingCostBasisMinor < 0) {
        throw new Error("Opening cost basis cannot be negative.");
      }
      events.push({
        id: crypto.randomUUID(),
        userId,
        accountId,
        instrumentId: instrument.id,
        type: source.type,
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
        eventSequence,
        settlementDate: source.settlement_date
          ? dateInputToUtc(source.settlement_date)
          : null,
        externalId: source.external_id,
        eventGroupId: source.event_group_id
          ? eventGroupIds.get(source.event_group_id)
          : null,
        description: source.description ?? null,
        notes: source.notes ?? null,
        createdAt,
        updatedAt: createdAt,
      });
    } catch (error) {
      errors.push({
        collection: "position_events",
        row: index + 1,
        externalId: source.external_id,
        message:
          error instanceof Error ? error.message : "Position event is invalid.",
      });
    }
  });

  const currentQuantities = replayPositionQuantities(existingEvents);
  let quantities = currentQuantities;
  try {
    quantities = replayPositionQuantities([
      ...existingEvents,
      ...(events as PositionEvent[]),
    ]);
  } catch (error) {
    errors.push({
      collection: "position_events",
      row: 0,
      externalId: null,
      message:
        error instanceof Error
          ? error.message
          : "Position sequence is invalid.",
    });
  }

  const existingCash = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
      ),
    )
    .all();
  const existingCashByExternal = new Map(
    existingCash
      .filter((row) => row.externalId)
      .map((row) => [row.externalId!, row]),
  );
  const cashDuplicates = duplicateValues(
    envelope.cash_transactions.map((row) => row.external_id),
  );
  const cash: Array<typeof transactions.$inferInsert> = [];
  envelope.cash_transactions.forEach((source, index) => {
    if (cashDuplicates.has(source.external_id)) {
      errors.push({
        collection: "cash_transactions",
        row: index + 1,
        externalId: source.external_id,
        message: "Cash external ID occurs more than once in this file.",
      });
      return;
    }
    try {
      if (source.date > today)
        throw new Error("Cash activity cannot be dated in the future.");
      const amountMinor = parseMoney(source.amount, account.currency);
      if (
        source.type === "manual_adjustment"
          ? amountMinor === 0
          : amountMinor <= 0
      ) {
        throw new Error("Cash amount has an invalid sign or is zero.");
      }
      const transactionDate = dateInputToUtc(source.date);
      const existing = existingCashByExternal.get(source.external_id);
      if (existing) {
        const identical =
          existing.type === source.type &&
          existing.amountMinor === amountMinor &&
          existing.transactionDate === transactionDate;
        if (!identical)
          throw new Error(
            "Cash external ID conflicts with an existing transaction.",
          );
        skippedDuplicates += 1;
        return;
      }
      const createdAt = new Date(
        timestampBase +
          envelope.instruments.length +
          envelope.position_events.length +
          index,
      ).toISOString();
      cash.push({
        id: crypto.randomUUID(),
        userId,
        accountId,
        externalId: source.external_id,
        type: source.type,
        amountMinor,
        currency: account.currency,
        transactionDate,
        eventGroupId: source.event_group_id
          ? eventGroupIds.get(source.event_group_id)
          : null,
        description: source.description ?? null,
        notes: source.notes ?? null,
        createdAt,
        updatedAt: createdAt,
      });
    } catch (error) {
      errors.push({
        collection: "cash_transactions",
        row: index + 1,
        externalId: source.external_id,
        message:
          error instanceof Error
            ? error.message
            : "Cash transaction is invalid.",
      });
    }
  });

  for (const externalGroupId of externalGroupIds) {
    const sourceEvents = groupedEvents.get(externalGroupId) ?? [];
    const sourceCash = groupedCash.get(externalGroupId) ?? [];
    const existingGroupValues = [
      ...sourceEvents.map((source) =>
        existingEventByExternal.get(source.external_id),
      ),
      ...sourceCash.map((source) =>
        existingCashByExternal.get(source.external_id),
      ),
    ]
      .filter((row): row is PositionEvent | typeof transactions.$inferSelect =>
        Boolean(row),
      )
      .map((row) => row.eventGroupId);
    if (!existingGroupValues.length) continue;
    const existingGroupIds = new Set(existingGroupValues.filter(Boolean));
    if (
      existingGroupValues.some((value) => !value) ||
      existingGroupIds.size !== 1
    ) {
      errors.push({
        collection: "event_groups",
        row: 0,
        externalId: externalGroupId,
        message:
          "Existing reinvestment records do not share one valid event group.",
      });
      continue;
    }
    const internalGroupId = [...existingGroupIds][0]!;
    const sourceEventIds = new Set(
      sourceEvents.map((source) => source.external_id),
    );
    const sourceCashIds = new Set(
      sourceCash.map((source) => source.external_id),
    );
    for (const event of events) {
      if (event.externalId && sourceEventIds.has(event.externalId)) {
        event.eventGroupId = internalGroupId;
      }
    }
    for (const row of cash) {
      if (row.externalId && sourceCashIds.has(row.externalId)) {
        row.eventGroupId = internalGroupId;
      }
    }
  }

  const involvedInstrumentIds = [
    ...new Set([...instrumentByExternal.values()].map((row) => row.id)),
  ];
  const existingPrices = involvedInstrumentIds.length
    ? db
        .select()
        .from(securityPrices)
        .where(
          and(
            eq(securityPrices.userId, userId),
            inArray(securityPrices.instrumentId, involvedInstrumentIds),
          ),
        )
        .all()
    : [];
  const existingPriceByExternal = new Map(
    existingPrices
      .filter((row) => row.externalId)
      .map((row) => [`${row.instrumentId}:${row.externalId}`, row]),
  );
  const priceDuplicates = duplicateValues(
    envelope.prices.map(
      (row) => `${row.instrument_external_id}:${row.external_id}`,
    ),
  );
  const prices: Array<typeof securityPrices.$inferInsert> = [];
  envelope.prices.forEach((source, index) => {
    const duplicateKey = `${source.instrument_external_id}:${source.external_id}`;
    if (priceDuplicates.has(duplicateKey)) {
      errors.push({
        collection: "prices",
        row: index + 1,
        externalId: source.external_id,
        message: "Price external ID occurs more than once for this instrument.",
      });
      return;
    }
    try {
      if (source.effective_date > today)
        throw new Error("Price cannot be dated in the future.");
      const instrument = instrumentByExternal.get(
        source.instrument_external_id,
      );
      if (!instrument) throw new Error("Referenced instrument was not found.");
      const price = canonicalDecimal(source.price, { label: "unit price" });
      const effectiveDate = dateInputToUtc(source.effective_date);
      const existingByExternal = existingPriceByExternal.get(
        `${instrument.id}:${source.external_id}`,
      );
      const existingByDate = existingPrices.find(
        (row) =>
          row.instrumentId === instrument.id &&
          row.effectiveDate === effectiveDate,
      );
      const existing = existingByExternal ?? existingByDate;
      if (existing) {
        const identical =
          existing.price === price &&
          existing.effectiveDate === effectiveDate &&
          existing.source === source.source;
        if (!identical)
          throw new Error("Price conflicts with an existing observation.");
        skippedDuplicates += 1;
        return;
      }
      const createdAt = new Date(
        timestampBase +
          envelope.instruments.length +
          envelope.position_events.length +
          envelope.cash_transactions.length +
          index,
      ).toISOString();
      prices.push({
        id: crypto.randomUUID(),
        userId,
        instrumentId: instrument.id,
        externalId: source.external_id,
        price,
        currency: instrument.quoteCurrency,
        effectiveDate,
        source: source.source,
        provenance: source.provenance ?? null,
        createdAt,
        updatedAt: createdAt,
      });
    } catch (error) {
      errors.push({
        collection: "prices",
        row: index + 1,
        externalId: source.external_id,
        message: error instanceof Error ? error.message : "Price is invalid.",
      });
    }
  });

  const current = calculatePositionAccountSnapshot(userId, db, accountId);
  const projectedCashMinor =
    current.cashMinor +
    events.reduce(
      (total, event) => total + BigInt(event.cashEffectMinor ?? 0),
      0n,
    ) +
    cash.reduce(
      (total, row) =>
        total + transactionEffect(row.type as TransactionType, row.amountMinor),
      0n,
    );
  const allEvents = [...existingEvents, ...(events as PositionEvent[])];
  const allPrices = [...existingPrices, ...(prices as SecurityPrice[])];
  const allInstruments = new Map(
    [...existingInstruments, ...(instruments as InvestmentInstrument[])].map(
      (row) => [row.id, row],
    ),
  );
  let projectedPositionsMinor = 0n;
  const missingPrices: string[] = [];
  const missingCurrencies = new Set<string>();
  const staleInstrumentIds: string[] = [];
  const issues: PositionDataIssue[] = [];
  const projectionAsOf = nowIso();
  for (const [instrumentId, quantity] of quantities) {
    if (quantity === "0") continue;
    const instrument = allInstruments.get(instrumentId);
    if (!instrument) continue;
    const exposureFrom =
      allEvents
        .filter((event) => event.instrumentId === instrumentId)
        .sort(
          (left, right) =>
            left.tradeDate.localeCompare(right.tradeDate) ||
            (left.eventSequence ?? 0) - (right.eventSequence ?? 0) ||
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )[0]?.tradeDate ?? projectionAsOf;
    const price = allPrices
      .filter((row) => row.instrumentId === instrumentId)
      .sort((left, right) =>
        right.effectiveDate.localeCompare(left.effectiveDate),
      )[0];
    if (!price) {
      missingPrices.push(instrumentId);
      issues.push({
        type: "missing_price",
        instrumentId,
        instrumentName: instrument.name,
        instrumentSymbol: instrument.symbol,
        currency: instrument.quoteCurrency,
        affectedFrom: exposureFrom,
        affectedTo: projectionAsOf,
        lastPriceDate: null,
        source: null,
        provenance: null,
        thresholdDays: null,
      });
      continue;
    }
    try {
      projectedPositionsMinor += convertMinor(
        calculateQuoteValueMinor(quantity, price.price, price.currency),
        price.currency,
        account.currency,
        rates,
        nowIso(),
      );
    } catch (error) {
      if (!(error instanceof MissingExchangeRateError)) throw error;
      missingCurrencies.add(price.currency);
      issues.push({
        type: "missing_rate",
        instrumentId,
        instrumentName: instrument.name,
        instrumentSymbol: instrument.symbol,
        currency: price.currency,
        affectedFrom: exposureFrom,
        affectedTo: projectionAsOf,
        lastPriceDate: price.effectiveDate,
        source: price.source,
        provenance: price.provenance,
        thresholdDays: null,
      });
    }
    const thresholdDays =
      instrument.assetType === "stock"
        ? settings.positionStaleDaysStock
        : instrument.assetType === "etf"
          ? settings.positionStaleDaysEtf
          : settings.positionStaleDaysFund;
    if (
      new Date(projectionAsOf).getTime() -
        new Date(price.effectiveDate).getTime() >
      thresholdDays * 86_400_000
    ) {
      staleInstrumentIds.push(instrumentId);
      issues.push({
        type: "stale_price",
        instrumentId,
        instrumentName: instrument.name,
        instrumentSymbol: instrument.symbol,
        currency: price.currency,
        affectedFrom: new Date(
          new Date(price.effectiveDate).getTime() + thresholdDays * 86_400_000,
        ).toISOString(),
        affectedTo: projectionAsOf,
        lastPriceDate: price.effectiveDate,
        source: price.source,
        provenance: price.provenance,
        thresholdDays,
      });
    }
  }

  const involvedQuantityIds = new Set([
    ...currentQuantities.keys(),
    ...quantities.keys(),
    ...instrumentByExternal.values().map((instrument) => instrument.id),
  ]);
  const newInstrumentIds = new Set(
    instruments.map((instrument) => instrument.id!),
  );
  const instrumentChanges = [...involvedQuantityIds]
    .map((instrumentId) => {
      const instrument = allInstruments.get(instrumentId);
      if (!instrument) return null;
      const currentQuantity = currentQuantities.get(instrumentId) ?? "0";
      const projectedQuantity = quantities.get(instrumentId) ?? "0";
      return {
        instrumentId,
        externalId: instrument.externalId,
        name: instrument.name,
        symbol: instrument.symbol,
        resolution: newInstrumentIds.has(instrumentId)
          ? ("new" as const)
          : ("existing" as const),
        currentQuantity,
        projectedQuantity,
        quantityChange: new Decimal(projectedQuantity)
          .minus(currentQuantity)
          .toString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const importedEventIds = new Set(events.map((event) => event.id!));
  const quantityState = new Map<string, Decimal>();
  const eventChanges: PreparedInvestment["eventChanges"] = [];
  for (const event of orderPositionEvents(allEvents)) {
    const before = quantityState.get(event.instrumentId) ?? new Decimal(0);
    const after = applyPositionEventQuantity(before, event);
    quantityState.set(event.instrumentId, after);
    if (!importedEventIds.has(event.id)) continue;
    const instrument = allInstruments.get(event.instrumentId);
    if (!instrument) continue;
    eventChanges.push({
      externalId: event.externalId,
      instrumentId: event.instrumentId,
      instrumentName: instrument.name,
      instrumentSymbol: instrument.symbol,
      type: event.type,
      tradeDate: event.tradeDate,
      eventSequence: event.eventSequence,
      beforeQuantity: before.toString(),
      afterQuantity: after.toString(),
    });
  }
  const priceChanges: PreparedInvestment["priceChanges"] = prices
    .map((price) => {
      const instrument = allInstruments.get(price.instrumentId!);
      if (!instrument) return null;
      const nextPrice = allPrices
        .filter(
          (candidate) =>
            candidate.instrumentId === price.instrumentId &&
            candidate.effectiveDate > price.effectiveDate!,
        )
        .sort((left, right) =>
          left.effectiveDate.localeCompare(right.effectiveDate),
        )[0];
      return {
        externalId: price.externalId ?? null,
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        instrumentSymbol: instrument.symbol,
        price: price.price!,
        currency: price.currency!,
        source: price.source!,
        affectedFrom: price.effectiveDate!,
        affectedTo: nextPrice?.effectiveDate ?? projectionAsOf,
        affectedToExclusive: Boolean(nextPrice),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const sourceDates = [
    ...envelope.position_events.map((row) => row.trade_date),
    ...envelope.cash_transactions.map((row) => row.date),
    ...envelope.prices.map((row) => row.effective_date),
  ].sort();

  return {
    account,
    instruments,
    events,
    cash,
    prices,
    errors,
    skippedDuplicates,
    dateRange: sourceDates.length
      ? { from: sourceDates[0], to: sourceDates.at(-1)! }
      : null,
    instrumentChanges,
    eventChanges,
    priceChanges,
    sourceRecords:
      envelope.instruments.length +
      envelope.position_events.length +
      envelope.cash_transactions.length +
      envelope.prices.length,
    projected: {
      cashMinor: projectedCashMinor,
      positionsMinor: projectedPositionsMinor,
      totalMinor: projectedCashMinor + projectedPositionsMinor,
      complete: missingPrices.length === 0 && missingCurrencies.size === 0,
      missingPrices,
      missingCurrencies: [...missingCurrencies],
      staleInstrumentIds,
      issues,
    },
  };
}

export function previewInvestmentHistory(
  userId: string,
  accountId: string,
  content: string,
  format: "csv" | "json",
) {
  const prepared = prepareInvestmentHistory(
    userId,
    accountId,
    parseInvestmentHistoryFile(content, format),
  );
  const current = calculatePositionAccountSnapshot(
    userId,
    getDatabase(),
    accountId,
  );
  return {
    account: {
      id: prepared.account.id,
      name: prepared.account.name,
      currency: prepared.account.currency,
    },
    current: {
      cashMinor: checkedNumber(current.cashMinor),
      positionsMinor: checkedNumber(current.positionsMinor),
      totalMinor: checkedNumber(current.totalMinor),
      complete: current.complete,
      issues: current.issues,
    },
    projected: {
      ...prepared.projected,
      cashMinor: checkedNumber(prepared.projected.cashMinor),
      positionsMinor: checkedNumber(prepared.projected.positionsMinor),
      totalMinor: checkedNumber(prepared.projected.totalMinor),
    },
    netChangeMinor: checkedNumber(
      prepared.projected.totalMinor - current.totalMinor,
    ),
    dateRange: prepared.dateRange,
    instrumentChanges: prepared.instrumentChanges,
    eventChanges: prepared.eventChanges,
    priceChanges: prepared.priceChanges,
    summary: {
      records: prepared.sourceRecords,
      ready:
        prepared.instruments.length +
        prepared.events.length +
        prepared.cash.length +
        prepared.prices.length,
      skippedDuplicates: prepared.skippedDuplicates,
      failed: prepared.errors.length,
    },
    canCommit: prepared.errors.length === 0,
    errors: prepared.errors,
  };
}

export function commitInvestmentHistory(
  userId: string,
  accountId: string,
  content: string,
  format: "csv" | "json",
) {
  const prepared = prepareInvestmentHistory(
    userId,
    accountId,
    parseInvestmentHistoryFile(content, format),
  );
  if (prepared.errors.length) {
    throw new InvestmentHistoryFileError(
      "Resolve every investment-history error before importing.",
    );
  }
  const db = getDatabase();
  return db.transaction((tx) => {
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
    if (!account)
      throw new InvestmentHistoryAccessError("Position account not found.");
    if (prepared.instruments.length) {
      tx.insert(investmentInstruments).values(prepared.instruments).run();
    }
    if (prepared.events.length) {
      tx.insert(positionEvents).values(prepared.events).run();
    }
    if (prepared.cash.length) {
      tx.insert(transactions).values(prepared.cash).run();
    }
    if (prepared.prices.length) {
      tx.insert(securityPrices).values(prepared.prices).run();
    }
    replayPositionQuantities(
      tx
        .select()
        .from(positionEvents)
        .where(
          and(
            eq(positionEvents.userId, userId),
            eq(positionEvents.accountId, accountId),
          ),
        )
        .all(),
    );
    const finalBalanceMinor = recalculateAccountBalance(userId, tx, accountId);
    return {
      account: {
        id: account.id,
        name: account.name,
        currency: account.currency,
      },
      finalBalanceMinor,
      summary: {
        imported:
          prepared.instruments.length +
          prepared.events.length +
          prepared.cash.length +
          prepared.prices.length,
        skippedDuplicates: prepared.skippedDuplicates,
      },
    };
  });
}
