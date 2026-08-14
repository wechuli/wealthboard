import Link from "next/link";
import { Edit3, Plus, Trash2 } from "lucide-react";

import {
  deletePositionEventAction,
  deletePositionReconciliationAction,
  deleteSecurityPriceAction,
} from "@/app/(app)/actions";
import { MutationButton } from "@/components/mutation-button";
import { MoneyValue, SensitiveValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import {
  getPositionAccountSnapshot,
  listInvestmentInstruments,
  listPositionEvents,
  listPositionReconciliations,
  listSecurityPrices,
} from "@/lib/services/investments";

const EVENT_LABELS = {
  opening_position: "Opening position",
  buy: "Buy",
  sell: "Sell",
  quantity_adjustment: "Quantity adjustment",
} as const;

export function PositionAccountDetails({
  userId,
  accountId,
  currency,
  timezone,
  dateFormat,
}: {
  userId: string;
  accountId: string;
  currency: string;
  timezone: string;
  dateFormat: string;
}) {
  const snapshot = getPositionAccountSnapshot(userId, accountId);
  const instruments = listInvestmentInstruments(userId, {
    includeArchived: true,
  });
  const instrumentIds = [
    ...new Set([
      ...snapshot.positions.map((position) => position.instrument.id),
      ...listPositionEvents(userId, accountId).map(
        (event) => event.instrumentId,
      ),
    ]),
  ];
  const events = listPositionEvents(userId, accountId).sort(
    (left, right) =>
      right.tradeDate.localeCompare(left.tradeDate) ||
      right.createdAt.localeCompare(left.createdAt),
  );
  const prices = listSecurityPrices(userId, instrumentIds).sort(
    (left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate) ||
      right.createdAt.localeCompare(left.createdAt),
  );
  const reconciliations = listPositionReconciliations(userId, accountId).sort(
    (left, right) => right.observationDate.localeCompare(left.observationDate),
  );
  const instrumentById = new Map(
    instruments.map((instrument) => [instrument.id, instrument]),
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PositionMetric
          label="Current value"
          amount={snapshot.totalMinor}
          currency={currency}
          primary
        />
        <PositionMetric
          label="Cash"
          amount={snapshot.cashMinor}
          currency={currency}
        />
        <PositionMetric
          label="Positions"
          amount={snapshot.positionsMinor}
          currency={currency}
        />
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
            Data quality
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={snapshot.complete ? "positive" : "warning"}>
              {snapshot.complete ? "Complete" : "Incomplete"}
            </Badge>
            {snapshot.staleInstrumentIds.length ? (
              <Badge tone="warning">
                {snapshot.staleInstrumentIds.length} stale
              </Badge>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Positions</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Current quantities valued with the latest effective price.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={`/accounts/${accountId}/positions/new`}>
              <Plus size={15} />
              Add holding
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {!snapshot.positions.length ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No positions recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="pb-3 font-medium">Instrument</th>
                    <th className="pb-3 font-medium">Quantity</th>
                    <th className="pb-3 font-medium">Unit price</th>
                    <th className="pb-3 font-medium">As of</th>
                    <th className="pb-3 text-right font-medium">Value</th>
                    <th className="pb-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {snapshot.positions.map((position) => (
                    <tr key={position.instrument.id}>
                      <td className="py-3">
                        <p className="font-medium text-slate-100">
                          {position.instrument.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {position.instrument.symbol || "No symbol"} ·{" "}
                          {position.instrument.quoteCurrency}
                        </p>
                      </td>
                      <td className="py-3">
                        <SensitiveValue>{position.quantity}</SensitiveValue>
                      </td>
                      <td className="py-3">
                        {position.price ? (
                          <SensitiveValue>
                            {position.price.currency} {position.price.price}
                          </SensitiveValue>
                        ) : (
                          <Badge tone="warning">Missing</Badge>
                        )}
                      </td>
                      <td className="py-3 text-slate-400">
                        {position.price
                          ? formatDate(
                              position.price.effectiveDate,
                              timezone,
                              dateFormat,
                            )
                          : "No price"}
                        {position.stale ? (
                          <Badge className="ml-2" tone="warning">
                            Stale
                          </Badge>
                        ) : null}
                      </td>
                      <td className="py-3 text-right font-medium">
                        {position.accountValueMinor == null ? (
                          <span className="text-amber-300">Incomplete</span>
                        ) : (
                          <MoneyValue
                            amount={position.accountValueMinor}
                            currency={currency}
                          />
                        )}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label={`Update ${position.instrument.name} price`}
                        >
                          <Link
                            href={`/accounts/${accountId}/prices/new?instrumentId=${position.instrument.id}`}
                          >
                            <Edit3 size={15} />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Position activity</CardTitle>
          </CardHeader>
          <CardContent>
            {!events.length ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No position activity.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {events.map((event) => {
                  const instrument = instrumentById.get(event.instrumentId);
                  return (
                    <div
                      key={event.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-200">
                          {EVENT_LABELS[event.type]} ·{" "}
                          {instrument?.symbol ||
                            instrument?.name ||
                            "Instrument"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(event.tradeDate, timezone, dateFormat)} ·{" "}
                          <SensitiveValue>
                            {event.quantity} units
                          </SensitiveValue>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {event.cashEffectMinor ? (
                          <MoneyValue
                            amount={event.cashEffectMinor}
                            currency={currency}
                            className="text-sm"
                          />
                        ) : null}
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label="Edit position event"
                        >
                          <Link
                            href={`/accounts/${accountId}/positions/${event.id}/edit`}
                          >
                            <Edit3 size={15} />
                          </Link>
                        </Button>
                        <MutationButton
                          action={deletePositionEventAction.bind(
                            null,
                            event.id,
                          )}
                          confirm="Delete this position event? Quantities, cash, and later values will be replayed."
                          successMessage="Position event deleted."
                          variant="ghost"
                          size="icon"
                          aria-label="Delete position event"
                        >
                          <Trash2 size={15} />
                        </MutationButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Price history</CardTitle>
          </CardHeader>
          <CardContent>
            {!prices.length ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No prices recorded.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {prices.map((price) => {
                  const instrument = instrumentById.get(price.instrumentId);
                  return (
                    <div
                      key={price.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {instrument?.symbol ||
                            instrument?.name ||
                            "Instrument"}{" "}
                          ·{" "}
                          <SensitiveValue>
                            {price.currency} {price.price}
                          </SensitiveValue>
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(
                            price.effectiveDate,
                            timezone,
                            dateFormat,
                          )}{" "}
                          · {price.source}
                        </p>
                      </div>
                      <MutationButton
                        action={deleteSecurityPriceAction.bind(null, price.id)}
                        confirm="Delete this price? Current and historical values may become incomplete."
                        successMessage="Price deleted."
                        variant="ghost"
                        size="icon"
                        aria-label="Delete security price"
                      >
                        <Trash2 size={15} />
                      </MutationButton>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {reconciliations.length ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Statement reconciliations</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-white/[0.06]">
            {reconciliations.map((reconciliation) => {
              const calculated = getPositionAccountSnapshot(
                userId,
                accountId,
                reconciliation.observationDate,
              );
              return (
                <div
                  key={reconciliation.id}
                  className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                >
                  <span className="text-sm text-slate-400">
                    {formatDate(
                      reconciliation.observationDate,
                      timezone,
                      dateFormat,
                    )}
                  </span>
                  <MoneyValue
                    amount={reconciliation.reportedTotalMinor}
                    currency={currency}
                  />
                  <MoneyValue
                    amount={calculated.totalMinor}
                    currency={currency}
                  />
                  <MoneyValue
                    amount={
                      BigInt(reconciliation.reportedTotalMinor) -
                      calculated.totalMinor
                    }
                    currency={currency}
                  />
                  <MutationButton
                    action={deletePositionReconciliationAction.bind(
                      null,
                      reconciliation.id,
                    )}
                    confirm="Delete this reconciliation observation? Holdings and values will not change."
                    successMessage="Reconciliation deleted."
                    variant="ghost"
                    size="icon"
                    aria-label="Delete reconciliation"
                  >
                    <Trash2 size={15} />
                  </MutationButton>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function PositionMetric({
  label,
  amount,
  currency,
  primary,
}: {
  label: string;
  amount: number | bigint;
  currency: string;
  primary?: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <MoneyValue
        amount={amount}
        currency={currency}
        className={
          primary
            ? "mt-3 block text-2xl font-semibold text-white"
            : "mt-3 block text-xl font-semibold text-slate-100"
        }
      />
    </Card>
  );
}
