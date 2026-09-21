import {
  Archive,
  ArrowDownRight,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Banknote,
  Building2,
  CandlestickChart,
  CircleDollarSign,
  Download,
  Edit3,
  FileInput,
  GitBranch,
  Grid2X2,
  Landmark,
  List,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  archiveAccount,
  deleteTransaction,
  deleteValuation,
  getAccount,
  getAccountAnalytics,
  getAccountActivity,
  getAccountPositionEvents,
  getAccountPositionReconciliations,
  getAccounts,
  getAccountTransactions,
  getAccountValuations,
  getCategories,
  getDashboard,
  getGoalAlerts,
  getGoals,
  getInstitutions,
  getInstruments,
  getSettings,
  getTransactions,
} from "@/api/client";
import {
  AccountHistoryChart,
  AllocationChart,
  AssetsLiabilitiesChart,
  ContributionsGrowthChart,
  NetWorthChart,
} from "@/components/charts";
import {
  CorporateActionsPanel,
  ImportWorkspace,
} from "@/components/accounts/advanced-workflows";
import {
  AccountControls,
  AccountConversionForm,
  AccountCreateForm,
  LedgerManager,
  PositionTools,
  TransactionForm,
} from "@/components/accounts/ledger-forms";
import { InstrumentForm, InstrumentManager } from "@/components/planning/forms";
import { MoneyValue } from "@/components/privacy";
import type {
  Account,
  ActivityItem,
  Session,
  Transaction,
  Valuation,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Progress,
  Select,
} from "@/components/ui/core";
import { formatDate, humanize, ResourceView } from "@/components/ui/resource";
import { useResource } from "@/hooks/use-resource";

const transactionLabels: Record<string, string> = {
  opening_balance: "Opening balance",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  interest: "Interest",
  dividend: "Dividend",
  capital_gain: "Capital gain",
  capital_loss: "Capital loss",
  fee: "Fee",
  purchase: "Purchase",
  sale: "Sale",
  manual_adjustment: "Manual adjustment",
  liability_payment: "Liability payment",
  liability_increase: "Liability increase",
  transfer: "Transfer",
};

const transactionTypes = Object.keys(transactionLabels).filter(
  (type) => type !== "opening_balance",
);

type PageProps = { session: Session };

function IncompleteValue({ className }: { className?: string }) {
  return <span className={className ?? "text-amber-300"}>Incomplete data</span>;
}

function CurrentExchangeRateWarnings({
  complete,
  missingCurrencies,
}: {
  complete: boolean;
  missingCurrencies: string[];
}) {
  if (complete) return null;
  return (
    <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
      Exchange rates are missing for{" "}
      {missingCurrencies.join(", ") || "one or more currencies"}. Affected
      totals are marked incomplete.
    </div>
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
  amount?: string;
  currency: string;
  icon: React.ReactNode;
  negative?: boolean;
}) {
  return (
    <Card className="p-5" role="group" aria-label={`${label} metric`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
        {icon}
        {label}
      </div>
      {amount == null ? (
        <IncompleteValue className="mt-3 block text-sm font-medium text-amber-300" />
      ) : (
        <MoneyValue
          amount={amount}
          currency={currency}
          className={
            negative
              ? "mt-3 block text-xl font-semibold text-red-300"
              : "mt-3 block text-xl font-semibold text-slate-100"
          }
        />
      )}
    </Card>
  );
}

export function DashboardPage() {
  const [searchParams] = useSearchParams();
  const requestedRange = searchParams.get("range") ?? "1y";
  const range = ["1m", "3m", "6m", "1y", "all"].includes(requestedRange)
    ? requestedRange
    : "1y";
  const state = useResource(
    () =>
      Promise.all([
        getDashboard(range),
        getGoals(),
        getGoalAlerts(),
        getTransactions(),
      ]),
    [range],
  );

  return (
    <ResourceView state={state} loadingLabel="Loading overview...">
      {([data, goals, goalAlerts, transactions]) => {
        const activeGoals = goals
          .filter((goal) => goal.status === "active")
          .slice(0, 3);
        const periodChanges = [
          ["1 month", data.periodChanges.oneMonth],
          ["3 months", data.periodChanges.threeMonths],
          ["1 year", data.periodChanges.oneYear],
          ["All time", data.periodChanges.allTime],
        ] as const;
        return (
          <>
            <PageHeader
              title="Overview"
              description="A clear view of what you own, owe, and are building toward."
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="secondary">
                    <Link to="/review">
                      <Sparkles size={17} />
                      Review
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link to="/transactions/new">
                      <Plus size={17} />
                      Quick add
                    </Link>
                  </Button>
                </div>
              }
            />

            <CurrentExchangeRateWarnings
              complete={data.currentComplete}
              missingCurrencies={data.missingCurrencies}
            />
            {goalAlerts.length ? (
              <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
                {goalAlerts.length} goal alert
                {goalAlerts.length === 1 ? " needs" : "s need"} attention.
              </div>
            ) : null}

            <Card className="relative overflow-hidden border-emerald-400/15 bg-[var(--panel-raised)]">
              <CardContent className="relative p-6 sm:p-8">
                <div className="flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <CircleDollarSign
                        size={17}
                        className="text-emerald-300"
                      />
                      Total net worth
                    </div>
                    <MoneyValue
                      amount={data.totals.netWorth}
                      currency={data.baseCurrency}
                      className="mt-3 block text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl"
                    />
                    <p className="mt-3 text-sm text-slate-500">
                      {data.accountCount} active accounts · {data.goalCount}{" "}
                      goals
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {periodChanges.map(
                      ([label, value]) => (
                        <div
                          key={label}
                          role="group"
                          aria-label={`${label} net worth change`}
                          className="min-w-28 rounded-xl border border-white/[0.06] bg-black/15 p-3"
                        >
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">
                            {label}
                          </p>
                          {value == null ? (
                            <IncompleteValue className="mt-1 block text-sm font-medium text-amber-300" />
                          ) : (
                            <p
                              className={
                                BigInt(value) >= 0n
                                  ? "mt-1 flex items-center gap-1 text-sm font-medium text-emerald-300"
                                  : "mt-1 flex items-center gap-1 text-sm font-medium text-red-300"
                              }
                            >
                              {BigInt(value) >= 0n ? (
                                <ArrowUpRight size={14} />
                              ) : (
                                <ArrowDownRight size={14} />
                              )}
                              <MoneyValue
                                amount={value}
                                currency={data.baseCurrency}
                              />
                            </p>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <DashboardMetric
                label="Total assets"
                amount={data.totals.assets}
                currency={data.baseCurrency}
                icon={<Landmark size={17} />}
              />
              <DashboardMetric
                label="Total liabilities"
                amount={data.totals.liabilities}
                currency={data.baseCurrency}
                icon={<Banknote size={17} />}
                negative
              />
              <DashboardMetric
                label="Contributions"
                amount={data.totals.contributions}
                currency={data.baseCurrency}
                icon={<WalletCards size={17} />}
              />
              <DashboardMetric
                label="Income & gains"
                amount={(
                  BigInt(data.totals.income) +
                  BigInt(data.totals.capitalGrowth)
                ).toString()}
                currency={data.baseCurrency}
                icon={<TrendingUp size={17} />}
              />
              <DashboardMetric
                label="Liquid assets"
                amount={data.totals.liquid}
                currency={data.baseCurrency}
                icon={<Banknote size={17} />}
              />
              <DashboardMetric
                label="Investment assets"
                amount={data.totals.investible}
                currency={data.baseCurrency}
                icon={<Sparkles size={17} />}
              />
              <DashboardMetric
                label="Withdrawals"
                amount={data.totals.withdrawals}
                currency={data.baseCurrency}
                icon={<ArrowUpRight size={17} />}
              />
              <DashboardMetric
                label="Fees"
                amount={data.totals.fees}
                currency={data.baseCurrency}
                icon={<ArrowDownRight size={17} />}
                negative
              />
            </div>

            {data.accountCount === 0 ? (
              <Card className="mt-5 p-10 text-center">
                <Landmark className="mx-auto text-slate-500" size={32} />
                <h2 className="mt-4 text-lg font-semibold">
                  Add your first account
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Start with a current balance. Wealthboard will build history
                  as you update it.
                </p>
                <Button asChild className="mt-5">
                  <Link to="/accounts/new">
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
                          Assets less liabilities over time
                        </p>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {!data.historicalComplete ? (
                        <p className="mb-3 text-xs text-amber-200">
                          Incomplete history: one or more effective-dated prices
                          or exchange rates are unavailable.
                        </p>
                      ) : null}
                      <NetWorthChart
                        data={data.history}
                        currency={data.baseCurrency}
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
                        currency={data.baseCurrency}
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
                        assetsMinor={data.totals.assets}
                        liabilitiesMinor={data.totals.liabilities}
                        currency={data.baseCurrency}
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
                      {!data.compositionComplete ? (
                        <p className="mb-3 text-xs text-amber-200">
                          {data.completenessReasons.join(" ")}
                        </p>
                      ) : null}
                      <ContributionsGrowthChart
                        currency={data.baseCurrency}
                        values={[
                          {
                            name: "Contributions",
                            valueMinor: data.totals.contributions,
                          },
                          { name: "Income", valueMinor: data.totals.income },
                          {
                            name: "Capital",
                            valueMinor: data.totals.capitalGrowth,
                          },
                          {
                            name: "Withdrawals",
                            valueMinor: `-${data.totals.withdrawals}`,
                          },
                          { name: "Fees", valueMinor: `-${data.totals.fees}` },
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
                    <Link to="/goals">View all</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {activeGoals.length === 0 ? (
                    <div className="py-10 text-center">
                      <Target className="mx-auto text-slate-500" size={25} />
                      <p className="mt-3 text-sm text-slate-500">
                        No active goals.
                      </p>
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        className="mt-4"
                      >
                        <Link to="/goals/new">Create goal</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {activeGoals.map((goal) => (
                        <Link
                          key={goal.id}
                          to={`/goals/${goal.id}`}
                          className="block rounded-xl border border-white/[0.06] p-4 hover:bg-white/[0.025]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">{goal.name}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {goal.linkedAccount?.name || "Direct goal"} ·{" "}
                                {formatDate(goal.targetDate)}
                              </p>
                            </div>
                            <Badge
                              tone={
                                goal.valueIncomplete ? "warning" : "positive"
                              }
                            >
                              {humanize(goal.status)}
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
                                amount={goal.currentAmountMinor}
                                currency={goal.currentAmountCurrency}
                              />
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
                    <Link to="/transactions">View all</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {transactions.items.length === 0 ? (
                    <p className="py-12 text-center text-sm text-slate-500">
                      No recent activity.
                    </p>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {transactions.items.slice(0, 6).map((activity) => (
                        <div
                          key={activity.id}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {transactionLabels[activity.type] ??
                                humanize(activity.type)}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {activity.accountName} ·{" "}
                              {formatDate(activity.transactionDate)}
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
      }}
    </ResourceView>
  );
}

type AccountView = "cards" | "table";

function AccountsList({
  accounts,
  baseCurrency,
}: {
  accounts: Account[];
  baseCurrency: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [institution, setInstitution] = useState("all");
  const [kind, setKind] = useState("all");
  const [tracking, setTracking] = useState("all");
  const [priceState, setPriceState] = useState("all");
  const [sort, setSort] = useState("value");
  const [view, setView] = useState<AccountView>("cards");
  const categories = [
    ...new Set(accounts.map((account) => account.categoryName)),
  ];
  const currencies = [...new Set(accounts.map((account) => account.currency))];
  const institutions = [
    ...new Set(
      accounts.map((account) => account.institutionName).filter(Boolean),
    ),
  ] as string[];
  const visible = useMemo(
    () =>
      accounts
        .filter((account) => {
          const normalized = query.toLowerCase();
          return (
            (!normalized ||
              account.name.toLowerCase().includes(normalized) ||
              account.institutionName?.toLowerCase().includes(normalized)) &&
            (category === "all" || account.categoryName === category) &&
            (currency === "all" || account.currency === currency) &&
            (institution === "all" ||
              (institution === "unspecified"
                ? !account.institutionName
                : account.institutionName === institution)) &&
            (kind === "all" ||
              (kind === "liability"
                ? account.isLiability
                : !account.isLiability)) &&
            (tracking === "all" || account.trackingMode === tracking) &&
            priceState === "all"
          );
        })
        .sort((left, right) => {
          if (sort === "name") return left.name.localeCompare(right.name);
          if (sort === "category")
            return left.categoryName.localeCompare(right.categoryName);
          if (sort === "value")
            return Number(
              BigInt(right.currentValueMinor) - BigInt(left.currentValueMinor),
            );
          if (sort === "change") {
            if (left.monthlyChangeMinor == null) return 1;
            if (right.monthlyChangeMinor == null) return -1;
            return Number(
              BigInt(right.monthlyChangeMinor) -
                BigInt(left.monthlyChangeMinor),
            );
          }
          return 0;
        }),
    [
      accounts,
      category,
      currency,
      institution,
      kind,
      priceState,
      query,
      sort,
      tracking,
    ],
  );

  return (
    <>
      <div className="mb-5 grid gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div className="relative">
          <Search
            className="absolute left-3 top-3.5 text-slate-500"
            size={16}
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search accounts"
            className="pl-9"
            aria-label="Search accounts"
          />
        </div>
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select
          value={tracking}
          onChange={(event) => setTracking(event.target.value)}
          aria-label="Filter by tracking method"
        >
          <option value="all">All tracking methods</option>
          <option value="balance">Account value</option>
          <option value="positions">Units and prices</option>
        </Select>
        <Select
          value={priceState}
          onChange={(event) => setPriceState(event.target.value)}
          aria-label="Filter by price state"
        >
          <option value="all">All price states</option>
          <option value="complete">Complete prices</option>
          <option value="missing">Missing prices</option>
          <option value="stale">Stale prices</option>
        </Select>
        <Select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          aria-label="Filter by currency"
        >
          <option value="all">All currencies</option>
          {currencies.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select
          value={institution}
          onChange={(event) => setInstitution(event.target.value)}
          aria-label="Filter by institution"
        >
          <option value="all">All institutions</option>
          <option value="unspecified">Unspecified</option>
          {institutions.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          aria-label="Filter by asset type"
        >
          <option value="all">Assets & liabilities</option>
          <option value="asset">Assets</option>
          <option value="liability">Liabilities</option>
        </Select>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Sort accounts"
        >
          <option value="value">Value</option>
          <option value="name">Name</option>
          <option value="category">Category</option>
          <option value="change">Recent change</option>
          <option value="updated">Last updated</option>
        </Select>
        <div className="flex rounded-xl border border-white/10 p-1">
          <Button
            type="button"
            variant={view === "cards" ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setView("cards")}
            aria-label="Card view"
          >
            <Grid2X2 size={17} />
          </Button>
          <Button
            type="button"
            variant={view === "table" ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setView("table")}
            aria-label="Table view"
          >
            <List size={18} />
          </Button>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-slate-400">
          No accounts match these filters.
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((account) => (
            <Link
              key={account.id}
              to={`/accounts/${account.id}`}
              className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <Card className="h-full p-5 transition-colors group-hover:border-emerald-400/25 group-hover:bg-[var(--panel-raised)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-xl bg-white/[0.05] p-2.5 text-slate-300">
                      <Landmark size={19} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-100">
                        {account.name}
                      </h2>
                      <p className="truncate text-xs text-slate-500">
                        {account.institutionName || account.categoryName}
                      </p>
                    </div>
                  </div>
                  {account.archivedAt ? (
                    <Badge>Archived</Badge>
                  ) : account.isLiability ? (
                    <Badge tone="negative">Liability</Badge>
                  ) : account.trackingMode === "positions" ? (
                    <Badge tone="warning">Positions</Badge>
                  ) : null}
                </div>
                <div className="mt-7">
                  <MoneyValue
                    amount={account.currentValueMinor}
                    currency={account.currency}
                    className="text-2xl font-semibold tracking-tight text-white"
                  />
                  {account.currency !== baseCurrency ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {account.convertedValueMinor == null ? (
                        "Exchange rate needed"
                      ) : (
                        <>
                          <MoneyValue
                            amount={account.convertedValueMinor}
                            currency={baseCurrency}
                          />{" "}
                          in base currency
                        </>
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="mt-5 flex items-end justify-between border-t border-white/[0.06] pt-4 text-xs">
                  <div>
                    <p className="text-slate-500">30-day change</p>
                    {account.monthlyChangeMinor == null ? (
                      <IncompleteValue className="mt-1 block text-amber-300" />
                    ) : (
                      <span
                        className={
                          BigInt(account.monthlyChangeMinor) >= 0n
                            ? "mt-1 flex items-center gap-1 text-emerald-300"
                            : "mt-1 flex items-center gap-1 text-red-300"
                        }
                      >
                        {BigInt(account.monthlyChangeMinor) >= 0n ? (
                          <ArrowUpRight size={13} />
                        ) : (
                          <ArrowDownRight size={13} />
                        )}
                        <MoneyValue
                          amount={account.monthlyChangeMinor}
                          currency={baseCurrency}
                        />
                      </span>
                    )}
                  </div>
                  <div className="text-right text-slate-500">
                    <p>{account.categoryName}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-4">Account</th>
                <th className="p-4">Category</th>
                <th className="p-4">Value</th>
                <th className="p-4">Base value</th>
                <th className="p-4">30-day change</th>
                <th className="p-4">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {visible.map((account) => (
                <tr key={account.id} className="hover:bg-white/[0.025]">
                  <td className="p-4">
                    <Link
                      to={`/accounts/${account.id}`}
                      className="font-medium text-slate-100 hover:text-emerald-300"
                    >
                      {account.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {account.institutionName}
                    </p>
                  </td>
                  <td className="p-4 text-slate-400">{account.categoryName}</td>
                  <td className="p-4">
                    <MoneyValue
                      amount={account.currentValueMinor}
                      currency={account.currency}
                    />
                  </td>
                  <td className="p-4">
                    {account.convertedValueMinor != null ? (
                      <MoneyValue
                        amount={account.convertedValueMinor}
                        currency={baseCurrency}
                      />
                    ) : (
                      <span className="text-amber-300">Rate needed</span>
                    )}
                  </td>
                  <td
                    className={
                      account.monthlyChangeMinor == null
                        ? "p-4 text-amber-300"
                        : BigInt(account.monthlyChangeMinor) >= 0n
                          ? "p-4 text-emerald-300"
                          : "p-4 text-red-300"
                    }
                  >
                    {account.monthlyChangeMinor == null ? (
                      "Incomplete data"
                    ) : (
                      <MoneyValue
                        amount={account.monthlyChangeMinor}
                        currency={baseCurrency}
                      />
                    )}
                  </td>
                  <td className="p-4 text-slate-500">Not recorded</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function AccountsPage() {
  const state = useResource(() => Promise.all([getAccounts(), getSettings()]));
  return (
    <>
      <PageHeader
        title="Accounts & assets"
        description="Everything you own and owe, organized in one clear view."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/institutions">
                <Building2 size={17} />
                Institutions
              </Link>
            </Button>
            <Button asChild>
              <Link to="/accounts/new">
                <Plus size={17} />
                Add account
              </Link>
            </Button>
          </>
        }
      />
      <ResourceView state={state}>
        {([accounts, settings]) => (
          <AccountsList
            accounts={accounts.items}
            baseCurrency={settings.settings.baseCurrency}
          />
        )}
      </ResourceView>
    </>
  );
}

function DeleteTransactionButton({
  transaction,
  session,
  onChanged,
}: {
  transaction: Transaction;
  session: Session;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      aria-label="Delete transaction"
      onClick={async () => {
        if (
          !window.confirm(
            transaction.type === "transfer"
              ? "Delete both sides of this transfer?"
              : "Delete this transaction?",
          )
        )
          return;
        setPending(true);
        try {
          await deleteTransaction(transaction.id, session.csrfToken);
          onChanged();
        } finally {
          setPending(false);
        }
      }}
    >
      <Trash2 size={15} />
    </Button>
  );
}

export function TransactionsPage({ session }: PageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [accountID, setAccountID] = useState(
    () => searchParams.get("accountId") ?? "",
  );
  const [type, setType] = useState(() => searchParams.get("type") ?? "");
  const [flow, setFlow] = useState(() => searchParams.get("flow") ?? "");
  const [sort, setSort] = useState(() =>
    searchParams.get("sort") === "oldest" ? "oldest" : "newest",
  );
  const [from, setFrom] = useState(() => searchParams.get("from") ?? "");
  const [to, setTo] = useState(() => searchParams.get("to") ?? "");
  const state = useResource(
    () => Promise.all([getTransactions(), getAccounts()]),
    [refresh],
  );
  const filterParams = new URLSearchParams();
  if (query) filterParams.set("q", query);
  if (accountID) filterParams.set("accountId", accountID);
  if (type) filterParams.set("type", type);
  if (from) filterParams.set("from", from);
  if (to) filterParams.set("to", to);
  if (flow) filterParams.set("flow", flow);
  filterParams.set("sort", sort);
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Contributions, withdrawals, income, gains, fees, and transfers."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <a
                href={`/api/export/transactions.csv?${filterParams.toString()}`}
              >
                <Download size={17} />
                Export CSV
              </a>
            </Button>
            <Button asChild>
              <Link to="/transactions/new">
                <Plus size={17} />
                Record transaction
              </Link>
            </Button>
          </div>
        }
      />
      <ResourceView state={state}>
        {([transactions, accounts]) => {
          const rows = transactions.items
            .filter(
              (item) =>
                (!query ||
                  `${item.description ?? ""} ${item.notes ?? ""} ${item.accountName}`
                    .toLowerCase()
                    .includes(query.toLowerCase())) &&
                (!accountID || item.accountId === accountID) &&
                (!type || item.type === type) &&
                (!from || item.transactionDate >= from) &&
                (!to || item.transactionDate <= to) &&
                (!flow ||
                  (flow === "inflow"
                    ? ![
                        "withdrawal",
                        "capital_loss",
                        "fee",
                        "sale",
                        "liability_payment",
                      ].includes(item.type)
                    : [
                        "withdrawal",
                        "capital_loss",
                        "fee",
                        "sale",
                        "liability_payment",
                      ].includes(item.type))),
            )
            .sort((left, right) =>
              sort === "oldest"
                ? left.transactionDate.localeCompare(right.transactionDate)
                : right.transactionDate.localeCompare(left.transactionDate),
            );
          const clear = () => {
            setQuery("");
            setAccountID("");
            setType("");
            setFlow("");
            setSort("newest");
            setFrom("");
            setTo("");
            setSearchParams({});
          };
          return (
            <>
              <div className="mb-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSearchParams(filterParams);
                  }}
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                >
                  <div className="relative sm:col-span-2">
                    <Search
                      className="absolute left-3 top-3.5 text-slate-500"
                      size={16}
                    />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search descriptions, notes, or accounts"
                      className="pl-9"
                      aria-label="Search transactions"
                    />
                  </div>
                  <Select
                    value={accountID}
                    onChange={(event) => setAccountID(event.target.value)}
                    aria-label="Filter by account"
                  >
                    <option value="">All accounts</option>
                    {accounts.items.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                        {account.archivedAt ? " (archived)" : ""}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                    aria-label="Filter by transaction type"
                  >
                    <option value="">All transaction types</option>
                    {transactionTypes.map((value) => (
                      <option key={value} value={value}>
                        {transactionLabels[value]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={flow}
                    onChange={(event) => setFlow(event.target.value)}
                    aria-label="Filter by amount direction"
                  >
                    <option value="">All amount directions</option>
                    <option value="inflow">Money in</option>
                    <option value="outflow">Money out</option>
                  </Select>
                  <Select
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                    aria-label="Sort transactions"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </Select>
                  <div>
                    <Label htmlFor="transaction-from">From date</Label>
                    <Input
                      id="transaction-from"
                      type="date"
                      value={from}
                      onChange={(event) => setFrom(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="transaction-to">To date</Label>
                    <Input
                      id="transaction-to"
                      type="date"
                      value={to}
                      onChange={(event) => setTo(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
                    <Button type="submit" size="sm">
                      <SlidersHorizontal size={15} />
                      Apply filters
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clear}
                    >
                      <RotateCcw size={15} />
                      Clear
                    </Button>
                  </div>
                </form>
              </div>
              {rows.length === 0 ? (
                <EmptyState
                  icon={<ArrowLeftRight size={24} />}
                  title={
                    transactions.items.length
                      ? "No transactions match these filters."
                      : "No activity yet"
                  }
                  description={
                    transactions.items.length
                      ? "Clear or change the active filters."
                      : "Record your first deposit, valuation, or transfer."
                  }
                  action={
                    <Button asChild>
                      <Link to="/transactions/new">Record activity</Link>
                    </Button>
                  }
                />
              ) : (
                <>
                  <Card>
                    <CardContent className="p-0">
                      <div className="divide-y divide-white/[0.06]">
                        {rows.map((transaction) => {
                          const negative =
                            [
                              "withdrawal",
                              "capital_loss",
                              "fee",
                              "sale",
                              "liability_payment",
                            ].includes(transaction.type) ||
                            transaction.amountMinor.startsWith("-");
                          return (
                            <div
                              key={transaction.id}
                              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <span
                                  className={
                                    negative
                                      ? "h-2 w-2 shrink-0 rounded-full bg-red-400"
                                      : "h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                                  }
                                />
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium text-slate-100">
                                      {transactionLabels[transaction.type] ??
                                        humanize(transaction.type)}
                                    </p>
                                    {transaction.type === "transfer" ? (
                                      <Badge tone="info">Transfer</Badge>
                                    ) : null}
                                  </div>
                                  <p className="truncate text-xs text-slate-500">
                                    <Link
                                      to={`/accounts/${transaction.accountId}`}
                                      className="hover:text-emerald-300"
                                    >
                                      {transaction.accountName}
                                    </Link>
                                    {" · "}
                                    {formatDate(transaction.transactionDate)}
                                    {transaction.description
                                      ? ` · ${transaction.description}`
                                      : ""}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2 sm:justify-end">
                                <MoneyValue
                                  amount={transaction.amountMinor}
                                  currency={transaction.currency}
                                  className={
                                    negative
                                      ? "font-medium text-red-300"
                                      : "font-medium text-emerald-300"
                                  }
                                />
                                {transaction.type !== "opening_balance" &&
                                transaction.type !== "transfer" ? (
                                  <Button
                                    asChild
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Edit transaction"
                                  >
                                    <Link
                                      to={`/transactions/${transaction.id}/edit`}
                                    >
                                      <Edit3 size={15} />
                                    </Link>
                                  </Button>
                                ) : null}
                                {transaction.type !== "opening_balance" ? (
                                  <DeleteTransactionButton
                                    transaction={transaction}
                                    session={session}
                                    onChanged={() =>
                                      setRefresh((value) => value + 1)
                                    }
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  <div className="mt-4 flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      Showing {rows.length} of up to 100 transactions on this
                      page.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" disabled>
                        <ArrowLeft size={15} />
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!transactions.hasMore}
                      >
                        Next
                        <ArrowRight size={15} />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          );
        }}
      </ResourceView>
    </>
  );
}

function Metric({
  label,
  value,
  currency,
  primary,
}: {
  label: string;
  value?: string;
  currency: string;
  primary?: boolean;
}) {
  return (
    <Card className="p-5" role="group" aria-label={`${label} metric`}>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      {value == null ? (
        <IncompleteValue className="mt-3 block text-sm font-medium text-amber-300" />
      ) : (
        <MoneyValue
          amount={value}
          currency={currency}
          className={
            primary
              ? "mt-3 block text-2xl font-semibold text-white"
              : "mt-3 block text-xl font-semibold text-slate-100"
          }
        />
      )}
    </Card>
  );
}

function Quick({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
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

function ActivityRows({ items }: { items: ActivityItem[] }) {
  if (!items.length)
    return (
      <p className="py-10 text-center text-sm text-slate-500">
        No recent activity.
      </p>
    );
  return (
    <div className="divide-y divide-white/[0.06]">
      {items.slice(0, 8).map((item) => (
        <div
          key={`${item.kind}-${item.id}`}
          className="flex items-center justify-between gap-3 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-200">
              {transactionLabels[item.type] ?? humanize(item.type)}
            </p>
            <p className="truncate text-xs text-slate-500">
              {formatDate(item.date)}
              {item.description ? ` · ${item.description}` : ""}
            </p>
          </div>
          <MoneyValue
            amount={item.amountMinor}
            currency={item.currency}
            className="text-sm"
          />
        </div>
      ))}
    </div>
  );
}

export function AccountDetailPage({ session }: PageProps) {
  const { id = "" } = useParams();
  const [refresh, setRefresh] = useState(0);
  const state = useResource(
    () =>
      Promise.all([
        getAccount(id),
        getAccountAnalytics(id),
        getAccountActivity(id),
        getAccountValuations(id),
        getGoals(),
      ]),
    [id, refresh],
  );
  return (
    <ResourceView state={state} loadingLabel="Loading account...">
      {([account, analytics, activity, valuations, goals]) => {
        const linkedGoals = goals.filter(
          (goal) => goal.linkedAccount?.id === id,
        );
        return (
          <>
            <PageHeader
              title={account.name}
              description={[account.institutionName, account.categoryName]
                .filter(Boolean)
                .join(" · ")}
              actions={
                <>
                  {!account.isLiability ? (
                    <Button asChild variant="secondary">
                      <Link
                        to={`/estate/distribution?account=${id}#asset-${id}`}
                      >
                        <ScrollText size={16} />
                        Estate plan
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild variant="secondary">
                    <Link to={`/accounts/${id}/edit`}>
                      <Edit3 size={16} />
                      Edit
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link
                      to={
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
            {account.trackingMode === "positions" && analytics.positionSummary ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Current value" value={account.currentValueMinor} currency={account.currency} primary />
                <Metric label="Cash" value={analytics.positionSummary.cashMinor} currency={account.currency} />
                <Metric label="Positions" value={analytics.positionSummary.positionsMinor} currency={account.currency} />
                <Card className="p-5">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Data quality</p>
                  <Badge tone={analytics.positionSummary.complete ? "positive" : "warning"}>
                    {analytics.positionSummary.complete ? "Complete" : "Incomplete"}
                  </Badge>
                </Card>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label={account.isLiability ? "Amount owed" : "Current value"} value={account.currentValueMinor} currency={account.currency} primary />
                <Metric label="Contributions" value={analytics.metrics.contributionsMinor} currency={account.currency} />
                <Metric label="Income" value={analytics.metrics.incomeMinor} currency={account.currency} />
                <Metric label="Valuation change" value={analytics.metrics.estimatedGainMinor} currency={account.currency} />
              </div>
            )}
            {account.trackingMode === "positions" &&
            analytics.movementAttribution ? (
              <Card className="mt-5">
                <CardHeader>
                  <div>
                    <CardTitle>Movement attribution</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">
                      Exact bridge from recorded cash, quantities, prices, and
                      currencies.
                    </p>
                  </div>
                  <Badge
                    tone={
                      analytics.movementAttribution.complete
                        ? "positive"
                        : "warning"
                    }
                  >
                    {analytics.movementAttribution.complete
                      ? "Complete"
                      : "Incomplete"}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      [
                        "External cash",
                        analytics.movementAttribution.externalCashMinor,
                      ],
                      ["Income", analytics.movementAttribution.incomeMinor],
                      ["Fees", analytics.movementAttribution.feesMinor],
                      [
                        "Internal trade cash",
                        analytics.movementAttribution.internalTradeCashMinor,
                      ],
                      [
                        "Quantity changes",
                        analytics.movementAttribution.quantityMovementMinor,
                      ],
                      [
                        "Price movement",
                        analytics.movementAttribution.priceMovementMinor,
                      ],
                      [
                        "Currency movement",
                        analytics.movementAttribution.currencyMovementMinor,
                      ],
                      [
                        "Unattributed",
                        analytics.movementAttribution.unattributedMinor,
                      ],
                    ].map(([label, amount]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-white/10 p-3"
                      >
                        <p className="text-xs text-slate-500">{label}</p>
                        <MoneyValue
                          amount={amount}
                          currency={account.currency}
                          className="mt-1 font-semibold"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-amber-200">
                    {analytics.movementAttribution.returnMessage}
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
                      {account.trackingMode === "positions"
                        ? "Cash, quantities, and effective-dated prices"
                        : "Balance reconstructed from all activity"}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  {!analytics.historyComplete &&
                  analytics.completenessReasons.length ? (
                    <p className="mb-3 text-xs text-amber-200">
                      {analytics.completenessReasons.join(" ")}
                    </p>
                  ) : null}
                  <AccountHistoryChart
                    data={analytics.history}
                    currency={analytics.currency}
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
                        to={`/accounts/${id}/positions/new?type=buy`}
                        icon={<CandlestickChart size={17} />}
                        label="Buy"
                      />
                      <Quick
                        to={`/accounts/${id}/positions/new?type=sell`}
                        icon={<CandlestickChart size={17} />}
                        label="Sell"
                      />
                      <Quick
                        to={`/accounts/${id}/prices/new`}
                        icon={<TrendingUp size={17} />}
                        label="Price"
                      />
                      <Quick
                        to={`/accounts/${id}/reconcile`}
                        icon={<Scale size={17} />}
                        label="Reconcile"
                      />
                      <Quick
                        to={`/accounts/${id}/investment-actions?command=reinvestment`}
                        icon={<RefreshCw size={17} />}
                        label="Reinvest"
                      />
                      <Quick
                        to={`/accounts/${id}/investment-actions?command=in_kind_transfer`}
                        icon={<ArrowLeftRight size={17} />}
                        label="Move units"
                      />
                      <Quick
                        to={`/accounts/${id}/investment-actions?command=split`}
                        icon={<GitBranch size={17} />}
                        label="Corp action"
                      />
                    </>
                  ) : null}
                  <Quick
                    to={`/transactions/new?accountId=${id}&type=deposit`}
                    icon={<ArrowDownToLine size={17} />}
                    label="Deposit"
                  />
                  <Quick
                    to={`/transactions/new?accountId=${id}&type=withdrawal`}
                    icon={<ArrowUpFromLine size={17} />}
                    label="Withdraw"
                  />
                  <Quick
                    to={`/transactions/new?accountId=${id}&type=interest`}
                    icon={<TrendingUp size={17} />}
                    label="Interest"
                  />
                  <Quick
                    to={`/transactions/new?accountId=${id}&type=transfer`}
                    icon={<ArrowLeftRight size={17} />}
                    label="Transfer"
                  />
                  {account.trackingMode === "balance" ? (
                    <>
                      <Quick
                        to={`/accounts/${id}/valuation`}
                        icon={<Sparkles size={17} />}
                        label="Value"
                      />
                      <Quick
                        to={`/accounts/${id}/convert`}
                        icon={<RefreshCw size={17} />}
                        label="Convert"
                      />
                    </>
                  ) : null}
                  <Quick
                    to={`/transactions/new?accountId=${id}&type=fee`}
                    icon={<Landmark size={17} />}
                    label="Fee"
                  />
                  <Quick
                    to={`/accounts/${id}/import`}
                    icon={<FileInput size={17} />}
                    label="Import"
                  />
                </CardContent>
              </Card>
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              {account.trackingMode === "balance" ? (
                <Card id="transactions" className="scroll-mt-24">
                  <CardHeader>
                    <div>
                      <CardTitle>Transactions</CardTitle>
                      <p className="mt-1 text-xs text-slate-500">
                        Newest account activity first
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/transactions?accountId=${id}`}>
                        View all
                        <ArrowRight size={15} />
                      </Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <ActivityRows
                      items={activity.items.filter(
                        (item) => item.kind === "transaction",
                      )}
                    />
                  </CardContent>
                </Card>
              ) : null}
              <Card>
                <CardHeader>
                  <CardTitle>Valuation history</CardTitle>
                </CardHeader>
                <CardContent>
                  {valuations.items.length ? (
                    <div className="divide-y divide-white/[0.06]">
                      {valuations.items.map((valuation) => (
                        <ValuationRow
                          key={valuation.id}
                          valuation={valuation}
                          session={session}
                          onChanged={() => setRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="py-10 text-center text-sm text-slate-500">
                      No manual valuations yet.
                    </p>
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
                  <Detail
                    label="Institution"
                    value={account.institutionName || "Not set"}
                  />
                  <Detail
                    label="Reference"
                    value={account.accountReference || "Not set"}
                  />
                  {account.trackingMode === "balance" ? (
                    <Detail
                      label="Cost basis"
                      value={account.costBasisMinor ?? "Not set"}
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
                        to={`/goals/${goal.id}`}
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
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Archive this account? Its records remain available for recovery or permanent deletion.",
                    )
                  )
                    return;
                  await archiveAccount(id, true, session.csrfToken);
                  setRefresh((value) => value + 1);
                }}
              >
                <Archive size={16} />
                Archive account
              </Button>
            </div>
          </>
        );
      }}
    </ResourceView>
  );
}

function ValuationRow({
  valuation,
  session,
  onChanged,
}: {
  valuation: Valuation;
  session: Session;
  onChanged: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-medium">
          <MoneyValue
            amount={valuation.valueMinor}
            currency={valuation.currency}
          />
        </p>
        <p className="text-xs text-slate-500">
          {formatDate(valuation.valuationDate)}
          {valuation.notes ? ` · ${valuation.notes}` : ""}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete valuation"
        onClick={async () => {
          if (
            !window.confirm(
              "Delete this valuation? Later activity will be replayed from the previous value.",
            )
          )
            return;
          await deleteValuation(valuation.id, session.csrfToken);
          onChanged();
        }}
      >
        <Trash2 size={15} />
      </Button>
    </div>
  );
}

function AccountRouteData({
  children,
}: PageProps & {
  children: (
    data: Awaited<ReturnType<typeof getAccounts>>["items"],
    categories: Awaited<ReturnType<typeof getCategories>>["items"],
    institutions: Awaited<ReturnType<typeof getInstitutions>>["items"],
  ) => React.ReactNode;
}) {
  const state = useResource(() =>
    Promise.all([getAccounts(), getCategories(), getInstitutions()]),
  );
  return (
    <ResourceView state={state}>
      {([accounts, categories, institutions]) =>
        children(accounts.items, categories.items, institutions.items)
      }
    </ResourceView>
  );
}

export function NewAccountPage({ session }: PageProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add an account or asset"
        description="Track one monetary value or use units and prices for an investment account."
      />
      <AccountRouteData session={session}>
        {(_accounts, categories, institutions) => (
          <AccountCreateForm
            categories={categories}
            institutions={institutions}
            session={session}
            onChanged={() => undefined}
          />
        )}
      </AccountRouteData>
    </div>
  );
}

export function EditAccountPage({ session }: PageProps) {
  const { id = "" } = useParams();
  const state = useResource(() =>
    Promise.all([getAccount(id), getCategories(), getInstitutions()]),
  );
  return (
    <div className="mx-auto max-w-3xl">
      <ResourceView state={state}>
        {([account, categories, institutions]) => (
          <>
            <PageHeader
              title={`Edit ${account.name}`}
              description="Account history and currency remain unchanged."
            />
            <AccountControls
              account={account}
              categories={categories.items}
              institutions={institutions.items}
              session={session}
              onChanged={() => undefined}
            />
          </>
        )}
      </ResourceView>
    </div>
  );
}

export function NewTransactionPage({ session }: PageProps) {
  const [searchParams] = useSearchParams();
  const state = useResource(getAccounts);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Record activity"
        description="Balances are recalculated from transaction and valuation history."
      />
      <ResourceView state={state}>
        {({ items }) => {
          const account =
            items.find((item) => item.id === searchParams.get("accountId")) ??
            items[0];
          return account ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {transactionLabels[searchParams.get("type") ?? "deposit"] ??
                    "Transaction details"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TransactionForm
                  account={account}
                  session={session}
                  onChanged={() => undefined}
                />
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<Landmark size={24} />}
              title="No accounts yet"
              description="Add an account before recording activity."
            />
          );
        }}
      </ResourceView>
    </div>
  );
}

export function EditTransactionPage({ session }: PageProps) {
  const { id = "" } = useParams();
  const state = useResource(() =>
    Promise.all([getTransactions(), getAccounts()]),
  );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Edit transaction"
        description="Saving will replay this account’s complete history."
      />
      <ResourceView state={state}>
        {([transactions, accounts]) => {
          const transaction = transactions.items.find((item) => item.id === id);
          const account = transaction
            ? accounts.items.find((item) => item.id === transaction.accountId)
            : undefined;
          return transaction && account ? (
            <Card>
              <CardHeader>
                <CardTitle>Transaction details</CardTitle>
              </CardHeader>
              <CardContent>
                <TransactionForm
                  account={account}
                  transaction={transaction}
                  session={session}
                  onChanged={() => undefined}
                />
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<ArrowLeftRight size={24} />}
              title="Transaction not found"
              description="Return to transactions and choose an editable transaction."
            />
          );
        }}
      </ResourceView>
    </div>
  );
}

function AccountWorkflowPage({
  session,
  title,
  description,
  mode,
}: PageProps & {
  title: (account: Account) => string;
  description: (account: Account) => string;
  mode:
    | "ledger"
    | "conversion"
    | "positions"
    | "reconcile"
    | "import"
    | "corporate";
}) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const command = searchParams.get("command");
  const corporateActionKind =
    command === "reinvestment"
      ? "dividend-reinvestments"
      : command === "in_kind_transfer"
        ? "in-kind-transfers"
        : "stock-splits";
  const [refresh, setRefresh] = useState(0);
  const state = useResource(
    () =>
      Promise.all([
        getAccount(id),
        getAccounts(),
        getAccountTransactions(id),
        getAccountValuations(id),
        getInstruments(),
        getAccountPositionEvents(id),
        getAccountPositionReconciliations(id),
      ]),
    [id, refresh],
  );
  return (
    <ResourceView state={state}>
      {([
        account,
        accounts,
        transactions,
        valuations,
        instruments,
        events,
        reconciliations,
      ]) => (
        <div
          className={
            mode === "conversion" ? "mx-auto max-w-5xl" : "mx-auto max-w-3xl"
          }
        >
          <PageHeader
            title={title(account)}
            description={description(account)}
          />
          {mode === "ledger" ? (
            <LedgerManager
              account={account}
              transactions={transactions.items}
              valuations={valuations.items}
              allAccounts={accounts.items}
              session={session}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          ) : mode === "conversion" ? (
            <AccountConversionForm
              account={account}
              instruments={instruments.instruments}
              session={session}
              onConverted={(targetID) => navigate(`/accounts/${targetID}`)}
            />
          ) : mode === "import" ? (
            <ImportWorkspace
              account={account}
              session={session}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          ) : mode === "corporate" ? (
            <CorporateActionsPanel
              account={account}
              accounts={accounts.items}
              instruments={instruments.instruments}
              events={events.items}
              session={session}
              onChanged={() => setRefresh((value) => value + 1)}
              initialKind={corporateActionKind}
            />
          ) : (
            <PositionTools
              account={account}
              instruments={instruments.instruments}
              events={events.items}
              reconciliations={reconciliations.items}
              session={session}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          )}
        </div>
      )}
    </ResourceView>
  );
}

export function ValuationPage(props: PageProps) {
  return (
    <AccountWorkflowPage
      {...props}
      title={() => "Update asset value"}
      description={(account) =>
        `Record a point-in-time valuation for ${account.name}. This is not counted as a contribution.`
      }
      mode="ledger"
    />
  );
}
export function ConvertAccountPage(props: PageProps) {
  return (
    <AccountWorkflowPage
      {...props}
      title={() => "Convert to position tracking"}
      description={(account) =>
        `Preserve ${account.name} as archived history and create an explicit cash-and-holdings replacement.`
      }
      mode="conversion"
    />
  );
}
export function ReconcilePositionAccountPage(props: PageProps) {
  return (
    <AccountWorkflowPage
      {...props}
      title={() => "Reconcile statement"}
      description={() =>
        "Compare a broker-reported total without changing holdings or prices."
      }
      mode="reconcile"
    />
  );
}
export function AccountHistoryImportPage(props: PageProps) {
  return (
    <AccountWorkflowPage
      {...props}
      title={(account) => `Import history for ${account.name}`}
      description={(account) =>
        `${account.institutionName || "No institution"} · ${account.currency} · Preview a prepared ${account.trackingMode === "positions" ? "Investment History" : "Account History"} v1 file before changing this account.`
      }
      mode="import"
    />
  );
}
export function InvestmentActionsPage(props: PageProps) {
  return (
    <AccountWorkflowPage
      {...props}
      title={() => "Investment action"}
      description={(account) =>
        `Record grouped and non-cash position changes for ${account.name}.`
      }
      mode="corporate"
    />
  );
}
export function NewPositionEventPage(props: PageProps) {
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type");
  return (
    <AccountWorkflowPage
      {...props}
      title={() =>
        type && type !== "opening_position"
          ? "Record position activity"
          : "Add holding"
      }
      description={(account) =>
        `Update quantities and account cash for ${account.name}.`
      }
      mode="positions"
    />
  );
}
export function EditPositionEventPage(props: PageProps) {
  return (
    <AccountWorkflowPage
      {...props}
      title={() => "Correct position activity"}
      description={() =>
        "Every later quantity, cash balance, and account value will be replayed."
      }
      mode="positions"
    />
  );
}

export function NewAccountInstrumentPage({ session }: PageProps) {
  const { id = "" } = useParams();
  const state = useResource(() => getAccount(id));
  return (
    <div className="mx-auto max-w-3xl">
      <ResourceView state={state}>
        {(account) => (
          <>
            <PageHeader
              title="Add instrument"
              description={`Create a security reference for ${account.name}${account.trackingMode === "balance" ? " before conversion" : ""}.`}
            />
            <Card>
              <CardHeader>
                <CardTitle>Instrument details</CardTitle>
              </CardHeader>
              <CardContent>
                <InstrumentForm session={session} onChanged={() => undefined} />
              </CardContent>
            </Card>
          </>
        )}
      </ResourceView>
    </div>
  );
}

export function NewSecurityPricePage({ session }: PageProps) {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const instrumentID = searchParams.get("instrumentId") ?? "";
  const state = useResource(
    () =>
      Promise.all([
        getAccount(id),
        getInstruments(),
        getAccountPositionEvents(id),
      ]).then(([account, { instruments }, events]) => {
        const selectedInstrumentID =
          instrumentID || events.items[0]?.instrumentId;
        return [
          account,
          instruments.find((item) => item.id === selectedInstrumentID) ?? null,
        ] as const;
      }),
    [id, instrumentID],
  );
  return (
    <div className="mx-auto max-w-3xl">
      <ResourceView state={state}>
        {([account, instrument]) => (
          <>
            <PageHeader
              title="Update security price"
              description={`Record an effective-dated price for ${account.name}.`}
            />
            {instrument ? (
              <InstrumentManager
                instrument={instrument}
                prices={[]}
                session={session}
                onChanged={() => undefined}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Price observation</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="py-10 text-center text-sm text-slate-500">
                    No positions recorded.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </ResourceView>
    </div>
  );
}

export function ArchivedAccountsPage({}: PageProps) {
  return (
    <>
      <PageHeader
        title="Archived accounts"
        actions={
          <Button asChild variant="secondary">
            <Link to="/settings">
              <ArrowLeft size={16} />
              Settings
            </Link>
          </Button>
        }
      />
      <p className="py-10 text-sm text-slate-500">No archived accounts.</p>
    </>
  );
}

export const coreRouteIntents = [
  "/",
  "/accounts",
  "/accounts/archived",
  "/accounts/:id",
  "/accounts/new",
  "/accounts/:id/edit",
  "/accounts/:id/valuation",
  "/accounts/:id/convert",
  "/accounts/:id/reconcile",
  "/accounts/:id/import",
  "/accounts/:id/investment-actions",
  "/accounts/:id/instruments/new",
  "/accounts/:id/positions/new",
  "/accounts/:id/positions/:eventId/edit",
  "/accounts/:id/prices/new",
  "/transactions",
  "/transactions/new",
  "/transactions/:id/edit",
] as const;

export type CoreRouteIntent = (typeof coreRouteIntents)[number];
