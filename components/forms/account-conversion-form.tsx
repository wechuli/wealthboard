"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Eye, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { z } from "zod";

import type { InvestmentInstrument } from "@/db/schema";
import { MoneyValue } from "@/components/privacy-provider";
import { Button } from "@/components/ui/button";
import {
  Checkbox,
  FieldError,
  Input,
  Label,
  Select,
} from "@/components/ui/form-controls";
import { accountConversionSchema, type ActionState } from "@/lib/validation";

type PreviewState = ActionState & {
  preview?: {
    currency: string;
    conversionDate: string;
    sourceBalanceMinor: string;
    openingCashMinor: string;
    positionsMinor: string;
    projectedTotalMinor: string;
    differenceMinor: string;
    holdings: Array<{
      instrumentId: string;
      name: string;
      symbol: string | null;
      quantity: string;
      price: string;
      quoteCurrency: string;
    }>;
  };
};

type HoldingRow = {
  key: string;
  instrumentId: string;
  quantity: string;
  price: string;
  openingCostBasis: string;
  priceSource: string;
  priceProvenance: string;
};

function serializedHoldings(rows: HoldingRow[]) {
  return JSON.stringify(
    rows.map((holding) => ({
      instrumentId: holding.instrumentId,
      quantity: holding.quantity,
      price: holding.price,
      openingCostBasis: holding.openingCostBasis || undefined,
      priceSource: holding.priceSource,
      priceProvenance: holding.priceProvenance || undefined,
    })),
  );
}

function conversionFormData(values: z.input<typeof accountConversionSchema>) {
  const formData = new FormData();
  formData.set("sourceAccountId", values.sourceAccountId);
  formData.set("targetName", values.targetName);
  formData.set("conversionDate", values.conversionDate);
  formData.set("openingCash", values.openingCash);
  formData.set("holdingsJson", values.holdingsJson);
  formData.set("idempotencyKey", values.idempotencyKey);
  if (values.confirmDifference) formData.set("confirmDifference", "on");
  return formData;
}

export function AccountConversionForm({
  previewAction,
  convertAction,
  sourceAccount,
  instruments,
  today,
  initialInstrumentId,
}: {
  previewAction: (formData: FormData) => Promise<PreviewState>;
  convertAction: (formData: FormData) => Promise<ActionState>;
  sourceAccount: {
    id: string;
    name: string;
    currency: string;
    currentValueMinor: number;
  };
  instruments: InvestmentInstrument[];
  today: string;
  initialInstrumentId?: string;
}) {
  type Values = z.input<typeof accountConversionSchema>;
  const initialHolding: HoldingRow = {
    key: crypto.randomUUID(),
    instrumentId: initialInstrumentId ?? instruments[0]?.id ?? "",
    quantity: "",
    price: "",
    openingCostBasis: "",
    priceSource: "conversion",
    priceProvenance: "",
  };
  const [holdings, setHoldings] = useState<HoldingRow[]>([initialHolding]);
  const [state, setState] = useState<PreviewState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(accountConversionSchema),
    defaultValues: {
      sourceAccountId: sourceAccount.id,
      targetName: `${sourceAccount.name} Positions`,
      conversionDate: today,
      openingCash: "0",
      holdingsJson: serializedHoldings([initialHolding]),
      idempotencyKey: crypto.randomUUID(),
      confirmDifference: false,
    },
  });
  const confirmDifference = useWatch({
    control,
    name: "confirmDifference",
  });

  const replaceHoldings = (next: HoldingRow[]) => {
    setHoldings(next);
    setValue("holdingsJson", serializedHoldings(next), {
      shouldValidate: true,
    });
    setState({});
  };
  const updateHolding = (
    index: number,
    field: keyof Omit<HoldingRow, "key">,
    value: string,
  ) => {
    replaceHoldings(
      holdings.map((holding, candidate) =>
        candidate === index ? { ...holding, [field]: value } : holding,
      ),
    );
  };
  const preview = handleSubmit((values) => {
    startTransition(async () =>
      setState(await previewAction(conversionFormData(values))),
    );
  });
  const convert = handleSubmit((values) => {
    if (!state.preview) return;
    startTransition(async () =>
      setState(await convertAction(conversionFormData(values))),
    );
  });
  const difference = BigInt(state.preview?.differenceMinor ?? 0);

  return (
    <form
      onSubmit={convert}
      onChange={(event) => {
        if (
          (event.target as Element).getAttribute("name") !== "confirmDifference"
        ) {
          setState({});
        }
      }}
      className="space-y-6"
      noValidate
    >
      <input type="hidden" {...register("sourceAccountId")} />
      <input type="hidden" {...register("holdingsJson")} />
      <input type="hidden" {...register("idempotencyKey")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="targetName">Replacement account name</Label>
          <Input id="targetName" {...register("targetName")} />
          <FieldError>{errors.targetName?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="conversionDate">Conversion date</Label>
          <Input
            id="conversionDate"
            type="date"
            {...register("conversionDate")}
          />
          <FieldError>{errors.conversionDate?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="openingCash">
            Opening cash ({sourceAccount.currency})
          </Label>
          <Input
            id="openingCash"
            inputMode="decimal"
            {...register("openingCash")}
          />
          <FieldError>{errors.openingCash?.message}</FieldError>
        </div>
        <div className="rounded-lg border border-white/10 p-3">
          <p className="text-xs text-slate-500">Current account value</p>
          <MoneyValue
            amount={sourceAccount.currentValueMinor}
            currency={sourceAccount.currency}
            className="mt-1 font-semibold"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Opening holdings
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Enter explicit quantities and prices; no historical units are
              inferred.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              replaceHoldings([
                ...holdings,
                {
                  ...initialHolding,
                  key: crypto.randomUUID(),
                  instrumentId: instruments[0]?.id ?? "",
                },
              ])
            }
            disabled={!instruments.length}
          >
            <Plus size={15} />
            Holding
          </Button>
        </div>
        {!instruments.length ? (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
            Create an instrument before conversion.{" "}
            <Link
              href={`/accounts/${sourceAccount.id}/instruments/new?return=conversion`}
              className="font-semibold underline"
            >
              Add instrument
            </Link>
          </div>
        ) : null}
        {holdings.map((holding, index) => (
          <div
            key={holding.key}
            className="grid gap-3 rounded-lg border border-white/10 p-3 sm:grid-cols-2 lg:grid-cols-6"
          >
            <div className="lg:col-span-2">
              <Label htmlFor={`holding-instrument-${index}`}>Instrument</Label>
              <Select
                id={`holding-instrument-${index}`}
                value={holding.instrumentId}
                onChange={(event) =>
                  updateHolding(index, "instrumentId", event.target.value)
                }
              >
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.symbol || instrument.name} ·{" "}
                    {instrument.quoteCurrency}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`holding-quantity-${index}`}>Quantity</Label>
              <Input
                id={`holding-quantity-${index}`}
                inputMode="decimal"
                value={holding.quantity}
                onChange={(event) =>
                  updateHolding(index, "quantity", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor={`holding-price-${index}`}>Unit price</Label>
              <Input
                id={`holding-price-${index}`}
                inputMode="decimal"
                value={holding.price}
                onChange={(event) =>
                  updateHolding(index, "price", event.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor={`holding-basis-${index}`}>Reference basis</Label>
              <Input
                id={`holding-basis-${index}`}
                inputMode="decimal"
                value={holding.openingCostBasis}
                onChange={(event) =>
                  updateHolding(index, "openingCostBasis", event.target.value)
                }
              />
            </div>
            <div className="flex items-end justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove holding ${index + 1}`}
                disabled={holdings.length === 1}
                onClick={() =>
                  replaceHoldings(
                    holdings.filter((_, candidate) => candidate !== index),
                  )
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
            <div className="lg:col-span-2">
              <Label htmlFor={`holding-source-${index}`}>Price source</Label>
              <Input
                id={`holding-source-${index}`}
                value={holding.priceSource}
                onChange={(event) =>
                  updateHolding(index, "priceSource", event.target.value)
                }
              />
            </div>
            <div className="lg:col-span-4">
              <Label htmlFor={`holding-provenance-${index}`}>
                Price provenance
              </Label>
              <Input
                id={`holding-provenance-${index}`}
                value={holding.priceProvenance}
                placeholder="Optional statement or source reference"
                onChange={(event) =>
                  updateHolding(index, "priceProvenance", event.target.value)
                }
              />
            </div>
          </div>
        ))}
        <FieldError>{errors.holdingsJson?.message}</FieldError>
      </div>

      {state.message ? (
        <p
          role="alert"
          className="rounded-lg bg-red-400/10 p-3 text-sm text-red-200"
        >
          {state.message}
        </p>
      ) : null}

      {state.preview ? (
        <div className="space-y-4 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Summary
              label="Source balance"
              value={state.preview.sourceBalanceMinor}
              currency={state.preview.currency}
            />
            <Summary
              label="Opening cash"
              value={state.preview.openingCashMinor}
              currency={state.preview.currency}
            />
            <Summary
              label="Opening positions"
              value={state.preview.positionsMinor}
              currency={state.preview.currency}
            />
            <Summary
              label="Projected total"
              value={state.preview.projectedTotalMinor}
              currency={state.preview.currency}
            />
          </div>
          {difference !== 0n ? (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
              <p className="text-sm text-amber-200">
                The replacement differs from the source balance by{" "}
                <MoneyValue
                  amount={difference}
                  currency={state.preview.currency}
                />
                .
              </p>
              <Checkbox
                label="I reviewed and accept this conversion difference"
                {...register("confirmDifference")}
              />
            </div>
          ) : null}
          <p className="text-xs text-slate-400">
            Confirmation archives the source account and creates a linked
            replacement. Existing history remains unchanged.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !instruments.length}
          onClick={() => void preview()}
        >
          {pending ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <Eye size={16} />
          )}
          Preview conversion
        </Button>
        <Button
          type="submit"
          disabled={
            pending ||
            !state.preview ||
            (difference !== 0n && !confirmDifference)
          }
        >
          {pending ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          Convert account
        </Button>
      </div>
    </form>
  );
}

function Summary({
  label,
  value,
  currency,
}: {
  label: string;
  value: string;
  currency: string;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <MoneyValue
        amount={BigInt(value)}
        currency={currency}
        className="mt-1 font-semibold"
      />
    </div>
  );
}
