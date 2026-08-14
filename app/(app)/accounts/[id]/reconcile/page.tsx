import { notFound } from "next/navigation";

import { recordPositionReconciliationAction } from "@/app/(app)/actions";
import { PositionReconciliationForm } from "@/components/forms/investment-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/bootstrap";
import { dateInputForTimezone } from "@/lib/dates";
import { getAccount } from "@/lib/services/accounts";

export default async function ReconcilePositionAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const [account, settings] = await Promise.all([
    getAccount(userId, id),
    getSettings(userId),
  ]);
  if (!account || account.trackingMode !== "positions" || account.archivedAt)
    notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Reconcile statement"
        description="Compare a broker-reported total without changing holdings or prices."
      />
      <Card>
        <CardHeader>
          <CardTitle>Statement observation</CardTitle>
        </CardHeader>
        <CardContent>
          <PositionReconciliationForm
            action={recordPositionReconciliationAction}
            accountId={id}
            accountCurrency={account.currency}
            today={dateInputForTimezone(settings.timezone)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
