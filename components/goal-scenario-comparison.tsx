"use client";

import { useState } from "react";
import { CalendarClock, GitCompareArrows, TrendingUp } from "lucide-react";

import { MoneyValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form-controls";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/dates";
import { projectGoalScenario } from "@/lib/finance";
import { parseMoney, percentage } from "@/lib/money";

type Scenario = {
  id: "saved" | "required" | "conservative";
  name: string;
  monthlyContribution: string;
  annualReturn: string;
};

export function GoalScenarioComparison({
  currentMinor,
  targetMinor,
  currency,
  fromDate,
  targetDate,
  planStartDate,
  planEndDate,
  savedMonthlyContribution,
  requiredMonthlyContribution,
  savedAnnualReturn,
  timezone,
}: {
  currentMinor: string;
  targetMinor: string;
  currency: string;
  fromDate: string;
  targetDate: string;
  planStartDate: string | null;
  planEndDate: string | null;
  savedMonthlyContribution: string;
  requiredMonthlyContribution: string;
  savedAnnualReturn: number;
  timezone: string;
}) {
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [
    {
      id: "saved",
      name: "Saved plan",
      monthlyContribution: savedMonthlyContribution,
      annualReturn: String(savedAnnualReturn),
    },
    {
      id: "required",
      name: "Required pace",
      monthlyContribution: requiredMonthlyContribution,
      annualReturn: String(savedAnnualReturn),
    },
    {
      id: "conservative",
      name: "Lower return",
      monthlyContribution: savedMonthlyContribution,
      annualReturn: String(Math.max(0, savedAnnualReturn - 2)),
    },
  ]);

  const updateScenario = (
    id: Scenario["id"],
    field: "monthlyContribution" | "annualReturn",
    value: string,
  ) => {
    setScenarios((current) =>
      current.map((scenario) =>
        scenario.id === id ? { ...scenario, [field]: value } : scenario,
      ),
    );
  };

  return (
    <Card className="mt-5">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows size={18} />
            Scenario comparison
          </CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Comparison only. Your saved goal and contribution plan remain
            unchanged.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-3">
          {scenarios.map((scenario) => (
            <ScenarioPanel
              key={scenario.id}
              scenario={scenario}
              currentMinor={currentMinor}
              targetMinor={targetMinor}
              currency={currency}
              fromDate={fromDate}
              targetDate={targetDate}
              planStartDate={planStartDate}
              planEndDate={planEndDate}
              timezone={timezone}
              onChange={updateScenario}
            />
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

function ScenarioPanel({
  scenario,
  currentMinor,
  targetMinor,
  currency,
  fromDate,
  targetDate,
  planStartDate,
  planEndDate,
  timezone,
  onChange,
}: {
  scenario: Scenario;
  currentMinor: string;
  targetMinor: string;
  currency: string;
  fromDate: string;
  targetDate: string;
  planStartDate: string | null;
  planEndDate: string | null;
  timezone: string;
  onChange: (
    id: Scenario["id"],
    field: "monthlyContribution" | "annualReturn",
    value: string,
  ) => void;
}) {
  let result: ReturnType<typeof projectGoalScenario> | null = null;
  let error: string | null = null;
  const annualReturn = Number(scenario.annualReturn);

  try {
    const monthlyContribution = parseMoney(
      scenario.monthlyContribution,
      currency,
    );
    if (monthlyContribution < 0) {
      throw new Error("Contribution cannot be negative.");
    }
    if (
      !Number.isFinite(annualReturn) ||
      annualReturn < 0 ||
      annualReturn > 100
    ) {
      throw new Error("Return must be between 0% and 100%.");
    }
    result = projectGoalScenario({
      currentMinor: BigInt(currentMinor),
      targetMinor: BigInt(targetMinor),
      monthlyContributionMinor: monthlyContribution,
      annualReturnBps: Math.round(annualReturn * 100),
      fromDate: new Date(`${fromDate}T12:00:00.000Z`),
      targetDate: new Date(targetDate),
      contributionStart:
        scenario.id !== "required" && planStartDate
          ? new Date(planStartDate)
          : undefined,
      contributionEnd:
        scenario.id !== "required" && planEndDate
          ? new Date(planEndDate)
          : null,
    });
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Enter valid assumptions.";
  }

  const target = BigInt(targetMinor);
  const progress = result
    ? Number(percentage(result.projectedAtTarget, target))
    : 0;

  return (
    <section className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex min-h-7 items-start justify-between gap-2">
        <h3 className="font-medium text-slate-100">{scenario.name}</h3>
        {result ? (
          <Badge tone={result.reachesTarget ? "positive" : "warning"}>
            {result.reachesTarget ? "Target met" : "Shortfall"}
          </Badge>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${scenario.id}-contribution`}>
            Monthly contribution
          </Label>
          <Input
            id={`${scenario.id}-contribution`}
            inputMode="decimal"
            value={scenario.monthlyContribution}
            onChange={(event) =>
              onChange(scenario.id, "monthlyContribution", event.target.value)
            }
            aria-label={`${scenario.name} monthly contribution`}
          />
        </div>
        <div>
          <Label htmlFor={`${scenario.id}-return`}>Annual return (%)</Label>
          <Input
            id={`${scenario.id}-return`}
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={scenario.annualReturn}
            onChange={(event) =>
              onChange(scenario.id, "annualReturn", event.target.value)
            }
            aria-label={`${scenario.name} annual return`}
          />
        </div>
      </div>
      <div className="mt-4 min-h-44">
        {result ? (
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">Projected at target</p>
                <MoneyValue
                  amount={result.projectedAtTarget}
                  currency={currency}
                  className="mt-1 block text-lg font-semibold text-white"
                />
              </div>
              <span className="text-xs text-slate-500">
                {progress.toFixed(1)}%
              </span>
            </div>
            <Progress
              value={progress}
              label={`${scenario.name} projected goal progress`}
              className="mt-3"
            />
            <dl className="mt-4 space-y-2 text-xs">
              <ScenarioValue
                label="New contributions"
                value={
                  <MoneyValue
                    amount={result.futureContributions}
                    currency={currency}
                  />
                }
              />
              <ScenarioValue
                label="Estimated growth"
                value={
                  <MoneyValue
                    amount={result.investmentGrowth}
                    currency={currency}
                  />
                }
              />
              <ScenarioValue
                label="Estimated completion"
                value={
                  result.forecastDate ? (
                    <span>
                      {formatDate(result.forecastDate, timezone, "MMM yyyy")}
                    </span>
                  ) : (
                    <span>Not projected</span>
                  )
                }
                icon={<CalendarClock size={13} />}
              />
            </dl>
          </>
        ) : (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </section>
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
