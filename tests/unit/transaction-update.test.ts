// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));

import {
  transactionAction,
  updateTransactionAction,
} from "@/app/(app)/actions";
import { categories, transactions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { commitAccountHistory } from "@/lib/services/account-history-import";
import {
  createAccount,
  getAccount,
  getTransaction,
  recordTransaction,
  updateTransaction,
} from "@/lib/services/accounts";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-transaction-update-"),
);
const databasePath = path.join(workspace, "transactions.db");

function updateForm(accountId: string, type: string) {
  const formData = new FormData();
  formData.set("accountId", accountId);
  formData.set("type", type);
  formData.set("amount", "999");
  formData.set("transactionDate", "2025-03-01");
  formData.set("description", "Crafted reserved update");
  formData.set("notes", "This must not be persisted.");
  return formData;
}

describe.sequential("transaction update invariants", () => {
  let userId = "";
  let accountId = "";
  let transactionId = "";
  let idempotencyKey = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET =
      "unit-test-session-secret-longer-than-32-characters";
    process.env.TZ = "Africa/Nairobi";

    const sqlite = new Database(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.close();
    process.env.DATABASE_PATH = databasePath;

    ({ userId } = await registerUser({
      username: "transaction-update",
      displayName: "Transaction Update",
      password: "correct-horse-battery-staple",
    }));
    vi.mocked(requireSession).mockResolvedValue({
      userId,
      username: "transaction-update",
      version: 1,
    });

    const category = await getDatabase().query.categories.findFirst({
      where: and(eq(categories.userId, userId), eq(categories.slug, "savings")),
    });
    if (!category) throw new Error("Savings category was not created.");

    accountId = createAccount(userId, {
      name: "Invariant Account",
      categoryId: category.id,
      currency: "KES",
      openingValue: "100",
      isIncludedInNetWorth: true,
      openedAt: "2025-01-01",
    });
    idempotencyKey = crypto.randomUUID();
    transactionId = recordTransaction(userId, {
      accountId,
      type: "deposit",
      amount: "25",
      transactionDate: "2025-02-01",
      description: "Original deposit",
      notes: "Original notes",
      idempotencyKey,
    });
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test.each(["opening_balance", "transfer"] as const)(
    "the update action rejects a crafted %s type without changing financial state",
    async (type) => {
      const transactionBefore = await getTransaction(userId, transactionId);
      const accountBefore = await getAccount(userId, accountId);

      const result = await updateTransactionAction(
        transactionId,
        updateForm(accountId, type),
      );

      expect(result.message).toBe("Check the highlighted fields.");
      expect(result.fieldErrors?.type).toBeDefined();
      expect(await getTransaction(userId, transactionId)).toEqual(
        transactionBefore,
      );
      expect(await getAccount(userId, accountId)).toEqual(accountBefore);
    },
  );

  test.each(["opening_balance", "transfer"] as const)(
    "the service rejects a direct %s update without changing financial state",
    async (type) => {
      const transactionBefore = await getTransaction(userId, transactionId);
      const accountBefore = await getAccount(userId, accountId);

      expect(() =>
        updateTransaction(userId, transactionId, {
          type,
          amount: "999",
          transactionDate: "2025-03-01",
          description: "Direct reserved update",
          notes: "This must not be persisted.",
        }),
      ).toThrow("Use the dedicated workflow for this transaction type.");

      expect(await getTransaction(userId, transactionId)).toEqual(
        transactionBefore,
      );
      expect(await getAccount(userId, accountId)).toEqual(accountBefore);
    },
  );

  test("normal type changes still replay the account balance", async () => {
    updateTransaction(userId, transactionId, {
      type: "withdrawal",
      amount: "25",
      transactionDate: "2025-02-01",
      description: "Corrected withdrawal",
      notes: "Original notes",
    });

    const updatedTransaction = await getTransaction(userId, transactionId);
    const updatedAccount = await getAccount(userId, accountId);
    const accountTransactions = await getDatabase().query.transactions.findMany(
      {
        where: and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, accountId),
        ),
      },
    );

    expect(updatedTransaction).toMatchObject({
      type: "withdrawal",
      amountMinor: 2_500,
      idempotencyKey,
    });
    expect(BigInt(updatedAccount?.currentValueMinor ?? 0)).toBe(7_500n);
    expect(
      accountTransactions.filter(({ type }) => type === "opening_balance"),
    ).toHaveLength(1);
    expect(
      accountTransactions.filter(({ type }) => type === "transfer"),
    ).toHaveLength(0);
  });

  test("a manual external ID prevents a later import duplicate", async () => {
    const category = await getDatabase().query.categories.findFirst({
      where: and(eq(categories.userId, userId), eq(categories.slug, "savings")),
    });
    if (!category) throw new Error("Savings category was not created.");
    const importAccountId = createAccount(userId, {
      name: "Import Deduplication Account",
      categoryId: category.id,
      currency: "KES",
      openingValue: "0",
      isIncludedInNetWorth: true,
      openedAt: "2025-01-01",
    });
    const formData = new FormData();
    formData.set("accountId", importAccountId);
    formData.set("type", "deposit");
    formData.set("amount", "12.34");
    formData.set("transactionDate", "2025-03-02");
    formData.set("description", "Broker dividend");
    formData.set("externalId", "  broker-transaction-42  ");
    formData.set("notes", "Entered manually");
    formData.set("idempotencyKey", crypto.randomUUID());

    await transactionAction(formData);

    const stored = getDatabase()
      .query.transactions.findFirst({
        where: and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, importAccountId),
          eq(transactions.externalId, "broker-transaction-42"),
        ),
      })
      .sync();
    expect(stored).toMatchObject({
      type: "deposit",
      amountMinor: 1_234,
      description: "Broker dividend",
      notes: "Entered manually",
    });

    const result = commitAccountHistory(
      userId,
      importAccountId,
      [
        "external_id,type,amount,date,description,notes",
        "broker-transaction-42,deposit,12.34,2025-03-02,Broker dividend,Entered manually",
      ].join("\n"),
      "csv",
    );

    expect(result.summary).toEqual({
      imported: 0,
      skippedDuplicates: 1,
      failed: 0,
    });
    expect(result.rows[0].status).toBe("duplicate_existing");
    expect(
      getDatabase()
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.accountId, importAccountId),
            eq(transactions.externalId, "broker-transaction-42"),
          ),
        )
        .all(),
    ).toHaveLength(1);
  });
});
