import Link from "next/link";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Download,
  Edit3,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import { deleteTransactionAction } from "@/app/(app)/actions";
import { MoneyValue } from "@/components/privacy-provider";
import { MutationButton } from "@/components/mutation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form-controls";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { transactionTypes } from "@/db/schema";
import { TRANSACTION_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { getSettings } from "@/lib/bootstrap";
import {
  listAccounts,
  listTransactionPage,
  TRANSACTION_PAGE_SIZE,
} from "@/lib/services/accounts";
import { requireSession } from "@/lib/auth/session";
import {
  parseTransactionListQuery,
  type TransactionListQuery,
} from "@/lib/validation";

export const metadata = { title: "Transactions" };

function filterSearchParams(params: TransactionListQuery) {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.accountId) searchParams.set("accountId", params.accountId);
  if (params.type) searchParams.set("type", params.type);
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  if (params.flow) searchParams.set("flow", params.flow);
  searchParams.set("sort", params.sort);
  return searchParams;
}

function pageHref(
  params: TransactionListQuery,
  cursor: string,
  page: "next" | "previous",
) {
  const searchParams = filterSearchParams(params);
  searchParams.set("cursor", cursor);
  searchParams.set("page", page);
  return `/transactions?${searchParams.toString()}`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireSession();
  const params = parseTransactionListQuery(await searchParams);
  const [{ rows, previousCursor, nextCursor }, settings, accountOptions] =
    await Promise.all([
      listTransactionPage(userId, params),
      getSettings(userId),
      listAccounts(userId, { includeArchived: true }),
    ]);
  const exportParams = filterSearchParams(params);
  const hasFilters = Boolean(
    params.q ||
    params.accountId ||
    params.type ||
    params.from ||
    params.to ||
    params.flow,
  );

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Contributions, withdrawals, income, gains, fees, and transfers."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <a
                href={`/api/export/transactions.csv?${exportParams.toString()}`}
              >
                <Download size={17} />
                Export CSV
              </a>
            </Button>
            <Button asChild>
              <Link href="/transactions/new">
                <Plus size={17} />
                Record transaction
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search
              className="absolute left-3 top-3.5 text-slate-500"
              size={16}
            />
            <Input
              name="q"
              defaultValue={params.q}
              placeholder="Search descriptions, notes, or accounts"
              className="pl-9"
              aria-label="Search transactions"
            />
          </div>
          <Select
            name="accountId"
            defaultValue={params.accountId ?? ""}
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.archivedAt ? " (archived)" : ""}
              </option>
            ))}
          </Select>
          <Select
            name="type"
            defaultValue={params.type ?? ""}
            aria-label="Filter by transaction type"
          >
            <option value="">All transaction types</option>
            {transactionTypes.map((type) => (
              <option key={type} value={type}>
                {TRANSACTION_LABELS[type]}
              </option>
            ))}
          </Select>
          <Select
            name="flow"
            defaultValue={params.flow ?? ""}
            aria-label="Filter by amount direction"
          >
            <option value="">All amount directions</option>
            <option value="inflow">Money in</option>
            <option value="outflow">Money out</option>
          </Select>
          <Select
            name="sort"
            defaultValue={params.sort}
            aria-label="Sort transactions"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
          <div>
            <Label htmlFor="transaction-from">From date</Label>
            <Input
              id="transaction-from"
              name="from"
              type="date"
              defaultValue={params.from}
            />
          </div>
          <div>
            <Label htmlFor="transaction-to">To date</Label>
            <Input
              id="transaction-to"
              name="to"
              type="date"
              defaultValue={params.to}
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm">
              <SlidersHorizontal size={15} />
              Apply filters
            </Button>
            <Button asChild type="button" variant="ghost" size="sm">
              <Link href="/transactions">
                <RotateCcw size={15} />
                Clear
              </Link>
            </Button>
          </div>
        </form>
      </div>

      {rows.length === 0 && !hasFilters && !params.cursor ? (
        <EmptyState
          icon={<ArrowLeftRight size={24} />}
          title="No activity yet"
          description="Record your first deposit, valuation, or transfer."
          action={
            <Button asChild>
              <Link href="/transactions/new">Record activity</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
          <p className="text-sm text-slate-300">
            No transactions match these filters.
          </p>
          <Button asChild variant="ghost" size="sm" className="mt-3">
            <Link href="/transactions">
              <RotateCcw size={15} />
              Clear filters
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-white/[0.06]">
                {rows.map((transaction) => {
                  const negative =
                    [
                      "withdrawal",
                      "capital_loss",
                      "fee",
                      "sale",
                      "liability_payment",
                    ].includes(transaction.type) || transaction.amountMinor < 0;
                  return (
                    <div
                      key={transaction.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={
                            negative
                              ? "h-2 w-2 shrink-0 rounded-full bg-red-400"
                              : "h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                          }
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-slate-100">
                              {TRANSACTION_LABELS[transaction.type]}
                            </p>
                            {transaction.type === "transfer" ? (
                              <Badge tone="info">Transfer</Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-slate-500">
                            <Link
                              href={`/accounts/${transaction.accountId}`}
                              className="hover:text-emerald-300"
                            >
                              {transaction.accountName}
                            </Link>
                            {" · "}
                            {formatDate(
                              transaction.transactionDate,
                              settings.timezone,
                              settings.preferredDateFormat,
                            )}
                            {transaction.description
                              ? ` · ${transaction.description}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        <MoneyValue
                          amount={transaction.amountMinor}
                          currency={transaction.currency}
                          className={
                            negative
                              ? "font-medium text-red-300"
                              : "font-medium text-emerald-300"
                          }
                        />
                        {transaction.type !== "opening_balance" &&
                        transaction.type !== "transfer" ? (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            aria-label="Edit transaction"
                          >
                            <Link href={`/transactions/${transaction.id}/edit`}>
                              <Edit3 size={15} />
                            </Link>
                          </Button>
                        ) : null}
                        {transaction.type !== "opening_balance" ? (
                          <MutationButton
                            action={deleteTransactionAction.bind(
                              null,
                              transaction.id,
                            )}
                            confirm={
                              transaction.type === "transfer"
                                ? "Delete both sides of this transfer?"
                                : "Delete this transaction?"
                            }
                            successMessage="Transaction deleted."
                            variant="ghost"
                            size="icon"
                            aria-label="Delete transaction"
                          >
                            <Trash2 size={15} />
                          </MutationButton>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <div className="mt-4 flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing {rows.length} of up to {TRANSACTION_PAGE_SIZE}{" "}
              transactions on this page.
            </p>
            <div className="flex gap-2">
              {previousCursor ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(params, previousCursor, "previous")}>
                    <ArrowLeft size={15} />
                    Previous
                  </Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  <ArrowLeft size={15} />
                  Previous
                </Button>
              )}
              {nextCursor ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(params, nextCursor, "next")}>
                    Next
                    <ArrowRight size={15} />
                  </Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Next
                  <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
