import { zodResolver } from "@hookform/resolvers/zod";
import {
  Archive,
  ArrowLeftRight,
  Eye,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import {
  archiveAccount,
  createAccount,
  createPositionEvent,
  createPositionReconciliation,
  createTransaction,
  createTransfer,
  createValuation,
  deleteAccount,
  deletePositionEvent,
  deletePositionReconciliation,
  deleteTransaction,
  deleteValuation,
  executeAccountConversion,
  previewAccountConversion,
  updateAccount,
  updatePositionEvent,
  updateTransaction,
} from "@/api/client";
import { minorUnitsToDecimal } from "@/lib/format";
import type {
  Account,
  AccountConversionInput,
  AccountConversionPreview,
  AccountInput,
  Category,
  Institution,
  Instrument,
  PositionEvent,
  PositionEventInput,
  PositionReconciliation,
  Session,
  Transaction,
  TransactionInput,
  Valuation,
} from "@/lib/types";
import { MoneyValue, PrivateValue } from "@/components/privacy";
import { Card, CardHeader, humanize } from "@/components/ui/resource";

const today = () => new Date().toISOString().slice(0, 10);

function decimalToMinor(value: string, currency: string) {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const match = value
    .trim()
    .replaceAll(",", "")
    .match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("Enter a valid amount.");
  const fraction = match[3] ?? "";
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits)))
    throw new Error(
      `Use no more than ${digits} decimal places for ${currency}.`,
    );
  const minor =
    `${match[2]}${fraction.padEnd(digits, "0").slice(0, digits)}`.replace(
      /^0+(?=\d)/,
      "",
    );
  return `${match[1]}${minor || "0"}`;
}

function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}

const accountSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  categoryId: z.string().uuid(),
  institutionId: z.string(),
  accountReference: z.string().max(50),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  trackingMode: z.enum(["balance", "positions"]),
  openingValue: z.string().min(1),
  costBasis: z.string(),
  isIncludedInNetWorth: z.boolean(),
  notes: z.string().max(2000),
  openedAt: z.string(),
});
type AccountValues = z.infer<typeof accountSchema>;

export function AccountCreateForm({
  categories,
  institutions,
  session,
  onChanged,
}: {
  categories: Category[];
  institutions: Institution[];
  session: Session;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Add account"
        description="Create a balance or position-tracked financial account."
      />
      <AccountForm
        categories={categories}
        institutions={institutions}
        session={session}
        onChanged={onChanged}
      />
    </Card>
  );
}

function AccountForm({
  categories,
  institutions,
  session,
  onChanged,
  account,
}: {
  categories: Category[];
  institutions: Institution[];
  session: Session;
  onChanged: () => void;
  account?: Account;
}) {
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { isSubmitting },
  } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: account
      ? {
          name: account.name,
          description: account.description ?? "",
          categoryId: account.categoryId,
          institutionId: account.institutionId ?? "",
          accountReference: account.accountReference ?? "",
          currency: account.currency,
          trackingMode: account.trackingMode as "balance" | "positions",
          openingValue: "0",
          costBasis: account.costBasisMinor
            ? minorUnitsToDecimal(account.costBasisMinor)
            : "",
          isIncludedInNetWorth: account.isIncludedInNetWorth,
          notes: account.notes ?? "",
          openedAt: account.openedAt?.slice(0, 10) ?? "",
        }
      : {
          name: "",
          description: "",
          categoryId: categories[0]?.id ?? "",
          institutionId: "",
          accountReference: "",
          currency: "KES",
          trackingMode: "balance",
          openingValue: "0.00",
          costBasis: "",
          isIncludedInNetWorth: true,
          notes: "",
          openedAt: today(),
        },
  });
  const currency = useWatch({ control, name: "currency" });
  return (
    <form
      className="auth-form"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        setError("");
        try {
          const input: AccountInput = {
            idempotencyKey: account ? undefined : key,
            name: values.name,
            description: values.description,
            categoryId: values.categoryId,
            institutionId: values.institutionId || null,
            accountReference: values.accountReference,
            currency: values.currency,
            trackingMode: values.trackingMode,
            openingValueMinor: account
              ? "0"
              : decimalToMinor(values.openingValue, values.currency),
            costBasisMinor: values.costBasis
              ? decimalToMinor(values.costBasis, values.currency)
              : null,
            isIncludedInNetWorth: values.isIncludedInNetWorth,
            notes: values.notes,
            openedAt: values.openedAt || null,
          };
          if (account)
            await updateAccount(account.id, input, session.csrfToken);
          else await createAccount(input, session.csrfToken);
          if (!account) {
            reset();
            setKey(crypto.randomUUID());
          }
          onChanged();
        } catch (caught) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The account could not be saved.",
          );
        }
      })}
    >
      <ErrorNotice message={error} />
      <div className="form-grid">
        <div>
          <label htmlFor={`account-name-${account?.id ?? "new"}`}>
            Account or asset name
          </label>
          <input
            id={`account-name-${account?.id ?? "new"}`}
            {...register("name")}
          />
        </div>
        <div>
          <label htmlFor={`account-category-${account?.id ?? "new"}`}>
            Category
          </label>
          <select
            id={`account-category-${account?.id ?? "new"}`}
            {...register("categoryId")}
          >
            {categories
              .filter((item) => !item.isArchived)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor={`account-institution-${account?.id ?? "new"}`}>
            Institution
          </label>
          <select
            id={`account-institution-${account?.id ?? "new"}`}
            {...register("institutionId")}
          >
            <option value="">None</option>
            {institutions
              .filter((item) => !item.archivedAt)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor={`account-currency-${account?.id ?? "new"}`}>
            Currency
          </label>
          <input
            id={`account-currency-${account?.id ?? "new"}`}
            disabled={Boolean(account)}
            maxLength={3}
            {...register("currency")}
          />
        </div>
        <div>
          <label htmlFor={`account-tracking-${account?.id ?? "new"}`}>
            Tracking method
          </label>
          <select
            id={`account-tracking-${account?.id ?? "new"}`}
            disabled={Boolean(account)}
            {...register("trackingMode")}
          >
            <option value="balance">Account value</option>
            <option value="positions">Units and prices</option>
          </select>
        </div>
        {!account ? (
          <div>
            <label htmlFor="account-opening">Opening value ({currency})</label>
            <input
              id="account-opening"
              inputMode="decimal"
              {...register("openingValue")}
            />
          </div>
        ) : null}
        <div>
          <label htmlFor={`account-cost-${account?.id ?? "new"}`}>
            Cost basis ({currency})
          </label>
          <input
            id={`account-cost-${account?.id ?? "new"}`}
            inputMode="decimal"
            {...register("costBasis")}
          />
        </div>
        <div>
          <label htmlFor={`account-reference-${account?.id ?? "new"}`}>
            Masked account reference
          </label>
          <input
            id={`account-reference-${account?.id ?? "new"}`}
            {...register("accountReference")}
          />
        </div>
        <div>
          <label htmlFor={`account-opened-${account?.id ?? "new"}`}>
            Opened or acquired
          </label>
          <input
            id={`account-opened-${account?.id ?? "new"}`}
            type="date"
            {...register("openedAt")}
          />
        </div>
        <div>
          <label htmlFor={`account-description-${account?.id ?? "new"}`}>
            Description
          </label>
          <input
            id={`account-description-${account?.id ?? "new"}`}
            {...register("description")}
          />
        </div>
        <div>
          <label htmlFor={`account-notes-${account?.id ?? "new"}`}>
            Private notes
          </label>
          <input
            id={`account-notes-${account?.id ?? "new"}`}
            {...register("notes")}
          />
        </div>
      </div>
      <label>
        <input type="checkbox" {...register("isIncludedInNetWorth")} /> Include
        this account in net worth
      </label>
      <button className="primary-button compact" disabled={isSubmitting}>
        <Save size={16} />
        {isSubmitting
          ? "Saving..."
          : account
            ? "Save account"
            : "Create account"}
      </button>
    </form>
  );
}

export function AccountControls({
  account,
  categories,
  institutions,
  session,
  onChanged,
}: {
  account: Account;
  categories: Category[];
  institutions: Institution[];
  session: Session;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  return (
    <Card className="section-block">
      <CardHeader title="Manage account" />
      <ErrorNotice message={error} />
      <div className="page-actions">
        <button
          className="secondary-button"
          onClick={() => setEditing(!editing)}
        >
          <Save size={16} /> Edit
        </button>
        <button
          className="secondary-button"
          onClick={async () => {
            if (
              !window.confirm(
                `${account.archivedAt ? "Restore" : "Archive"} ${account.name}?`,
              )
            )
              return;
            try {
              await archiveAccount(
                account.id,
                !account.archivedAt,
                session.csrfToken,
              );
              onChanged();
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Account status could not be changed.",
              );
            }
          }}
        >
          <Archive size={16} />
          {account.archivedAt ? "Restore" : "Archive"}
        </button>
        <button
          className="secondary-button danger-button"
          onClick={async () => {
            const confirmationName = window.prompt(
              `Type ${account.name} to permanently delete this account.`,
            );
            if (confirmationName === null) return;
            try {
              await deleteAccount(
                account.id,
                confirmationName,
                session.csrfToken,
              );
              navigate("/accounts");
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "The account could not be deleted.",
              );
            }
          }}
        >
          <Trash2 size={16} /> Delete
        </button>
      </div>
      {editing ? (
        <AccountForm
          account={account}
          categories={categories}
          institutions={institutions}
          session={session}
          onChanged={onChanged}
        />
      ) : null}
    </Card>
  );
}

const transactionSchema = z.object({
  type: z.enum([
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
  ]),
  amount: z.string().min(1),
  transactionDate: z.iso.date(),
  description: z.string().max(200),
  externalId: z.string().max(200),
  notes: z.string().max(2000),
});
type TransactionValues = z.infer<typeof transactionSchema>;

type TransactionOperations = {
  create: typeof createTransaction;
  update: typeof updateTransaction;
};

export function TransactionForm({
  account,
  session,
  transaction,
  onChanged,
  operations = { create: createTransaction, update: updateTransaction },
}: {
  account: Account;
  session: Session;
  transaction?: Transaction;
  onChanged: () => void;
  operations?: TransactionOperations;
}) {
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<TransactionValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: transaction
      ? {
          type: transaction.type as TransactionValues["type"],
          amount: minorUnitsToDecimal(transaction.amountMinor),
          transactionDate: transaction.transactionDate,
          description: transaction.description ?? "",
          externalId: transaction.externalId ?? "",
          notes: transaction.notes ?? "",
        }
      : {
          type: "deposit",
          amount: "",
          transactionDate: today(),
          description: "",
          externalId: "",
          notes: "",
        },
  });
  return (
    <form
      className="auth-form"
      onSubmit={handleSubmit(async (values) => {
        setError("");
        try {
          const input: TransactionInput = {
            idempotencyKey: transaction ? undefined : key,
            accountId: account.id,
            type: values.type,
            amountMinor: decimalToMinor(values.amount, account.currency),
            transactionDate: values.transactionDate,
            description: values.description,
            externalId: values.externalId,
            notes: values.notes,
          };
          if (transaction)
            await operations.update(transaction.id, input, session.csrfToken);
          else await operations.create(input, session.csrfToken);
          if (!transaction) {
            reset();
            setKey(crypto.randomUUID());
          }
          onChanged();
        } catch (caught) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The transaction could not be saved.",
          );
        }
      })}
    >
      <ErrorNotice message={error} />
      <div className="form-grid">
        <div>
          <label htmlFor={`transaction-type-${transaction?.id ?? "new"}`}>
            Transaction type
          </label>
          <select
            id={`transaction-type-${transaction?.id ?? "new"}`}
            disabled={Boolean(transaction)}
            {...register("type")}
          >
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="interest">Interest</option>
            <option value="dividend">Dividend</option>
            <option value="capital_gain">Capital gain</option>
            <option value="capital_loss">Capital loss</option>
            <option value="fee">Fee</option>
            <option value="purchase">Purchase</option>
            <option value="sale">Sale</option>
            <option value="manual_adjustment">Manual adjustment</option>
            <option value="liability_payment">Liability payment</option>
            <option value="liability_increase">Liability increase</option>
          </select>
        </div>
        <div>
          <label htmlFor={`transaction-amount-${transaction?.id ?? "new"}`}>
            Amount ({account.currency})
          </label>
          <input
            id={`transaction-amount-${transaction?.id ?? "new"}`}
            inputMode="decimal"
            {...register("amount")}
          />
        </div>
        <div>
          <label htmlFor={`transaction-date-${transaction?.id ?? "new"}`}>
            Date
          </label>
          <input
            id={`transaction-date-${transaction?.id ?? "new"}`}
            type="date"
            {...register("transactionDate")}
          />
        </div>
        <div>
          <label
            htmlFor={`transaction-description-${transaction?.id ?? "new"}`}
          >
            Description
          </label>
          <input
            id={`transaction-description-${transaction?.id ?? "new"}`}
            {...register("description")}
          />
        </div>
        <div>
          <label htmlFor={`transaction-external-${transaction?.id ?? "new"}`}>
            External ID
          </label>
          <input
            id={`transaction-external-${transaction?.id ?? "new"}`}
            {...register("externalId")}
          />
        </div>
        <div>
          <label htmlFor={`transaction-notes-${transaction?.id ?? "new"}`}>
            Notes
          </label>
          <input
            id={`transaction-notes-${transaction?.id ?? "new"}`}
            {...register("notes")}
          />
        </div>
      </div>
      <button className="primary-button compact" disabled={isSubmitting}>
        <Save size={16} />
        {isSubmitting
          ? "Saving..."
          : transaction
            ? "Save transaction"
            : "Record transaction"}
      </button>
    </form>
  );
}

export function LedgerManager({
  account,
  transactions,
  valuations,
  allAccounts,
  session,
  onChanged,
}: {
  account: Account;
  transactions: Transaction[];
  valuations: Valuation[];
  allAccounts: Account[];
  session: Session;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");
  const remove = async (label: string, action: () => Promise<void>) => {
    if (!window.confirm(`Delete this ${label}?`)) return;
    setError("");
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `The ${label} could not be deleted.`,
      );
    }
  };
  return (
    <div className="settings-stack section-block">
      <ErrorNotice message={error} />
      <Card>
        <CardHeader title="Record transaction" />
        <TransactionForm
          account={account}
          session={session}
          onChanged={onChanged}
        />
      </Card>
      <Card>
        <CardHeader title="Manage transactions" />
        {transactions.map((item) => (
          <div className="data-row" key={item.id}>
            <div>
              <strong>{item.type}</strong>
              <span>
                {item.transactionDate} ·{" "}
                <MoneyValue
                  amount={item.amountMinor}
                  currency={item.currency}
                />
              </span>
            </div>
            <div className="page-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setEditing(editing === item.id ? undefined : item.id)
                }
              >
                Edit
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${item.type} transaction`}
                onClick={() =>
                  void remove("transaction", () =>
                    deleteTransaction(item.id, session.csrfToken),
                  )
                }
              >
                <Trash2 />
              </button>
            </div>
            {editing === item.id ? (
              <TransactionForm
                account={account}
                transaction={item}
                session={session}
                onChanged={onChanged}
              />
            ) : null}
          </div>
        ))}
      </Card>
      <ValuationManager
        account={account}
        valuations={valuations}
        session={session}
        onChanged={onChanged}
      />
      <TransferForm
        account={account}
        accounts={allAccounts}
        session={session}
        onChanged={onChanged}
      />
    </div>
  );
}

function ValuationManager({
  account,
  valuations,
  session,
  onChanged,
}: {
  account: Account;
  valuations: Valuation[];
  session: Session;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const schema = z.object({
    value: z.string().min(1),
    valuationDate: z.iso.date(),
    notes: z.string().max(2000),
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      value: minorUnitsToDecimal(account.currentValueMinor),
      valuationDate: today(),
      notes: "",
    },
  });
  return (
    <Card>
      <CardHeader title="Valuations" />
      <ErrorNotice message={error} />
      <form
        className="auth-form"
        onSubmit={handleSubmit(async (values) => {
          setError("");
          try {
            await createValuation(
              {
                idempotencyKey: key,
                accountId: account.id,
                valueMinor: decimalToMinor(values.value, account.currency),
                valuationDate: values.valuationDate,
                notes: values.notes,
              },
              session.csrfToken,
            );
            reset();
            setKey(crypto.randomUUID());
            onChanged();
          } catch (caught) {
            setError(
              caught instanceof Error
                ? caught.message
                : "The valuation could not be saved.",
            );
          }
        })}
      >
        <div className="form-grid">
          <div>
            <label htmlFor="valuation-value">
              New value ({account.currency})
            </label>
            <input
              id="valuation-value"
              inputMode="decimal"
              {...register("value")}
            />
          </div>
          <div>
            <label htmlFor="valuation-date">Valuation date</label>
            <input
              id="valuation-date"
              type="date"
              {...register("valuationDate")}
            />
          </div>
          <div>
            <label htmlFor="valuation-notes">Notes</label>
            <input id="valuation-notes" {...register("notes")} />
          </div>
        </div>
        <button className="primary-button compact" disabled={isSubmitting}>
          <Plus size={16} />
          {isSubmitting ? "Saving..." : "Record valuation"}
        </button>
      </form>
      <div className="data-list">
        {valuations.map((item) => (
          <div className="data-row" key={item.id}>
            <div>
              <strong>{item.valuationDate}</strong>
              <span>{item.notes || "Recorded valuation"}</span>
            </div>
            <div className="page-actions">
              <MoneyValue amount={item.valueMinor} currency={item.currency} />
              <button
                className="icon-button"
                aria-label={`Delete valuation from ${item.valuationDate}`}
                onClick={async () => {
                  if (!window.confirm("Delete this valuation?")) return;
                  try {
                    await deleteValuation(item.id, session.csrfToken);
                    onChanged();
                  } catch (caught) {
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "The valuation could not be deleted.",
                    );
                  }
                }}
              >
                <Trash2 />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TransferForm({
  account,
  accounts,
  session,
  onChanged,
}: {
  account: Account;
  accounts: Account[];
  session: Session;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const destinations = accounts.filter(
    (item) => item.id !== account.id && !item.archivedAt,
  );
  const schema = z.object({
    toAccountId: z.string().uuid(),
    amount: z.string().min(1),
    destinationAmount: z.string(),
    transactionDate: z.iso.date(),
    description: z.string().max(200),
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      toAccountId: destinations[0]?.id ?? "",
      amount: "",
      destinationAmount: "",
      transactionDate: today(),
      description: "",
    },
  });
  return (
    <Card>
      <CardHeader
        title="Transfer funds"
        description="Paired account entries are created atomically."
      />
      <ErrorNotice message={error} />
      <form
        className="auth-form"
        onSubmit={handleSubmit(async (values) => {
          setError("");
          const destination = accounts.find(
            (item) => item.id === values.toAccountId,
          );
          try {
            await createTransfer(
              {
                idempotencyKey: key,
                fromAccountId: account.id,
                toAccountId: values.toAccountId,
                sourceAmountMinor: decimalToMinor(
                  values.amount,
                  account.currency,
                ),
                destinationAmountMinor:
                  values.destinationAmount && destination
                    ? decimalToMinor(
                        values.destinationAmount,
                        destination.currency,
                      )
                    : "",
                transactionDate: values.transactionDate,
                description: values.description,
              },
              session.csrfToken,
            );
            reset();
            setKey(crypto.randomUUID());
            onChanged();
          } catch (caught) {
            setError(
              caught instanceof Error
                ? caught.message
                : "The transfer could not be saved.",
            );
          }
        })}
      >
        <div className="form-grid">
          <div>
            <label htmlFor="transfer-to">To account</label>
            <select id="transfer-to" {...register("toAccountId")}>
              {destinations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.currency}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="transfer-amount">
              Source amount ({account.currency})
            </label>
            <input
              id="transfer-amount"
              inputMode="decimal"
              {...register("amount")}
            />
          </div>
          <div>
            <label htmlFor="transfer-destination">
              Destination amount (optional)
            </label>
            <input
              id="transfer-destination"
              inputMode="decimal"
              {...register("destinationAmount")}
            />
          </div>
          <div>
            <label htmlFor="transfer-date">Date</label>
            <input
              id="transfer-date"
              type="date"
              {...register("transactionDate")}
            />
          </div>
          <div>
            <label htmlFor="transfer-description">Description</label>
            <input id="transfer-description" {...register("description")} />
          </div>
        </div>
        <button
          className="primary-button compact"
          disabled={isSubmitting || !destinations.length}
        >
          <ArrowLeftRight size={16} />
          {isSubmitting ? "Transferring..." : "Transfer funds"}
        </button>
      </form>
    </Card>
  );
}

type ConversionOperations = {
  preview: typeof previewAccountConversion;
  execute: typeof executeAccountConversion;
};
export function AccountConversionForm({
  account,
  instruments,
  session,
  onConverted,
  operations = {
    preview: previewAccountConversion,
    execute: executeAccountConversion,
  },
}: {
  account: Account;
  instruments: Instrument[];
  session: Session;
  onConverted: (id: string) => void;
  operations?: ConversionOperations;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<AccountConversionPreview>();
  const [error, setError] = useState("");
  const schema = z.object({
    targetName: z.string().trim().min(1).max(100),
    conversionDate: z.iso.date(),
    openingCash: z.string(),
    instrumentId: z.string().uuid(),
    quantity: z.string().min(1),
    price: z.string().min(1),
    openingCostBasis: z.string(),
    confirmDifference: z.boolean(),
  });
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    control,
    formState: { isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      targetName: `${account.name} Positions`,
      conversionDate: today(),
      openingCash: "0",
      instrumentId: instruments[0]?.id ?? "",
      quantity: "",
      price: "",
      openingCostBasis: "",
      confirmDifference: false,
    },
  });
  const confirmed = useWatch({ control, name: "confirmDifference" });
  const input = (
    values: Values,
    confirmDifference: boolean,
  ): AccountConversionInput => ({
    sourceAccountId: account.id,
    targetName: values.targetName,
    conversionDate: values.conversionDate,
    openingCash: values.openingCash,
    holdings: [
      {
        instrumentId: values.instrumentId,
        quantity: values.quantity,
        price: values.price,
        openingCostBasis: values.openingCostBasis,
        priceSource: "conversion",
        priceProvenance: "",
      },
    ],
    idempotencyKey: key,
    confirmDifference,
  });
  const difference = BigInt(preview?.differenceMinor ?? "0");
  return (
    <Card>
      <CardHeader
        title="Convert to position tracking"
        description="Preview the replacement account before archiving this balance account."
      />
      <ErrorNotice message={error} />
      <form
        className="auth-form"
        onChange={(event) => {
          if (
            (event.target as HTMLElement).getAttribute("name") !==
            "confirmDifference"
          )
            setPreview(undefined);
        }}
        onSubmit={handleSubmit(async (values) => {
          if (!preview) return;
          setError("");
          try {
            const result = await operations.execute(
              input(values, confirmed),
              session.csrfToken,
            );
            onConverted(result.targetAccountId);
          } catch (caught) {
            setError(
              caught instanceof Error
                ? caught.message
                : "The conversion could not be completed.",
            );
          }
        })}
      >
        <div className="form-grid">
          <div>
            <label htmlFor="conversion-name">Replacement account name</label>
            <input id="conversion-name" {...register("targetName")} />
          </div>
          <div>
            <label htmlFor="conversion-date">Conversion date</label>
            <input
              id="conversion-date"
              type="date"
              {...register("conversionDate")}
            />
          </div>
          <div>
            <label htmlFor="conversion-cash">
              Opening cash ({account.currency})
            </label>
            <input
              id="conversion-cash"
              inputMode="decimal"
              {...register("openingCash")}
            />
          </div>
          <div>
            <label htmlFor="conversion-instrument">Instrument</label>
            <select id="conversion-instrument" {...register("instrumentId")}>
              {instruments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.symbol || item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="conversion-quantity">Quantity</label>
            <input
              id="conversion-quantity"
              inputMode="decimal"
              {...register("quantity")}
            />
          </div>
          <div>
            <label htmlFor="conversion-price">Unit price</label>
            <input
              id="conversion-price"
              inputMode="decimal"
              {...register("price")}
            />
          </div>
          <div>
            <label htmlFor="conversion-basis">Opening cost basis</label>
            <input
              id="conversion-basis"
              inputMode="decimal"
              {...register("openingCostBasis")}
            />
          </div>
        </div>
        {preview ? (
          <div className="notice warning" role="status">
            <p>
              Source{" "}
              <MoneyValue
                amount={preview.sourceBalanceMinor}
                currency={preview.currency}
              />{" "}
              · projected{" "}
              <MoneyValue
                amount={preview.projectedTotalMinor}
                currency={preview.currency}
              />{" "}
              · difference{" "}
              <MoneyValue
                amount={preview.differenceMinor}
                currency={preview.currency}
              />
            </p>
            {difference !== 0n ? (
              <label>
                <input type="checkbox" {...register("confirmDifference")} /> I
                reviewed and accept this conversion difference
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="page-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isSubmitting || !instruments.length}
            onClick={() =>
              void handleSubmit(async (values) => {
                setError("");
                try {
                  setPreview(
                    await operations.preview(
                      input(values, false),
                      session.csrfToken,
                    ),
                  );
                } catch (caught) {
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "The conversion preview failed.",
                  );
                }
              })()
            }
          >
            <Eye size={16} /> Preview conversion
          </button>
          <button
            className="primary-button compact"
            disabled={
              isSubmitting || !preview || (difference !== 0n && !confirmed)
            }
          >
            <RefreshCw size={16} /> Convert account
          </button>
        </div>
      </form>
    </Card>
  );
}

export const positionEventTypeSchema = z.enum([
  "opening_position",
  "buy",
  "sell",
  "quantity_adjustment",
]);
const positionSchema = z.object({
  instrumentId: z.string().uuid(),
  type: positionEventTypeSchema,
  quantity: z.string().min(1),
  unitPrice: z.string(),
  tradeCurrency: z.string().regex(/^[A-Z]{3}$/),
  feeAmount: z.string(),
  feeCurrency: z.string(),
  cashEffect: z.string(),
  appliedExchangeRate: z.string(),
  openingCostBasis: z.string(),
  tradeDate: z.iso.date(),
  settlementDate: z.string(),
  externalId: z.string(),
  description: z.string(),
  notes: z.string(),
});

function positionEventValues(event: PositionEvent, accountCurrency: string): z.infer<typeof positionSchema> {
  return {
    instrumentId: event.instrumentId,
    type: positionEventTypeSchema.parse(event.type),
    quantity: event.quantity,
    unitPrice: event.unitPrice ?? "",
    tradeCurrency: event.tradeCurrency,
    feeAmount: event.feeAmountMinor ? minorUnitsToDecimal(event.feeAmountMinor) : "",
    feeCurrency: event.feeCurrency ?? accountCurrency,
    cashEffect: event.cashEffectMinor === "0"
      ? ""
      : minorUnitsToDecimal(event.cashEffectMinor.replace("-", "")),
    appliedExchangeRate: event.appliedExchangeRate ?? "",
    openingCostBasis: event.openingCostBasisMinor ? minorUnitsToDecimal(event.openingCostBasisMinor) : "",
    tradeDate: event.tradeDate,
    settlementDate: event.settlementDate ?? "",
    externalId: event.externalId ?? "",
    description: event.description ?? "",
    notes: event.notes ?? "",
  };
}

export function PositionTools({
  account,
  instruments,
  events,
  reconciliations,
  session,
  onChanged,
  initialEvent,
  initialType = "buy",
  initialInstrumentId,
  operations = {
    createEvent: createPositionEvent,
    updateEvent: updatePositionEvent,
    deleteEvent: deletePositionEvent,
    createReconciliation: createPositionReconciliation,
    deleteReconciliation: deletePositionReconciliation,
  },
}: {
  account: Account;
  instruments: Instrument[];
  events: PositionEvent[];
  reconciliations: PositionReconciliation[];
  session: Session;
  onChanged: () => void;
  initialEvent?: PositionEvent;
  initialType?: z.infer<typeof positionEventTypeSchema>;
  initialInstrumentId?: string;
  operations?: {
    createEvent: typeof createPositionEvent;
    updateEvent: typeof updatePositionEvent;
    deleteEvent: typeof deletePositionEvent;
    createReconciliation: typeof createPositionReconciliation;
    deleteReconciliation: typeof deletePositionReconciliation;
  };
}) {
  const [eventKey, setEventKey] = useState(() => crypto.randomUUID());
  const [eventID, setEventID] = useState(initialEvent?.id ?? "");
  const [error, setError] = useState("");
  const selectedInstrument = initialInstrumentId
    ? instruments.find((instrument) => instrument.id === initialInstrumentId)
    : instruments.find((instrument) => !instrument.archivedAt);
  const blankEvent = {
    instrumentId: selectedInstrument?.id ?? "",
    type: initialType,
    quantity: "",
    unitPrice: "",
    tradeCurrency: selectedInstrument?.quoteCurrency ?? account.currency,
    feeAmount: "0",
    feeCurrency: account.currency,
    cashEffect: "",
    appliedExchangeRate: "",
    openingCostBasis: "",
    tradeDate: today(),
    settlementDate: "",
    externalId: "",
    description: "",
    notes: "",
  };
  const eventForm = useForm<z.infer<typeof positionSchema>>({
    resolver: zodResolver(positionSchema),
    defaultValues: initialEvent
      ? positionEventValues(initialEvent, account.currency)
      : blankEvent,
  });
  const reconciliationSchema = z.object({
    observationDate: z.iso.date(),
    reportedCash: z.string(),
    reportedTotal: z.string().min(1),
    notes: z.string(),
  });
  const reconciliationForm = useForm({
    resolver: zodResolver(reconciliationSchema),
    defaultValues: {
      observationDate: today(),
      reportedCash: "0",
      reportedTotal: "",
      notes: "",
    },
  });
  const eventInput = (
    values: z.infer<typeof positionSchema>,
  ): PositionEventInput => ({
    accountId: account.id,
    ...values,
    idempotencyKey: eventKey,
  });
  const editEvent = (event: PositionEvent) => {
    setEventID(event.id);
    eventForm.reset(positionEventValues(event, account.currency));
  };
  const resetEvent = () => {
    setEventID("");
    setEventKey(crypto.randomUUID());
    eventForm.reset(blankEvent);
  };
  const remove = async (label: string, action: () => Promise<void>) => {
    if (!window.confirm(`Delete this ${label}?`)) return;
    setError("");
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `The ${label} could not be deleted.`,
      );
    }
  };
  return (
    <div className="settings-stack section-block">
      <ErrorNotice message={error} />
      <Card>
        <CardHeader
          title={eventID ? "Edit position event" : "Position event"}
          description="Record or revise a long-only holding event."
        />
        <form
          className="auth-form"
          onSubmit={eventForm.handleSubmit(async (values) => {
            setError("");
            try {
              const result = eventID
                ? await operations.updateEvent(
                    eventID,
                    eventInput(values),
                    session.csrfToken,
                  )
                : await operations.createEvent(
                    eventInput(values),
                    session.csrfToken,
                  );
              if (!result.id) throw new Error("The saved event has no ID.");
              resetEvent();
              onChanged();
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "The position event could not be saved.",
              );
            }
          })}
        >
          <ErrorNotice message={Object.values(eventForm.formState.errors)
            .map((field) => field.message)
            .filter((message): message is string => typeof message === "string")
            .join(" ")} />
          <div className="form-grid">
            <div>
              <label htmlFor="event-instrument">Instrument</label>
              <select
                id="event-instrument"
                {...eventForm.register("instrumentId", {
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                    const instrument = instruments.find((item) => item.id === event.target.value);
                    if (instrument) eventForm.setValue("tradeCurrency", instrument.quoteCurrency);
                  },
                })}
              >
                {instruments.map((item) => (
                  <option key={item.id} value={item.id} disabled={Boolean(item.archivedAt) && initialEvent?.instrumentId !== item.id}>
                    {item.symbol || item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="event-type">Event type</label>
              <select id="event-type" {...eventForm.register("type")}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="opening_position">Opening position</option>
                <option value="quantity_adjustment">Quantity adjustment</option>
              </select>
            </div>
            <div>
              <label htmlFor="event-quantity">Quantity</label>
              <input
                id="event-quantity"
                inputMode="decimal"
                {...eventForm.register("quantity")}
              />
            </div>
            <div>
              <label htmlFor="event-price">Unit price</label>
              <input
                id="event-price"
                inputMode="decimal"
                {...eventForm.register("unitPrice")}
              />
            </div>
            <div>
              <label htmlFor="event-currency">Trade currency</label>
              <input
                id="event-currency"
                maxLength={3}
                {...eventForm.register("tradeCurrency")}
              />
            </div>
            <div>
              <label htmlFor="event-fee">Fee amount</label>
              <input
                id="event-fee"
                inputMode="decimal"
                {...eventForm.register("feeAmount")}
              />
            </div>
            <div>
              <label htmlFor="event-fee-currency">Fee currency</label>
              <input
                id="event-fee-currency"
                maxLength={3}
                {...eventForm.register("feeCurrency")}
              />
            </div>
            <div>
              <label htmlFor="event-cash">Cash effect</label>
              <input
                id="event-cash"
                inputMode="decimal"
                {...eventForm.register("cashEffect")}
              />
            </div>
            <div>
              <label htmlFor="event-rate">Applied exchange rate</label>
              <input
                id="event-rate"
                inputMode="decimal"
                {...eventForm.register("appliedExchangeRate")}
              />
            </div>
            <div>
              <label htmlFor="event-basis">Opening cost basis</label>
              <input
                id="event-basis"
                inputMode="decimal"
                {...eventForm.register("openingCostBasis")}
              />
            </div>
            <div>
              <label htmlFor="event-date">Trade date</label>
              <input
                id="event-date"
                type="date"
                {...eventForm.register("tradeDate")}
              />
            </div>
            <div>
              <label htmlFor="event-settlement">Settlement date</label>
              <input
                id="event-settlement"
                type="date"
                {...eventForm.register("settlementDate")}
              />
            </div>
            <div>
              <label htmlFor="event-external">External ID</label>
              <input
                id="event-external"
                {...eventForm.register("externalId")}
              />
            </div>
            <div>
              <label htmlFor="event-description">Description</label>
              <input
                id="event-description"
                {...eventForm.register("description")}
              />
            </div>
            <div>
              <label htmlFor="event-notes">Notes</label>
              <input id="event-notes" {...eventForm.register("notes")} />
            </div>
          </div>
          <div className="page-actions">
            <button
              className="primary-button compact"
              disabled={eventForm.formState.isSubmitting || !instruments.length}
            >
              <Save size={16} />
              {eventID ? "Update position event" : "Record position event"}
            </button>
            {eventID ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={resetEvent}
                >
                  Cancel edit
                </button>
                <button
                  type="button"
                  className="secondary-button danger-button"
                  onClick={() =>
                    void remove("position event", async () => {
                      await operations.deleteEvent(eventID, session.csrfToken);
                      resetEvent();
                    })
                  }
                >
                  <Trash2 size={16} /> Delete event
                </button>
              </>
            ) : null}
          </div>
        </form>
        <div className="data-list">
          {events.map((event) => {
            const editable =
              !event.eventGroupId &&
              positionEventTypeSchema.safeParse(event.type).success;
            const instrument = instruments.find(
              (item) => item.id === event.instrumentId,
            );
            return (
              <div className="data-row" key={event.id}>
                <div>
                  <strong>
                    {humanize(event.type)} ·{" "}
                    {instrument?.symbol || instrument?.name || "Instrument"}
                  </strong>
                  <span>
                    {event.tradeDate} ·{" "}
                    <PrivateValue>{event.quantity} units</PrivateValue>
                    {event.unitPrice ? (
                      <>
                        {" "}
                        ·{" "}
                        <PrivateValue>
                          {event.tradeCurrency} {event.unitPrice}
                        </PrivateValue>
                      </>
                    ) : null}
                  </span>
                </div>
                {editable ? (
                  <div className="page-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => editEvent(event)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${humanize(event.type)} event from ${event.tradeDate}`}
                      onClick={() =>
                        void remove("position event", () =>
                          operations.deleteEvent(event.id, session.csrfToken),
                        )
                      }
                    >
                      <Trash2 />
                    </button>
                  </div>
                ) : (
                  <span>Managed workflow</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Statement reconciliation"
          description="Compare reported cash and total without changing holdings."
        />
        <form
          className="auth-form"
          onSubmit={reconciliationForm.handleSubmit(async (values) => {
            setError("");
            try {
              const result = await operations.createReconciliation(
                { accountId: account.id, ...values },
                session.csrfToken,
              );
              if (!result.id)
                throw new Error("The saved reconciliation has no ID.");
              reconciliationForm.reset();
              onChanged();
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "The reconciliation could not be saved.",
              );
            }
          })}
        >
          <div className="form-grid">
            <div>
              <label htmlFor="reconciliation-date">Observation date</label>
              <input
                id="reconciliation-date"
                type="date"
                {...reconciliationForm.register("observationDate")}
              />
            </div>
            <div>
              <label htmlFor="reconciliation-cash">Reported cash</label>
              <input
                id="reconciliation-cash"
                inputMode="decimal"
                {...reconciliationForm.register("reportedCash")}
              />
            </div>
            <div>
              <label htmlFor="reconciliation-total">Reported total</label>
              <input
                id="reconciliation-total"
                inputMode="decimal"
                {...reconciliationForm.register("reportedTotal")}
              />
            </div>
            <div>
              <label htmlFor="reconciliation-notes">Notes</label>
              <input
                id="reconciliation-notes"
                {...reconciliationForm.register("notes")}
              />
            </div>
          </div>
          <div className="page-actions">
            <button
              className="primary-button compact"
              disabled={reconciliationForm.formState.isSubmitting}
            >
              <Plus size={16} /> Save reconciliation
            </button>
          </div>
        </form>
        <div className="data-list">
          {reconciliations.map((item) => (
            <div className="data-row" key={item.id}>
              <div>
                <strong>{item.observationDate}</strong>
                <span>{item.notes || "Statement reconciliation"}</span>
              </div>
              <div className="page-actions">
                <MoneyValue
                  amount={item.reportedTotalMinor}
                  currency={account.currency}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete reconciliation from ${item.observationDate}`}
                  onClick={() =>
                    void remove("reconciliation", () =>
                      operations.deleteReconciliation(
                        item.id,
                        session.csrfToken,
                      ),
                    )
                  }
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
