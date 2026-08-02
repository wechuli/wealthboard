import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { parse } from "csv-parse/sync";

import {
  accounts,
  categories,
  exchangeRates,
  goalContributionPlans,
  goals,
  transactions,
  userSettings,
  valuationSnapshots,
  transactionTypes,
  type TransactionType,
} from "@/db/schema";
import { dateInputForTimezone, dateInputToUtc, nowIso } from "@/lib/dates";
import {
  closeDatabase,
  databasePath,
  getDatabase,
  getSqlite,
} from "@/lib/db";
import { clearBootstrapCache } from "@/lib/bootstrap";
import { parseMoney } from "@/lib/money";
import { recalculateAccountBalance } from "@/lib/services/accounts";

const REQUIRED_TABLES = [
  "user_settings",
  "categories",
  "accounts",
  "transactions",
  "valuation_snapshots",
  "exchange_rates",
  "goals",
  "goal_contribution_plans",
  "login_attempts",
  "idempotency_keys",
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  user_settings: ["password_hash", "session_version", "session_timeout_minutes"],
  accounts: ["current_value_minor", "is_liability", "is_included_in_net_worth"],
  transactions: ["amount_minor", "transaction_date", "idempotency_key"],
  goals: ["target_amount_minor", "linked_account_id", "assumed_annual_return_bps"],
  goal_contribution_plans: ["planned_contribution_minor", "frequency"],
};

function backupDirectory() {
  const configured = process.env.BACKUP_PATH ?? "backups";
  const directory = path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function timestampName() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

export async function createDatabaseBackup(prefix = "worthboard") {
  const destination = path.join(backupDirectory(), `${prefix}-${timestampName()}.db`);
  await getSqlite().backup(destination);
  return destination;
}

export function validateDatabaseFile(filePath: string) {
  const header = Buffer.alloc(16);
  const descriptor = fs.openSync(filePath, "r");
  fs.readSync(descriptor, header, 0, 16, 0);
  fs.closeSync(descriptor);
  if (header.toString("utf8") !== "SQLite format 3\u0000") {
    throw new Error("The uploaded file is not a SQLite database.");
  }

  const candidate = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("The uploaded database failed its integrity check.");
    const tables = candidate
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((table) => table.name));
    const missing = REQUIRED_TABLES.filter((table) => !names.has(table));
    if (missing.length) {
      throw new Error(`The uploaded database is missing required tables: ${missing.join(", ")}.`);
    }
    for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const columns = candidate
        .prepare(`PRAGMA table_info("${table}")`)
        .all() as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));
      const missingColumns = requiredColumns.filter((column) => !names.has(column));
      if (missingColumns.length) {
        throw new Error(
          `The uploaded database has an incompatible ${table} table.`,
        );
      }
    }
    const users = candidate
      .prepare("SELECT COUNT(*) AS total FROM user_settings WHERE id = 'single-user'")
      .get() as { total: number };
    if (users.total !== 1) throw new Error("The uploaded database has no valid single-user settings.");
  } finally {
    candidate.close();
  }
}

function migrateCandidateDatabase(filePath: string) {
  const candidate = new Database(filePath);
  try {
    candidate.pragma("foreign_keys = ON");
    const migrationsFolder = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "db/migrations",
    );
    migrate(drizzle(candidate), { migrationsFolder });
  } finally {
    candidate.close();
  }
}

export async function restoreDatabase(bytes: Uint8Array) {
  const target = databasePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.restore-${crypto.randomUUID()}.db`,
  );
  fs.writeFileSync(temporary, bytes, { flag: "wx" });
  let preRestore: string | undefined;
  let replaced = false;
  try {
    migrateCandidateDatabase(temporary);
    validateDatabaseFile(temporary);
    preRestore = await createDatabaseBackup("pre-restore");
    closeDatabase();
    fs.rmSync(`${target}-wal`, { force: true });
    fs.rmSync(`${target}-shm`, { force: true });
    fs.renameSync(temporary, target);
    replaced = true;
    clearBootstrapCache();
    getSqlite().pragma("integrity_check");
    return preRestore;
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    if (preRestore && replaced) {
      closeDatabase();
      fs.copyFileSync(preRestore, target);
      clearBootstrapCache();
    }
    throw error;
  }
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

export async function exportData() {
  const db = getDatabase();
  const settings = await db.select().from(userSettings);
  return {
    format: "worthboard-json",
    version: 1,
    exportedAt: nowIso(),
    settings: settings.map((setting) => ({ ...setting, passwordHash: undefined })),
    categories: await db.select().from(categories),
    accounts: await db.select().from(accounts),
    transactions: await db.select().from(transactions),
    valuations: await db.select().from(valuationSnapshots),
    exchangeRates: await db.select().from(exchangeRates),
    goals: await db.select().from(goals),
    goalContributionPlans: await db.select().from(goalContributionPlans),
  };
}

type CsvTransaction = {
  account_id?: string;
  account_name?: string;
  type?: string;
  amount?: string;
  currency?: string;
  date?: string;
  description?: string;
  notes?: string;
};

export function importTransactionsCsv(content: string) {
  const parsed = parse(content, {
    columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as CsvTransaction[];
  if (!parsed.length) throw new Error("The CSV contains no transaction rows.");
  if (parsed.length > 10_000) throw new Error("Import is limited to 10,000 rows at a time.");

  const db = getDatabase();
  const accountRows = db.select().from(accounts).all();
  const timezone =
    db.query.userSettings.findFirst().sync()?.timezone ??
    process.env.TZ ??
    "Africa/Nairobi";
  const prepared = parsed.map((row, index) => {
    const matchingNames = row.account_name
      ? accountRows.filter(
          (item) => item.name.toLowerCase() === row.account_name?.toLowerCase(),
        )
      : [];
    if (!row.account_id && matchingNames.length > 1) {
      throw new Error(
        `Row ${index + 2}: account name is ambiguous; provide account_id.`,
      );
    }
    const account = row.account_id
      ? accountRows.find((item) => item.id === row.account_id)
      : matchingNames[0];
    if (!account) throw new Error(`Row ${index + 2}: account was not found.`);
    if (!row.type || !transactionTypes.includes(row.type as TransactionType)) {
      throw new Error(`Row ${index + 2}: unsupported transaction type.`);
    }
    if (row.type === "opening_balance" || row.type === "transfer") {
      throw new Error(`Row ${index + 2}: opening balances and transfers cannot be imported.`);
    }
    if (!row.date) throw new Error(`Row ${index + 2}: date is required.`);
    if (row.date > dateInputForTimezone(timezone)) {
      throw new Error(`Row ${index + 2}: financial activity cannot be future-dated.`);
    }
    const currency = (row.currency || account.currency).toUpperCase();
    if (currency !== account.currency) {
      throw new Error(`Row ${index + 2}: currency must match ${account.name}.`);
    }
    const amountMinor = parseMoney(row.amount || "", currency);
    if (row.type !== "manual_adjustment" && amountMinor <= 0) {
      throw new Error(`Row ${index + 2}: amount must be positive.`);
    }
    return {
      account,
      type: row.type as TransactionType,
      amountMinor,
      currency,
      transactionDate: dateInputToUtc(row.date),
      description: row.description,
      notes: row.notes,
    };
  });

  const affected = new Set(prepared.map((row) => row.account.id));
  const timestamp = nowIso();
  db.transaction((tx) => {
    tx.insert(transactions)
      .values(
        prepared.map((row) => ({
          id: crypto.randomUUID(),
          accountId: row.account.id,
          type: row.type,
          amountMinor: row.amountMinor,
          currency: row.currency,
          transactionDate: row.transactionDate,
          description: row.description,
          notes: row.notes,
          idempotencyKey: `csv-${crypto.randomUUID()}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      )
      .run();
    for (const accountId of affected) recalculateAccountBalance(tx, accountId);
  });
  return prepared.length;
}

export async function transactionCsv() {
  const rows = await getDatabase()
    .select({
      id: transactions.id,
      account_id: transactions.accountId,
      account_name: accounts.name,
      type: transactions.type,
      amount_minor: transactions.amountMinor,
      currency: transactions.currency,
      date: transactions.transactionDate,
      description: transactions.description,
      notes: transactions.notes,
      transfer_group_id: transactions.transferGroupId,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id));
  return toCsv(rows);
}

export async function accountCsv() {
  const rows = await getDatabase()
    .select({
      id: accounts.id,
      name: accounts.name,
      category: categories.name,
      institution: accounts.institution,
      currency: accounts.currency,
      current_value_minor: accounts.currentValueMinor,
      cost_basis_minor: accounts.costBasisMinor,
      is_liability: accounts.isLiability,
      included_in_net_worth: accounts.isIncludedInNetWorth,
      archived_at: accounts.archivedAt,
    })
    .from(accounts)
    .innerJoin(categories, eq(accounts.categoryId, categories.id));
  return toCsv(rows);
}
