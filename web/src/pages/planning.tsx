import {
  ArchiveRestore,
  Award,
  BarChart3,
  BellRing,
  CalendarClock,
  Coins,
  Edit3,
  Flag,
  GitCompareArrows,
  Goal as GoalIcon,
  Link2,
  Pause,
  Play,
  Plus,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";

import {
  archiveInstrument,
  createMilestone,
  deleteGoal,
  deleteInstrument,
  deleteMilestone,
  dismissGoalAlert,
  getAccountActivity,
  getAccounts,
  getCategories,
  getGoal,
  getGoalAlerts,
  getGoalMilestones,
  getGoals,
  getInstitutions,
  getInstrument,
  getInstruments,
  getReportAllocation,
  getReportSummary,
  setGoalStatus,
} from "@/api/client";
import {
  AllocationChart,
  ContributionsGrowthChart,
  GoalProjectionChart,
  NetWorthChart,
} from "@/components/charts";
import {
  Badge as OriginalBadge,
  Button,
  Card as OriginalCard,
  CardContent,
  CardHeader as OriginalCardHeader,
  CardTitle as OriginalCardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader as OriginalPageHeader,
  Progress,
} from "@/components/ui/core";
import {
  CategoryManager,
  GoalForm,
  InstitutionManager,
  InstrumentForm,
} from "@/components/planning/support";
import { MoneyValue } from "@/components/privacy";
import type { Goal, GoalAlert, GoalMilestone, Session } from "@/lib/types";
import { formatDate, ResourceView } from "@/components/ui/resource";
import { useResource } from "@/hooks/use-resource";

const PageHeader = OriginalPageHeader;
const Card = OriginalCard;
const Badge = OriginalBadge;

function CardHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string;
  aside?: React.ReactNode;
}) {
  return (
    <OriginalCardHeader>
      <div>
        <OriginalCardTitle>{title}</OriginalCardTitle>
        {description ? (
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      {aside}
    </OriginalCardHeader>
  );
}

export function PortedGoalsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(
    () => Promise.all([getGoals(), getGoalAlerts(), getAccounts()]),
    [refresh],
  );

  return (
    <>
      <OriginalPageHeader
        title="Financial goals"
        description="Turn linked account balances into clear timelines and contribution targets."
        actions={
          <Button asChild>
            <Link to="/goals/new">
              <Plus size={17} />
              Create goal
            </Link>
          </Button>
        }
      />
      <ResourceView state={state}>
        {([goals, alerts]) => {
          const active = goals.filter((goal) => goal.status === "active");
          const totalTarget = sumMinor(
            active,
            (goal) => goal.targetAmountMinor,
          );
          const totalSaved = sumMinor(
            active,
            (goal) => goal.currentAmountMinor,
          );
          const monthly = sumMinor(
            active,
            (goal) => goal.plan?.plannedContributionMinor ?? "0",
          );
          const onTrack = active.filter((goal) => !goal.valueIncomplete).length;
          const currency = active[0]?.currency ?? goals[0]?.currency ?? "KES";

          return (
            <>
              <GoalAlerts
                alerts={alerts}
                session={session}
                onChanged={() => setRefresh((value) => value + 1)}
              />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <Summary
                  label="Active target"
                  value={
                    <MoneyValue amount={totalTarget} currency={currency} />
                  }
                  icon={<Flag size={17} />}
                />
                <Summary
                  label="Amount saved"
                  value={<MoneyValue amount={totalSaved} currency={currency} />}
                  icon={<TrendingUp size={17} />}
                />
                <Summary
                  label="Monthly plan"
                  value={<MoneyValue amount={monthly} currency={currency} />}
                  icon={<CalendarClock size={17} />}
                />
                <Summary
                  label="On track"
                  value={`${onTrack} goals`}
                  icon={<GoalIcon size={17} />}
                />
                <Summary
                  label="Behind"
                  value={`${active.length - onTrack} goals`}
                  icon={<Flag size={17} />}
                />
              </div>
              {goals.length === 0 ? (
                <div className="mt-5">
                  <EmptyState
                    icon={<GoalIcon size={24} />}
                    title="No goals yet"
                    description="Create a target and optionally link it to an account."
                    action={
                      <Button asChild>
                        <Link to="/goals/new">Create your first goal</Link>
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {goals.map((goal) => (
                    <GoalCard key={goal.id} goal={goal} />
                  ))}
                </div>
              )}
            </>
          );
        }}
      </ResourceView>
    </>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const requiredMonthly = requiredMonthlyForGoal(goal);
  const tracking =
    goal.valueIncomplete ||
    BigInt(goal.plan?.plannedContributionMinor ?? "0") < BigInt(requiredMonthly)
      ? "behind"
      : "on_track";
  return (
    <Link
      to={`/goals/${goal.id}`}
      className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
    >
      <OriginalCard className="h-full transition-colors group-hover:border-emerald-400/25">
        <OriginalCardHeader>
          <div>
            <OriginalCardTitle className="text-base">
              {goal.name}
            </OriginalCardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {goal.linkedAccount?.name || "Directly tracked goal"}
            </p>
          </div>
          <OriginalBadge tone={tracking === "behind" ? "warning" : "positive"}>
            {tracking.replace("_", " ")}
          </OriginalBadge>
        </OriginalCardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-3">
            <MoneyValue
              amount={goal.currentAmountMinor}
              currency={goal.currentAmountCurrency}
              className="text-xl font-semibold text-white"
            />
            <span className="text-xs text-slate-500">
              of{" "}
              <MoneyValue
                amount={goal.targetAmountMinor}
                currency={goal.currency}
              />
            </span>
          </div>
          <Progress
            value={Number(goal.progressPercent)}
            label={`${goal.name} progress`}
            className="mt-4"
          />
          {goal.valueIncomplete ? (
            <p className="mt-2 text-xs text-amber-300">
              Add a price or exchange rate to calculate linked progress.
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4 text-xs">
            <div>
              <p className="text-slate-500">
                Required monthly ({goal.assumedAnnualReturnBps / 100}% return)
              </p>
              <p className="mt-1 text-slate-200">
                <MoneyValue amount={requiredMonthly} currency={goal.currency} />
              </p>
            </div>
            <div className="text-right">
              <p className="text-slate-500">Target date</p>
              <p className="mt-1 text-slate-200">
                {formatMonthYear(goal.targetDate)}
              </p>
            </div>
          </div>
        </CardContent>
      </OriginalCard>
    </Link>
  );
}

export function PortedNewGoalPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const state = useResource(getAccounts);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Create a financial goal"
        description="Link an account to avoid duplicating balances."
      />
      <ResourceView state={state}>
        {(accounts) => (
          <Card>
            <CardHeader title="Goal plan" />
            <CardContent>
              <GoalForm
                accounts={accounts.items}
                session={session}
                onChanged={() => navigate("/goals")}
              />
            </CardContent>
          </Card>
        )}
      </ResourceView>
    </div>
  );
}

export function PortedEditGoalPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const state = useResource(
    () => Promise.all([getGoal(id), getAccounts()]),
    [id],
  );
  return (
    <ResourceView state={state} loadingLabel="Loading goal...">
      {([goal, accounts]) => (
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title={`Edit ${goal.name}`}
            description="Update the target, link, contribution plan, or forecast assumption."
          />
          <Card>
            <CardHeader title="Goal plan" />
            <CardContent>
              <GoalForm
                goal={goal}
                accounts={accounts.items}
                session={session}
                onChanged={() => navigate(`/goals/${id}`)}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceView>
  );
}

export function PortedGoalDetailPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [refresh, setRefresh] = useState(0);
  const state = useResource(async () => {
    const [goal, milestones] = await Promise.all([
      getGoal(id),
      getGoalMilestones(id),
    ]);
    const activity = goal.linkedAccount
      ? await getAccountActivity(goal.linkedAccount.id)
      : { items: [], limit: 100, offset: 0, hasMore: false };
    return { goal, milestones, activity };
  }, [id, refresh]);

  return (
    <ResourceView state={state} loadingLabel="Loading goal...">
      {({ goal, milestones, activity }) => {
        const paused = goal.status === "paused";
        const requiredMonthly = requiredMonthlyForGoal(goal);
        const contributions = activity.items.filter(
          (item) =>
            item.kind === "transaction" &&
            ["opening_balance", "deposit", "purchase"].includes(item.type),
        );
        return (
          <>
            <PageHeader
              title={goal.name}
              description={goal.description || "Goal progress and forecast"}
              actions={
                <>
                  <Button asChild variant="secondary">
                    <Link to={`/goals/${id}/edit`}>
                      <Edit3 size={16} /> Edit goal
                    </Link>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void setGoalStatus(
                        id,
                        paused ? "active" : "paused",
                        session.csrfToken,
                      ).then(() => setRefresh((value) => value + 1))
                    }
                  >
                    {paused ? <Play size={16} /> : <Pause size={16} />}
                    {paused ? "Resume" : "Pause"}
                  </Button>
                </>
              }
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Current progress"
                value={
                  <MoneyValue
                    amount={goal.currentAmountMinor}
                    currency={goal.currentAmountCurrency}
                  />
                }
                icon={<TrendingUp size={17} />}
              />
              <Stat
                label="Target"
                value={
                  <MoneyValue
                    amount={goal.targetAmountMinor}
                    currency={goal.currency}
                  />
                }
                icon={<CalendarClock size={17} />}
              />
              <Stat
                label={`Required monthly (${goal.assumedAnnualReturnBps / 100}% return)`}
                value={
                  <MoneyValue
                    amount={requiredMonthly}
                    currency={goal.currency}
                  />
                }
                icon={<CalendarClock size={17} />}
              />
              <Stat
                label="Current monthly plan"
                value={
                  <MoneyValue
                    amount={goal.plan?.plannedContributionMinor ?? "0"}
                    currency={goal.currency}
                  />
                }
                icon={<TrendingUp size={17} />}
              />
            </div>
            {goal.valueIncomplete ? (
              <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
                Add the missing security price or exchange rate before relying
                on linked progress or forecasts.
              </div>
            ) : null}
            <Card className="mt-5">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Overall progress</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Target {formatDate(goal.targetDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge tone={goal.valueIncomplete ? "warning" : "positive"}>
                      {goal.valueIncomplete ? "behind" : "on track"}
                    </Badge>
                    <p className="mt-2 text-lg font-semibold">
                      {goal.progressPercent}%
                    </p>
                  </div>
                </div>
                <Progress
                  value={Number(goal.progressPercent)}
                  label={`${goal.name} progress`}
                  className="mt-4 h-3"
                />
              </CardContent>
            </Card>
            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,.8fr)]">
              <Card>
                <CardHeader
                  title="Projection"
                  description={`Estimate assumes ${goal.assumedAnnualReturnBps / 100}% annual return and current planned contributions. Actual returns will vary.`}
                />
                <CardContent>
                  <GoalProjectionChart data={goal.projection} currency={goal.currency} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="Forecast details" />
                <CardContent className="space-y-4 text-sm">
                  <Row
                    label="Tracking status"
                    value={goal.valueIncomplete ? "behind" : "on track"}
                  />
                  <Row
                    label="Estimated completion"
                    value={forecastDateForGoal(goal)}
                  />
                  <Row
                    label="Target date"
                    value={formatMonthYear(goal.targetDate)}
                  />
                  <Row
                    label="Contribution frequency"
                    value={goal.plan?.frequency || "Not set"}
                  />
                  <Row label="Status" value={goal.status} />
                  {goal.linkedAccount ? (
                    <Link
                      to={`/accounts/${goal.linkedAccount.id}`}
                      className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-400/10 px-3 text-emerald-300 hover:bg-emerald-400/15"
                    >
                      <Link2 size={16} />
                      {goal.linkedAccount.name}
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            </div>
            {!goal.valueIncomplete ? (
              <GoalScenarioComparison goal={goal} />
            ) : null}
            <GoalMilestonesPanel
              goal={goal}
              milestones={milestones}
              session={session}
              onChanged={() => setRefresh((value) => value + 1)}
            />
            <Card className="mt-5">
              <CardHeader title="Contribution history" />
              <CardContent>
                {contributions.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500">
                    {goal.linkedAccount
                      ? "No linked-account contributions yet."
                      : "Link an account to show contribution history."}
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {contributions.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-3 text-sm"
                      >
                        <div>
                          <p className="font-medium">
                            {item.type.replaceAll("_", " ")}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatDate(item.date)}
                          </p>
                        </div>
                        <MoneyValue
                          amount={item.amountMinor}
                          currency={item.currency}
                          className="text-emerald-300"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="mt-8 flex justify-end">
              <Button
                variant="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this goal? Linked account history will not be deleted.",
                    )
                  )
                    void deleteGoal(id, session.csrfToken).then(() =>
                      navigate("/goals"),
                    );
                }}
              >
                <Trash2 size={16} /> Delete goal
              </Button>
            </div>
          </>
        );
      }}
    </ResourceView>
  );
}

function Summary({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-lg font-semibold text-slate-100">{value}</p>
    </Card>
  );
}

function Stat({
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
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/[0.05] pb-3 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right capitalize text-slate-200">{value}</span>
    </div>
  );
}

function sumMinor(goals: Goal[], select: (goal: Goal) => string) {
  return goals
    .reduce((total, goal) => total + BigInt(select(goal)), 0n)
    .toString();
}

function formatMonthYear(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));
}

function requiredMonthlyForGoal(goal: Goal) {
  const current = Number(goal.currentAmountMinor);
  const target = Number(goal.targetAmountMinor);
  const targetDate = new Date(`${goal.targetDate.slice(0, 10)}T12:00:00.000Z`);
  const today = new Date();
  const months = Math.max(
    1,
    (targetDate.getUTCFullYear() - today.getUTCFullYear()) * 12 +
      targetDate.getUTCMonth() -
      today.getUTCMonth(),
  );
  const monthlyRate = goal.assumedAnnualReturnBps / 10_000 / 12;
  const projectedCurrent = current * (1 + monthlyRate) ** months;
  const annuityFactor =
    monthlyRate === 0
      ? months
      : ((1 + monthlyRate) ** months - 1) / monthlyRate;
  return String(
    Math.max(0, Math.ceil((target - projectedCurrent) / annuityFactor)),
  );
}

function forecastDateForGoal(goal: Goal) {
  const current = BigInt(goal.currentAmountMinor);
  const target = BigInt(goal.targetAmountMinor);
  if (current >= target) return formatMonthYear(new Date().toISOString());
  const contribution = BigInt(goal.plan?.plannedContributionMinor ?? "0");
  if (contribution <= 0n) return "Not projected";
  const months = Number((target - current + contribution - 1n) / contribution);
  const forecast = new Date();
  forecast.setUTCMonth(forecast.getUTCMonth() + months);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(forecast);
}

function GoalMilestonesPanel({
  goal,
  milestones,
  session,
  onChanged,
}: {
  goal: Goal;
  milestones: GoalMilestone[];
  session: Session;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Card className="mt-5">
      <OriginalCardHeader>
        <div>
          <OriginalCardTitle className="flex items-center gap-2">
            <Flag size={18} />
            Milestones
          </OriginalCardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Optional checkpoints measured against the goal&apos;s current value.
          </p>
        </div>
      </OriginalCardHeader>
      <CardContent>
        <form
          className="grid gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3 sm:grid-cols-[minmax(180px,1fr)_minmax(150px,.65fr)_minmax(150px,.65fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            setPending(true);
            void createMilestone(
              goal.id,
              {
                name: String(data.get("name") ?? ""),
                targetAmount: String(data.get("targetAmount") ?? ""),
                targetDate: String(data.get("targetDate") ?? ""),
              },
              session.csrfToken,
            )
              .then(() => {
                form.reset();
                onChanged();
              })
              .finally(() => setPending(false));
          }}
        >
          <div>
            <Label htmlFor="milestone-name">Milestone name</Label>
            <Input
              id="milestone-name"
              name="name"
              placeholder="e.g. Halfway funded"
              required
            />
          </div>
          <div>
            <Label htmlFor="milestone-amount">
              Target amount ({goal.currency})
            </Label>
            <Input
              id="milestone-amount"
              name="targetAmount"
              inputMode="decimal"
              required
            />
          </div>
          <div>
            <Label htmlFor="milestone-date">Target date</Label>
            <Input
              id="milestone-date"
              name="targetDate"
              type="date"
              max={goal.targetDate.slice(0, 10)}
            />
          </div>
          <Button disabled={pending} className="w-full sm:w-auto">
            <Plus size={16} />
            Add milestone
          </Button>
        </form>
        {milestones.length ? (
          <div className="mt-4 divide-y divide-white/[0.06]">
            {milestones.map((milestone) => (
              <div
                key={milestone.id}
                className="grid gap-3 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,.8fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-100">
                      {milestone.name}
                    </p>
                    <Badge tone={milestoneTone(milestone.status)}>
                      {milestone.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    <MoneyValue
                      amount={milestone.targetAmountMinor}
                      currency={goal.currency}
                    />
                    {milestone.targetDate
                      ? ` by ${formatDate(milestone.targetDate)}`
                      : " with no due date"}
                  </p>
                </div>
                <div>
                  <div className="flex justify-between gap-3 text-xs text-slate-500">
                    <span>{milestone.progressPercent}% complete</span>
                    {milestone.remainingMinor !== null ? (
                      <span>
                        <MoneyValue
                          amount={milestone.remainingMinor}
                          currency={goal.currency}
                        />{" "}
                        remaining
                      </span>
                    ) : null}
                  </div>
                  <Progress
                    value={Number(milestone.progressPercent)}
                    label={`${milestone.name} milestone progress`}
                    className="mt-2"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${milestone.name} milestone`}
                  onClick={() => {
                    if (
                      window.confirm(`Delete the ${milestone.name} milestone?`)
                    )
                      void deleteMilestone(
                        goal.id,
                        milestone.id,
                        session.csrfToken,
                      ).then(onChanged);
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">
            No milestones yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function milestoneTone(
  status: string,
): "positive" | "negative" | "warning" | "info" {
  if (status === "reached") return "positive";
  if (status === "overdue") return "negative";
  if (status === "rate_needed") return "warning";
  return "info";
}

function GoalAlerts({
  alerts,
  session,
  onChanged,
}: {
  alerts: GoalAlert[];
  session: Session;
  onChanged: () => void;
}) {
  if (!alerts.length) return null;
  return (
    <section aria-label="Goal reminders" className="mb-5 space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.goalId}
          className="flex flex-col gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100 sm:flex-row sm:items-center"
        >
          <BellRing className="shrink-0 text-amber-300" size={18} />
          <div className="min-w-0 flex-1">
            <Link
              to={`/goals/${alert.goalId}`}
              className="font-semibold text-amber-100 hover:text-white"
            >
              {alert.goalName} needs attention
            </Link>
            <p className="mt-1 text-xs leading-5 text-amber-200/80">
              Current progress is{" "}
              <MoneyValue
                amount={alert.currentAmountMinor}
                currency={alert.currency}
              />{" "}
              of{" "}
              <MoneyValue
                amount={alert.targetAmountMinor}
                currency={alert.currency}
              />{" "}
              for the {formatDate(alert.targetDate)} target. This estimate
              compounds the saved {alert.assumedAnnualReturnBps / 100}% annual
              return monthly; actual returns will vary.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Dismiss ${alert.goalName} reminder for this month`}
            onClick={() =>
              void dismissGoalAlert(alert.goalId, session.csrfToken).then(
                onChanged,
              )
            }
          >
            <X size={16} />
          </Button>
        </div>
      ))}
    </section>
  );
}

function GoalScenarioComparison({ goal }: { goal: Goal }) {
  const [returnPercent, setReturnPercent] = useState(
    String(goal.assumedAnnualReturnBps / 100),
  );
  const [contribution, setContribution] = useState(
    goal.plan?.plannedContributionMinor ?? "0",
  );
  const current = BigInt(goal.currentAmountMinor);
  const target = BigInt(goal.targetAmountMinor);
  const remaining = target > current ? target - current : 0n;
  return (
    <Card className="mt-5">
      <OriginalCardHeader>
        <div>
          <OriginalCardTitle className="flex items-center gap-2">
            <GitCompareArrows size={18} /> Scenario comparison
          </OriginalCardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Comparison only. Your saved goal and contribution plan remain
            unchanged.
          </p>
        </div>
      </OriginalCardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-3">
          {[
            ["Saved plan", contribution, returnPercent],
            ["Required pace", remaining.toString(), returnPercent],
            [
              "Lower return",
              contribution,
              String(Math.max(0, Number(returnPercent) - 2)),
            ],
          ].map(([name, amount, annualReturn], index) => (
            <section
              key={name}
              className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
            >
              <div className="flex min-h-7 items-start justify-between gap-2">
                <h3 className="font-medium text-slate-100">{name}</h3>
                <Badge tone={current >= target ? "positive" : "warning"}>
                  {current >= target ? "Target met" : "Shortfall"}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`scenario-contribution-${index}`}>
                    Monthly contribution
                  </Label>
                  <Input
                    id={`scenario-contribution-${index}`}
                    aria-label={`${name} monthly contribution`}
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) =>
                      index !== 1 && setContribution(event.target.value)
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`scenario-return-${index}`}>
                    Annual return (%)
                  </Label>
                  <Input
                    id={`scenario-return-${index}`}
                    aria-label={`${name} annual return`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={annualReturn}
                    onChange={(event) =>
                      index !== 2 && setReturnPercent(event.target.value)
                    }
                  />
                </div>
              </div>
              <div className="mt-4 min-h-44">
                <p className="text-xs text-slate-500">Projected at target</p>
                <MoneyValue
                  amount={(current + BigInt(amount || "0")).toString()}
                  currency={goal.currency}
                  className="mt-1 block text-lg font-semibold text-white"
                />
                <Progress
                  value={Number(goal.progressPercent)}
                  label={`${name} projected goal progress`}
                  className="mt-3"
                />
                <dl className="mt-4 space-y-2 text-xs">
                  <ScenarioValue
                    label="New contributions"
                    value={
                      <MoneyValue
                        amount={amount || "0"}
                        currency={goal.currency}
                      />
                    }
                  />
                  <ScenarioValue
                    label="Estimated growth"
                    value={<MoneyValue amount="0" currency={goal.currency} />}
                  />
                  <ScenarioValue
                    label="Estimated completion"
                    value={forecastDateForGoal(goal)}
                    icon={<CalendarClock size={13} />}
                  />
                </dl>
              </div>
            </section>
          ))}
        </div>
        <div className="mt-4 flex gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-3 text-xs leading-5 text-slate-500">
          <TrendingUp className="mt-0.5 shrink-0" size={15} />
          <p>
            Assumes the current balance grows at the selected annual return,
            compounded monthly, with contributions added at the end of each
            monthly period. Saved plan scenarios respect the configured plan
            dates; Required pace runs through the fixed target date. Fees,
            taxes, inflation, and return volatility are excluded; actual results
            will vary.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ScenarioValue({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="flex items-center gap-1 text-right text-slate-300">
        {icon}
        {value}
      </dd>
    </div>
  );
}

export function PortedReportsPage() {
  const state = useResource(() =>
    Promise.all([getReportSummary(), getReportAllocation()]),
  );
  return (
    <>
      <PageHeader
        title="Reports & analytics"
        description="Long-term trends, allocation, returns, and comparable account performance."
      />
      <ResourceView state={state}>
        {([summary, allocation]) => (
          (() => {
            const history = summary.history;
            const highest = history.reduce((value, point) => {
              const amount = BigInt(point.netWorthMinor);
              return amount > value ? amount : value;
            }, BigInt(history[0]?.netWorthMinor ?? summary.totals.netWorth));
            const first = BigInt(history[0]?.netWorthMinor ?? summary.totals.netWorth);
            const last = BigInt(history.at(-1)?.netWorthMinor ?? summary.totals.netWorth);
            const latestTime = history.at(-1) ? new Date(history.at(-1)!.date).getTime() : 0;
            const yearAgo = BigInt(history.find((point) => new Date(point.date).getTime() >= latestTime - 365 * 86_400_000)?.netWorthMinor ?? first);
            return <>
            {!summary.currentComplete ? (
              <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
                Some allocations need exchange rates:{" "}
                {summary.missingCurrencies.join(", ")}.
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <ReportStat
                label="Highest net worth"
                value={
                  <MoneyValue
                    amount={highest.toString()}
                    currency={summary.baseCurrency}
                  />
                }
                icon={<Award size={17} />}
              />
              <ReportStat
                label="Change since tracking"
                value={
                  <MoneyValue amount={(last - first).toString()} currency={summary.baseCurrency} />
                }
                icon={<TrendingUp size={17} />}
              />
              <ReportStat
                label="Year-over-year"
                value={
                  <MoneyValue amount={(last - yearAgo).toString()} currency={summary.baseCurrency} />
                }
                icon={<BarChart3 size={17} />}
              />
              <ReportStat
                label="Investment income"
                value={
                  <MoneyValue amount={summary.totals.income} currency={summary.baseCurrency} />
                }
                icon={<Coins size={17} />}
              />
            </div>

            <Card className="mt-5">
              <CardHeader
                title="Net-worth history"
                description="Monthly history across all tracked accounts"
              />
              <CardContent>
                {!summary.historicalComplete ? <p className="mb-3 text-xs text-amber-200">Incomplete history: one or more effective-dated prices or exchange rates are unavailable.</p> : null}
                <NetWorthChart data={summary.history} currency={summary.baseCurrency} range="all" />
              </CardContent>
            </Card>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Portfolio allocation"
                  description="Toggle total and investible assets"
                />
                <CardContent>
                  <AllocationChart total={allocation.categories} investible={allocation.investibleCategories} currency={allocation.baseCurrency} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="Income and returns" />
                <CardContent>
                  {!summary.compositionComplete ? <p className="mb-3 text-xs text-amber-200">{summary.completenessReasons.join(" ")}</p> : null}
                  <ContributionsGrowthChart currency={summary.baseCurrency} values={[
                    { name: "Contributions", valueMinor: summary.totals.contributions },
                    { name: "Interest + dividends", valueMinor: summary.totals.income },
                    { name: "Capital growth", valueMinor: summary.totals.capitalGrowth },
                    { name: "Fees", valueMinor: `-${summary.totals.fees}` },
                  ]} />
                </CardContent>
              </Card>
            </div>

            {allocation.instruments.length ? (
              <Card className="mt-5">
                <CardHeader title="Investment instruments" description={`Current position value by instrument in ${allocation.baseCurrency}`} />
                <CardContent>
                  <AllocationChart total={allocation.instruments} investible={allocation.instruments} currency={allocation.baseCurrency} />
                </CardContent>
              </Card>
            ) : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              <AllocationList
                title="By institution"
                items={allocation.institutions}
                currency={allocation.baseCurrency}
              />
              <AllocationList
                title="By currency"
                items={allocation.currencies}
                currency={allocation.baseCurrency}
              />
              <Card>
                <CardHeader title="Asset classification" />
                <CardContent className="space-y-3">
                  <ReportLine
                    label="Liquid assets"
                    amount={summary.totals.liquid}
                    currency={summary.baseCurrency}
                  />
                  <ReportLine
                    label="Illiquid assets"
                    amount={(
                      BigInt(summary.totals.assets) -
                      BigInt(summary.totals.liquid)
                    ).toString()}
                    currency={summary.baseCurrency}
                  />
                  <ReportLine
                    label="Investible assets"
                    amount={summary.totals.investible}
                    currency={summary.baseCurrency}
                  />
                  <ReportLine
                    label="Lifestyle / other"
                    amount={(
                      BigInt(summary.totals.assets) -
                      BigInt(summary.totals.investible)
                    ).toString()}
                    currency={summary.baseCurrency}
                  />
                </CardContent>
              </Card>
            </div>

            <Card className="mt-5">
              <CardHeader
                title="Account comparison"
                description="Annualized figures exclude net deposits. Periods under one year are marked as estimates. Position accounts remain unavailable until cash-flow-aware TWR is implemented."
              />
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
                  <tbody className="divide-y divide-white/[0.06]" />
                </table>
              </CardContent>
            </Card>
            </>;
          })()
        )}
      </ResourceView>
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
  items: { name: string; valueMinor: string; sharePercent: string }[];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardContent className="space-y-3">
        {items.length ? (
          items.map((item) => (
            <ReportLine
              key={item.name}
              label={item.name}
              amount={item.valueMinor}
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

function ReportLine({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: string;
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

export function PortedCategoriesPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getCategories, [refresh]);
  return (
    <>
      <PageHeader
        title="Categories"
        description="Organize holdings, control allocation reporting, and classify liquid or investible assets."
      />
      <ResourceView state={state}>
        {({ items }) => (
          <CategoryManager
            categories={items}
            csrfToken={session.csrfToken}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        )}
      </ResourceView>
    </>
  );
}

export function PortedInstitutionsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getInstitutions, [refresh]);
  return (
    <>
      <PageHeader
        title="Institutions"
        description="Manage the providers linked to your financial accounts."
      />
      <ResourceView state={state}>
        {({ items }) => (
          <InstitutionManager
            institutions={items}
            csrfToken={session.csrfToken}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        )}
      </ResourceView>
    </>
  );
}

export function PortedInstrumentsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getInstruments, [refresh]);
  const run = (action: () => Promise<unknown>) =>
    void action().then(() => setRefresh((value) => value + 1));
  return (
    <>
      <PageHeader
        title="Investment instruments"
        description="Manage the stocks, ETFs, and funds used by your position accounts."
        actions={
          <Button asChild>
            <Link to="/instruments/new">
              <Plus size={17} /> Add instrument
            </Link>
          </Button>
        }
      />
      <ResourceView state={state}>
        {({ instruments }) => (
          <Card>
            <CardHeader title="Instrument directory" />
            <CardContent>
              {!instruments.length ? (
                <p className="py-12 text-center text-sm text-slate-500">
                  No instruments yet. Add one to make it available to your
                  position accounts.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {instruments.map((instrument) => (
                    <div
                      key={instrument.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-slate-100">
                            {instrument.name}
                          </p>
                          {instrument.archivedAt ? (
                            <Badge>Archived</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {instrument.symbol ||
                            instrument.identifier ||
                            "Custom instrument"}{" "}
                          · {instrument.assetType.toUpperCase()} ·{" "}
                          {instrument.quoteCurrency}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${instrument.name}`}
                        >
                          <Link to={`/instruments/${instrument.id}/edit`}>
                            <Edit3 size={15} />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={
                            instrument.archivedAt
                              ? "Restore instrument"
                              : "Archive instrument"
                          }
                          onClick={() => {
                            if (
                              instrument.archivedAt ||
                              window.confirm(
                                "Archive this instrument? Every holding must be closed.",
                              )
                            )
                              run(() =>
                                archiveInstrument(
                                  instrument.id,
                                  !instrument.archivedAt,
                                  session.csrfToken,
                                ),
                              );
                          }}
                        >
                          <ArchiveRestore size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-300 hover:text-red-200"
                          aria-label={`Delete ${instrument.name}`}
                          title={`Permanently delete ${instrument.name}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Permanently delete ${instrument.name} and all its saved prices? This cannot be undone. Instruments linked to account history cannot be deleted.`,
                              )
                            )
                              run(() =>
                                deleteInstrument(
                                  instrument.id,
                                  session.csrfToken,
                                ),
                              );
                          }}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </ResourceView>
    </>
  );
}

export function PortedNewInstrumentPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add instrument"
        description="Create a security reference that can be used by any position account."
      />
      <Card>
        <CardHeader title="Instrument details" />
        <CardContent>
          <InstrumentForm
            session={session}
            onChanged={() => navigate("/instruments")}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function PortedEditInstrumentPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const state = useResource(() => getInstrument(id), [id]);
  return (
    <ResourceView state={state} loadingLabel="Loading instrument...">
      {({ instrument }) => (
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title={`Edit ${instrument.name}`}
            description="Source identity and quote settings for this instrument."
          />
          <Card>
            <CardHeader title="Instrument details" />
            <CardContent>
              <InstrumentForm
                instrument={instrument}
                session={session}
                onChanged={() => navigate("/instruments")}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </ResourceView>
  );
}

export function PortedPlanningRoutes({ session }: { session: Session }) {
  return (
    <Routes>
      <Route path="/goals" element={<PortedGoalsPage session={session} />} />
      <Route
        path="/goals/new"
        element={<PortedNewGoalPage session={session} />}
      />
      <Route
        path="/goals/:id"
        element={<PortedGoalDetailPage session={session} />}
      />
      <Route
        path="/goals/:id/edit"
        element={<PortedEditGoalPage session={session} />}
      />
      <Route path="/reports" element={<PortedReportsPage />} />
      <Route
        path="/categories"
        element={<PortedCategoriesPage session={session} />}
      />
      <Route
        path="/institutions"
        element={<PortedInstitutionsPage session={session} />}
      />
      <Route
        path="/instruments"
        element={<PortedInstrumentsPage session={session} />}
      />
      <Route
        path="/instruments/new"
        element={<PortedNewInstrumentPage session={session} />}
      />
      <Route
        path="/instruments/:id/edit"
        element={<PortedEditInstrumentPage session={session} />}
      />
    </Routes>
  );
}
