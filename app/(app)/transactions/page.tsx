import Link from "next/link";
import { ArrowLeftRight, Edit3, Plus, Trash2 } from "lucide-react";

import { deleteTransactionAction } from "@/app/(app)/actions";
import { MoneyValue } from "@/components/privacy-provider";
import { MutationButton } from "@/components/mutation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { TRANSACTION_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { getSettings } from "@/lib/bootstrap";
import { listTransactions } from "@/lib/services/accounts";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const [rows, settings] = await Promise.all([listTransactions(), getSettings()]);
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Contributions, withdrawals, income, gains, fees, and transfers."
        actions={<Button asChild><Link href="/transactions/new"><Plus size={17} />Record transaction</Link></Button>}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight size={24} />}
          title="No activity yet"
          description="Record your first deposit, valuation, or transfer."
          action={<Button asChild><Link href="/transactions/new">Record activity</Link></Button>}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-white/[0.06]">
              {rows.map((transaction) => {
                const negative = ["withdrawal", "capital_loss", "fee", "sale", "liability_payment"].includes(transaction.type) || transaction.amountMinor < 0;
                return (
                  <div key={transaction.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={negative ? "h-2 w-2 shrink-0 rounded-full bg-red-400" : "h-2 w-2 shrink-0 rounded-full bg-emerald-400"} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-100">{TRANSACTION_LABELS[transaction.type]}</p>
                          {transaction.type === "transfer" ? <Badge tone="info">Transfer</Badge> : null}
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          <Link href={`/accounts/${transaction.accountId}`} className="hover:text-emerald-300">{transaction.accountName}</Link>
                          {" · "}{formatDate(transaction.transactionDate, settings.timezone, settings.preferredDateFormat)}
                          {transaction.description ? ` · ${transaction.description}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <MoneyValue
                        amount={transaction.amountMinor}
                        currency={transaction.currency}
                        className={negative ? "font-medium text-red-300" : "font-medium text-emerald-300"}
                      />
                      {transaction.type !== "opening_balance" && transaction.type !== "transfer" ? (
                        <Button asChild variant="ghost" size="icon" aria-label="Edit transaction">
                          <Link href={`/transactions/${transaction.id}/edit`}><Edit3 size={15} /></Link>
                        </Button>
                      ) : null}
                      {transaction.type !== "opening_balance" ? (
                        <MutationButton
                          action={deleteTransactionAction.bind(null, transaction.id)}
                          confirm={transaction.type === "transfer" ? "Delete both sides of this transfer?" : "Delete this transaction?"}
                          successMessage="Transaction deleted."
                          variant="ghost"
                          size="icon"
                          aria-label="Delete transaction"
                        ><Trash2 size={15} /></MutationButton>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
