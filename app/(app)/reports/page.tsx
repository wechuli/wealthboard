import { Award, BarChart3, Coins, TrendingUp } from "lucide-react";

import {
  AllocationChart,
  ContributionsGrowthChart,
  NetWorthChart,
} from "@/components/charts";
import { MoneyValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { safeChartNumber } from "@/lib/money";
import {
  getAccountComparisons,
  getDashboardData,
} from "@/lib/services/analytics";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const { userId } = await requireSession();
  const [data, comparisons] = await Promise.all([
    getDashboardData(userId, "all"),
    getAccountComparisons(userId),
  ]);
  const currency = data.settings.baseCurrency;
  const highest = data.history.reduce(
    (value, point) => Math.max(value, point.netWorth),
    data.history[0]?.netWorth ?? 0,
  );
  const first = data.history[0]?.netWorth ?? 0;
  const last = data.history.at(-1)?.netWorth ?? 0;
  const latestTime = data.history.at(-1)
    ? new Date(data.history.at(-1)!.date).getTime()
    : 0;
  const yearAgo =
    data.history.find(
      (point) =>
        new Date(point.date).getTime() >= latestTime - 365 * 86_400_000,
    )?.netWorth ?? first;

  return (
    <>
      <PageHeader
        title="Reports & analytics"
        description="Long-term trends, allocation, returns, and comparable account performance."
      />
      {data.missingRates.length ? (
        <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
          This report is incomplete because effective-dated rates for{" "}
          {data.missingRates.join(", ")} are missing. Affected holdings are
          excluded where conversion is unavailable.
        </div>
      ) : null}
      {data.missingPrices.length || data.stalePrices.length ? (
        <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
          Position reporting needs review. {data.missingPrices.length} missing
          price{data.missingPrices.length === 1 ? "" : "s"}
          {data.stalePrices.length
            ? ` and ${data.stalePrices.length} stale price${data.stalePrices.length === 1 ? "" : "s"}`
            : ""}{" "}
          affect these results.
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat
          label="Highest net worth"
          value={
            <MoneyValue amount={Math.round(highest)} currency={currency} />
          }
          icon={<Award size={17} />}
        />
        <ReportStat
          label="Change since tracking"
          value={
            <MoneyValue amount={Math.round(last - first)} currency={currency} />
          }
          icon={<TrendingUp size={17} />}
        />
        <ReportStat
          label="Year-over-year"
          value={
            <MoneyValue
              amount={Math.round(last - yearAgo)}
              currency={currency}
            />
          }
          icon={<BarChart3 size={17} />}
        />
        <ReportStat
          label="Investment income"
          value={<MoneyValue amount={data.totals.income} currency={currency} />}
          icon={<Coins size={17} />}
        />
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Net-worth history</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {data.historyComplete
                ? "Monthly history across all tracked accounts"
                : "Incomplete history: one or more prices or exchange rates are unavailable"}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <NetWorthChart data={data.history} currency={currency} range="all" />
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Portfolio allocation</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Toggle total and investible assets
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <AllocationChart
              total={data.allocation}
              investible={data.investibleAllocation}
              currency={currency}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Income and returns</CardTitle>
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
                  name: "Interest + dividends",
                  value: safeChartNumber(data.totals.income),
                },
                {
                  name: "Capital growth",
                  value: safeChartNumber(data.totals.capitalGrowth),
                },
                { name: "Fees", value: -safeChartNumber(data.totals.fees) },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {data.instrumentAllocation.length ? (
        <Card className="mt-5">
          <CardHeader>
            <div>
              <CardTitle>Investment instruments</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Current position value by instrument in {currency}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <AllocationChart
              total={data.instrumentAllocation}
              investible={data.instrumentAllocation}
              currency={currency}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <AllocationList
          title="By institution"
          items={data.institutionAllocation}
          currency={currency}
        />
        <AllocationList
          title="By currency"
          items={data.currencyAllocation}
          currency={currency}
        />
        <Card>
          <CardHeader>
            <CardTitle>Asset classification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Line
              label="Liquid assets"
              amount={data.totals.liquid}
              currency={currency}
            />
            <Line
              label="Illiquid assets"
              amount={data.totals.assets - data.totals.liquid}
              currency={currency}
            />
            <Line
              label="Investible assets"
              amount={data.totals.investible}
              currency={currency}
            />
            <Line
              label="Lifestyle / other"
              amount={data.totals.assets - data.totals.investible}
              currency={currency}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Account comparison</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Annualized figures exclude net deposits. Periods under one year
              are marked as estimates.
            </p>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="border-y border-white/[0.06] bg-white/[0.025] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-4">Account</th>
                <th className="p-4">Starting</th>
                <th className="p-4">Ending</th>
                <th className="p-4">Deposits</th>
                <th className="p-4">Withdrawals</th>
                <th className="p-4">Net income</th>
                <th className="p-4">Simple annualized</th>
                <th className="p-4">Effective annualized</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {comparisons.map((account) => (
                <tr key={account.id}>
                  <td className="p-4 font-medium">
                    {account.name}
                    {account.days < 365 ? (
                      <Badge tone="warning" className="ml-2">
                        Short period
                      </Badge>
                    ) : null}
                  </td>
                  <td className="p-4">
                    <MoneyValue
                      amount={account.startingBalance}
                      currency={account.currency}
                    />
                  </td>
                  <td className="p-4">
                    <MoneyValue
                      amount={account.endingBalance}
                      currency={account.currency}
                    />
                  </td>
                  <td className="p-4">
                    <MoneyValue
                      amount={account.deposits}
                      currency={account.currency}
                    />
                  </td>
                  <td className="p-4">
                    <MoneyValue
                      amount={account.withdrawals}
                      currency={account.currency}
                    />
                  </td>
                  <td className="p-4">
                    <MoneyValue
                      amount={account.netIncome}
                      currency={account.currency}
                    />
                  </td>
                  <td className="p-4 tabular-nums">
                    {account.simpleAnnualized
                      ? `${account.simpleAnnualized}%`
                      : "Insufficient history"}
                  </td>
                  <td className="p-4 tabular-nums">
                    {account.effectiveAnnualized
                      ? `${account.effectiveAnnualized}%`
                      : "Insufficient history"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function ReportStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-xs uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </Card>
  );
}

function AllocationList({
  title,
  items,
  currency,
}: {
  title: string;
  items: Array<{ name: string; value: number }>;
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length ? (
          items.map((item) => (
            <Line
              key={item.name}
              label={item.name}
              amount={BigInt(Math.round(item.value))}
              currency={currency}
            />
          ))
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">
            No allocation data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Line({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: bigint;
  currency: string;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/[0.05] pb-3 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <MoneyValue
        amount={amount}
        currency={currency}
        className="text-sm font-medium"
      />
    </div>
  );
}
