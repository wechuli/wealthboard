import { notFound } from "next/navigation";

import { updateTransactionAction } from "@/app/(app)/actions";
import { TransactionForm } from "@/components/forms/transaction-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { utcToDateInput } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";
import { getTransaction, listAccounts } from "@/lib/services/accounts";
import { requireSession } from "@/lib/auth/session";

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireSession();
  const { id } = await params;
  const [transaction, accountRows] = await Promise.all([
    getTransaction(userId, id),
    listAccounts(userId),
  ]);
  if (!transaction || transaction.type === "opening_balance" || transaction.type === "transfer") notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit transaction" description="Saving will replay this account’s complete history." />
      <Card>
        <CardHeader><CardTitle>Transaction details</CardTitle></CardHeader>
        <CardContent>
          <TransactionForm
            accounts={accountRows}
            action={updateTransactionAction.bind(null, id)}
            idempotencyKey={transaction.idempotencyKey || crypto.randomUUID()}
            initial={{
              id,
              accountId: transaction.accountId,
              type: transaction.type,
              amount: minorToDecimalString(
                transaction.type === "manual_adjustment"
                  ? transaction.amountMinor
                  : Math.abs(transaction.amountMinor),
                transaction.currency,
              ),
              transactionDate: utcToDateInput(transaction.transactionDate),
              description: transaction.description || "",
              notes: transaction.notes || "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
