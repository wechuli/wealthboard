import { notFound } from "next/navigation";

import { valuationAction } from "@/app/(app)/actions";
import { ValuationForm } from "@/components/forms/valuation-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { minorToDecimalString } from "@/lib/money";
import { getAccount } from "@/lib/services/accounts";
import { getSettings } from "@/lib/bootstrap";
import { dateInputForTimezone } from "@/lib/dates";

export default async function ValuationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [account, settings] = await Promise.all([getAccount(id), getSettings()]);
  if (!account) notFound();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Update asset value" description={`Record a point-in-time valuation for ${account.name}. This is not counted as a contribution.`} />
      <Card>
        <CardHeader><CardTitle>New valuation</CardTitle></CardHeader>
        <CardContent>
          <ValuationForm
            accountId={id}
            currency={account.currency}
            currentValue={minorToDecimalString(account.currentValueMinor, account.currency)}
            action={valuationAction}
            idempotencyKey={crypto.randomUUID()}
            today={dateInputForTimezone(settings.timezone)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
