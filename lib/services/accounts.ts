import "server-only";

import { and, asc, desc, eq, getTableColumns, isNull } from "drizzle-orm";

import {
  accounts,
  categories,
  idempotencyKeys,
  transactions,
  valuationSnapshots,
  type TransactionType,
} from "@/db/schema";
import {
  dateInputForTimezone,
  dateInputToUtc,
  nowIso,
} from "@/lib/dates";
import { replayBalance, type FinancialEvent } from "@/lib/finance";
import { getDatabase } from "@/lib/db";
import { parseMoney } from "@/lib/money";

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

function checkedNumber(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("The calculated balance is outside the supported range.");
  }
  return number;
}

function assertNotFutureDate(value: string, client: DatabaseClient) {
  const timezone =
    client.query.userSettings.findFirst().sync()?.timezone ??
    process.env.TZ ??
    "Africa/Nairobi";
  if (value > dateInputForTimezone(timezone)) {
    throw new Error("Financial activity cannot be dated in the future.");
  }
}

function accountEvents(client: DatabaseClient | TransactionClient, accountId: string) {
  const transactionRows = client
    .select({
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      date: transactions.transactionDate,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .all();
  const valuationRows = client
    .select({
      valueMinor: valuationSnapshots.valueMinor,
      date: valuationSnapshots.valuationDate,
      createdAt: valuationSnapshots.createdAt,
    })
    .from(valuationSnapshots)
    .where(eq(valuationSnapshots.accountId, accountId))
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

export function recalculateAccountBalance(
  client: DatabaseClient | TransactionClient,
  accountId: string,
) {
  const value = checkedNumber(replayBalance(accountEvents(client, accountId)));
  client
    .update(accounts)
    .set({ currentValueMinor: value, updatedAt: nowIso() })
    .where(eq(accounts.id, accountId))
    .run();
  return value;
}

export async function listAccounts(options: { includeArchived?: boolean } = {}) {
  const db = getDatabase();
  return db
    .select({
      ...getTableColumns(accounts),
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categorySlug: categories.slug,
      categoryIsLiquid: categories.isLiquid,
      categoryIsInvestible: categories.isInvestible,
    })
    .from(accounts)
    .innerJoin(categories, eq(accounts.categoryId, categories.id))
    .where(options.includeArchived ? undefined : isNull(accounts.archivedAt))
    .orderBy(desc(accounts.currentValueMinor), asc(accounts.name));
}

export async function getAccount(id: string) {
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
    .innerJoin(categories, eq(accounts.categoryId, categories.id))
    .where(eq(accounts.id, id))
    .get();
}

export async function getAccountActivity(accountId: string) {
  const db = getDatabase();
  const transactionRows = await db.query.transactions.findMany({
    where: eq(transactions.accountId, accountId),
    orderBy: [desc(transactions.transactionDate), desc(transactions.createdAt)],
  });
  const valuations = await db.query.valuationSnapshots.findMany({
    where: eq(valuationSnapshots.accountId, accountId),
    orderBy: [desc(valuationSnapshots.valuationDate), desc(valuationSnapshots.createdAt)],
  });
  return { transactions: transactionRows, valuations };
}

export async function listTransactions() {
  return getDatabase()
    .select({
      ...getTableColumns(transactions),
      accountName: accounts.name,
      accountIsLiability: accounts.isLiability,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt));
}

export async function getTransaction(id: string) {
  return getDatabase().query.transactions.findFirst({
    where: eq(transactions.id, id),
  });
}

export function createAccount(input: {
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
}) {
  const db = getDatabase();
  if (input.idempotencyKey) {
    const duplicate = db.query.idempotencyKeys
      .findFirst({ where: eq(idempotencyKeys.key, input.idempotencyKey) })
      .sync();
    if (duplicate?.operation === "create-account" && duplicate.resultId) {
      return duplicate.resultId;
    }
    if (duplicate) throw new Error("This request key was already used.");
  }
  const category = db.query.categories.findFirst({
    where: and(eq(categories.id, input.categoryId), eq(categories.isArchived, false)),
  }).sync();
  if (!category) throw new Error("The selected category is unavailable.");

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const openingValueMinor = parseMoney(input.openingValue, input.currency);
  if (openingValueMinor < 0) throw new Error("Opening value cannot be negative.");
  const costBasisMinor = input.costBasis
    ? parseMoney(input.costBasis, input.currency)
    : undefined;
  const transactionDate = input.openedAt ? dateInputToUtc(input.openedAt) : timestamp;
  if (input.openedAt) assertNotFutureDate(input.openedAt, db);

  db.transaction((tx) => {
    tx.insert(accounts)
      .values({
        id,
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
          key: input.idempotencyKey,
          operation: "create-account",
          resultId: id,
          createdAt: timestamp,
        })
        .run();
    }
  });
  return id;
}

export function updateAccount(
  id: string,
  input: Omit<Parameters<typeof createAccount>[0], "openingValue" | "openedAt">,
) {
  const db = getDatabase();
  const existing = db.query.accounts.findFirst({ where: eq(accounts.id, id) }).sync();
  if (!existing) throw new Error("Account not found.");
  const category = db.query.categories
    .findFirst({ where: eq(categories.id, input.categoryId) })
    .sync();
  if (!category) throw new Error("The selected category is unavailable.");
  if (existing.currency !== input.currency) {
    throw new Error("Account currency cannot be changed after creation.");
  }
  if (category.assetOrLiability === "liability" && existing.goalId) {
    throw new Error("Unlink this account from its goal before making it a liability.");
  }

  db.update(accounts)
    .set({
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      institution: input.institution || null,
      accountReference: input.accountReference || null,
      costBasisMinor: input.costBasis
        ? parseMoney(input.costBasis, input.currency)
        : null,
      isLiability: category.assetOrLiability === "liability",
      isIncludedInNetWorth: input.isIncludedInNetWorth,
      notes: input.notes,
      updatedAt: nowIso(),
    })
    .where(eq(accounts.id, id))
    .run();
}

export function setAccountArchived(id: string, archived: boolean) {
  const result = getDatabase()
    .update(accounts)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(eq(accounts.id, id))
    .run();
  if (result.changes === 0) throw new Error("Account not found.");
}

export function recordTransaction(input: {
  accountId: string;
  type: TransactionType;
  amount: string;
  transactionDate: string;
  description?: string;
  notes?: string;
  idempotencyKey: string;
}) {
  const db = getDatabase();
  assertNotFutureDate(input.transactionDate, db);
  const account = db.query.accounts
    .findFirst({ where: eq(accounts.id, input.accountId) })
    .sync();
  if (!account) throw new Error("Account not found.");
  if (input.type === "opening_balance" || input.type === "transfer") {
    throw new Error("Use the dedicated workflow for this transaction type.");
  }
  const amountMinor = parseMoney(input.amount, account.currency);
  if (input.type !== "manual_adjustment" && amountMinor <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  const existing = db.query.transactions
    .findFirst({ where: eq(transactions.idempotencyKey, input.idempotencyKey) })
    .sync();
  if (existing) return existing.id;

  if (input.type === "manual_adjustment" && amountMinor === 0) {
    throw new Error("Adjustment cannot be zero.");
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.transaction((tx) => {
    tx.insert(transactions)
      .values({
        id,
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
    recalculateAccountBalance(tx, account.id);
  });
  return id;
}

export function updateTransaction(
  id: string,
  input: Pick<
    Parameters<typeof recordTransaction>[0],
    "type" | "amount" | "transactionDate" | "description" | "notes"
  >,
) {
  const db = getDatabase();
  assertNotFutureDate(input.transactionDate, db);
  const existing = db.query.transactions.findFirst({ where: eq(transactions.id, id) }).sync();
  if (!existing) throw new Error("Transaction not found.");
  if (existing.type === "opening_balance" || existing.type === "transfer") {
    throw new Error("Opening balances and transfers cannot be edited individually.");
  }
  const account = db.query.accounts
    .findFirst({ where: eq(accounts.id, existing.accountId) })
    .sync();
  if (!account) throw new Error("Account not found.");
  const amountMinor = parseMoney(input.amount, account.currency);
  if (input.type !== "manual_adjustment" && amountMinor <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  db.transaction((tx) => {
    tx.update(transactions)
      .set({
        type: input.type,
        amountMinor,
        transactionDate: dateInputToUtc(input.transactionDate),
        description: input.description || null,
        notes: input.notes,
        updatedAt: nowIso(),
      })
      .where(eq(transactions.id, id))
      .run();
    recalculateAccountBalance(tx, existing.accountId);
  });
}

export function deleteTransaction(id: string) {
  const db = getDatabase();
  const existing = db.query.transactions.findFirst({ where: eq(transactions.id, id) }).sync();
  if (!existing) throw new Error("Transaction not found.");
  if (existing.type === "opening_balance") {
    throw new Error("The opening balance cannot be deleted.");
  }

  db.transaction((tx) => {
    if (existing.transferGroupId) {
      const transferRows = tx
        .select({ accountId: transactions.accountId })
        .from(transactions)
        .where(eq(transactions.transferGroupId, existing.transferGroupId))
        .all();
      tx.delete(transactions)
        .where(eq(transactions.transferGroupId, existing.transferGroupId))
        .run();
      for (const row of transferRows) recalculateAccountBalance(tx, row.accountId);
    } else {
      tx.delete(transactions).where(eq(transactions.id, id)).run();
      recalculateAccountBalance(tx, existing.accountId);
    }
  });
}

export function recordValuation(input: {
  idempotencyKey: string;
  accountId: string;
  value: string;
  valuationDate: string;
  notes?: string;
}) {
  const db = getDatabase();
  assertNotFutureDate(input.valuationDate, db);
  const duplicate = db.query.idempotencyKeys
    .findFirst({ where: eq(idempotencyKeys.key, input.idempotencyKey) })
    .sync();
  if (duplicate?.operation === "valuation" && duplicate.resultId) {
    return duplicate.resultId;
  }
  if (duplicate) throw new Error("This request key was already used.");
  const account = db.query.accounts
    .findFirst({ where: eq(accounts.id, input.accountId) })
    .sync();
  if (!account) throw new Error("Account not found.");
  const valueMinor = parseMoney(input.value, account.currency);
  if (valueMinor < 0) throw new Error("Valuation cannot be negative.");
  const id = crypto.randomUUID();

  db.transaction((tx) => {
    tx.insert(valuationSnapshots)
      .values({
        id,
        accountId: account.id,
        valueMinor,
        currency: account.currency,
        valuationDate: dateInputToUtc(input.valuationDate),
        notes: input.notes,
        createdAt: nowIso(),
      })
      .run();
    tx.insert(idempotencyKeys)
      .values({
        key: input.idempotencyKey,
        operation: "valuation",
        resultId: id,
        createdAt: nowIso(),
      })
      .run();
    recalculateAccountBalance(tx, account.id);
  });
  return id;
}

export function deleteValuation(id: string) {
  const db = getDatabase();
  const existing = db.query.valuationSnapshots
    .findFirst({ where: eq(valuationSnapshots.id, id) })
    .sync();
  if (!existing) throw new Error("Valuation not found.");
  db.transaction((tx) => {
    tx.delete(valuationSnapshots).where(eq(valuationSnapshots.id, id)).run();
    recalculateAccountBalance(tx, existing.accountId);
  });
}

export function accountBalanceAt(accountId: string, throughDate: string) {
  return replayBalance(accountEvents(getDatabase(), accountId), throughDate);
}
