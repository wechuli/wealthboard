"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { LoaderCircle, Save } from "lucide-react";

import type { Account, GoalStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import type { ActionState } from "@/lib/validation";

type GoalValues = {
  name: string;
  description?: string;
  targetAmount: string;
  currentAmount?: string;
  currency: string;
  targetDate: string;
  linkedAccountId?: string;
  icon: string;
  status: GoalStatus;
  priority: number;
  assumedAnnualReturn: number;
  plannedContribution: string;
  frequency: "weekly" | "monthly" | "quarterly" | "annually" | "custom";
  planStartDate: string;
  planEndDate?: string;
};

export function GoalForm({
  accounts,
  action,
  initial,
  idempotencyKey,
  today,
}: {
  accounts: Account[];
  action: (formData: FormData) => Promise<ActionState>;
  initial?: Partial<GoalValues>;
  idempotencyKey?: string;
  today?: string;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<GoalValues>({
    defaultValues: {
      currency: "KES",
      icon: "Target",
      status: "active",
      priority: 0,
      assumedAnnualReturn: 8,
      plannedContribution: "0.00",
      frequency: "monthly",
      planStartDate: today,
      ...initial,
    },
  });
  const currency = useWatch({ control, name: "currency" });
  const editing = Boolean(initial?.name);
  const progressiveAction = action as unknown as (formData: FormData) => void;
  return (
    <form
      action={progressiveAction}
      onSubmit={handleSubmit((_values, event) => {
        const formData = new FormData(event?.target as HTMLFormElement);
        startTransition(async () => setState(await action(formData)));
      })}
      className="space-y-6"
      noValidate
    >
      {idempotencyKey ? <input type="hidden" name="idempotencyKey" value={idempotencyKey} /> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="name">Goal name</Label>
          <Input id="name" placeholder="e.g. 2028 Family Car" {...register("name", { required: "Enter a goal name." })} />
          <FieldError>{errors.name?.message || state.fieldErrors?.name?.[0]}</FieldError>
        </div>
        <div>
          <Label htmlFor="targetAmount">Target amount ({currency})</Label>
          <Input id="targetAmount" inputMode="decimal" {...register("targetAmount", { required: true })} />
          <FieldError>{state.fieldErrors?.targetAmount?.[0]}</FieldError>
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" maxLength={3} defaultValue={initial?.currency ?? "KES"} {...register("currency")} />
        </div>
        <div>
          <Label htmlFor="targetDate">Target date</Label>
          <Input id="targetDate" type="date" {...register("targetDate", { required: true })} />
          <FieldError>{state.fieldErrors?.targetDate?.[0]}</FieldError>
        </div>
        <div>
          <Label htmlFor="linkedAccountId">Linked account</Label>
          <Select id="linkedAccountId" {...register("linkedAccountId")}>
            <option value="">No linked account</option>
            {accounts.filter((account) => !account.isLiability && !account.archivedAt).map((account) => (
              <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="currentAmount">Current amount ({currency})</Label>
          <Input id="currentAmount" inputMode="decimal" placeholder="Used only without linked account" {...register("currentAmount")} />
        </div>
        <div>
          <Label htmlFor="plannedContribution">Planned contribution ({currency})</Label>
          <Input id="plannedContribution" inputMode="decimal" {...register("plannedContribution")} />
        </div>
        <div>
          <Label htmlFor="frequency">Contribution frequency</Label>
          <Select id="frequency" {...register("frequency")}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
            <option value="custom">Custom monthly equivalent</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="planStartDate">Plan start</Label>
          <Input id="planStartDate" type="date" defaultValue={initial?.planStartDate ?? today} {...register("planStartDate")} />
        </div>
        <div>
          <Label htmlFor="planEndDate">Plan end</Label>
          <Input id="planEndDate" type="date" {...register("planEndDate")} />
        </div>
        <div>
          <Label htmlFor="assumedAnnualReturn">Assumed annual return (%)</Label>
          <Input id="assumedAnnualReturn" type="number" min="0" max="100" step="0.1" defaultValue={initial?.assumedAnnualReturn ?? 8} {...register("assumedAnnualReturn")} />
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select id="status" {...register("status")}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" {...register("description")} />
        </div>
      </div>
      <input type="hidden" defaultValue={initial?.icon ?? "Target"} {...register("icon")} />
      <input type="hidden" defaultValue={initial?.priority ?? 0} {...register("priority")} />
      {state.message ? <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{state.message}</p> : null}
      <div className="flex justify-end">
        <Button disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}
          {editing ? "Save goal" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}
