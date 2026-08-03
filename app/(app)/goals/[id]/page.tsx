import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarClock,
  Edit3,
  Link2,
  Pause,
  Play,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { deleteGoalAction, setGoalStatusAction } from "@/app/(app)/actions";
import { GoalProjectionChart } from "@/components/charts";
import { GoalMilestones } from "@/components/goal-milestones";
import { GoalScenarioComparison } from "@/components/goal-scenario-comparison";
import { MoneyValue } from "@/components/privacy-provider";
import { MutationButton } from "@/components/mutation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/ui/page";
import { TRANSACTION_LABELS } from "@/lib/constants";
import { dateInputForTimezone, formatDate, utcToDateInput } from "@/lib/dates";
import { minorToDecimalString, safeChartNumber } from "@/lib/money";
import { getAccountActivity } from "@/lib/services/accounts";
import { getSettings } from "@/lib/bootstrap";
import {
  getGoal,
  goalProjectionPoints,
  listGoalMilestones,
} from "@/lib/services/goals";
import { requireSession } from "@/lib/auth/session";

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const { id } = await params;
  const [goal, settings] = await Promise.all([
    getGoal(userId, id),
    getSettings(userId),
  ]);
  if (!goal) notFound();
  const [activity, milestones] = await Promise.all([
    goal.linkedAccountId
      ? getAccountActivity(userId, goal.linkedAccountId)
      : { transactions: [], valuations: [] },
    listGoalMilestones(userId, id),
  ]);
  const contributions = activity.transactions.filter((transaction) =>
    ["opening_balance", "deposit", "purchase"].includes(transaction.type),
  );
  const projection = goalProjectionPoints({
    currentMinor: goal.currentAmountCalculated,
    targetMinor: goal.targetAmountMinor,
    monthlyContributionMinor: goal.plannedMonthly,
    annualReturnBps: goal.assumedAnnualReturnBps,
    targetDate: new Date(goal.targetDate),
    contributionStart: goal.planStartDate
      ? new Date(goal.planStartDate)
      : undefined,
    contributionEnd: goal.planEndDate ? new Date(goal.planEndDate) : null,
  }).map((point) => ({
    date: point.date,
    projected: safeChartNumber(point.projected),
    contributions: safeChartNumber(point.contributions),
    target: safeChartNumber(point.target),
  }));
  return (
    <>
      <PageHeader
        title={goal.name}
        description={goal.description || "Goal progress and forecast"}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/goals/${id}/edit`}>
                <Edit3 size={16} />
                Edit goal
              </Link>
            </Button>
            <MutationButton
              action={setGoalStatusAction.bind(
                null,
                id,
                goal.status === "paused" ? "active" : "paused",
              )}
              successMessage={
                goal.status === "paused" ? "Goal resumed." : "Goal paused."
              }
              variant="secondary"
            >
              {goal.status === "paused" ? (
                <Play size={16} />
              ) : (
                <Pause size={16} />
              )}
              {goal.status === "paused" ? "Resume" : "Pause"}
            </MutationButton>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Current progress"
          value={
            <MoneyValue
              amount={goal.currentAmountCalculated}
              currency={goal.currency}
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
              amount={goal.requiredMonthly}
              currency={goal.currency}
            />
          }
          icon={<CalendarClock size={17} />}
        />
        <Stat
          label="Current monthly plan"
          value={
            <MoneyValue
              amount={goal.currentPlannedMonthly}
              currency={goal.currency}
            />
          }
          icon={<TrendingUp size={17} />}
        />
      </div>
      {goal.missingExchangeRate ? (
        <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
          Configure an exchange rate between the linked account and goal
          currencies before relying on progress or forecasts.
        </div>
      ) : null}

      <Card className="mt-5">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Overall progress</p>
              <p className="mt-1 text-xs text-slate-500">
                Target{" "}
                {formatDate(goal.targetDate, settings.timezone, "dd MMM yyyy")}
              </p>
            </div>
            <div className="text-right">
              <Badge tone={goal.tracking === "behind" ? "warning" : "positive"}>
                {goal.tracking.replace("_", " ")}
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
          <CardHeader>
            <div>
              <CardTitle>Projection</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Estimate assumes {goal.assumedAnnualReturnBps / 100}% annual
                return and current planned contributions. Actual returns will
                vary.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <GoalProjectionChart data={projection} currency={goal.currency} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Forecast details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Row
              label="Tracking status"
              value={goal.tracking.replace("_", " ")}
            />
            <Row
              label="Estimated completion"
              value={
                goal.forecastDate
                  ? formatDate(goal.forecastDate, settings.timezone, "MMM yyyy")
                  : "Not projected"
              }
            />
            <Row
              label="Target date"
              value={formatDate(goal.targetDate, settings.timezone, "MMM yyyy")}
            />
            <Row
              label="Contribution frequency"
              value={goal.frequency || "Not set"}
            />
            <Row label="Status" value={goal.status} />
            {goal.linkedAccountId ? (
              <Link
                href={`/accounts/${goal.linkedAccountId}`}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-400/10 px-3 text-emerald-300 hover:bg-emerald-400/15"
              >
                <Link2 size={16} />
                {goal.accountName}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {!goal.missingExchangeRate ? (
        <GoalScenarioComparison
          currentMinor={goal.currentAmountCalculated.toString()}
          targetMinor={goal.targetAmountMinor.toString()}
          currency={goal.currency}
          fromDate={dateInputForTimezone(settings.timezone)}
          targetDate={goal.targetDate}
          savedMonthlyContribution={minorToDecimalString(
            goal.plannedMonthly,
            goal.currency,
          )}
          requiredMonthlyContribution={minorToDecimalString(
            goal.requiredMonthly,
            goal.currency,
          )}
          savedAnnualReturn={goal.assumedAnnualReturnBps / 100}
          timezone={settings.timezone}
        />
      ) : null}

      <GoalMilestones
        goalId={id}
        currency={goal.currency}
        goalTargetDate={utcToDateInput(goal.targetDate)}
        timezone={settings.timezone}
        dateFormat={settings.preferredDateFormat}
        milestones={milestones.map((milestone) => ({
          id: milestone.id,
          name: milestone.name,
          targetAmountMinor: milestone.targetAmountMinor,
          targetDate: milestone.targetDate,
          status: milestone.status,
          progressPercent: milestone.progressPercent,
          remainingMinor: milestone.remainingMinor?.toString() ?? null,
        }))}
      />

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Contribution history</CardTitle>
        </CardHeader>
        <CardContent>
          {contributions.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {goal.linkedAccountId
                ? "No linked-account contributions yet."
                : "Link an account to show contribution history."}
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {contributions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {TRANSACTION_LABELS[transaction.type]}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(
                        transaction.transactionDate,
                        settings.timezone,
                        settings.preferredDateFormat,
                      )}
                    </p>
                  </div>
                  <MoneyValue
                    amount={transaction.amountMinor}
                    currency={transaction.currency}
                    className="text-emerald-300"
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-8 flex justify-end">
        <MutationButton
          action={deleteGoalAction.bind(null, id)}
          confirm="Delete this goal? Linked account history will not be deleted."
          variant="danger"
        >
          <Trash2 size={16} />
          Delete goal
        </MutationButton>
      </div>
    </>
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
