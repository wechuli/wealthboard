import { notFound } from "next/navigation";

import { setSecurityPriceAction } from "@/app/(app)/actions";
import { SecurityPriceForm } from "@/components/forms/investment-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/bootstrap";
import { dateInputForTimezone } from "@/lib/dates";
import { getAccount } from "@/lib/services/accounts";
import { getPositionAccountSnapshot } from "@/lib/services/investments";

export default async function NewSecurityPricePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ instrumentId?: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const [account, settings] = await Promise.all([
    getAccount(userId, id),
    getSettings(userId),
  ]);
  if (!account || account.trackingMode !== "positions" || account.archivedAt)
    notFound();
  const snapshot = getPositionAccountSnapshot(userId, id);
  const instruments = snapshot.positions.map((position) => position.instrument);
  if (!instruments.length) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Update security price"
        description={`Record an effective-dated price for ${account.name}.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Price observation</CardTitle>
        </CardHeader>
        <CardContent>
          <SecurityPriceForm
            action={setSecurityPriceAction}
            accountId={id}
            instruments={instruments}
            today={dateInputForTimezone(settings.timezone)}
            initialInstrumentId={query.instrumentId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
