import { notFound } from "next/navigation";

import { createInvestmentInstrumentAction } from "@/app/(app)/actions";
import { InvestmentInstrumentForm } from "@/components/forms/investment-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getAccount } from "@/lib/services/accounts";
import { getCurrencyConfiguration } from "@/lib/services/settings";

export default async function NewInstrumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const [account, currencies] = await Promise.all([
    getAccount(userId, id),
    getCurrencyConfiguration(userId),
  ]);
  if (!account || account.trackingMode !== "positions" || account.archivedAt)
    notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add instrument"
        description={`Create a security reference for ${account.name}.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Instrument details</CardTitle>
        </CardHeader>
        <CardContent>
          <InvestmentInstrumentForm
            action={createInvestmentInstrumentAction.bind(null, id)}
            currencies={currencies.enabledCurrencies}
            baseCurrency={account.currency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
