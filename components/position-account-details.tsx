import Link from "next/link";
import { Edit3, Plus, Trash2 } from "lucide-react";

import {
  deletePositionEventAction,
  deletePositionReconciliationAction,
  deleteSecurityPriceAction,
  deleteTransactionAction,
} from "@/app/(app)/actions";
import { MutationButton } from "@/components/mutation-button";
import { MoneyValue, SensitiveValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TRANSACTION_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import {
  getPositionAccountSnapshot,
  listInvestmentInstruments,
  listPositionCashTransactions,
  listPositionEvents,
  listPositionReconciliations,
  listSecurityPrices,
} from "@/lib/services/investments";

const EVENT_LABELS = {
  opening_position: "Opening position",
  buy: "Buy",
  sell: "Sell",
  quantity_adjustment: "Quantity adjustment",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  split: "Stock split",
  spinoff: "Spin-off",
  merger_in: "Merger received",
  merger_out: "Merger surrendered",
} as const;

const EDITABLE_EVENT_TYPES = new Set<string>([
  "opening_position",
  "buy",
  "sell",
  "quantity_adjustment",
]);

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
  const events = listPositionEvents(userId, accountId);
  const instrumentIds = [
    ...new Set([
      ...snapshot.positions.map((position) => position.instrument.id),
      ...events.map((event) => event.instrumentId),
    ]),
  ];
  const prices = listSecurityPrices(userId, instrumentIds);
  const cashTransactions = listPositionCashTransactions(userId, accountId);
  const reconciliations = listPositionReconciliations(userId, accountId).sort(
    (left, right) => right.observationDate.localeCompare(left.observationDate),
  );
  const instrumentById = new Map(
    instruments.map((instrument) => [instrument.id, instrument]),
  );
  const activity = [
    ...events.map((event) => ({
      kind: "position" as const,
      date: event.tradeDate,
      createdAt: event.createdAt,
      event,
    })),
    ...prices.map((price) => ({
      kind: "price" as const,
      date: price.effectiveDate,
      createdAt: price.createdAt,
      price,
    })),
    ...cashTransactions.map((transaction) => ({
      kind: "cash" as const,
      date: transaction.transactionDate,
      createdAt: transaction.createdAt,
      transaction,
    })),
  ].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.createdAt.localeCompare(left.createdAt),
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

      {snapshot.issues.length ? (
        <div className="mt-4 space-y-2">
          {snapshot.issues.map((issue) => (
            <div
              key={`${issue.type}-${issue.instrumentId}`}
              className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3"
            >
              <p className="text-sm font-medium text-amber-200">
                {issue.instrumentSymbol || issue.instrumentName} ·{" "}
                {issue.type.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {issue.currency} · affected{" "}
                {formatDate(issue.affectedFrom, timezone, dateFormat)} to{" "}
                {formatDate(issue.affectedTo, timezone, dateFormat)}
                {issue.lastPriceDate
                  ? ` · last price ${formatDate(issue.lastPriceDate, timezone, dateFormat)}`
                  : ""}
                {issue.source ? ` · ${issue.source}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}

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

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Investment activity</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Cash, position, corporate-action, and price source records in one
              timeline.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {!activity.length ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No investment activity.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {activity.map((item) => {
                if (item.kind === "position") {
                  return (
                    <PositionActivityRow
                      key={`position-${item.event.id}`}
                      accountId={accountId}
                      currency={currency}
                      timezone={timezone}
                      dateFormat={dateFormat}
                      event={item.event}
                      instrumentName={
                        instrumentById.get(item.event.instrumentId)?.symbol ||
                        instrumentById.get(item.event.instrumentId)?.name ||
                        "Instrument"
                      }
                    />
                  );
                }
                if (item.kind === "price") {
                  return (
                    <PriceActivityRow
                      key={`price-${item.price.id}`}
                      timezone={timezone}
                      dateFormat={dateFormat}
                      price={item.price}
                      instrumentName={
                        instrumentById.get(item.price.instrumentId)?.symbol ||
                        instrumentById.get(item.price.instrumentId)?.name ||
                        "Instrument"
                      }
                    />
                  );
                }
                return (
                  <CashActivityRow
                    key={`cash-${item.transaction.id}`}
                    timezone={timezone}
                    dateFormat={dateFormat}
                    transaction={item.transaction}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {reconciliations.length ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Statement reconciliations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 pb-2 text-xs uppercase text-slate-500 sm:grid">
              <span>Date</span>
              <span>Reported</span>
              <span>Calculated</span>
              <span>Difference</span>
              <span />
            </div>
            <div className="divide-y divide-white/[0.06]">
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
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

type PositionEventRow = ReturnType<typeof listPositionEvents>[number];
type PriceRow = ReturnType<typeof listSecurityPrices>[number];
type CashRow = ReturnType<typeof listPositionCashTransactions>[number];

function PositionActivityRow({
  accountId,
  currency,
  timezone,
  dateFormat,
  event,
  instrumentName,
}: {
  accountId: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  event: PositionEventRow;
  instrumentName: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-200">
          {EVENT_LABELS[event.type]} · {instrumentName}
        </p>
        <p className="text-xs text-slate-500">
          {formatDate(event.tradeDate, timezone, dateFormat)} ·{" "}
          <SensitiveValue>{event.quantity} units</SensitiveValue>
        </p>
        {event.description ? (
          <p className="mt-1 text-xs text-slate-500">{event.description}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {event.cashEffectMinor ? (
          <MoneyValue
            amount={event.cashEffectMinor}
            currency={currency}
            className="text-sm"
          />
        ) : null}
        {EDITABLE_EVENT_TYPES.has(event.type) ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Edit position event"
          >
            <Link href={`/accounts/${accountId}/positions/${event.id}/edit`}>
              <Edit3 size={15} />
            </Link>
          </Button>
        ) : null}
        <MutationButton
          action={deletePositionEventAction.bind(null, event.id)}
          confirm="Delete this position event? Its complete group and every later value will be replayed."
          successMessage="Investment activity deleted."
          variant="ghost"
          size="icon"
          aria-label="Delete position event"
        >
          <Trash2 size={15} />
        </MutationButton>
      </div>
    </div>
  );
}

function PriceActivityRow({
  timezone,
  dateFormat,
  price,
  instrumentName,
}: {
  timezone: string;
  dateFormat: string;
  price: PriceRow;
  instrumentName: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-medium text-slate-200">
          Price · {instrumentName} ·{" "}
          <SensitiveValue>
            {price.currency} {price.price}
          </SensitiveValue>
        </p>
        <p className="text-xs text-slate-500">
          {formatDate(price.effectiveDate, timezone, dateFormat)} ·{" "}
          {price.source}
        </p>
      </div>
      <MutationButton
        action={deleteSecurityPriceAction.bind(null, price.id)}
        confirm="Delete this price? Current and historical values may become incomplete."
        successMessage="Security price deleted."
        variant="ghost"
        size="icon"
        aria-label="Delete security price"
      >
        <Trash2 size={15} />
      </MutationButton>
    </div>
  );
}

function CashActivityRow({
  timezone,
  dateFormat,
  transaction,
}: {
  timezone: string;
  dateFormat: string;
  transaction: CashRow;
}) {
  const editable =
    transaction.type !== "opening_balance" &&
    transaction.type !== "transfer" &&
    !transaction.eventGroupId;
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-200">
          Cash · {TRANSACTION_LABELS[transaction.type]}
        </p>
        <p className="text-xs text-slate-500">
          {formatDate(transaction.transactionDate, timezone, dateFormat)}
          {transaction.description ? ` · ${transaction.description}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <MoneyValue
          amount={transaction.amountMinor}
          currency={transaction.currency}
          className="text-sm"
        />
        {editable ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Edit cash activity"
          >
            <Link href={`/transactions/${transaction.id}/edit`}>
              <Edit3 size={15} />
            </Link>
          </Button>
        ) : null}
        {transaction.type !== "opening_balance" ? (
          <MutationButton
            action={deleteTransactionAction.bind(null, transaction.id)}
            confirm={
              transaction.eventGroupId
                ? "Delete this complete investment group? Quantities, cash, and later values will be replayed."
                : "Delete this cash activity?"
            }
            successMessage="Cash activity deleted."
            variant="ghost"
            size="icon"
            aria-label="Delete cash activity"
          >
            <Trash2 size={15} />
          </MutationButton>
        ) : null}
      </div>
    </div>
  );
}

function PositionMetric({
  label,
  amount,
  currency,
  primary = false,
}: {
  label: string;
  amount: bigint;
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
            ? "mt-3 text-2xl font-semibold text-white"
            : "mt-3 text-xl font-semibold text-slate-100"
        }
      />
    </Card>
  );
}
