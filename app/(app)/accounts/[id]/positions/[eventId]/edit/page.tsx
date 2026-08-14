import { notFound } from "next/navigation";

import { updatePositionEventAction } from "@/app/(app)/actions";
import { PositionEventForm } from "@/components/forms/investment-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { utcToDateInput } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";
import { getAccount } from "@/lib/services/accounts";
import {
  getPositionEvent,
  listInvestmentInstruments,
} from "@/lib/services/investments";
import { getCurrencyConfiguration } from "@/lib/services/settings";

export default async function EditPositionEventPage({
  params,
}: {
  params: Promise<{ id: string; eventId: string }>;
}) {
  const { userId } = await requireSession();
  const { id, eventId } = await params;
  const [account, event, instruments, currencies] = await Promise.all([
    getAccount(userId, id),
    getPositionEvent(userId, eventId),
    listInvestmentInstruments(userId, { includeArchived: true }),
    getCurrencyConfiguration(userId),
  ]);
  if (
    !account ||
    account.trackingMode !== "positions" ||
    account.archivedAt ||
    !event ||
    event.accountId !== id
  ) {
    notFound();
  }
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Correct position activity"
        description="Every later quantity, cash balance, and account value will be replayed."
      />
      <Card>
        <CardHeader>
          <CardTitle>Position correction</CardTitle>
        </CardHeader>
        <CardContent>
          <PositionEventForm
            action={updatePositionEventAction.bind(null, eventId)}
            accountId={id}
            accountCurrency={account.currency}
            instruments={instruments}
            currencies={currencies.enabledCurrencies}
            today={utcToDateInput(event.tradeDate)}
            initialInstrumentId={event.instrumentId}
            initialType={event.type}
            initial={{
              accountId: id,
              instrumentId: event.instrumentId,
              type: event.type,
              quantity: event.quantity,
              unitPrice: event.unitPrice || undefined,
              tradeCurrency: event.tradeCurrency,
              feeAmount:
                event.feeAmountMinor == null || !event.feeCurrency
                  ? undefined
                  : minorToDecimalString(
                      event.feeAmountMinor,
                      event.feeCurrency,
                    ),
              feeCurrency: event.feeCurrency || undefined,
              cashEffect:
                event.cashEffectMinor === 0
                  ? undefined
                  : minorToDecimalString(
                      Math.abs(event.cashEffectMinor),
                      account.currency,
                    ),
              appliedExchangeRate: event.appliedExchangeRate || undefined,
              openingCostBasis:
                event.openingCostBasisMinor == null
                  ? undefined
                  : minorToDecimalString(
                      event.openingCostBasisMinor,
                      account.currency,
                    ),
              tradeDate: utcToDateInput(event.tradeDate),
              settlementDate: event.settlementDate
                ? utcToDateInput(event.settlementDate)
                : undefined,
              externalId: event.externalId || undefined,
              eventGroupId: event.eventGroupId || undefined,
              idempotencyKey: event.idempotencyKey || crypto.randomUUID(),
              description: event.description || undefined,
              notes: event.notes || undefined,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
