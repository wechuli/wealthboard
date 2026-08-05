import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { z } from "zod";

import {
  accounts,
  institutions,
  transactions,
  userSettings,
  valuationSnapshots,
  type TransactionType,
} from "@/db/schema";
import {
  dateInputForTimezone,
  dateInputToUtc,
  nowIso,
  utcToDateInput,
} from "@/lib/dates";
import { getDatabase } from "@/lib/db";
import { replayBalance, type FinancialEvent } from "@/lib/finance";
import { parseMoney } from "@/lib/money";
import { recalculateAccountBalance } from "@/lib/services/accounts";

export const ACCOUNT_HISTORY_MAX_BYTES = 5 * 1024 * 1024;
export const ACCOUNT_HISTORY_MAX_ROWS = 10_000;
export const ACCOUNT_HISTORY_HEADERS = [
  "external_id",
  "type",
  "amount",
  "date",
  "description",
  "notes",
] as const;

const importTypes = [
  "deposit",
  "withdrawal",
  "interest",
  "dividend",
  "capital_gain",
  "capital_loss",
  "fee",
  "purchase",
  "sale",
  "manual_adjustment",
  "liability_payment",
  "liability_increase",
] as const satisfies readonly TransactionType[];

type ImportType = (typeof importTypes)[number];
type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
type Client = DatabaseClient | TransactionClient;
type SourceRow = {
  external_id?: unknown;
  type?: unknown;
  amount?: unknown;
  date?: unknown;
  description?: unknown;
  notes?: unknown;
  [key: string]: unknown;
};

export type AccountHistoryRowStatus =
  | "ready"
  | "duplicate_existing"
  | "duplicate_in_file"
  | "conflicting_existing"
  | "failed"
  | "imported";

export type AccountHistoryResultRow = {
  row: number;
  externalId: string | null;
  status: AccountHistoryRowStatus;
  code: string;
  message: string;
  transactionId: string | null;
  type: string | null;
  amount: string | null;
  date: string | null;
};

type PreparedRow = AccountHistoryResultRow & {
  prepared?: {
    externalId: string;
    type: ImportType;
    amountMinor: number;
    transactionDate: string;
    description: string | null;
    notes: string | null;
  };
};

export type AccountHistoryPreview = {
  account: {
    id: string;
    name: string;
    institution: string | null;
    currency: string;
  };
  dateRange: { from: string; to: string } | null;
  currentBalanceMinor: number;
  projectedBalanceMinor: number;
  netChangeMinor: number;
  summary: {
    ready: number;
    skippedDuplicates: number;
    failed: number;
  };
  rows: AccountHistoryResultRow[];
};

const jsonEnvelopeSchema = z
  .object({
    format: z.literal("wealthboard-account-history"),
    version: z.literal(1),
    transactions: z.array(z.unknown()).min(1).max(ACCOUNT_HISTORY_MAX_ROWS),
  })
  .strict();

export class AccountHistoryFileError extends Error {}
export class AccountHistoryAccessError extends Error {}

function fileError(message: string): never {
  throw new AccountHistoryFileError(message);
}

function parseCsv(content: string): SourceRow[] {
  let records: unknown[][];
  try {
    records = parse(content, {
      bom: true,
      skip_empty_lines: true,
      trim: false,
    }) as unknown[][];
  } catch {
    return fileError("The CSV is malformed.");
  }
  if (!records.length)
    return fileError("The file contains no transaction rows.");
  const headers = records[0].map((value) =>
    typeof value === "string" ? value.trim() : "",
  );
  if (
    headers.length !== ACCOUNT_HISTORY_HEADERS.length ||
    new Set(headers).size !== headers.length ||
    ACCOUNT_HISTORY_HEADERS.some((header) => !headers.includes(header))
  ) {
    return fileError(
      `CSV headers must be exactly: ${ACCOUNT_HISTORY_HEADERS.join(",")}.`,
    );
  }
  const data = records.slice(1);
  if (!data.length) return fileError("The file contains no transaction rows.");
  if (data.length > ACCOUNT_HISTORY_MAX_ROWS) {
    return fileError("Import is limited to 10,000 rows at a time.");
  }
  return data.map((values) => {
    if (values.length !== headers.length)
      return fileError("The CSV is malformed.");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index]]),
    );
  });
}

function parseJson(content: string): SourceRow[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return fileError("The JSON is malformed.");
  }
  const parsed = jsonEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    if (
      value &&
      typeof value === "object" &&
      "transactions" in value &&
      Array.isArray(value.transactions) &&
      value.transactions.length > ACCOUNT_HISTORY_MAX_ROWS
    ) {
      return fileError("Import is limited to 10,000 rows at a time.");
    }
    return fileError(
      "JSON must use wealthboard-account-history format version 1 with a non-empty transactions array.",
    );
  }
  return parsed.data.transactions.map((row) =>
    row && typeof row === "object" && !Array.isArray(row)
      ? (row as SourceRow)
      : { invalid_row: row },
  );
}

export function parseAccountHistoryFile(
  content: string,
  format: "csv" | "json",
) {
  if (Buffer.byteLength(content, "utf8") > ACCOUNT_HISTORY_MAX_BYTES) {
    return fileError("Account history import is limited to 5 MB.");
  }
  if (!content.trim()) return fileError("The file is empty.");
  return format === "csv" ? parseCsv(content) : parseJson(content);
}

function textValue(
  value: unknown,
  field: string,
  max: number,
): { value: string | null } | { error: string } {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string")
    return { error: `${field} must be text or null.` };
  if (value.length > max)
    return { error: `${field} must be ${max} characters or fewer.` };
  return { value };
}

function failed(
  row: number,
  source: SourceRow,
  externalId: string | null,
  code: string,
  message: string,
): PreparedRow {
  return {
    row,
    externalId,
    status: "failed",
    code,
    message,
    transactionId: null,
    type: typeof source.type === "string" ? source.type : null,
    amount: typeof source.amount === "string" ? source.amount : null,
    date: typeof source.date === "string" ? source.date : null,
  };
}

function validateRow(
  source: SourceRow,
  row: number,
  currency: string,
  today: string,
): PreparedRow {
  const allowedKeys = new Set(ACCOUNT_HISTORY_HEADERS);
  if (Object.keys(source).some((key) => !allowedKeys.has(key as never))) {
    return failed(
      row,
      source,
      null,
      "unknown_field",
      "The row contains an unknown field.",
    );
  }
  if (typeof source.external_id !== "string") {
    return failed(
      row,
      source,
      null,
      "external_id_required",
      "external_id is required and must be text.",
    );
  }
  const externalId = source.external_id.trim();
  if (!externalId || externalId.length > 200) {
    return failed(
      row,
      source,
      externalId || null,
      "invalid_external_id",
      "external_id must contain 1 to 200 characters.",
    );
  }
  if (
    typeof source.type !== "string" ||
    !importTypes.includes(source.type as ImportType)
  ) {
    return failed(
      row,
      source,
      externalId,
      "invalid_type",
      "The transaction type is not supported for account history import.",
    );
  }
  if (typeof source.amount !== "string") {
    return failed(
      row,
      source,
      externalId,
      "invalid_amount",
      "amount must be a decimal string.",
    );
  }
  let amountMinor: number;
  try {
    amountMinor = parseMoney(source.amount, currency);
  } catch (error) {
    return failed(
      row,
      source,
      externalId,
      "invalid_amount",
      error instanceof Error ? error.message : "amount is invalid.",
    );
  }
  if (
    amountMinor === 0 ||
    (source.type !== "manual_adjustment" && amountMinor < 0)
  ) {
    return failed(
      row,
      source,
      externalId,
      "invalid_amount",
      source.type === "manual_adjustment"
        ? "manual_adjustment amount must be signed and non-zero."
        : "amount must be positive.",
    );
  }
  if (typeof source.date !== "string") {
    return failed(row, source, externalId, "invalid_date", "date is required.");
  }
  let transactionDate: string;
  try {
    transactionDate = dateInputToUtc(source.date);
  } catch (error) {
    return failed(
      row,
      source,
      externalId,
      "invalid_date",
      error instanceof Error ? error.message : "date is invalid.",
    );
  }
  if (source.date > today) {
    return failed(
      row,
      source,
      externalId,
      "future_date",
      "date cannot be in the future.",
    );
  }
  const description = textValue(source.description, "description", 200);
  if ("error" in description) {
    return failed(
      row,
      source,
      externalId,
      "invalid_description",
      description.error,
    );
  }
  const notes = textValue(source.notes, "notes", 2000);
  if ("error" in notes) {
    return failed(row, source, externalId, "invalid_notes", notes.error);
  }
  return {
    row,
    externalId,
    status: "ready",
    code: "ready",
    message: "Ready to import.",
    transactionId: null,
    type: source.type,
    amount: source.amount,
    date: source.date,
    prepared: {
      externalId,
      type: source.type as ImportType,
      amountMinor,
      transactionDate,
      description: description.value,
      notes: notes.value,
    },
  };
}

function existingTransactions(
  client: Client,
  userId: string,
  accountId: string,
  externalIds: string[],
) {
  const rows: Array<typeof transactions.$inferSelect> = [];
  for (let index = 0; index < externalIds.length; index += 500) {
    rows.push(
      ...client
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.accountId, accountId),
            inArray(
              transactions.externalId,
              externalIds.slice(index, index + 500),
            ),
          ),
        )
        .all(),
    );
  }
  return new Map(rows.map((row) => [row.externalId!, row]));
}

function classifyRows(
  client: Client,
  userId: string,
  accountId: string,
  currency: string,
  timezone: string,
  sourceRows: SourceRow[],
  firstRow: number,
) {
  const rows = sourceRows.map((source, index) =>
    validateRow(
      source,
      index + firstRow,
      currency,
      dateInputForTimezone(timezone),
    ),
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.externalId)
      counts.set(row.externalId, (counts.get(row.externalId) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.externalId && (counts.get(row.externalId) ?? 0) > 1) {
      row.status = "duplicate_in_file";
      row.code = "duplicate_in_file";
      row.message = "external_id occurs more than once in this file.";
      delete row.prepared;
    }
  }
  const candidates = rows.filter(
    (row) => row.status === "ready" && row.prepared,
  );
  const existing = existingTransactions(
    client,
    userId,
    accountId,
    candidates.map((row) => row.prepared!.externalId),
  );
  for (const row of candidates) {
    const match = existing.get(row.prepared!.externalId);
    if (!match) continue;
    if (
      match.type === row.prepared!.type &&
      match.amountMinor === row.prepared!.amountMinor &&
      match.currency === currency &&
      match.transactionDate === row.prepared!.transactionDate &&
      match.description === row.prepared!.description &&
      match.notes === row.prepared!.notes
    ) {
      row.status = "duplicate_existing";
      row.code = "duplicate_existing";
      row.message = "This transaction is already imported.";
    } else {
      row.status = "conflicting_existing";
      row.code = "conflicting_existing";
      row.message = "external_id already belongs to a different transaction.";
    }
    delete row.prepared;
  }
  return rows;
}

function accountForImport(client: Client, userId: string, accountId: string) {
  const row = client
    .select({
      id: accounts.id,
      name: accounts.name,
      institution: institutions.name,
      currency: accounts.currency,
      currentValueMinor: accounts.currentValueMinor,
    })
    .from(accounts)
    .leftJoin(
      institutions,
      and(
        eq(institutions.userId, accounts.userId),
        eq(institutions.id, accounts.institutionId),
      ),
    )
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.id, accountId),
        isNull(accounts.archivedAt),
      ),
    )
    .get();
  if (!row) throw new AccountHistoryAccessError("Account not found.");
  return row;
}

function projectedBalance(
  userId: string,
  accountId: string,
  ready: PreparedRow[],
) {
  const db = getDatabase();
  const transactionEvents: FinancialEvent[] = db
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
      ),
    )
    .all()
    .map((row) => ({ kind: "transaction", ...row }));
  const valuationEvents: FinancialEvent[] = db
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
      ),
    )
    .all()
    .map((row) => ({ kind: "valuation", ...row }));
  const createdAt = nowIso();
  return replayBalance([
    ...transactionEvents,
    ...valuationEvents,
    ...ready.map(
      (row): FinancialEvent => ({
        kind: "transaction",
        type: row.prepared!.type,
        amountMinor: row.prepared!.amountMinor,
        date: row.prepared!.transactionDate,
        createdAt,
      }),
    ),
  ]);
}

function checkedBalance(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new AccountHistoryFileError(
      "The projected balance is outside the supported range.",
    );
  }
  return number;
}

function summarize(rows: PreparedRow[]) {
  return {
    ready: rows.filter((row) => row.status === "ready").length,
    skippedDuplicates: rows.filter((row) => row.status === "duplicate_existing")
      .length,
    failed: rows.filter(
      (row) =>
        row.status === "failed" ||
        row.status === "duplicate_in_file" ||
        row.status === "conflicting_existing",
    ).length,
  };
}

function toResultRow(row: PreparedRow): AccountHistoryResultRow {
  return {
    row: row.row,
    externalId: row.externalId,
    status: row.status,
    code: row.code,
    message: row.message,
    transactionId: row.transactionId,
    type: row.type,
    amount: row.amount,
    date: row.date,
  };
}

export function previewAccountHistory(
  userId: string,
  accountId: string,
  content: string,
  format: "csv" | "json",
): AccountHistoryPreview {
  const db = getDatabase();
  const account = accountForImport(db, userId, accountId);
  const timezone =
    db.query.userSettings
      .findFirst({ where: eq(userSettings.userId, userId) })
      .sync()?.timezone ?? "UTC";
  const rows = classifyRows(
    db,
    userId,
    accountId,
    account.currency,
    timezone,
    parseAccountHistoryFile(content, format),
    format === "csv" ? 2 : 1,
  );
  const ready = rows.filter((row) => row.status === "ready" && row.prepared);
  const projected = checkedBalance(projectedBalance(userId, accountId, ready));
  const dates = rows
    .filter((row) => row.prepared)
    .map((row) => utcToDateInput(row.prepared!.transactionDate))
    .sort();
  return {
    account: {
      id: account.id,
      name: account.name,
      institution: account.institution,
      currency: account.currency,
    },
    dateRange: dates.length ? { from: dates[0], to: dates.at(-1)! } : null,
    currentBalanceMinor: account.currentValueMinor,
    projectedBalanceMinor: projected,
    netChangeMinor: projected - account.currentValueMinor,
    summary: summarize(rows),
    rows: rows.map(toResultRow),
  };
}

export function commitAccountHistory(
  userId: string,
  accountId: string,
  content: string,
  format: "csv" | "json",
) {
  const sourceRows = parseAccountHistoryFile(content, format);
  const db = getDatabase();
  return db.transaction((tx) => {
    const account = accountForImport(tx, userId, accountId);
    const timezone =
      tx.query.userSettings
        .findFirst({ where: eq(userSettings.userId, userId) })
        .sync()?.timezone ?? "UTC";
    const rows = classifyRows(
      tx,
      userId,
      accountId,
      account.currency,
      timezone,
      sourceRows,
      format === "csv" ? 2 : 1,
    );
    const ready = rows.filter((row) => row.status === "ready" && row.prepared);
    const createdAt = nowIso();
    for (const row of ready) {
      const transactionId = crypto.randomUUID();
      tx.insert(transactions)
        .values({
          id: transactionId,
          userId,
          accountId,
          externalId: row.prepared!.externalId,
          type: row.prepared!.type,
          amountMinor: row.prepared!.amountMinor,
          currency: account.currency,
          transactionDate: row.prepared!.transactionDate,
          description: row.prepared!.description,
          notes: row.prepared!.notes,
          createdAt,
          updatedAt: createdAt,
        })
        .run();
      row.status = "imported";
      row.code = "imported";
      row.message = "Transaction imported.";
      row.transactionId = transactionId;
      delete row.prepared;
    }
    if (ready.length) recalculateAccountBalance(userId, tx, accountId);
    const finalAccount = tx
      .select({ currentValueMinor: accounts.currentValueMinor })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
      .get()!;
    return {
      account: {
        id: account.id,
        name: account.name,
        institution: account.institution,
        currency: account.currency,
      },
      finalBalanceMinor: finalAccount.currentValueMinor,
      summary: {
        imported: ready.length,
        skippedDuplicates: rows.filter(
          (row) => row.status === "duplicate_existing",
        ).length,
        failed: rows.filter(
          (row) =>
            row.status === "failed" ||
            row.status === "duplicate_in_file" ||
            row.status === "conflicting_existing",
        ).length,
      },
      rows: rows.map(toResultRow),
    };
  });
}
