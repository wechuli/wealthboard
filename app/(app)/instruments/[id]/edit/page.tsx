import { notFound } from "next/navigation";

import { updateInvestmentInstrumentAction } from "@/app/(app)/actions";
import { InvestmentInstrumentForm } from "@/components/forms/investment-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getInvestmentInstrument } from "@/lib/services/investments";
import { getCurrencyConfiguration } from "@/lib/services/settings";

export default async function EditInstrumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const [instrument, currencies] = await Promise.all([
    getInvestmentInstrument(userId, id),
    getCurrencyConfiguration(userId),
  ]);
  if (!instrument) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${instrument.name}`}
        description="Source identity and quote settings for this instrument."
      />
      <Card>
        <CardHeader>
          <CardTitle>Instrument details</CardTitle>
        </CardHeader>
        <CardContent>
          <InvestmentInstrumentForm
            action={updateInvestmentInstrumentAction.bind(null, id)}
            currencies={currencies.enabledCurrencies}
            baseCurrency={instrument.quoteCurrency}
            initial={{
              externalId: instrument.externalId || undefined,
              name: instrument.name,
              symbol: instrument.symbol || undefined,
              identifierType: instrument.identifierType,
              identifier: instrument.identifier || undefined,
              exchangeMic: instrument.exchangeMic || undefined,
              assetType: instrument.assetType,
              quoteCurrency: instrument.quoteCurrency,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
