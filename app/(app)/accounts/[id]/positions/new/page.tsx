import Link from "next/link";
import { notFound } from "next/navigation";

import { recordPositionEventAction } from "@/app/(app)/actions";
import { PositionEventForm } from "@/components/forms/investment-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { dateInputForTimezone } from "@/lib/dates";
import { getSettings } from "@/lib/bootstrap";
import { getAccount } from "@/lib/services/accounts";
import { listInvestmentInstruments } from "@/lib/services/investments";
import { getCurrencyConfiguration } from "@/lib/services/settings";

export default async function NewPositionEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ instrumentId?: string; type?: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const [account, instruments, settings, currencies] = await Promise.all([
    getAccount(userId, id),
    listInvestmentInstruments(userId),
    getSettings(userId),
    getCurrencyConfiguration(userId),
  ]);
  if (!account || account.trackingMode !== "positions" || account.archivedAt)
    notFound();
  const type = [
    "opening_position",
    "buy",
    "sell",
    "quantity_adjustment",
  ].includes(query.type ?? "")
    ? (query.type as
        | "opening_position"
        | "buy"
        | "sell"
        | "quantity_adjustment")
    : "opening_position";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={
          type === "opening_position"
            ? "Add holding"
            : "Record position activity"
        }
        description={`Update quantities and account cash for ${account.name}.`}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/accounts/${id}/instruments/new`}>New instrument</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Position activity</CardTitle>
        </CardHeader>
        <CardContent>
          {instruments.length ? (
            <PositionEventForm
              action={recordPositionEventAction}
              accountId={id}
              accountCurrency={account.currency}
              instruments={instruments}
              currencies={currencies.enabledCurrencies}
              today={dateInputForTimezone(settings.timezone)}
              initialInstrumentId={query.instrumentId}
              initialType={type}
            />
          ) : (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-400">
                Create an instrument before adding a holding.
              </p>
              <Button asChild className="mt-4">
                <Link href={`/accounts/${id}/instruments/new`}>
                  Create instrument
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
