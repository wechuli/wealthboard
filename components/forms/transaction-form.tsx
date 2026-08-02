"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftRight, LoaderCircle, Save } from "lucide-react";

import type { Account, TransactionType } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import { TRANSACTION_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/validation";

const clientSchema = z.object({
  accountId: z.string().min(1, "Choose an account."),
  toAccountId: z.string().optional(),
  type: z.string(),
  amount: z.string().min(1, "Enter an amount."),
  destinationAmount: z.string().optional(),
  transactionDate: z.string().min(1, "Choose a date."),
  description: z.string().optional(),
  notes: z.string().optional(),
});

type Values = z.infer<typeof clientSchema>;

const availableTypes = Object.entries(TRANSACTION_LABELS).filter(
  ([type]) => type !== "opening_balance",
) as Array<[TransactionType, string]>;

export function TransactionForm({
  accounts,
  action,
  idempotencyKey,
  initial,
  today,
}: {
  accounts: Account[];
  action: (formData: FormData) => Promise<ActionState>;
  idempotencyKey: string;
  initial?: Partial<Values> & { id?: string };
  today?: string;
}) {
  const [serverState, setServerState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      type: "deposit",
      transactionDate: today,
      ...initial,
    },
  });
  const type = useWatch({ control, name: "type" });
  const editing = Boolean(initial?.id);
  const accountId = useWatch({ control, name: "accountId" });
  const toAccountId = useWatch({ control, name: "toAccountId" });
  const source = accounts.find((account) => account.id === accountId);
  const destination = accounts.find((account) => account.id === toAccountId);

  useEffect(() => {
    if (initial) return;
    queueMicrotask(() => {
      const recentAccount = localStorage.getItem("wealthboard-recent-account");
      const recentType = localStorage.getItem("wealthboard-recent-transaction-type");
      if (recentAccount && accounts.some((account) => account.id === recentAccount)) {
        setValue("accountId", recentAccount);
      }
      if (recentType && availableTypes.some(([value]) => value === recentType)) {
        setValue("type", recentType);
      }
    });
  }, [accounts, initial, setValue]);

  const submit = handleSubmit((values, event) => {
    const formData = new FormData(event?.target as HTMLFormElement);
    localStorage.setItem("wealthboard-recent-account", values.accountId);
    localStorage.setItem("wealthboard-recent-transaction-type", values.type);
    startTransition(async () => setServerState(await action(formData)));
  });
  const progressiveAction = action as unknown as (formData: FormData) => void;

  return (
    <form action={progressiveAction} onSubmit={submit} className="space-y-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="type">Transaction type</Label>
          <Select id="type" disabled={editing} defaultValue={initial?.type ?? "deposit"} {...register("type")}>
            {availableTypes.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
          {editing ? <input type="hidden" name="type" value={type} /> : null}
        </div>
        <div>
          <Label htmlFor="accountId">{type === "transfer" ? "From account" : "Account"}</Label>
          <Select id="accountId" disabled={editing} {...register("accountId")}>
            <option value="">Choose an account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
            ))}
          </Select>
          {editing ? <input type="hidden" name="accountId" value={accountId} /> : null}
          <FieldError>{errors.accountId?.message || serverState.fieldErrors?.accountId?.[0]}</FieldError>
        </div>
        {type === "transfer" ? (
          <div>
            <Label htmlFor="toAccountId">To account</Label>
            <Select id="toAccountId" {...register("toAccountId")}>
              <option value="">Choose destination</option>
              {accounts.filter((account) => account.id !== accountId && !account.isLiability).map((account) => (
                <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
              ))}
            </Select>
            <FieldError>{serverState.fieldErrors?.toAccountId?.[0]}</FieldError>
          </div>
        ) : null}
        <div>
          <Label htmlFor="amount">
            Amount {source ? `(${source.currency})` : ""}
          </Label>
          <Input id="amount" inputMode="decimal" placeholder="0.00" {...register("amount")} />
          <FieldError>{errors.amount?.message || serverState.fieldErrors?.amount?.[0]}</FieldError>
        </div>
        {type === "transfer" && source && destination && source.currency !== destination.currency ? (
          <div>
            <Label htmlFor="destinationAmount">Destination amount ({destination.currency})</Label>
            <Input
              id="destinationAmount"
              inputMode="decimal"
              placeholder="Leave blank to use configured rate"
              {...register("destinationAmount")}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor="transactionDate">Date</Label>
          <Input id="transactionDate" type="date" defaultValue={initial?.transactionDate ?? today} {...register("transactionDate")} />
          <FieldError>{errors.transactionDate?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Input id="description" placeholder="Optional memo" {...register("description")} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" placeholder="Optional private notes" {...register("notes")} />
        </div>
      </div>
      {serverState.message ? (
        <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{serverState.message}</p>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" size={17} /> : type === "transfer" ? <ArrowLeftRight size={17} /> : <Save size={17} />}
          {editing ? "Save transaction" : type === "transfer" ? "Transfer funds" : "Record transaction"}
        </Button>
      </div>
    </form>
  );
}
