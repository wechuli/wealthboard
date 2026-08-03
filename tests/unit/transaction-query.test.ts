// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { accounts, categories, transactions, users } from "@/db/schema";
import { closeDatabase, getDatabase, getSqlite } from "@/lib/db";
import { listTransactionPage } from "@/lib/services/accounts";
import { transactionCsv } from "@/lib/services/portability";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-transactions-"),
);
const databasePath = path.join(workspace, "transactions.db");
const aliceId = "00000000-0000-4000-8000-000000000001";
const bobId = "00000000-0000-4000-8000-000000000002";
const aliceAccountId = "10000000-0000-4000-8000-000000000001";
const secondAliceAccountId = "10000000-0000-4000-8000-000000000002";
const bobAccountId = "10000000-0000-4000-8000-000000000003";
const categoryId = "20000000-0000-4000-8000-000000000001";
const bobCategoryId = "20000000-0000-4000-8000-000000000002";
const timestamp = "2025-06-15T12:00:00.000Z";

function transactionRow({
  id,
  userId = aliceId,
  accountId = aliceAccountId,
  type = "dividend" as const,
  amountMinor = 100,
  transactionDate = timestamp,
  description = "Quarterly bonus",
}: {
  id: string;
  userId?: string;
  accountId?: string;
  type?: typeof transactions.$inferInsert.type;
  amountMinor?: number;
  transactionDate?: string;
  description?: string;
}) {
  return {
    id,
    userId,
    accountId,
    type,
    amountMinor,
    currency: "KES",
    transactionDate,
    description,
    notes: null,
    transferGroupId: null,
    idempotencyKey: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe.sequential("transaction workbench query", () => {
  beforeAll(() => {
    const sqlite = new Database(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.close();
    process.env.DATABASE_PATH = databasePath;

    const db = getDatabase();
    db.insert(users)
      .values([
        {
          id: aliceId,
          username: "alice-query",
          passwordHash: "not-used",
          status: "active",
          sessionVersion: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: bobId,
          username: "bob-query",
          passwordHash: "not-used",
          status: "active",
          sessionVersion: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ])
      .run();
    db.insert(categories)
      .values([
        {
          id: categoryId,
          userId: aliceId,
          name: "Income",
          slug: "income",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: bobCategoryId,
          userId: bobId,
          name: "Income",
          slug: "income",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ])
      .run();
    db.insert(accounts)
      .values([
        {
          id: aliceAccountId,
          userId: aliceId,
          name: "Alice Income",
          categoryId,
          currency: "KES",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: secondAliceAccountId,
          userId: aliceId,
          name: "Alice Other",
          categoryId,
          currency: "KES",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: bobAccountId,
          userId: bobId,
          name: "Bob Income",
          categoryId: bobCategoryId,
          currency: "KES",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ])
      .run();
    db.insert(transactions)
      .values([
        transactionRow({ id: "30000000-0000-4000-8000-000000000001" }),
        transactionRow({ id: "30000000-0000-4000-8000-000000000002" }),
        transactionRow({ id: "30000000-0000-4000-8000-000000000003" }),
        transactionRow({
          id: "30000000-0000-4000-8000-000000000004",
          type: "fee",
          description: "Quarterly bonus fee",
        }),
        transactionRow({
          id: "30000000-0000-4000-8000-000000000005",
          accountId: secondAliceAccountId,
        }),
        transactionRow({
          id: "30000000-0000-4000-8000-000000000006",
          userId: bobId,
          accountId: bobAccountId,
        }),
      ])
      .run();

    const nativeSqlite = getSqlite();
    const insertLoadRow = nativeSqlite.prepare(`
      INSERT INTO transactions (
        id, user_id, account_id, type, amount_minor, currency,
        transaction_date, description, created_at, updated_at
      ) VALUES (?, ?, ?, 'deposit', 100, 'KES', ?, 'Load fixture', ?, ?)
    `);
    nativeSqlite.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        insertLoadRow.run(
          `40000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          aliceId,
          secondAliceAccountId,
          "2025-05-01T12:00:00.000Z",
          timestamp,
          timestamp,
        );
      }
    })();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("combines filters with owner scoping and stable cursor pagination", async () => {
    const filters = {
      q: "bonus",
      accountId: aliceAccountId,
      type: "dividend" as const,
      from: "2025-06-15",
      to: "2025-06-15",
      flow: "inflow" as const,
      sort: "newest" as const,
    };
    const firstPage = await listTransactionPage(aliceId, {
      ...filters,
      pageSize: 2,
    });

    expect(firstPage.rows.map((row) => row.id)).toEqual([
      "30000000-0000-4000-8000-000000000003",
      "30000000-0000-4000-8000-000000000002",
    ]);
    expect(firstPage.previousCursor).toBeUndefined();
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await listTransactionPage(aliceId, {
      ...filters,
      cursor: firstPage.nextCursor,
      page: "next",
      pageSize: 2,
    });
    expect(secondPage.rows.map((row) => row.id)).toEqual([
      "30000000-0000-4000-8000-000000000001",
    ]);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(secondPage.previousCursor).toBeDefined();

    const previousPage = await listTransactionPage(aliceId, {
      ...filters,
      cursor: secondPage.previousCursor,
      page: "previous",
      pageSize: 2,
    });
    expect(previousPage.rows.map((row) => row.id)).toEqual(
      firstPage.rows.map((row) => row.id),
    );

    const oldestPage = await listTransactionPage(aliceId, {
      ...filters,
      sort: "oldest",
      pageSize: 2,
    });
    expect(oldestPage.rows.map((row) => row.id)).toEqual([
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ]);
    const nextOldestPage = await listTransactionPage(aliceId, {
      ...filters,
      sort: "oldest",
      cursor: oldestPage.nextCursor,
      page: "next",
      pageSize: 2,
    });
    expect(nextOldestPage.rows.map((row) => row.id)).toEqual([
      "30000000-0000-4000-8000-000000000003",
    ]);
  });

  test("does not return another user's matching rows", async () => {
    const aliceView = await listTransactionPage(aliceId, {
      q: "Bob Income",
      sort: "newest",
    });
    expect(aliceView.rows).toEqual([]);

    const bobView = await listTransactionPage(bobId, {
      q: "Bob Income",
      sort: "newest",
    });
    expect(bobView.rows.map((row) => row.id)).toEqual([
      "30000000-0000-4000-8000-000000000006",
    ]);
  });

  test("uses transaction effects for amount direction", async () => {
    const outflows = await listTransactionPage(aliceId, {
      flow: "outflow",
      sort: "newest",
    });
    expect(outflows.rows.map((row) => row.type)).toEqual(["fee"]);
  });

  test("keeps 10,000-row histories bounded and uses the account cursor index", async () => {
    const firstPage = await listTransactionPage(aliceId, {
      q: "load fixture",
      accountId: secondAliceAccountId,
      type: "deposit",
      from: "2025-05-01",
      to: "2025-05-01",
      flow: "inflow",
      sort: "newest",
    });

    expect(firstPage.rows).toHaveLength(100);
    expect(firstPage.rows[0]?.id).toBe("40000000-0000-4000-8000-000000009999");
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await listTransactionPage(aliceId, {
      q: "load fixture",
      accountId: secondAliceAccountId,
      type: "deposit",
      from: "2025-05-01",
      to: "2025-05-01",
      flow: "inflow",
      sort: "newest",
      cursor: firstPage.nextCursor,
      page: "next",
    });
    expect(secondPage.rows).toHaveLength(100);
    expect(secondPage.rows[0]?.id).toBe("40000000-0000-4000-8000-000000009899");

    const plan = getSqlite()
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM transactions
         WHERE user_id = ? AND account_id = ?
         ORDER BY transaction_date DESC, created_at DESC, id DESC
         LIMIT 101`,
      )
      .all(aliceId, secondAliceAccountId) as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join(" ")).toContain(
      "transactions_user_account_date_created_id_idx",
    );
  });

  test("exports only the selected owner-scoped range", async () => {
    const csv = await transactionCsv(aliceId, {
      q: "bonus",
      accountId: aliceAccountId,
      type: "fee",
      from: "2025-06-15",
      to: "2025-06-15",
      flow: "outflow",
      sort: "newest",
    });

    expect(csv).toContain("30000000-0000-4000-8000-000000000004");
    expect(csv).not.toContain("30000000-0000-4000-8000-000000000003");
    expect(csv).not.toContain("30000000-0000-4000-8000-000000000006");
    expect(csv.trim().split("\n")).toHaveLength(2);
  });
});
