"use client";

import { useActionState, useEffect, useRef } from "react";
import { Flag, LoaderCircle, Plus, Trash2 } from "lucide-react";

import {
  createGoalMilestoneAction,
  deleteGoalMilestoneAction,
} from "@/app/(app)/actions";
import { MutationButton } from "@/components/mutation-button";
import { MoneyValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form-controls";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/dates";

export type GoalMilestoneItem = {
  id: string;
  name: string;
  targetAmountMinor: number;
  targetDate: string | null;
  status: "reached" | "overdue" | "upcoming" | "rate_needed";
  progressPercent: string;
  remainingMinor: string | null;
};

export function GoalMilestones({
  goalId,
  currency,
  goalTargetDate,
  timezone,
  dateFormat,
  milestones,
}: {
  goalId: string;
  currency: string;
  goalTargetDate: string;
  timezone: string;
  dateFormat: string;
  milestones: GoalMilestoneItem[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    createGoalMilestoneAction.bind(null, goalId),
    {},
  );

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <Card className="mt-5">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Flag size={18} />
            Milestones
          </CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Optional checkpoints measured against the goal&apos;s current value.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={action}
          className="grid gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3 sm:grid-cols-[minmax(180px,1fr)_minmax(150px,.65fr)_minmax(150px,.65fr)_auto] sm:items-end"
        >
          <div>
            <Label htmlFor="milestone-name">Milestone name</Label>
            <Input
              id="milestone-name"
              name="name"
              placeholder="e.g. Halfway funded"
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
          </div>
          <div>
            <Label htmlFor="milestone-amount">Target amount ({currency})</Label>
            <Input
              id="milestone-amount"
              name="targetAmount"
              inputMode="decimal"
              aria-invalid={Boolean(state.fieldErrors?.targetAmount)}
            />
          </div>
          <div>
            <Label htmlFor="milestone-date">Target date</Label>
            <Input
              id="milestone-date"
              name="targetDate"
              type="date"
              max={goalTargetDate}
              aria-invalid={Boolean(state.fieldErrors?.targetDate)}
            />
          </div>
          <Button disabled={pending} className="w-full sm:w-auto">
            {pending ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                size={16}
              />
            ) : (
              <Plus size={16} />
            )}
            Add milestone
          </Button>
          {state.message ? (
            <p
              role={state.ok ? "status" : "alert"}
              className={
                state.ok
                  ? "text-xs text-emerald-300 sm:col-span-4"
                  : "text-xs text-red-300 sm:col-span-4"
              }
            >
              {state.message}
            </p>
          ) : null}
        </form>

        {milestones.length ? (
          <div className="mt-4 divide-y divide-white/[0.06]">
            {milestones.map((milestone) => {
              const progress = Number(milestone.progressPercent);
              return (
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
                        currency={currency}
                      />
                      {milestone.targetDate
                        ? ` by ${formatDate(milestone.targetDate, timezone, dateFormat)}`
                        : " with no due date"}
                    </p>
                  </div>
                  <div>
                    <div className="flex justify-between gap-3 text-xs text-slate-500">
                      <span>{progress}% complete</span>
                      {milestone.remainingMinor !== null ? (
                        <span>
                          <MoneyValue
                            amount={BigInt(milestone.remainingMinor)}
                            currency={currency}
                          />{" "}
                          remaining
                        </span>
                      ) : null}
                    </div>
                    <Progress
                      value={progress}
                      label={`${milestone.name} milestone progress`}
                      className="mt-2"
                    />
                  </div>
                  <MutationButton
                    action={deleteGoalMilestoneAction.bind(
                      null,
                      goalId,
                      milestone.id,
                    )}
                    confirm={`Delete the ${milestone.name} milestone?`}
                    successMessage="Milestone deleted."
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${milestone.name} milestone`}
                  >
                    <Trash2 size={15} />
                  </MutationButton>
                </div>
              );
            })}
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

function milestoneTone(status: GoalMilestoneItem["status"]) {
  if (status === "reached") return "positive" as const;
  if (status === "overdue") return "negative" as const;
  if (status === "rate_needed") return "warning" as const;
  return "info" as const;
}
