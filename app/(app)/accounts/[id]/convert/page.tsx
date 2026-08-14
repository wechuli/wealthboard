import { notFound } from "next/navigation";

import {
  convertAccountToPositionsAction,
  previewAccountConversionAction,
} from "@/app/(app)/actions";
import { AccountConversionForm } from "@/components/forms/account-conversion-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { dateInputForTimezone } from "@/lib/dates";
import { getAccount } from "@/lib/services/accounts";
import { listInvestmentInstruments } from "@/lib/services/investments";
import { getSettings } from "@/lib/bootstrap";

export default async function ConvertAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ instrumentId?: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const [account, instruments, settings] = await Promise.all([
    getAccount(userId, id),
    listInvestmentInstruments(userId),
    getSettings(userId),
  ]);
  if (
    !account ||
    account.archivedAt ||
    account.isLiability ||
    !account.categoryIsInvestible ||
    account.trackingMode !== "balance"
  ) {
    notFound();
  }
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Convert to position tracking"
        description={`Preserve ${account.name} as archived history and create an explicit cash-and-holdings replacement.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Conversion preview</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountConversionForm
            previewAction={previewAccountConversionAction}
            convertAction={convertAccountToPositionsAction}
            sourceAccount={{
              id: account.id,
              name: account.name,
              currency: account.currency,
              currentValueMinor: account.currentValueMinor,
            }}
            instruments={instruments}
            today={dateInputForTimezone(settings.timezone)}
            initialInstrumentId={query.instrumentId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
