import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Edit3,
  Landmark,
  CandlestickChart,
  FileInput,
  GitBranch,
  Plus,
  RefreshCw,
  ScrollText,
  Sparkles,
  Scale,
  Trash2,
  TrendingUp,
} from "lucide-react";

import {
  archiveAccountAction,
  deleteTransactionAction,
  deleteValuationAction,
} from "@/app/(app)/actions";
import { AccountHistoryChart } from "@/components/charts";
import { MoneyValue } from "@/components/privacy-provider";
import { PositionAccountDetails } from "@/components/position-account-details";
import { MutationButton } from "@/components/mutation-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { TRANSACTION_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";
import { getAccount, getAccountActivity } from "@/lib/services/accounts";
import { getAccountAnalytics } from "@/lib/services/analytics";
import { getSettings } from "@/lib/bootstrap";
import { listGoals } from "@/lib/services/goals";
import { requireSession } from "@/lib/auth/session";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const [account, activity, analytics, settings, allGoals] = await Promise.all([
    getAccount(userId, id),
    getAccountActivity(userId, id),
    getAccountAnalytics(userId, id),
    getSettings(userId),
    listGoals(userId),
  ]);
  if (!account || !analytics) notFound();
  const linkedGoals = allGoals.filter((goal) => goal.linkedAccountId === id);
  const manualAsset = !account.categoryIsInvestible;
  const institutionLabel = account.institutionName
    ? `${account.institutionName}${account.institutionArchivedAt ? " (archived)" : ""}`
    : null;
  const movementAttribution = analytics.movementAttribution;

  return (
    <>
      <PageHeader
        title={account.name}
        description={[institutionLabel, account.categoryName]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {!account.isLiability ? (
              <Button asChild variant="secondary">
                <Link href={`/estate/distribution?account=${id}#asset-${id}`}>
                  <ScrollText size={16} />
                  Estate plan
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link href={`/accounts/${id}/edit`}>
                <Edit3 size={16} />
                Edit
              </Link>
            </Button>
            <Button asChild>
              <Link
                href={
                  account.trackingMode === "positions"
                    ? `/accounts/${id}/positions/new?type=buy`
                    : `/transactions/new?accountId=${id}&type=deposit`
                }
              >
                <Plus size={16} />
                {account.trackingMode === "positions"
                  ? "Add trade"
                  : "Add activity"}
              </Link>
            </Button>
          </>
        }
      />
      {account.trackingMode === "positions" ? (
        <PositionAccountDetails
          userId={userId}
          accountId={id}
          currency={account.currency}
          timezone={settings.timezone}
          dateFormat={settings.preferredDateFormat}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label={account.isLiability ? "Amount owed" : "Current value"}
            value={account.currentValueMinor}
            currency={account.currency}
            primary
          />
          <Metric
            label="Contributions"
            value={analytics.metrics.contributions}
            currency={account.currency}
          />
          <Metric
            label="Income"
            value={analytics.metrics.interest + analytics.metrics.dividends}
            currency={account.currency}
          />
          <Metric
            label={manualAsset ? "Valuation change" : "Estimated gain/loss"}
            value={analytics.estimatedGain}
            currency={account.currency}
            tone={analytics.estimatedGain >= 0 ? "positive" : "negative"}
          />
        </div>
      )}

      {account.trackingMode === "positions" && movementAttribution ? (
        <Card className="mt-5">
          <CardHeader>
            <div>
              <CardTitle>Movement attribution</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Exact bridge from recorded cash, quantities, prices, and
                currencies.
              </p>
            </div>
            <Badge tone={movementAttribution.complete ? "positive" : "warning"}>
              {movementAttribution.complete ? "Complete" : "Incomplete"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["External cash", movementAttribution.externalCashMinor],
                ["Income", movementAttribution.incomeMinor],
                ["Fees", movementAttribution.feesMinor],
                [
                  "Internal trade cash",
                  movementAttribution.internalTradeCashMinor,
                ],
                ["Quantity changes", movementAttribution.quantityMovementMinor],
                ["Price movement", movementAttribution.priceMovementMinor],
                [
                  "Currency movement",
                  movementAttribution.currencyMovementMinor,
                ],
                ["Unattributed", movementAttribution.unattributedMinor],
              ].map(([label, amount]) => (
                <div
                  key={String(label)}
                  className="rounded-lg border border-white/10 p-3"
                >
                  <p className="text-xs text-slate-500">{String(label)}</p>
                  <MoneyValue
                    amount={amount as bigint}
                    currency={account.currency}
                    className="mt-1 font-semibold"
                  />
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-amber-200">
              {movementAttribution.returnMessage}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.7fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Value history</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {manualAsset
                  ? "Valuations and recorded cash flows"
                  : account.trackingMode === "positions"
                    ? "Cash, quantities, and effective-dated prices"
                    : "Balance reconstructed from all activity"}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <AccountHistoryChart
              data={analytics.history}
              currency={account.currency}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {account.trackingMode === "positions" ? (
              <>
                <Quick
                  href={`/accounts/${id}/positions/new?type=buy`}
                  icon={<CandlestickChart size={17} />}
                  label="Buy"
                />
                <Quick
                  href={`/accounts/${id}/positions/new?type=sell`}
                  icon={<CandlestickChart size={17} />}
                  label="Sell"
                />
                <Quick
                  href={`/accounts/${id}/prices/new`}
                  icon={<TrendingUp size={17} />}
                  label="Price"
                />
                <Quick
                  href={`/accounts/${id}/reconcile`}
                  icon={<Scale size={17} />}
                  label="Reconcile"
                />
                <Quick
                  href={`/accounts/${id}/investment-actions?command=reinvestment`}
                  icon={<RefreshCw size={17} />}
                  label="Reinvest"
                />
                <Quick
                  href={`/accounts/${id}/investment-actions?command=in_kind_transfer`}
                  icon={<ArrowLeftRight size={17} />}
                  label="Move units"
                />
                <Quick
                  href={`/accounts/${id}/investment-actions?command=split`}
                  icon={<GitBranch size={17} />}
                  label="Corp action"
                />
              </>
            ) : null}
            <Quick
              href={`/transactions/new?accountId=${id}&type=deposit`}
              icon={<ArrowDownToLine size={17} />}
              label="Deposit"
            />
            <Quick
              href={`/transactions/new?accountId=${id}&type=withdrawal`}
              icon={<ArrowUpFromLine size={17} />}
              label="Withdraw"
            />
            <Quick
              href={`/transactions/new?accountId=${id}&type=interest`}
              icon={<TrendingUp size={17} />}
              label="Interest"
            />
            <Quick
              href={`/transactions/new?accountId=${id}&type=transfer`}
              icon={<ArrowLeftRight size={17} />}
              label="Transfer"
            />
            {account.trackingMode === "balance" ? (
              <>
                <Quick
                  href={`/accounts/${id}/valuation`}
                  icon={<Sparkles size={17} />}
                  label="Value"
                />
                {!account.archivedAt &&
                !account.isLiability &&
                account.categoryIsInvestible ? (
                  <Quick
                    href={`/accounts/${id}/convert`}
                    icon={<RefreshCw size={17} />}
                    label="Convert"
                  />
                ) : null}
              </>
            ) : null}
            <Quick
              href={`/transactions/new?accountId=${id}&type=fee`}
              icon={<Landmark size={17} />}
              label="Fee"
            />
            {!account.archivedAt ? (
              <Quick
                href={`/accounts/${id}/import`}
                icon={<FileInput size={17} />}
                label="Import"
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {account.trackingMode === "balance" ? (
          <Card>
            <CardHeader>
              <CardTitle>Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.transactions.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  No transactions recorded.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {activity.transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-200">
                          {TRANSACTION_LABELS[transaction.type]}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {formatDate(
                            transaction.transactionDate,
                            settings.timezone,
                            settings.preferredDateFormat,
                          )}
                          {transaction.description
                            ? ` · ${transaction.description}`
                            : ""}
                          {transaction.externalId
                            ? ` · External ID: ${transaction.externalId}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <MoneyValue
                          amount={transaction.amountMinor}
                          currency={transaction.currency}
                          className="text-sm"
                        />
                        {transaction.type !== "opening_balance" &&
                        transaction.type !== "transfer" ? (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            aria-label="Edit transaction"
                          >
                            <Link href={`/transactions/${transaction.id}/edit`}>
                              <Edit3 size={15} />
                            </Link>
                          </Button>
                        ) : null}
                        {transaction.type !== "opening_balance" ? (
                          <MutationButton
                            action={deleteTransactionAction.bind(
                              null,
                              transaction.id,
                            )}
                            confirm="Delete this transaction? The account balance will be recalculated."
                            successMessage="Transaction deleted."
                            variant="ghost"
                            size="icon"
                            aria-label="Delete transaction"
                          >
                            <Trash2 size={15} />
                          </MutationButton>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Valuation history</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.valuations.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No manual valuations yet.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {activity.valuations.map((valuation) => (
                  <div
                    key={valuation.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        <MoneyValue
                          amount={valuation.valueMinor}
                          currency={valuation.currency}
                        />
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(
                          valuation.valuationDate,
                          settings.timezone,
                          settings.preferredDateFormat,
                        )}
                        {valuation.notes ? ` · ${valuation.notes}` : ""}
                      </p>
                    </div>
                    <MutationButton
                      action={deleteValuationAction.bind(null, valuation.id)}
                      confirm="Delete this valuation? Later activity will be replayed from the previous value."
                      successMessage="Valuation deleted."
                      variant="ghost"
                      size="icon"
                      aria-label="Delete valuation"
                    >
                      <Trash2 size={15} />
                    </MutationButton>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details & notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail label="Category" value={account.categoryName} />
            <Detail
              label="Tracking method"
              value={
                account.trackingMode === "positions"
                  ? "Units and prices"
                  : "Account value"
              }
            />
            <Detail label="Institution" value={institutionLabel || "Not set"} />
            <Detail
              label="Reference"
              value={account.accountReference || "Not set"}
            />
            {account.trackingMode === "balance" ? (
              <Detail
                label="Cost basis"
                value={
                  account.costBasisMinor == null
                    ? "Not set"
                    : minorToDecimalString(
                        account.costBasisMinor,
                        account.currency,
                      )
                }
              />
            ) : null}
            <Detail
              label="Included in net worth"
              value={account.isIncludedInNetWorth ? "Yes" : "No"}
            />
            {account.notes ? (
              <p className="border-t border-white/[0.06] pt-3 leading-6 text-slate-400">
                {account.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Linked goals</CardTitle>
          </CardHeader>
          <CardContent>
            {linkedGoals.length ? (
              linkedGoals.map((goal) => (
                <Link
                  key={goal.id}
                  href={`/goals/${goal.id}`}
                  className="flex items-center justify-between rounded-xl bg-white/[0.035] p-3 hover:bg-white/[0.06]"
                >
                  <span className="font-medium">{goal.name}</span>
                  <Badge tone="positive">{goal.progressPercent}%</Badge>
                </Link>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                No goals linked to this account.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 flex justify-end">
        <form action={archiveAccountAction.bind(null, id, !account.archivedAt)}>
          <ConfirmSubmit
            message={
              account.archivedAt
                ? "Restore this account?"
                : "Archive this account? It will be removed from current net worth."
            }
            variant={account.archivedAt ? "secondary" : "danger"}
          >
            <Archive size={16} />
            {account.archivedAt ? "Restore account" : "Archive account"}
          </ConfirmSubmit>
        </form>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  currency,
  primary,
  tone,
}: {
  label: string;
  value: number | bigint;
  currency: string;
  primary?: boolean;
  tone?: "positive" | "negative";
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <MoneyValue
        amount={value}
        currency={currency}
        className={
          primary
            ? "mt-3 block text-2xl font-semibold text-white"
            : `mt-3 block text-xl font-semibold ${tone === "positive" ? "text-emerald-300" : tone === "negative" ? "text-red-300" : "text-slate-100"}`
        }
      />
    </Card>
  );
}

function Quick({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-2 rounded-xl border border-white/[0.07] px-3 text-sm text-slate-300 hover:bg-white/[0.05] hover:text-white"
    >
      {icon}
      {label}
    </Link>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-300">{value}</span>
    </div>
  );
}
