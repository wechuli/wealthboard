import "server-only";

import { and, asc, desc, eq, getTableColumns, isNull } from "drizzle-orm";

import {
  accounts,
  categories,
  idempotencyKeys,
  transactions,
  userSettings,
  valuationSnapshots,
  type TransactionType,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { replayBalance, type FinancialEvent } from "@/lib/finance";
import { parseMoney } from "@/lib/money";

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type Client = DatabaseClient | TransactionClient;

function checkedNumber(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("The calculated balance is outside the supported range.");
  }
  return number;
}

function assertNotFutureDate(userId: string, value: string, client: Client) {
  const timezone =
    client.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) }).sync()
      ?.timezone ??
    process.env.TZ ??
    "Africa/Nairobi";
  if (value > dateInputForTimezone(timezone)) {
    throw new Error("Financial activity cannot be dated in the future.");
  }
}

function accountEvents(client: Client, userId: string, accountId: string) {
  const transactionRows = client
    .select({
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      date: transactions.transactionDate,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId)))
    .all();
  const valuationRows = client
    .select({
      valueMinor: valuationSnapshots.valueMinor,
      date: valuationSnapshots.valuationDate,
      createdAt: valuationSnapshots.createdAt,
    })
    .from(valuationSnapshots)
    .where(
      and(eq(valuationSnapshots.userId, userId), eq(valuationSnapshots.accountId, accountId)),
    )
    .all();
  return [
    ...transactionRows.map(
      (row): FinancialEvent => ({
        kind: "transaction",
        type: row.type,
        amountMinor: row.amountMinor,
        date: row.date,
        createdAt: row.createdAt,
      }),
    ),
    ...valuationRows.map(
      (row): FinancialEvent => ({
        kind: "valuation",
        valueMinor: row.valueMinor,
        date: row.date,
        createdAt: row.createdAt,
      }),
    ),
  ];
}

export function recalculateAccountBalance(userId: string, client: Client, accountId: string) {
  const value = checkedNumber(replayBalance(accountEvents(client, userId, accountId)));
  client
    .update(accounts)
    .set({ currentValueMinor: value, updatedAt: nowIso() })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
    .run();
  return value;
}

export async function listAccounts(
  userId: string,
  options: { includeArchived?: boolean } = {},
) {
  return getDatabase()
    .select({
      ...getTableColumns(accounts),
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categorySlug: categories.slug,
      categoryIsLiquid: categories.isLiquid,
      categoryIsInvestible: categories.isInvestible,
    })
    .from(accounts)
    .innerJoin(
      categories,
      and(eq(accounts.categoryId, categories.id), eq(accounts.userId, categories.userId)),
    )
    .where(
      options.includeArchived
        ? eq(accounts.userId, userId)
        : and(eq(accounts.userId, userId), isNull(accounts.archivedAt)),
    )
    .orderBy(desc(accounts.currentValueMinor), asc(accounts.name));
}

export async function getAccount(userId: string, id: string) {
  return getDatabase()
    .select({
      ...getTableColumns(accounts),
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categorySlug: categories.slug,
      categoryIsLiquid: categories.isLiquid,
      categoryIsInvestible: categories.isInvestible,
    })
    .from(accounts)
    .innerJoin(
      categories,
      and(eq(accounts.categoryId, categories.id), eq(accounts.userId, categories.userId)),
    )
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
    .get();
}

export async function getAccountActivity(userId: string, accountId: string) {
  const db = getDatabase();
  const [transactionRows, valuations] = await Promise.all([
    db.query.transactions.findMany({
      where: and(eq(transactions.userId, userId), eq(transactions.accountId, accountId)),
      orderBy: [desc(transactions.transactionDate), desc(transactions.createdAt)],
    }),
    db.query.valuationSnapshots.findMany({
      where: and(
        eq(valuationSnapshots.userId, userId),
        eq(valuationSnapshots.accountId, accountId),
      ),
      orderBy: [desc(valuationSnapshots.valuationDate), desc(valuationSnapshots.createdAt)],
    }),
  ]);
  return { transactions: transactionRows, valuations };
}

export async function listTransactions(userId: string) {
  return getDatabase()
    .select({
      ...getTableColumns(transactions),
      accountName: accounts.name,
      accountIsLiability: accounts.isLiability,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(eq(transactions.accountId, accounts.id), eq(transactions.userId, accounts.userId)),
    )
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt));
}

export async function getTransaction(userId: string, id: string) {
  return getDatabase().query.transactions.findFirst({
    where: and(eq(transactions.userId, userId), eq(transactions.id, id)),
  });
}

type AccountInput = {
  idempotencyKey?: string;
  name: string;
  description?: string;
  categoryId: string;
  institution?: string;
  accountReference?: string;
  currency: string;
  openingValue: string;
  costBasis?: string;
  isIncludedInNetWorth: boolean;
  notes?: string;
  openedAt?: string;
};

export function createAccount(userId: string, input: AccountInput) {
  const db = getDatabase();
  if (input.openedAt) assertNotFutureDate(userId, input.openedAt, db);
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const openingValueMinor = parseMoney(input.openingValue, input.currency);
  if (openingValueMinor < 0) throw new Error("Opening value cannot be negative.");
  const costBasisMinor = input.costBasis ? parseMoney(input.costBasis, input.currency) : undefined;
  const transactionDate = input.openedAt ? dateInputToUtc(input.openedAt) : timestamp;

  return db.transaction((tx) => {
    if (input.idempotencyKey) {
      const duplicate = tx.query.idempotencyKeys
        .findFirst({
          where: and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, input.idempotencyKey)),
        })
        .sync();
      if (duplicate?.operation === "create-account" && duplicate.resultId) return duplicate.resultId;
      if (duplicate) throw new Error("This request key was already used.");
    }
    const category = tx.query.categories
      .findFirst({
        where: and(
          eq(categories.userId, userId),
          eq(categories.id, input.categoryId),
          eq(categories.isArchived, false),
        ),
      })
      .sync();
    if (!category) throw new Error("The selected category is unavailable.");

    tx.insert(accounts)
      .values({
        id,
        userId,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        institution: input.institution || null,
        accountReference: input.accountReference || null,
        currency: input.currency,
        currentValueMinor: openingValueMinor,
        costBasisMinor,
        isLiability: category.assetOrLiability === "liability",
        isIncludedInNetWorth: input.isIncludedInNetWorth,
        notes: input.notes,
        openedAt: input.openedAt ? transactionDate : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    tx.insert(transactions)
      .values({
        id: crypto.randomUUID(),
        userId,
        accountId: id,
        type: "opening_balance",
        amountMinor: openingValueMinor,
        currency: input.currency,
        transactionDate,
        description: "Opening balance",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    if (input.idempotencyKey) {
      tx.insert(idempotencyKeys)
        .values({
          userId,
          key: input.idempotencyKey,
          operation: "create-account",
          resultId: id,
          createdAt: timestamp,
        })
        .run();
    }
    return id;
  });
}

export function updateAccount(
  userId: string,
  id: string,
  input: Omit<AccountInput, "openingValue" | "openedAt">,
) {
  const db = getDatabase();
  db.transaction((tx) => {
    const existing = tx.query.accounts
      .findFirst({ where: and(eq(accounts.userId, userId), eq(accounts.id, id)) })
      .sync();
    if (!existing) throw new Error("Account not found.");
    const category = tx.query.categories
      .findFirst({
        where: and(
          eq(categories.userId, userId),
          eq(categories.id, input.categoryId),
          eq(categories.isArchived, false),
        ),
      })
      .sync();
    if (!category) throw new Error("The selected category is unavailable.");
    if (existing.currency !== input.currency) {
      throw new Error("Account currency cannot be changed after creation.");
    }
    if (category.assetOrLiability === "liability" && existing.goalId) {
      throw new Error("Unlink this account from its goal before making it a liability.");
    }
    tx.update(accounts)
      .set({
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        institution: input.institution || null,
        accountReference: input.accountReference || null,
        costBasisMinor: input.costBasis ? parseMoney(input.costBasis, input.currency) : null,
        isLiability: category.assetOrLiability === "liability",
        isIncludedInNetWorth: input.isIncludedInNetWorth,
        notes: input.notes,
        updatedAt: nowIso(),
      })
      .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
      .run();
  });
}

export function setAccountArchived(userId: string, id: string, archived: boolean) {
  const result = getDatabase()
    .update(accounts)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
    .run();
  if (result.changes === 0) throw new Error("Account not found.");
}

type TransactionInput = {
  accountId: string;
  type: TransactionType;
  amount: string;
  transactionDate: string;
  description?: string;
  notes?: string;
  idempotencyKey: string;
};

export function recordTransaction(userId: string, input: TransactionInput) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.transactionDate, db);
  if (input.type === "opening_balance" || input.type === "transfer") {
    throw new Error("Use the dedicated workflow for this transaction type.");
  }
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  return db.transaction((tx) => {
    const existing = tx.query.transactions
      .findFirst({
        where: and(
          eq(transactions.userId, userId),
          eq(transactions.idempotencyKey, input.idempotencyKey),
        ),
      })
      .sync();
    if (existing) return existing.id;
    const account = tx.query.accounts
      .findFirst({ where: and(eq(accounts.userId, userId), eq(accounts.id, input.accountId)) })
      .sync();
    if (!account) throw new Error("Account not found.");
    const amountMinor = parseMoney(input.amount, account.currency);
    if (input.type !== "manual_adjustment" && amountMinor <= 0) {
      throw new Error("Amount must be greater than zero.");
    }
    if (input.type === "manual_adjustment" && amountMinor === 0) {
      throw new Error("Adjustment cannot be zero.");
    }
    tx.insert(transactions)
      .values({
        id,
        userId,
        accountId: account.id,
        type: input.type,
        amountMinor,
        currency: account.currency,
        transactionDate: dateInputToUtc(input.transactionDate),
        description: input.description || null,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    recalculateAccountBalance(userId, tx, account.id);
    return id;
  });
}

export function updateTransaction(
  userId: string,
  id: string,
  input: Pick<TransactionInput, "type" | "amount" | "transactionDate" | "description" | "notes">,
) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.transactionDate, db);
  db.transaction((tx) => {
    const existing = tx.query.transactions
      .findFirst({ where: and(eq(transactions.userId, userId), eq(transactions.id, id)) })
      .sync();
    if (!existing) throw new Error("Transaction not found.");
    if (existing.type === "opening_balance" || existing.type === "transfer") {
      throw new Error("Opening balances and transfers cannot be edited individually.");
    }
    const account = tx.query.accounts
      .findFirst({
        where: and(eq(accounts.userId, userId), eq(accounts.id, existing.accountId)),
      })
      .sync();
    if (!account) throw new Error("Account not found.");
    const amountMinor = parseMoney(input.amount, account.currency);
    if (input.type !== "manual_adjustment" && amountMinor <= 0) {
      throw new Error("Amount must be greater than zero.");
    }
    tx.update(transactions)
      .set({
        type: input.type,
        amountMinor,
        transactionDate: dateInputToUtc(input.transactionDate),
        description: input.description || null,
        notes: input.notes,
        updatedAt: nowIso(),
      })
      .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
      .run();
    recalculateAccountBalance(userId, tx, existing.accountId);
  });
}

export function deleteTransaction(userId: string, id: string) {
  const db = getDatabase();
  db.transaction((tx) => {
    const existing = tx.query.transactions
      .findFirst({ where: and(eq(transactions.userId, userId), eq(transactions.id, id)) })
      .sync();
    if (!existing) throw new Error("Transaction not found.");
    if (existing.type === "opening_balance") throw new Error("The opening balance cannot be deleted.");
    if (existing.transferGroupId) {
      const transferRows = tx
        .select({ accountId: transactions.accountId })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.transferGroupId, existing.transferGroupId),
          ),
        )
        .all();
      tx.delete(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.transferGroupId, existing.transferGroupId),
          ),
        )
        .run();
      for (const row of transferRows) recalculateAccountBalance(userId, tx, row.accountId);
    } else {
      tx.delete(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
        .run();
      recalculateAccountBalance(userId, tx, existing.accountId);
    }
  });
}

type ValuationInput = {
  idempotencyKey: string;
  accountId: string;
  value: string;
  valuationDate: string;
  notes?: string;
};

export function recordValuation(userId: string, input: ValuationInput) {
  const db = getDatabase();
  assertNotFutureDate(userId, input.valuationDate, db);
  const id = crypto.randomUUID();
  return db.transaction((tx) => {
    const duplicate = tx.query.idempotencyKeys
      .findFirst({
        where: and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, input.idempotencyKey)),
      })
      .sync();
    if (duplicate?.operation === "valuation" && duplicate.resultId) return duplicate.resultId;
    if (duplicate) throw new Error("This request key was already used.");
    const account = tx.query.accounts
      .findFirst({ where: and(eq(accounts.userId, userId), eq(accounts.id, input.accountId)) })
      .sync();
    if (!account) throw new Error("Account not found.");
    const valueMinor = parseMoney(input.value, account.currency);
    if (valueMinor < 0) throw new Error("Valuation cannot be negative.");
    const timestamp = nowIso();
    tx.insert(valuationSnapshots)
      .values({
        id,
        userId,
        accountId: account.id,
        valueMinor,
        currency: account.currency,
        valuationDate: dateInputToUtc(input.valuationDate),
        notes: input.notes,
        createdAt: timestamp,
      })
      .run();
    tx.insert(idempotencyKeys)
      .values({
        userId,
        key: input.idempotencyKey,
        operation: "valuation",
        resultId: id,
        createdAt: timestamp,
      })
      .run();
    recalculateAccountBalance(userId, tx, account.id);
    return id;
  });
}

export function deleteValuation(userId: string, id: string) {
  const db = getDatabase();
  db.transaction((tx) => {
    const existing = tx.query.valuationSnapshots
      .findFirst({
        where: and(eq(valuationSnapshots.userId, userId), eq(valuationSnapshots.id, id)),
      })
      .sync();
    if (!existing) throw new Error("Valuation not found.");
    tx.delete(valuationSnapshots)
      .where(and(eq(valuationSnapshots.userId, userId), eq(valuationSnapshots.id, id)))
      .run();
    recalculateAccountBalance(userId, tx, existing.accountId);
  });
}

export function accountBalanceAt(userId: string, accountId: string, throughDate: string) {
  return replayBalance(accountEvents(getDatabase(), userId, accountId), throughDate);
}
