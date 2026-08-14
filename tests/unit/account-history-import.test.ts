// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  accounts,
  categories,
  transactions,
  userSettings,
  users,
  valuationSnapshots,
} from "@/db/schema";
import { closeDatabase, getDatabase, getSqlite } from "@/lib/db";
import { createAccount, deleteTransaction } from "@/lib/services/accounts";
import {
  commitAccountHistory,
  previewAccountHistory,
} from "@/lib/services/account-history-import";
import {
  exportData,
  restoreUserData,
  transactionCsv,
} from "@/lib/services/portability";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-account-history-"),
);
const databasePath = path.join(workspace, "history.db");
const aliceId = "00000000-0000-4000-8000-000000000011";
const bobId = "00000000-0000-4000-8000-000000000012";
const aliceAccountId = "10000000-0000-4000-8000-000000000011";
const bobAccountId = "10000000-0000-4000-8000-000000000012";
const aliceCategoryId = "20000000-0000-4000-8000-000000000011";
const bobCategoryId = "20000000-0000-4000-8000-000000000012";
const createdAt = "2025-01-01T00:00:00.000Z";
const headers = "external_id,type,amount,date,description,notes";

function csv(...rows: string[]) {
  return [headers, ...rows].join("\n");
}

describe.sequential("account history import", () => {
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
          username: "alice-history",
          passwordHash: "not-used",
          status: "active",
          sessionVersion: 1,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: bobId,
          username: "bob-history",
          passwordHash: "not-used",
          status: "active",
          sessionVersion: 1,
          createdAt,
          updatedAt: createdAt,
        },
      ])
      .run();
    db.insert(categories)
      .values([
        {
          id: aliceCategoryId,
          userId: aliceId,
          name: "Cash",
          slug: "cash",
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: bobCategoryId,
          userId: bobId,
          name: "Cash",
          slug: "cash",
          createdAt,
          updatedAt: createdAt,
        },
      ])
      .run();
    db.insert(userSettings)
      .values({
        id: "50000000-0000-4000-8000-000000000011",
        userId: aliceId,
        displayName: "Alice History",
        createdAt,
        updatedAt: createdAt,
      })
      .run();
    db.insert(accounts)
      .values([
        {
          id: aliceAccountId,
          userId: aliceId,
          name: "Alice History",
          categoryId: aliceCategoryId,
          currency: "USD",
          currentValueMinor: 20_000,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: bobAccountId,
          userId: bobId,
          name: "Bob History",
          categoryId: bobCategoryId,
          currency: "USD",
          createdAt,
          updatedAt: createdAt,
        },
      ])
      .run();
    db.insert(transactions)
      .values({
        id: "30000000-0000-4000-8000-000000000011",
        userId: aliceId,
        accountId: aliceAccountId,
        type: "opening_balance",
        amountMinor: 10_000,
        currency: "USD",
        transactionDate: "2025-01-01T12:00:00.000Z",
        createdAt,
        updatedAt: createdAt,
      })
      .run();
    db.insert(valuationSnapshots)
      .values({
        id: "40000000-0000-4000-8000-000000000011",
        userId: aliceId,
        accountId: aliceAccountId,
        valueMinor: 20_000,
        currency: "USD",
        valuationDate: "2025-02-01T12:00:00.000Z",
        createdAt: "2025-02-01T11:00:00.000Z",
      })
      .run();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("CSV and JSON preview equivalently without writes", () => {
    const csvContent = csv(
      "equivalent-1,deposit,10.00,2025-02-01,Funding,note",
    );
    const jsonContent = JSON.stringify({
      format: "wealthboard-account-history",
      version: 1,
      transactions: [
        {
          external_id: "equivalent-1",
          type: "deposit",
          amount: "10.00",
          date: "2025-02-01",
          description: "Funding",
          notes: "note",
        },
      ],
    });

    const csvPreview = previewAccountHistory(
      aliceId,
      aliceAccountId,
      csvContent,
      "csv",
    );
    const jsonPreview = previewAccountHistory(
      aliceId,
      aliceAccountId,
      jsonContent,
      "json",
    );

    const { rows: csvRows, ...csvSummary } = csvPreview;
    const { rows: jsonRows, ...jsonSummary } = jsonPreview;
    expect(jsonSummary).toEqual(csvSummary);
    expect(jsonRows).toEqual(
      csvRows.map((row) => ({ ...row, row: row.row - 1 })),
    );
    expect(csvPreview.rows[0].row).toBe(2);
    expect(jsonPreview.rows[0].row).toBe(1);
    expect(csvPreview.projectedBalanceMinor).toBe(21_000);
    expect(csvPreview.netChangeMinor).toBe(1_000);
    expect(
      getDatabase()
        .select()
        .from(transactions)
        .where(eq(transactions.externalId, "equivalent-1"))
        .all(),
    ).toEqual([]);
  });

  test("commits valid rows while excluding validation and in-file duplicates", async () => {
    const content = csv(
      "equivalent-1,deposit,10.00,2025-02-01,Funding,note",
      "bad-sign,deposit,-1.00,2025-02-02,,",
      "repeated,fee,1.00,2025-02-03,,",
      "repeated,fee,1.00,2025-02-03,,",
    );
    const preview = previewAccountHistory(
      aliceId,
      aliceAccountId,
      content,
      "csv",
    );
    expect(preview.summary).toEqual({
      ready: 1,
      skippedDuplicates: 0,
      failed: 3,
    });
    expect(preview.rows.map((row) => row.status)).toEqual([
      "ready",
      "failed",
      "duplicate_in_file",
      "duplicate_in_file",
    ]);

    const result = commitAccountHistory(
      aliceId,
      aliceAccountId,
      content,
      "csv",
    );
    expect(result.summary).toEqual({
      imported: 1,
      skippedDuplicates: 0,
      failed: 3,
    });
    expect(result.finalBalanceMinor).toBe(preview.projectedBalanceMinor);
    expect(result.rows[0]).toMatchObject({
      status: "imported",
      transactionId: expect.any(String),
    });

    const second = commitAccountHistory(
      aliceId,
      aliceAccountId,
      content,
      "csv",
    );
    expect(second.summary).toEqual({
      imported: 0,
      skippedDuplicates: 1,
      failed: 3,
    });
    expect(second.finalBalanceMinor).toBe(result.finalBalanceMinor);
    expect(await transactionCsv(aliceId)).toContain("external_id");
    expect(await transactionCsv(aliceId)).toContain("equivalent-1");
  });

  test("reports conflicts without overwriting imported records", () => {
    const result = commitAccountHistory(
      aliceId,
      aliceAccountId,
      csv("equivalent-1,deposit,999.00,2025-02-01,Changed,note"),
      "csv",
    );
    expect(result.summary).toEqual({
      imported: 0,
      skippedDuplicates: 0,
      failed: 1,
    });
    expect(result.rows[0].status).toBe("conflicting_existing");
    const stored = getDatabase()
      .query.transactions.findFirst({
        where: eq(transactions.externalId, "equivalent-1"),
      })
      .sync();
    expect(stored).toMatchObject({
      amountMinor: 1_000,
      description: "Funding",
    });
  });

  test("scopes external IDs by owner and account and releases them on deletion", () => {
    const secondAliceAccountId = createAccount(aliceId, {
      name: "Alice Secondary History",
      categoryId: aliceCategoryId,
      currency: "USD",
      openingValue: "0",
      isIncludedInNetWorth: true,
    });
    const sameOwnerResult = commitAccountHistory(
      aliceId,
      secondAliceAccountId,
      csv("equivalent-1,deposit,10.00,2025-02-01,Funding,note"),
      "csv",
    );
    expect(sameOwnerResult.summary.imported).toBe(1);

    const bobResult = commitAccountHistory(
      bobId,
      bobAccountId,
      csv("equivalent-1,deposit,10.00,2025-02-01,Funding,note"),
      "csv",
    );
    expect(bobResult.summary.imported).toBe(1);

    const aliceImported = getDatabase()
      .query.transactions.findFirst({
        where: and(
          eq(transactions.userId, aliceId),
          eq(transactions.accountId, aliceAccountId),
          eq(transactions.externalId, "equivalent-1"),
        ),
      })
      .sync()!;
    deleteTransaction(aliceId, aliceImported.id);
    const reimported = commitAccountHistory(
      aliceId,
      aliceAccountId,
      csv("equivalent-1,deposit,10.00,2025-02-01,Funding,note"),
      "csv",
    );
    expect(reimported.summary.imported).toBe(1);
    expect(reimported.rows[0]).toMatchObject({
      status: "imported",
      transactionId: expect.not.stringMatching(aliceImported.id),
    });
  });

  test("validates strict structure, precision, dates, and manual adjustments", () => {
    expect(() =>
      previewAccountHistory(
        aliceId,
        aliceAccountId,
        "external_id,type,amount,date\nx,deposit,1.00,2025-01-01",
        "csv",
      ),
    ).toThrow("CSV headers must be exactly");
    expect(() =>
      previewAccountHistory(
        aliceId,
        aliceAccountId,
        JSON.stringify({
          format: "wealthboard-account-history",
          version: 2,
          transactions: [],
        }),
        "json",
      ),
    ).toThrow("version 1");

    const preview = previewAccountHistory(
      aliceId,
      aliceAccountId,
      csv(
        "precision,deposit,1.001,2025-01-01,,",
        "zero,manual_adjustment,0,2025-01-01,,",
        "future,deposit,1.00,2999-01-01,,",
        "adjust,manual_adjustment,-2.00,2025-02-02,,",
      ),
      "csv",
    );
    expect(preview.rows.map((row) => row.code)).toEqual([
      "invalid_amount",
      "invalid_amount",
      "future_date",
      "ready",
    ]);
  });

  test("denies foreign and archived accounts", () => {
    const content = csv("private-1,deposit,1.00,2025-01-01,,");
    expect(() =>
      previewAccountHistory(bobId, aliceAccountId, content, "csv"),
    ).toThrow("Account not found");
    getDatabase()
      .update(accounts)
      .set({ archivedAt: "2025-03-01T00:00:00.000Z" })
      .where(and(eq(accounts.userId, aliceId), eq(accounts.id, aliceAccountId)))
      .run();
    expect(() =>
      previewAccountHistory(aliceId, aliceAccountId, content, "csv"),
    ).toThrow("Account not found");
    getDatabase()
      .update(accounts)
      .set({ archivedAt: null })
      .where(and(eq(accounts.userId, aliceId), eq(accounts.id, aliceAccountId)))
      .run();
  });

  test("rolls back every accepted row after an unexpected database failure", () => {
    getSqlite().exec(`
      CREATE TRIGGER reject_history_row
      BEFORE INSERT ON transactions
      WHEN NEW.external_id = 'rollback-2'
      BEGIN
        SELECT RAISE(ABORT, 'forced test failure');
      END;
    `);
    const content = csv(
      "rollback-1,deposit,1.00,2025-03-01,,",
      "rollback-2,deposit,1.00,2025-03-01,,",
    );
    expect(() =>
      commitAccountHistory(aliceId, aliceAccountId, content, "csv"),
    ).toThrow("forced test failure");
    getSqlite().exec("DROP TRIGGER reject_history_row");
    expect(
      getDatabase()
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, aliceId),
            eq(transactions.accountId, aliceAccountId),
          ),
        )
        .all()
        .filter((row) => row.externalId?.startsWith("rollback-")),
    ).toEqual([]);
  });

  test("classifies the 10,000-row boundary", () => {
    const content = csv(
      ...Array.from(
        { length: 10_000 },
        (_, index) => `bulk-${index},deposit,0.01,2025-01-02,Bulk transaction,`,
      ),
    );
    const preview = previewAccountHistory(
      aliceId,
      aliceAccountId,
      content,
      "csv",
    );
    expect(preview.summary.ready).toBe(10_000);
    expect(() =>
      previewAccountHistory(
        aliceId,
        aliceAccountId,
        `${content}\nbulk-over,deposit,0.01,2025-01-02,,`,
        "csv",
      ),
    ).toThrow("10,000");
  });

  test("round-trips external IDs in v8 and restores v4 with null IDs", async () => {
    const archive = await exportData(aliceId);
    expect(archive.version).toBe(8);
    expect(archive.transactions).toContainEqual(
      expect.objectContaining({ externalId: "equivalent-1" }),
    );
    restoreUserData(aliceId, archive);
    expect(
      getDatabase()
        .select({ externalId: transactions.externalId })
        .from(transactions)
        .where(eq(transactions.userId, aliceId))
        .all(),
    ).toContainEqual({ externalId: "equivalent-1" });

    const versionFour = structuredClone(archive) as Record<string, unknown> & {
      accounts: Array<Record<string, unknown>>;
      transactions: Array<Record<string, unknown>>;
      settings: Record<string, unknown>;
    };
    versionFour.version = 4;
    delete versionFour.accountConversions;
    delete versionFour.settings.positionStaleDaysStock;
    delete versionFour.settings.positionStaleDaysEtf;
    delete versionFour.settings.positionStaleDaysFund;
    delete versionFour.investmentInstruments;
    delete versionFour.positionEvents;
    delete versionFour.securityPrices;
    delete versionFour.positionReconciliations;
    delete versionFour.beneficiaries;
    delete versionFour.estatePlans;
    delete versionFour.estateAccountDirectives;
    delete versionFour.estateAllocations;
    delete versionFour.estateResiduaryAllocations;
    delete versionFour.estatePlanSnapshots;
    versionFour.accounts = versionFour.accounts.map((account) => {
      const legacyAccount = { ...account };
      delete legacyAccount.trackingMode;
      return legacyAccount;
    });
    versionFour.transactions = versionFour.transactions.map((transaction) => {
      const legacyTransaction = { ...transaction };
      delete legacyTransaction.externalId;
      delete legacyTransaction.eventGroupId;
      return legacyTransaction;
    });
    restoreUserData(aliceId, versionFour);
    expect(
      getDatabase()
        .select({ externalId: transactions.externalId })
        .from(transactions)
        .where(eq(transactions.userId, aliceId))
        .all()
        .every((transaction) => transaction.externalId === null),
    ).toBe(true);
  });
});
