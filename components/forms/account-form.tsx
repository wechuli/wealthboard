"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { LoaderCircle, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Checkbox,
  FieldError,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/form-controls";
import { accountSchema, type ActionState } from "@/lib/validation";
import type { Category } from "@/db/schema";
import { currencyOptions } from "@/lib/currencies";

type AccountValues = {
  name: string;
  description?: string;
  categoryId: string;
  institution?: string;
  accountReference?: string;
  currency: string;
  openingValue: string;
  costBasis?: string;
  isIncludedInNetWorth: boolean;
  notes?: string;
  openedAt?: string;
};

export function AccountForm({
  categories,
  action,
  initial,
  idempotencyKey,
  today,
  currencies,
  baseCurrency,
}: {
  categories: Category[];
  action: (formData: FormData) => Promise<ActionState>;
  initial?: Partial<AccountValues>;
  idempotencyKey?: string;
  today?: string;
  currencies: string[];
  baseCurrency: string;
}) {
  const [serverState, setServerState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      currency: baseCurrency,
      openingValue: "0.00",
      isIncludedInNetWorth: true,
      openedAt: today,
      ...initial,
    },
  });
  const availableCurrencies = currencyOptions(currencies).filter((currency) =>
    currencies.includes(currency.code),
  );

  const submit = handleSubmit((_values, event) => {
    const formData = new FormData(event?.target as HTMLFormElement);
    startTransition(async () => setServerState(await action(formData)));
  });
  const progressiveAction = action as unknown as (formData: FormData) => void;

  return (
    <form
      action={progressiveAction}
      onSubmit={submit}
      className="space-y-6"
      noValidate
    >
      {idempotencyKey ? (
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="name">Account or asset name</Label>
          <Input
            id="name"
            placeholder="e.g. Zimele Fixed Income Fund"
            {...register("name")}
          />
          <FieldError>
            {errors.name?.message || serverState.fieldErrors?.name?.[0]}
          </FieldError>
        </div>
        <div>
          <Label htmlFor="categoryId">Category</Label>
          <Select id="categoryId" {...register("categoryId")}>
            <option value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <FieldError>
            {errors.categoryId?.message ||
              serverState.fieldErrors?.categoryId?.[0]}
          </FieldError>
        </div>
        <div>
          <Label htmlFor="institution">Institution</Label>
          <Input
            id="institution"
            placeholder="Optional"
            {...register("institution")}
          />
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          {initial ? (
            <>
              <Select id="currency" value={initial.currency} disabled>
                {availableCurrencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} - {currency.name}
                  </option>
                ))}
              </Select>
              <input type="hidden" name="currency" value={initial.currency} />
            </>
          ) : (
            <Select id="currency" {...register("currency")}>
              {availableCurrencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
            </Select>
          )}
          <FieldError>
            {errors.currency?.message || serverState.fieldErrors?.currency?.[0]}
          </FieldError>
        </div>
        {!initial ? (
          <div>
            <Label htmlFor="openingValue">Opening value</Label>
            <Input
              id="openingValue"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue="0.00"
              {...register("openingValue")}
            />
            <FieldError>
              {errors.openingValue?.message ||
                serverState.fieldErrors?.openingValue?.[0]}
            </FieldError>
          </div>
        ) : (
          <input type="hidden" name="openingValue" value="0" />
        )}
        <div>
          <Label htmlFor="costBasis">Cost basis</Label>
          <Input
            id="costBasis"
            inputMode="decimal"
            placeholder="Optional"
            {...register("costBasis")}
          />
        </div>
        {!initial ? (
          <div>
            <Label htmlFor="openedAt">Opened or acquired</Label>
            <Input
              id="openedAt"
              type="date"
              defaultValue={today}
              {...register("openedAt")}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor="accountReference">Masked account reference</Label>
          <Input
            id="accountReference"
            placeholder="e.g. •••• 4821"
            {...register("accountReference")}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            placeholder="A short description"
            {...register("description")}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Private notes</Label>
          <Textarea
            id="notes"
            placeholder="Optional details about this holding"
            {...register("notes")}
          />
        </div>
      </div>
      <Checkbox
        label="Include this account in net worth"
        {...register("isIncludedInNetWorth")}
      />
      {serverState.message ? (
        <p
          role="alert"
          className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200"
        >
          {serverState.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={pending}>
          {pending ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Save size={17} />
          )}
          {initial ? "Save account" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
