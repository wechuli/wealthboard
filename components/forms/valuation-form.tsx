"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { LoaderCircle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/form-controls";
import type { ActionState } from "@/lib/validation";

export function ValuationForm({
  accountId,
  currency,
  currentValue,
  action,
  idempotencyKey,
  today,
}: {
  accountId: string;
  currency: string;
  currentValue: string;
  action: (formData: FormData) => Promise<ActionState>;
  idempotencyKey: string;
  today: string;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit } = useForm({
    defaultValues: {
      value: currentValue,
      valuationDate: today,
      notes: "",
    },
  });
  const progressiveAction = action as unknown as (formData: FormData) => void;
  return (
    <form
      action={progressiveAction}
      onSubmit={handleSubmit((_values, event) => {
        const formData = new FormData(event?.target as HTMLFormElement);
        startTransition(async () => setState(await action(formData)));
      })}
      className="space-y-4"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div>
        <Label htmlFor="value">New value ({currency})</Label>
        <Input id="value" inputMode="decimal" defaultValue={currentValue} {...register("value")} />
        <FieldError>{state.fieldErrors?.value?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="valuationDate">Valuation date</Label>
        <Input id="valuationDate" type="date" defaultValue={today} {...register("valuationDate")} />
      </div>
      <div>
        <Label htmlFor="valuationNotes">Notes</Label>
        <Textarea id="valuationNotes" {...register("notes")} />
      </div>
      {state.message ? <p role="alert" className="text-sm text-red-300">{state.message}</p> : null}
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" size={17} /> : <Sparkles size={17} />}
        Update value
      </Button>
    </form>
  );
}
