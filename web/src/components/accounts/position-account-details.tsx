import { ArrowLeft, ArrowRight, Edit3, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { getAccountActivity } from "@/api/client";
import { positionEventTypeSchema } from "@/components/accounts/ledger-forms";
import { MoneyValue, PrivateValue } from "@/components/privacy";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/core";
import { formatDate, humanize, ResourceView } from "@/components/ui/resource";
import { useResource } from "@/hooks/use-resource";
import type { Account, AccountPositionSummary } from "@/lib/types";

export function PositionsCard({
  account,
  summary,
}: {
  account: Account;
  summary: AccountPositionSummary;
}) {
  return (
    <Card id="positions" className="mt-5 min-w-0 scroll-mt-24">
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Positions</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Quantities and effective unit prices for each security.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to={`/accounts/${account.id}/instruments/new`}>
              Add instrument
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link
              to={`/accounts/${account.id}/positions/new?type=opening_position`}
            >
              <Plus size={15} aria-hidden="true" />
              Add holding
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {summary.positions.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No positions recorded. Add an opening holding or record a buy.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[720px] text-left text-sm tabular-nums"
              aria-label="Current positions"
            >
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  {["Instrument", "Quantity", "Unit price", "As of", `Value (${account.currency})`, "Actions"].map(
                    (label) => (
                      <th key={label} scope="col" className="px-2 pb-3 font-medium">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {summary.positions.map((position) => (
                  <tr key={position.instrumentId}>
                    <th scope="row" className="max-w-60 px-2 py-3 font-normal">
                      <p className="break-words font-medium text-slate-100">
                        {position.instrumentName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {position.instrumentSymbol || "No symbol"} - {position.quoteCurrency}
                      </p>
                      {position.instrumentArchived ? <Badge>Archived</Badge> : null}
                    </th>
                    <td className="px-2 py-3">
                      <PrivateValue>{position.quantity}</PrivateValue>
                    </td>
                    <td className="px-2 py-3">
                      {position.unitPrice !== null ? (
                        <PrivateValue>
                          {position.quoteCurrency} {position.unitPrice}
                        </PrivateValue>
                      ) : (
                        <Badge tone="warning">Missing price</Badge>
                      )}
                    </td>
                    <td className="px-2 py-3 text-slate-400">
                      <p>{position.priceDate ? formatDate(position.priceDate) : "No price"}</p>
                      {position.priceSource ? (
                        <p className="max-w-48 break-words text-xs text-slate-500">
                          {position.priceSource}
                        </p>
                      ) : null}
                      {position.stale ? <Badge tone="warning">Stale</Badge> : null}
                    </td>
                    <td className="px-2 py-3 font-medium">
                      {position.valueMinor !== null ? (
                        <MoneyValue amount={position.valueMinor} currency={account.currency} />
                      ) : (
                        <span className="text-amber-300">
                          {position.unitPrice === null ? "Incomplete" : "Exchange rate needed"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          to={position.instrumentArchived
                            ? `/instruments/${position.instrumentId}`
                            : `/accounts/${account.id}/prices/new?instrumentId=${position.instrumentId}`}
                          aria-label={position.instrumentArchived
                            ? `Manage ${position.instrumentName}`
                            : `Update ${position.instrumentName} price`}
                        >
                          <Edit3 size={16} aria-hidden="true" />
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
  );
}

const activityPageSize = 25;
const lastActivityPage = 401;
const activityPageSchema = z.coerce.number().int().min(1).max(lastActivityPage);

export function InvestmentActivity({ accountId }: { accountId: string }) {
  const [searchParams] = useSearchParams();
  const pageInput = searchParams.get("activityPage") ?? "1";
  const state = useResource(() => {
    const page = activityPageSchema.safeParse(pageInput);
    if (!page.success) {
      return Promise.reject(new Error(`Activity page must be between 1 and ${lastActivityPage}.`));
    }
    return getAccountActivity(accountId, {
      limit: activityPageSize,
      offset: (page.data - 1) * activityPageSize,
    });
  }, [accountId, pageInput]);
  const pageLink = (page: number) => {
    const params = new URLSearchParams(searchParams);
    if (page === 1) params.delete("activityPage");
    else params.set("activityPage", String(page));
    return {
      pathname: `/accounts/${accountId}`,
      search: params.size ? `?${params}` : "",
      hash: "#investment-activity",
    };
  };
  return (
    <Card id="investment-activity" className="mt-5 min-w-0 scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle>Investment activity</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Cash transactions, positions, corporate actions, and prices, newest first.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <ResourceView state={state} loadingLabel="Loading investment activity...">
          {(activity) => {
            const page = activity.offset / activity.limit + 1;
            return (
              <>
                {activity.items.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500">
                    No investment activity on this page.
                  </p>
                ) : (
                  <ol aria-label="Investment activity history" className="divide-y divide-white/[0.06]">
                    {activity.items.map((item) => {
                      const editablePosition = item.kind === "position" &&
                        !item.eventGroupId && positionEventTypeSchema.safeParse(item.type).success;
                      const editableCash = item.kind === "transaction" &&
                        !item.eventGroupId && !["opening_balance", "transfer"].includes(item.type);
                      const editPath = editablePosition
                        ? `/accounts/${accountId}/positions/${item.id}/edit`
                        : editableCash
                          ? `/transactions/${item.id}/edit`
                          : item.kind === "price" && item.instrumentId
                            ? `/accounts/${accountId}/prices/new?instrumentId=${item.instrumentId}`
                            : null;
                      return (
                        <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-medium text-slate-200">
                              {humanize(item.type)}
                              {item.instrumentName ? ` - ${item.instrumentSymbol || item.instrumentName}` : ""}
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatDate(item.date)}
                              {item.quantity ? <> - <PrivateValue>{item.quantity} units</PrivateValue></> : null}
                            </p>
                            {item.description ? (
                              <p className="mt-1 break-words text-xs text-slate-500">
                                <PrivateValue>{item.description}</PrivateValue>
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {item.kind === "price" ? (
                              <PrivateValue className="text-sm tabular-nums">{item.currency} {item.unitPrice}</PrivateValue>
                            ) : item.kind !== "position" || item.amountMinor !== "0" ? (
                              <MoneyValue amount={item.amountMinor} currency={item.currency} className="text-sm" />
                            ) : null}
                            {editPath ? (
                              <Button asChild variant="ghost" size="icon">
                                <Link to={editPath} aria-label={`${item.kind === "price" ? "Update" : "Edit"} ${humanize(item.type)}${item.instrumentName ? ` for ${item.instrumentName}` : ""} from ${formatDate(item.date)}`}>
                                  <Edit3 size={16} aria-hidden="true" />
                                </Link>
                              </Button>
                            ) : item.eventGroupId || item.kind === "position" ? (
                              <Badge>Managed workflow</Badge>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <nav aria-label="Investment activity pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  {page > 1 ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link to={pageLink(page - 1)}><ArrowLeft size={15} aria-hidden="true" />Previous</Link>
                    </Button>
                  ) : <Button disabled variant="secondary" size="sm">Previous</Button>}
                  <span className="text-xs text-slate-500">Page {page}</span>
                  {activity.hasMore && page < lastActivityPage ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link to={pageLink(page + 1)}>Next<ArrowRight size={15} aria-hidden="true" /></Link>
                    </Button>
                  ) : <Button disabled variant="secondary" size="sm">Next</Button>}
                </nav>
                {activity.hasMore && page === lastActivityPage ? (
                  <p className="mt-3 text-sm text-amber-300">
                    The history browsing limit has been reached. Your portfolio export retains older records.
                  </p>
                ) : null}
              </>
            );
          }}
        </ResourceView>
      </CardContent>
    </Card>
  );
}
