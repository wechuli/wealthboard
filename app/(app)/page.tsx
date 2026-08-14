import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CircleDollarSign,
  Landmark,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import {
  AllocationChart,
  AssetsLiabilitiesChart,
  ContributionsGrowthChart,
  NetWorthChart,
} from "@/components/charts";
import { GoalAlerts } from "@/components/goal-alerts";
import { MoneyValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/ui/page";
import { formatDate } from "@/lib/dates";
import { safeChartNumber } from "@/lib/money";
import {
  getDashboardData,
  getNetWorthAt,
  getNetWorthHistory,
} from "@/lib/services/analytics";
import { listGoalAlerts, listGoals } from "@/lib/services/goals";
import { requireSession } from "@/lib/auth/session";

const allowedRanges = new Set(["1m", "3m", "6m", "1y", "all"]);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { userId } = await requireSession();
  const params = await searchParams;
  const range = allowedRanges.has(params.range || "") ? params.range! : "1y";
  const [data, fullHistory, goals, goalAlerts] = await Promise.all([
    getDashboardData(userId, range as "1m" | "3m" | "6m" | "1y" | "all"),
    getNetWorthHistory(userId, "all"),
    listGoals(userId),
    listGoalAlerts(userId),
  ]);
  const currency = data.settings.baseCurrency;
  const current = data.totals.netWorth;
  const currentDate = new Date(
    data.history.at(-1)?.date ?? data.settings.updatedAt,
  );
  const baselineDate = (days: number) => {
    const date = new Date(currentDate);
    date.setUTCDate(date.getUTCDate() - days);
    return date;
  };
  const [oneMonth, threeMonths, oneYear] = await Promise.all([
    getNetWorthAt(userId, baselineDate(30)),
    getNetWorthAt(userId, baselineDate(90)),
    getNetWorthAt(userId, baselineDate(365)),
  ]);
  const changes = {
    "1 month": current - BigInt(Math.round(oneMonth.netWorth)),
    "3 months": current - BigInt(Math.round(threeMonths.netWorth)),
    "1 year": current - BigInt(Math.round(oneYear.netWorth)),
    "All time": fullHistory.length
      ? current - BigInt(Math.round(fullHistory[0].netWorth))
      : 0n,
  };
  const activeGoals = goals
    .filter((goal) => goal.status === "active")
    .slice(0, 3);

  return (
    <>
      <PageHeader
        title="Overview"
        description="A clear view of what you own, owe, and are building toward."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/review">
                <Sparkles size={17} />
                Review
              </Link>
            </Button>
            <Button asChild>
              <Link href="/transactions/new">
                <Plus size={17} />
                Quick add
              </Link>
            </Button>
          </div>
        }
      />

      {data.missingRates.length ? (
        <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
          Current or historical totals are incomplete. Add effective-dated
          exchange rates for {data.missingRates.join(", ")} in Settings;
          affected holdings are excluded where conversion is unavailable.
        </div>
      ) : null}
      {data.missingPrices.length || data.stalePrices.length ? (
        <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
          Position values need review. {data.missingPrices.length} instrument
          {data.missingPrices.length === 1 ? " is" : "s are"} missing a price
          {data.stalePrices.length
            ? ` and ${data.stalePrices.length} use stale prices`
            : ""}
          . Affected totals and history are marked incomplete.
        </div>
      ) : null}

      <GoalAlerts
        alerts={goalAlerts.map((alert) => ({
          goalId: alert.goalId,
          goalName: alert.goalName,
          currency: alert.currency,
          requiredMonthly: alert.requiredMonthly.toString(),
          plannedMonthly: alert.plannedMonthly.toString(),
          annualReturnBps: alert.annualReturnBps,
          targetDate: alert.targetDate,
        }))}
        timezone={data.settings.timezone}
      />

      <Card className="relative overflow-hidden border-emerald-400/15 bg-[#101a17]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/[0.07] blur-3xl" />
        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <CircleDollarSign size={17} className="text-emerald-300" />
                Total net worth
              </div>
              <MoneyValue
                amount={current}
                currency={currency}
                className="mt-3 block text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl"
              />
              <p className="mt-3 text-sm text-slate-500">
                {data.accountCount} active accounts · {data.goalCount} goals
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(changes).map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-28 rounded-xl border border-white/[0.06] bg-black/15 p-3"
                >
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <p
                    className={
                      value >= 0
                        ? "mt-1 flex items-center gap-1 text-sm font-medium text-emerald-300"
                        : "mt-1 flex items-center gap-1 text-sm font-medium text-red-300"
                    }
                  >
                    {value >= 0 ? (
                      <ArrowUpRight size={14} />
                    ) : (
                      <ArrowDownRight size={14} />
                    )}
                    <MoneyValue amount={value} currency={currency} compact />
                  </p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric
          label="Total assets"
          amount={data.totals.assets}
          currency={currency}
          icon={<Landmark size={17} />}
        />
        <DashboardMetric
          label="Total liabilities"
          amount={data.totals.liabilities}
          currency={currency}
          icon={<Banknote size={17} />}
          negative
        />
        <DashboardMetric
          label="Contributions"
          amount={data.totals.contributions}
          currency={currency}
          icon={<WalletCards size={17} />}
        />
        <DashboardMetric
          label="Income & gains"
          amount={data.totals.income + data.totals.capitalGrowth}
          currency={currency}
          icon={<TrendingUp size={17} />}
        />
        <DashboardMetric
          label="Liquid assets"
          amount={data.totals.liquid}
          currency={currency}
          icon={<Banknote size={17} />}
        />
        <DashboardMetric
          label="Investment assets"
          amount={data.totals.investible}
          currency={currency}
          icon={<Sparkles size={17} />}
        />
        <DashboardMetric
          label="Withdrawals"
          amount={data.totals.withdrawals}
          currency={currency}
          icon={<ArrowUpRight size={17} />}
        />
        <DashboardMetric
          label="Fees"
          amount={data.totals.fees}
          currency={currency}
          icon={<ArrowDownRight size={17} />}
          negative
        />
      </div>

      {data.accountCount === 0 ? (
        <Card className="mt-5 p-10 text-center">
          <Landmark className="mx-auto text-slate-500" size={32} />
          <h2 className="mt-4 text-lg font-semibold">Add your first account</h2>
          <p className="mt-2 text-sm text-slate-400">
            Start with a current balance. Wealthboard will build history as you
            update it.
          </p>
          <Button asChild className="mt-5">
            <Link href="/accounts/new">
              <Plus size={17} />
              Add account
            </Link>
          </Button>
        </Card>
      ) : (
        <>
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,.8fr)]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Net-worth history</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {data.historyComplete
                      ? "Assets less liabilities over time"
                      : "Incomplete history: one or more prices or exchange rates are unavailable"}
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <NetWorthChart
                  data={data.history}
                  currency={currency}
                  range={range}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Asset allocation</CardTitle>
              </CardHeader>
              <CardContent>
                <AllocationChart
                  total={data.allocation}
                  investible={data.investibleAllocation}
                  currency={currency}
                />
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Assets versus liabilities</CardTitle>
              </CardHeader>
              <CardContent>
                <AssetsLiabilitiesChart
                  assets={safeChartNumber(data.totals.assets)}
                  liabilities={safeChartNumber(data.totals.liabilities)}
                  currency={currency}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Contributions versus growth</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    How your current wealth was built
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <ContributionsGrowthChart
                  currency={currency}
                  values={[
                    {
                      name: "Contributions",
                      value: safeChartNumber(data.totals.contributions),
                    },
                    {
                      name: "Income",
                      value: safeChartNumber(data.totals.income),
                    },
                    {
                      name: "Capital",
                      value: safeChartNumber(data.totals.capitalGrowth),
                    },
                    {
                      name: "Withdrawals",
                      value: -safeChartNumber(data.totals.withdrawals),
                    },
                    { name: "Fees", value: -safeChartNumber(data.totals.fees) },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Goal progress</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/goals">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {activeGoals.length === 0 ? (
              <div className="py-10 text-center">
                <Target className="mx-auto text-slate-500" size={25} />
                <p className="mt-3 text-sm text-slate-500">No active goals.</p>
                <Button asChild variant="secondary" size="sm" className="mt-4">
                  <Link href="/goals/new">Create goal</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {activeGoals.map((goal) => (
                  <Link
                    key={goal.id}
                    href={`/goals/${goal.id}`}
                    className="block rounded-xl border border-white/[0.06] p-4 hover:bg-white/[0.025]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{goal.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {goal.accountName || "Direct goal"} ·{" "}
                          {formatDate(
                            goal.targetDate,
                            data.settings.timezone,
                            "MMM yyyy",
                          )}
                        </p>
                      </div>
                      <Badge
                        tone={
                          goal.tracking === "behind" ? "warning" : "positive"
                        }
                      >
                        {goal.tracking.replace("_", " ")}
                      </Badge>
                    </div>
                    <Progress
                      value={Number(goal.progressPercent)}
                      label={`${goal.name} progress`}
                      className="mt-3"
                    />
                    {goal.valueIncomplete ? (
                      <p className="mt-2 text-xs text-amber-300">
                        Price or exchange rate needed
                      </p>
                    ) : null}
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>{goal.progressPercent}% complete</span>
                      <span>
                        <MoneyValue
                          amount={goal.requiredMonthly}
                          currency={goal.currency}
                        />{" "}
                        / month needed
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/transactions">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.recentActivity.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                No recent activity.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {data.recentActivity.slice(0, 6).map((activity) => (
                  <div
                    key={`${activity.kind}-${activity.id}`}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {activity.label}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {activity.accountName} ·{" "}
                        {formatDate(
                          activity.date,
                          data.settings.timezone,
                          "dd MMM",
                        )}
                      </p>
                    </div>
                    <MoneyValue
                      amount={activity.amountMinor}
                      currency={activity.currency}
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function DashboardMetric({
  label,
  amount,
  currency,
  icon,
  negative,
}: {
  label: string;
  amount: bigint;
  currency: string;
  icon: React.ReactNode;
  negative?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <MoneyValue
        amount={amount}
        currency={currency}
        compact
        className={`mt-3 block text-xl font-semibold ${negative && amount > 0 ? "text-red-300" : "text-slate-100"}`}
      />
    </Card>
  );
}
