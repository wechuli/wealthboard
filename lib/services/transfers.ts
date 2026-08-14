import "server-only";

import { and, eq } from "drizzle-orm";

import {
  accounts,
  exchangeRates,
  idempotencyKeys,
  transactions,
  userSettings,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { convertMinor, parseMoney } from "@/lib/money";
import { recalculateAccountBalance } from "@/lib/services/accounts";

export function recordTransfer(
  userId: string,
  input: {
    fromAccountId: string;
    toAccountId: string;
    amount: string;
    destinationAmount?: string;
    transactionDate: string;
    description?: string;
    idempotencyKey: string;
  },
) {
  if (input.fromAccountId === input.toAccountId)
    throw new Error("Choose two different accounts.");
  const db = getDatabase();
  const timezone =
    db.query.userSettings
      .findFirst({ where: eq(userSettings.userId, userId) })
      .sync()?.timezone ??
    process.env.TZ ??
    "Africa/Nairobi";
  if (input.transactionDate > dateInputForTimezone(timezone)) {
    throw new Error("Financial activity cannot be dated in the future.");
  }

  return db.transaction((tx) => {
    const existingKey = tx.query.idempotencyKeys
      .findFirst({
        where: and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.key, input.idempotencyKey),
        ),
      })
      .sync();
    if (existingKey) return existingKey.resultId;
    const source = tx.query.accounts
      .findFirst({
        where: and(
          eq(accounts.userId, userId),
          eq(accounts.id, input.fromAccountId),
        ),
      })
      .sync();
    const destination = tx.query.accounts
      .findFirst({
        where: and(
          eq(accounts.userId, userId),
          eq(accounts.id, input.toAccountId),
        ),
      })
      .sync();
    if (!source || !destination)
      throw new Error("One of the selected accounts is unavailable.");
    if (source.archivedAt || destination.archivedAt) {
      throw new Error("Archived accounts cannot be changed.");
    }
    if (source.isLiability || destination.isLiability) {
      throw new Error(
        "Transfers are available only between asset accounts. Use Liability Payment or Liability Increase for debts.",
      );
    }
    const sourceAmount = parseMoney(input.amount, source.currency);
    if (sourceAmount <= 0)
      throw new Error("Transfer amount must be greater than zero.");
    const transactionDate = dateInputToUtc(input.transactionDate);
    let destinationAmount: number;
    if (source.currency === destination.currency) {
      destinationAmount = sourceAmount;
    } else if (input.destinationAmount) {
      destinationAmount = parseMoney(
        input.destinationAmount,
        destination.currency,
      );
    } else {
      const rates = tx
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.userId, userId))
        .all();
      const converted = convertMinor(
        sourceAmount,
        source.currency,
        destination.currency,
        rates,
        transactionDate,
      );
      destinationAmount = Number(converted);
      if (!Number.isSafeInteger(destinationAmount)) {
        throw new Error(
          "The converted transfer amount is outside the supported range.",
        );
      }
    }
    if (destinationAmount <= 0)
      throw new Error("Destination amount must be greater than zero.");

    const groupId = crypto.randomUUID();
    const timestamp = nowIso();
    tx.insert(idempotencyKeys)
      .values({
        userId,
        key: input.idempotencyKey,
        operation: "transfer",
        resultId: groupId,
        createdAt: timestamp,
      })
      .run();
    tx.insert(transactions)
      .values([
        {
          id: crypto.randomUUID(),
          userId,
          accountId: source.id,
          type: "transfer",
          amountMinor: -sourceAmount,
          currency: source.currency,
          transactionDate,
          description: input.description || `Transfer to ${destination.name}`,
          transferGroupId: groupId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: crypto.randomUUID(),
          userId,
          accountId: destination.id,
          type: "transfer",
          amountMinor: destinationAmount,
          currency: destination.currency,
          transactionDate,
          description: input.description || `Transfer from ${source.name}`,
          transferGroupId: groupId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ])
      .run();
    recalculateAccountBalance(userId, tx, source.id);
    recalculateAccountBalance(userId, tx, destination.id);
    return groupId;
  });
}
