"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { LoaderCircle, Save } from "lucide-react";
import { z } from "zod";

import type { InvestmentInstrument } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/form-controls";
import { currencyOptions } from "@/lib/currencies";
import { investmentCommandSchema, type ActionState } from "@/lib/validation";

const COMMAND_LABELS = {
  reinvestment: "Dividend reinvestment",
  in_kind_transfer: "In-kind transfer",
  split: "Stock split",
  spinoff: "Spin-off",
  merger: "Merger",
} as const;

export function InvestmentCommandForm({
  action,
  accountId,
  accountCurrency,
  positionAccounts,
  instruments,
  currencies,
  today,
  initialCommand = "reinvestment",
}: {
  action: (formData: FormData) => Promise<ActionState>;
  accountId: string;
  accountCurrency: string;
  positionAccounts: Array<{ id: string; name: string }>;
  instruments: InvestmentInstrument[];
  currencies: string[];
  today: string;
  initialCommand?: keyof typeof COMMAND_LABELS;
}) {
  type Values = z.input<typeof investmentCommandSchema>;
  const destinations = positionAccounts.filter(
    (account) => account.id !== accountId,
  );
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(investmentCommandSchema),
    defaultValues: {
      command: initialCommand,
      accountId,
      instrumentId: instruments[0]?.id,
      destinationAccountId: destinations[0]?.id,
      destinationInstrumentId: instruments[1]?.id ?? instruments[0]?.id,
      tradeCurrency: instruments[0]?.quoteCurrency ?? accountCurrency,
      activityDate: today,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  const command = useWatch({ control, name: "command" });
  const tradeCurrency = useWatch({ control, name: "tradeCurrency" });
  const submit = handleSubmit((_values, event) => {
    const formData = new FormData(event?.target as HTMLFormElement);
    startTransition(async () => setState(await action(formData)));
  });

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <input type="hidden" {...register("accountId")} />
      <input type="hidden" {...register("idempotencyKey")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="command">Action</Label>
          <Select id="command" {...register("command")}>
            {Object.entries(COMMAND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="instrumentId">
            {command === "spinoff" || command === "merger"
              ? "Source instrument"
              : "Instrument"}
          </Label>
          <Select id="instrumentId" {...register("instrumentId")}>
            {instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.symbol || instrument.name} ·{" "}
                {instrument.quoteCurrency}
              </option>
            ))}
          </Select>
          <FieldError>{errors.instrumentId?.message}</FieldError>
        </div>

        {command === "in_kind_transfer" ? (
          <div>
            <Label htmlFor="destinationAccountId">Destination account</Label>
            <Select
              id="destinationAccountId"
              {...register("destinationAccountId")}
            >
              {destinations.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            <FieldError>{errors.destinationAccountId?.message}</FieldError>
          </div>
        ) : null}

        {command === "spinoff" || command === "merger" ? (
          <div>
            <Label htmlFor="destinationInstrumentId">
              {command === "spinoff"
                ? "Spin-off instrument"
                : "Resulting instrument"}
            </Label>
            <Select
              id="destinationInstrumentId"
              {...register("destinationInstrumentId")}
            >
              {instruments.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.symbol || instrument.name} ·{" "}
                  {instrument.quoteCurrency}
                </option>
              ))}
            </Select>
            <FieldError>{errors.destinationInstrumentId?.message}</FieldError>
          </div>
        ) : null}

        {command === "reinvestment" ? (
          <>
            <div>
              <Label htmlFor="dividendAmount">
                Dividend amount ({accountCurrency})
              </Label>
              <Input
                id="dividendAmount"
                inputMode="decimal"
                {...register("dividendAmount")}
              />
              <FieldError>{errors.dividendAmount?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="unitPrice">Execution price per unit</Label>
              <Input
                id="unitPrice"
                inputMode="decimal"
                {...register("unitPrice")}
              />
              <FieldError>{errors.unitPrice?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="tradeCurrency">Trade currency</Label>
              <Select id="tradeCurrency" {...register("tradeCurrency")}>
                {currencyOptions(currencies).map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} - {currency.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="cashEffect">
                Actual purchase settlement ({accountCurrency})
              </Label>
              <Input
                id="cashEffect"
                inputMode="decimal"
                placeholder="Optional"
                {...register("cashEffect")}
              />
            </div>
            {tradeCurrency !== accountCurrency ? (
              <div>
                <Label htmlFor="appliedExchangeRate">
                  Applied settlement rate
                </Label>
                <Input
                  id="appliedExchangeRate"
                  inputMode="decimal"
                  placeholder="Optional when settlement is entered"
                  {...register("appliedExchangeRate")}
                />
              </div>
            ) : null}
            <div>
              <Label htmlFor="feeCurrency">Fee currency</Label>
              <Select id="feeCurrency" {...register("feeCurrency")}>
                <option value="">Use trade currency</option>
                {currencyOptions(currencies).map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : null}

        {command === "reinvestment" || command === "in_kind_transfer" ? (
          <div>
            <Label htmlFor="quantity">
              {command === "reinvestment"
                ? "Purchased quantity"
                : "Transferred quantity"}
            </Label>
            <Input
              id="quantity"
              inputMode="decimal"
              {...register("quantity")}
            />
            <FieldError>{errors.quantity?.message}</FieldError>
          </div>
        ) : null}

        {command === "reinvestment" || command === "in_kind_transfer" ? (
          <div>
            <Label htmlFor="feeAmount">Fee amount</Label>
            <Input
              id="feeAmount"
              inputMode="decimal"
              placeholder="Optional"
              {...register("feeAmount")}
            />
          </div>
        ) : null}

        {command === "split" ||
        command === "spinoff" ||
        command === "merger" ? (
          <>
            <div>
              <Label htmlFor="numerator">New or resulting shares</Label>
              <Input
                id="numerator"
                inputMode="decimal"
                placeholder="2"
                {...register("numerator")}
              />
              <FieldError>{errors.numerator?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="denominator">Existing or source shares</Label>
              <Input
                id="denominator"
                inputMode="decimal"
                placeholder="1"
                {...register("denominator")}
              />
              <FieldError>{errors.denominator?.message}</FieldError>
            </div>
          </>
        ) : null}

        <div>
          <Label htmlFor="activityDate">Effective date</Label>
          <Input id="activityDate" type="date" {...register("activityDate")} />
          <FieldError>{errors.activityDate?.message}</FieldError>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Private notes</Label>
          <Textarea id="notes" {...register("notes")} />
        </div>
      </div>
      {state.message ? (
        <p
          role="alert"
          className="rounded-lg bg-red-400/10 p-3 text-sm text-red-200"
        >
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={pending || !instruments.length}>
          {pending ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Save size={17} />
          )}
          Save {COMMAND_LABELS[command].toLowerCase()}
        </Button>
      </div>
    </form>
  );
}
