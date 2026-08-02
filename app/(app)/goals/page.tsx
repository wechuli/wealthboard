import Link from "next/link";
import { CalendarClock, Flag, Goal, Plus, TrendingUp } from "lucide-react";

import { MoneyValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { exchangeRates } from "@/db/schema";
import { formatDate } from "@/lib/dates";
import { getSettings } from "@/lib/bootstrap";
import { getDatabase } from "@/lib/db";
import { convertMinor, MissingExchangeRateError } from "@/lib/money";
import { listGoals } from "@/lib/services/goals";

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const [goalRows, settings, rates] = await Promise.all([
    listGoals(),
    getSettings(),
    getDatabase().select().from(exchangeRates),
  ]);
  const active = goalRows.filter((goal) => goal.status === "active");
  const safeTotal = (
    value: (goal: (typeof active)[number]) => bigint,
  ) =>
    active.reduce((sum, goal) => {
      try {
        return (
          sum +
          convertMinor(value(goal), goal.currency, settings.baseCurrency, rates)
        );
      } catch (error) {
        if (error instanceof MissingExchangeRateError) return sum;
        throw error;
      }
    }, 0n);
  const totalTarget = safeTotal((goal) => BigInt(goal.targetAmountMinor));
  const totalSaved = safeTotal((goal) => goal.currentAmountCalculated);
  const monthly = safeTotal((goal) => goal.currentPlannedMonthly);
  const onTrack = active.filter((goal) => goal.tracking !== "behind").length;

  return (
    <>
      <PageHeader
        title="Financial goals"
        description="Turn linked account balances into clear timelines and contribution targets."
        actions={<Button asChild><Link href="/goals/new"><Plus size={17} />Create goal</Link></Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Summary label="Active target" value={<MoneyValue amount={totalTarget} currency={settings.baseCurrency} />} icon={<Flag size={17} />} />
        <Summary label="Amount saved" value={<MoneyValue amount={totalSaved} currency={settings.baseCurrency} />} icon={<TrendingUp size={17} />} />
        <Summary label="Monthly plan" value={<MoneyValue amount={monthly} currency={settings.baseCurrency} />} icon={<CalendarClock size={17} />} />
        <Summary label="On track" value={`${onTrack} goals`} icon={<Goal size={17} />} />
        <Summary label="Behind" value={`${active.length - onTrack} goals`} icon={<Flag size={17} />} />
      </div>
      {goalRows.length === 0 ? (
        <div className="mt-5">
          <EmptyState icon={<Goal size={24} />} title="No goals yet" description="Create a target and optionally link it to an account." action={<Button asChild><Link href="/goals/new">Create your first goal</Link></Button>} />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {goalRows.map((goal) => (
            <Link key={goal.id} href={`/goals/${goal.id}`} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
              <Card className="h-full transition-colors group-hover:border-emerald-400/25">
                <CardHeader>
                  <div>
                    <CardTitle className="text-base">{goal.name}</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">{goal.accountName || "Directly tracked goal"}</p>
                  </div>
                  <Badge tone={goal.tracking === "behind" ? "warning" : "positive"}>{goal.tracking.replace("_", " ")}</Badge>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between gap-3">
                    <MoneyValue amount={goal.currentAmountCalculated} currency={goal.currency} className="text-xl font-semibold text-white" />
                    <span className="text-xs text-slate-500">of <MoneyValue amount={goal.targetAmountMinor} currency={goal.currency} /></span>
                  </div>
                  <Progress value={Number(goal.progressPercent)} label={`${goal.name} progress`} className="mt-4" />
                  {goal.missingExchangeRate ? <p className="mt-2 text-xs text-amber-300">Add an exchange rate to calculate linked progress.</p> : null}
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4 text-xs">
                    <div><p className="text-slate-500">Required monthly</p><p className="mt-1 text-slate-200"><MoneyValue amount={goal.requiredMonthly} currency={goal.currency} /></p></div>
                    <div className="text-right"><p className="text-slate-500">Target date</p><p className="mt-1 text-slate-200">{formatDate(goal.targetDate, settings.timezone, "MMM yyyy")}</p></div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Summary({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return <Card className="p-4"><div className="flex items-center justify-between text-slate-500"><p className="text-xs font-medium uppercase tracking-wide">{label}</p>{icon}</div><p className="mt-3 text-lg font-semibold text-slate-100">{value}</p></Card>;
}
