import { createStandaloneInvestmentInstrumentAction } from "@/app/(app)/actions";
import { InvestmentInstrumentForm } from "@/components/forms/investment-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getCurrencyConfiguration } from "@/lib/services/settings";

export const metadata = { title: "Add instrument" };

export default async function NewInstrumentPage() {
  const { userId } = await requireSession();
  const currencies = getCurrencyConfiguration(userId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add instrument"
        description="Create a security reference that can be used by any position account."
      />
      <Card>
        <CardHeader>
          <CardTitle>Instrument details</CardTitle>
        </CardHeader>
        <CardContent>
          <InvestmentInstrumentForm
            action={createStandaloneInvestmentInstrumentAction}
            currencies={currencies.enabledCurrencies}
            baseCurrency={currencies.baseCurrency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
