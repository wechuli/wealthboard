import "server-only";

import { and, eq, isNull, lte } from "drizzle-orm";

import {
  accountConversions,
  accounts,
  categories,
  estateAccountDirectives,
  exchangeRates,
  goals,
  investmentInstruments,
  positionEvents,
  securityPrices,
  transactions,
  userSettings,
  valuationSnapshots,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { replayBalance, type FinancialEvent } from "@/lib/finance";
import { calculateQuoteValueMinor, canonicalDecimal } from "@/lib/investments";
import { convertMinor, parseMoney } from "@/lib/money";
import { recalculateAccountBalance } from "@/lib/services/accounts";

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
type Client = DatabaseClient | TransactionClient;

export type AccountConversionHoldingInput = {
  instrumentId: string;
  quantity: string;
  price: string;
  openingCostBasis?: string;
  priceSource?: string;
  priceProvenance?: string;
};

export type AccountConversionInput = {
  sourceAccountId: string;
  targetName: string;
  conversionDate: string;
  openingCash: string;
  holdings: AccountConversionHoldingInput[];
  idempotencyKey: string;
  confirmDifference?: boolean;
};

function checkedNumber(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("The calculated value is outside the supported range.");
  }
  return number;
}

function assertConversionDate(userId: string, value: string, client: Client) {
  const settings = client.query.userSettings
    .findFirst({ where: eq(userSettings.userId, userId) })
    .sync();
  if (!settings) throw new Error("User settings are unavailable.");
  if (value > dateInputForTimezone(settings.timezone)) {
    throw new Error("The conversion date cannot be in the future.");
  }
}

function balanceAt(
  client: Client,
  userId: string,
  accountId: string,
  throughDate: string,
) {
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
  const valuationRows = client
    .select({
      valueMinor: valuationSnapshots.valueMinor,
      date: valuationSnapshots.valuationDate,
      createdAt: valuationSnapshots.createdAt,
    })
    .from(valuationSnapshots)
    .where(
      and(
        eq(valuationSnapshots.userId, userId),
        eq(valuationSnapshots.accountId, accountId),
        lte(valuationSnapshots.valuationDate, throughDate),
      ),
    )
    .all();
  const events: FinancialEvent[] = [
    ...transactionRows.map((row) => ({ kind: "transaction" as const, ...row })),
    ...valuationRows.map((row) => ({ kind: "valuation" as const, ...row })),
  ];
  return replayBalance(events, throughDate);
}

function prepareConversion(
  userId: string,
  input: AccountConversionInput,
  client: Client,
) {
  assertConversionDate(userId, input.conversionDate, client);
  const source = client.query.accounts
    .findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.id, input.sourceAccountId),
        eq(accounts.trackingMode, "balance"),
        eq(accounts.isLiability, false),
        isNull(accounts.archivedAt),
      ),
    })
    .sync();
  if (!source) throw new Error("Active balance account not found.");
  const category = client.query.categories
    .findFirst({
      where: and(
        eq(categories.userId, userId),
        eq(categories.id, source.categoryId),
        eq(categories.isArchived, false),
        eq(categories.isInvestible, true),
      ),
    })
    .sync();
  if (!category) {
    throw new Error("Only active investment accounts can be converted.");
  }
  if (!input.holdings.length) {
    throw new Error("Add at least one opening holding.");
  }
  const targetName = input.targetName.trim();
  if (!targetName || targetName.length > 100) {
    throw new Error("Enter a replacement account name.");
  }
  const conversionDate = dateInputToUtc(input.conversionDate);
  const latestTransaction = client.query.transactions
    .findFirst({
      where: and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, source.id),
      ),
      orderBy: (table, { desc }) => [desc(table.transactionDate)],
      columns: { transactionDate: true },
    })
    .sync();
  const latestValuation = client.query.valuationSnapshots
    .findFirst({
      where: and(
        eq(valuationSnapshots.userId, userId),
        eq(valuationSnapshots.accountId, source.id),
      ),
      orderBy: (table, { desc }) => [desc(table.valuationDate)],
      columns: { valuationDate: true },
    })
    .sync();
  const latestActivityDate = [
    latestTransaction?.transactionDate,
    latestValuation?.valuationDate,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  if (latestActivityDate && conversionDate < latestActivityDate) {
    throw new Error(
      `Choose a conversion date on or after ${latestActivityDate.slice(0, 10)}, the latest source activity.`,
    );
  }
  const openingCashMinor = parseMoney(input.openingCash, source.currency);
  if (openingCashMinor < 0) throw new Error("Opening cash cannot be negative.");
  const instrumentIds = new Set<string>();
  const rates = client
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.userId, userId))
    .all();
  let positionsMinor = 0n;
  const holdings = input.holdings.map((holding) => {
    if (instrumentIds.has(holding.instrumentId)) {
      throw new Error("Each opening instrument may appear only once.");
    }
    instrumentIds.add(holding.instrumentId);
    const instrument = client.query.investmentInstruments
      .findFirst({
        where: and(
          eq(investmentInstruments.userId, userId),
          eq(investmentInstruments.id, holding.instrumentId),
          isNull(investmentInstruments.archivedAt),
        ),
      })
      .sync();
    if (!instrument) throw new Error("An opening instrument is unavailable.");
    const quantity = canonicalDecimal(holding.quantity, { label: "quantity" });
    const price = canonicalDecimal(holding.price, { label: "unit price" });
    const quoteValueMinor = calculateQuoteValueMinor(
      quantity,
      price,
      instrument.quoteCurrency,
    );
    const accountValueMinor = convertMinor(
      quoteValueMinor,
      instrument.quoteCurrency,
      source.currency,
      rates,
      conversionDate,
    );
    positionsMinor += accountValueMinor;
    const existingPrice = client.query.securityPrices
      .findFirst({
        where: and(
          eq(securityPrices.userId, userId),
          eq(securityPrices.instrumentId, instrument.id),
          eq(securityPrices.effectiveDate, conversionDate),
        ),
      })
      .sync();
    if (existingPrice && existingPrice.price !== price) {
      throw new Error(
        `${instrument.name} already has a different price on the conversion date.`,
      );
    }
    const openingCostBasisMinor = holding.openingCostBasis
      ? parseMoney(holding.openingCostBasis, source.currency)
      : null;
    if (openingCostBasisMinor != null && openingCostBasisMinor < 0) {
      throw new Error("Opening cost basis cannot be negative.");
    }
    return {
      instrument,
      quantity,
      price,
      existingPrice,
      openingCostBasisMinor,
      priceSource: holding.priceSource?.trim() || "conversion",
      priceProvenance: holding.priceProvenance?.trim() || null,
    };
  });
  const sourceBalanceMinor = balanceAt(
    client,
    userId,
    source.id,
    conversionDate,
  );
  const projectedTotalMinor = BigInt(openingCashMinor) + positionsMinor;
  return {
    source,
    targetName,
    conversionDate,
    openingCashMinor,
    holdings,
    sourceBalanceMinor,
    positionsMinor,
    projectedTotalMinor,
    differenceMinor: projectedTotalMinor - sourceBalanceMinor,
  };
}

export function previewAccountConversion(
  userId: string,
  input: AccountConversionInput,
) {
  const prepared = prepareConversion(userId, input, getDatabase());
  return {
    sourceAccountId: prepared.source.id,
    sourceAccountName: prepared.source.name,
    currency: prepared.source.currency,
    conversionDate: prepared.conversionDate,
    sourceBalanceMinor: prepared.sourceBalanceMinor,
    openingCashMinor: BigInt(prepared.openingCashMinor),
    positionsMinor: prepared.positionsMinor,
    projectedTotalMinor: prepared.projectedTotalMinor,
    differenceMinor: prepared.differenceMinor,
    holdings: prepared.holdings.map((holding) => ({
      instrumentId: holding.instrument.id,
      name: holding.instrument.name,
      symbol: holding.instrument.symbol,
      quantity: holding.quantity,
      price: holding.price,
      quoteCurrency: holding.instrument.quoteCurrency,
    })),
  };
}

export function convertAccountToPositions(
  userId: string,
  input: AccountConversionInput,
) {
  const db = getDatabase();
  return db.transaction((tx) => {
    const duplicate = tx.query.accountConversions
      .findFirst({
        where: and(
          eq(accountConversions.userId, userId),
          eq(accountConversions.idempotencyKey, input.idempotencyKey),
        ),
      })
      .sync();
    if (duplicate) return duplicate.targetAccountId;
    const existingSourceConversion = tx.query.accountConversions
      .findFirst({
        where: and(
          eq(accountConversions.userId, userId),
          eq(accountConversions.sourceAccountId, input.sourceAccountId),
        ),
      })
      .sync();
    if (existingSourceConversion) {
      throw new Error("This account has already been converted.");
    }
    const prepared = prepareConversion(userId, input, tx);
    if (prepared.differenceMinor !== 0n && !input.confirmDifference) {
      throw new Error(
        "Confirm the difference between the source balance and opening position value.",
      );
    }
    const targetAccountId = crypto.randomUUID();
    const timestamp = nowIso();
    tx.insert(accounts)
      .values({
        id: targetAccountId,
        userId,
        name: prepared.targetName,
        description: prepared.source.description,
        categoryId: prepared.source.categoryId,
        institutionId: prepared.source.institutionId,
        accountReference: prepared.source.accountReference,
        currency: prepared.source.currency,
        trackingMode: "positions",
        currentValueMinor: prepared.openingCashMinor,
        costBasisMinor: null,
        isLiability: false,
        isIncludedInNetWorth: prepared.source.isIncludedInNetWorth,
        goalId: prepared.source.goalId,
        notes: prepared.source.notes,
        openedAt: prepared.conversionDate,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    tx.insert(transactions)
      .values({
        id: crypto.randomUUID(),
        userId,
        accountId: targetAccountId,
        type: "opening_balance",
        amountMinor: prepared.openingCashMinor,
        currency: prepared.source.currency,
        transactionDate: prepared.conversionDate,
        description: "Opening cash from account conversion",
        notes: null,
        externalId: null,
        transferGroupId: null,
        eventGroupId: null,
        idempotencyKey: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    prepared.holdings.forEach((holding, index) => {
      tx.insert(positionEvents)
        .values({
          id: crypto.randomUUID(),
          userId,
          accountId: targetAccountId,
          instrumentId: holding.instrument.id,
          relatedInstrumentId: null,
          type: "opening_position",
          quantity: holding.quantity,
          unitPrice: null,
          tradeCurrency: holding.instrument.quoteCurrency,
          grossAmountMinor: null,
          feeAmountMinor: null,
          feeCurrency: null,
          cashEffectMinor: 0,
          appliedExchangeRate: null,
          openingCostBasisMinor: holding.openingCostBasisMinor,
          actionRatioNumerator: null,
          actionRatioDenominator: null,
          tradeDate: prepared.conversionDate,
          eventSequence: index + 1,
          settlementDate: null,
          externalId: null,
          eventGroupId: null,
          idempotencyKey: null,
          description: "Opening position from account conversion",
          notes: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      if (!holding.existingPrice) {
        tx.insert(securityPrices)
          .values({
            id: crypto.randomUUID(),
            userId,
            instrumentId: holding.instrument.id,
            externalId: null,
            price: holding.price,
            currency: holding.instrument.quoteCurrency,
            effectiveDate: prepared.conversionDate,
            source: holding.priceSource,
            provenance: holding.priceProvenance,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
      }
    });
    recalculateAccountBalance(userId, tx, targetAccountId);
    tx.update(accounts)
      .set({
        goalId: null,
        archivedAt: prepared.conversionDate,
        updatedAt: timestamp,
      })
      .where(
        and(eq(accounts.userId, userId), eq(accounts.id, prepared.source.id)),
      )
      .run();
    if (prepared.source.goalId) {
      tx.update(goals)
        .set({ linkedAccountId: targetAccountId, updatedAt: timestamp })
        .where(
          and(eq(goals.userId, userId), eq(goals.id, prepared.source.goalId)),
        )
        .run();
    }
    tx.update(estateAccountDirectives)
      .set({ accountId: targetAccountId, updatedAt: timestamp })
      .where(
        and(
          eq(estateAccountDirectives.userId, userId),
          eq(estateAccountDirectives.accountId, prepared.source.id),
        ),
      )
      .run();
    tx.insert(accountConversions)
      .values({
        id: crypto.randomUUID(),
        userId,
        sourceAccountId: prepared.source.id,
        targetAccountId,
        conversionDate: prepared.conversionDate,
        sourceBalanceMinor: checkedNumber(prepared.sourceBalanceMinor),
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
      })
      .run();
    return targetAccountId;
  });
}

export function getAccountConversion(userId: string, sourceAccountId: string) {
  return getDatabase()
    .query.accountConversions.findFirst({
      where: and(
        eq(accountConversions.userId, userId),
        eq(accountConversions.sourceAccountId, sourceAccountId),
      ),
    })
    .sync();
}
