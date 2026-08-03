"use client";

import Link from "next/link";
import { BellRing, X } from "lucide-react";

import { dismissGoalAlertAction } from "@/app/(app)/actions";
import { MutationButton } from "@/components/mutation-button";
import { MoneyValue } from "@/components/privacy-provider";
import { formatDate } from "@/lib/dates";

export type GoalAlertItem = {
  goalId: string;
  goalName: string;
  currency: string;
  requiredMonthly: string;
  plannedMonthly: string;
  annualReturnBps: number;
  targetDate: string;
};

export function GoalAlerts({
  alerts,
  timezone,
}: {
  alerts: GoalAlertItem[];
  timezone: string;
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
              href={`/goals/${alert.goalId}`}
              className="font-semibold text-amber-100 hover:text-white"
            >
              {alert.goalName} needs attention
            </Link>
            <p className="mt-1 text-xs leading-5 text-amber-200/80">
              The current monthly plan is{" "}
              <MoneyValue
                amount={BigInt(alert.plannedMonthly)}
                currency={alert.currency}
              />
              ; the estimated monthly pace is{" "}
              <MoneyValue
                amount={BigInt(alert.requiredMonthly)}
                currency={alert.currency}
              />{" "}
              for the {formatDate(alert.targetDate, timezone, "MMM yyyy")}{" "}
              target. This estimate compounds the saved{" "}
              {alert.annualReturnBps / 100}% annual return monthly; actual
              returns will vary.
            </p>
          </div>
          <MutationButton
            action={dismissGoalAlertAction.bind(null, alert.goalId)}
            successMessage="Goal reminder dismissed for this month."
            variant="ghost"
            size="icon"
            aria-label={`Dismiss ${alert.goalName} reminder for this month`}
          >
            <X size={16} />
          </MutationButton>
        </div>
      ))}
    </section>
  );
}
