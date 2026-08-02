import { TransactionForm } from "@/components/forms/transaction-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { transactionAction } from "@/app/(app)/actions";
import { listAccounts } from "@/lib/services/accounts";
import { TRANSACTION_LABELS } from "@/lib/constants";
import type { TransactionType } from "@/db/schema";
import { getSettings } from "@/lib/bootstrap";
import { dateInputForTimezone } from "@/lib/dates";

export const metadata = { title: "Record activity" };

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; accountId?: string }>;
}) {
  const query = await searchParams;
  const [accountRows, settings] = await Promise.all([listAccounts(), getSettings()]);
  const type =
    query.type && query.type in TRANSACTION_LABELS && query.type !== "opening_balance"
      ? (query.type as TransactionType)
      : "deposit";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Record activity" description="Balances are recalculated from transaction and valuation history." />
      <Card>
        <CardHeader><CardTitle>{type === "transfer" ? "Transfer between accounts" : TRANSACTION_LABELS[type]}</CardTitle></CardHeader>
        <CardContent>
          <TransactionForm
            accounts={type === "transfer" ? accountRows.filter((account) => !account.isLiability) : accountRows}
            action={transactionAction}
            idempotencyKey={crypto.randomUUID()}
            initial={query.type || query.accountId ? { type, accountId: query.accountId } : undefined}
            today={dateInputForTimezone(settings.timezone)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
