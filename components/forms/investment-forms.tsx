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
import {
  investmentInstrumentSchema,
  positionEventSchema,
  positionReconciliationSchema,
  securityPriceSchema,
  type ActionState,
} from "@/lib/validation";

function FormMessage({ state }: { state: ActionState }) {
  return state.message ? (
    <p
      className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200"
      role="alert"
    >
      {state.message}
    </p>
  ) : null;
}

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <div className="flex justify-end">
      <Button disabled={pending}>
        {pending ? (
          <LoaderCircle className="animate-spin" size={17} />
        ) : (
          <Save size={17} />
        )}
        {label}
      </Button>
    </div>
  );
}

export function InvestmentInstrumentForm({
  action,
  currencies,
  baseCurrency,
  initial,
}: {
  action: (formData: FormData) => Promise<ActionState>;
  currencies: string[];
  baseCurrency: string;
  initial?: Partial<z.input<typeof investmentInstrumentSchema>>;
}) {
  type Values = z.input<typeof investmentInstrumentSchema>;
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(investmentInstrumentSchema),
    defaultValues: {
      identifierType: "ticker_exchange",
      assetType: "etf",
      quoteCurrency: baseCurrency,
      ...initial,
    },
  });
  const submit = handleSubmit((_values, event) => {
    const formData = new FormData(event?.target as HTMLFormElement);
    startTransition(async () => setState(await action(formData)));
  });
  const progressiveAction = action as unknown as (formData: FormData) => void;

  return (
    <form
      action={progressiveAction}
      onSubmit={submit}
      className="space-y-6"
      noValidate
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="name">Instrument name</Label>
          <Input
            id="name"
            placeholder="Example World ETF"
            {...register("name")}
          />
          <FieldError>{errors.name?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="symbol">Symbol</Label>
          <Input id="symbol" placeholder="EWLD" {...register("symbol")} />
        </div>
        <div>
          <Label htmlFor="assetType">Instrument type</Label>
          <Select id="assetType" {...register("assetType")}>
            <option value="stock">Stock</option>
            <option value="etf">ETF</option>
            <option value="fund">Fund</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="identifierType">Identifier type</Label>
          <Select id="identifierType" {...register("identifierType")}>
            <option value="ticker_exchange">Ticker and exchange</option>
            <option value="isin">ISIN</option>
            <option value="custom">Custom</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="identifier">Identifier</Label>
          <Input
            id="identifier"
            placeholder="EWLD or an ISIN"
            {...register("identifier")}
          />
        </div>
        <div>
          <Label htmlFor="exchangeMic">Exchange MIC</Label>
          <Input
            id="exchangeMic"
            placeholder="XNAS"
            {...register("exchangeMic")}
          />
        </div>
        <div>
          <Label htmlFor="quoteCurrency">Quote currency</Label>
          <Select id="quoteCurrency" {...register("quoteCurrency")}>
            {currencyOptions(currencies).map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} - {currency.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="externalId">External instrument ID</Label>
          <Input
            id="externalId"
            placeholder="Optional stable source ID"
            {...register("externalId")}
          />
        </div>
      </div>
      <FormMessage state={state} />
      <SubmitButton
        pending={pending}
        label={initial ? "Save instrument" : "Create instrument"}
      />
    </form>
  );
}

export function PositionEventForm({
  action,
  accountId,
  accountCurrency,
  instruments,
  currencies,
  today,
  initialInstrumentId,
  initialType = "opening_position",
  initial,
}: {
  action: (formData: FormData) => Promise<ActionState>;
  accountId: string;
  accountCurrency: string;
  instruments: InvestmentInstrument[];
  currencies: string[];
  today: string;
  initialInstrumentId?: string;
  initialType?: "opening_position" | "buy" | "sell" | "quantity_adjustment";
  initial?: Partial<z.input<typeof positionEventSchema>>;
}) {
  type Values = z.input<typeof positionEventSchema>;
  const selected =
    instruments.find((instrument) => instrument.id === initialInstrumentId) ??
    instruments[0];
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(positionEventSchema),
    defaultValues: {
      accountId,
      instrumentId: selected?.id,
      type: initialType,
      tradeCurrency: selected?.quoteCurrency ?? accountCurrency,
      tradeDate: today,
      idempotencyKey: crypto.randomUUID(),
      ...initial,
    },
  });
  const type = useWatch({ control, name: "type" });
  const submit = handleSubmit((_values, event) => {
    const formData = new FormData(event?.target as HTMLFormElement);
    startTransition(async () => setState(await action(formData)));
  });
  const progressiveAction = action as unknown as (formData: FormData) => void;

  return (
    <form
      action={progressiveAction}
      onSubmit={submit}
      className="space-y-6"
      noValidate
    >
      <input type="hidden" {...register("accountId")} />
      <input type="hidden" {...register("idempotencyKey")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="instrumentId">Instrument</Label>
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
        <div>
          <Label htmlFor="type">Activity</Label>
          <Select id="type" {...register("type")}>
            <option value="opening_position">Opening position</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="quantity_adjustment">Quantity adjustment</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="quantity">
            {type === "quantity_adjustment"
              ? "Signed quantity change"
              : "Quantity"}
          </Label>
          <Input
            id="quantity"
            inputMode="decimal"
            placeholder="0"
            {...register("quantity")}
          />
          <FieldError>{errors.quantity?.message}</FieldError>
        </div>
        {type === "buy" || type === "sell" ? (
          <>
            <div>
              <Label htmlFor="unitPrice">Execution price per unit</Label>
              <Input
                id="unitPrice"
                inputMode="decimal"
                placeholder="0.00"
                {...register("unitPrice")}
              />
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
              <Label htmlFor="feeAmount">Fee amount</Label>
              <Input
                id="feeAmount"
                inputMode="decimal"
                placeholder="Optional"
                {...register("feeAmount")}
              />
            </div>
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
            <div>
              <Label htmlFor="cashEffect">
                Actual settlement amount ({accountCurrency})
              </Label>
              <Input
                id="cashEffect"
                inputMode="decimal"
                placeholder="Optional"
                {...register("cashEffect")}
              />
            </div>
            <div>
              <Label htmlFor="appliedExchangeRate">
                Applied settlement rate
              </Label>
              <Input
                id="appliedExchangeRate"
                inputMode="decimal"
                placeholder="Optional"
                {...register("appliedExchangeRate")}
              />
            </div>
          </>
        ) : (
          <input type="hidden" {...register("tradeCurrency")} />
        )}
        {type === "opening_position" ? (
          <div>
            <Label htmlFor="openingCostBasis">
              Reference opening cost basis ({accountCurrency})
            </Label>
            <Input
              id="openingCostBasis"
              inputMode="decimal"
              placeholder="Optional"
              {...register("openingCostBasis")}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor="tradeDate">Trade date</Label>
          <Input id="tradeDate" type="date" {...register("tradeDate")} />
        </div>
        {type === "buy" || type === "sell" ? (
          <div>
            <Label htmlFor="settlementDate">Settlement date</Label>
            <Input
              id="settlementDate"
              type="date"
              {...register("settlementDate")}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor="externalId">External event ID</Label>
          <Input
            id="externalId"
            placeholder="Optional stable source ID"
            {...register("externalId")}
          />
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            placeholder="Optional memo"
            {...register("description")}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Private notes</Label>
          <Textarea id="notes" {...register("notes")} />
        </div>
      </div>
      <FormMessage state={state} />
      <SubmitButton
        pending={pending}
        label={initial ? "Save correction" : "Save position activity"}
      />
    </form>
  );
}

export function SecurityPriceForm({
  action,
  accountId,
  instruments,
  today,
  initialInstrumentId,
}: {
  action: (formData: FormData) => Promise<ActionState>;
  accountId: string;
  instruments: InvestmentInstrument[];
  today: string;
  initialInstrumentId?: string;
}) {
  type Values = z.input<typeof securityPriceSchema>;
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(securityPriceSchema),
    defaultValues: {
      accountId,
      instrumentId: initialInstrumentId ?? instruments[0]?.id,
      effectiveDate: today,
      source: "manual",
    },
  });
  const submit = handleSubmit((_values, event) => {
    const formData = new FormData(event?.target as HTMLFormElement);
    startTransition(async () => setState(await action(formData)));
  });
  const progressiveAction = action as unknown as (formData: FormData) => void;
  return (
    <form
      action={progressiveAction}
      onSubmit={submit}
      className="space-y-6"
      noValidate
    >
      <input type="hidden" {...register("accountId")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="instrumentId">Instrument</Label>
          <Select id="instrumentId" {...register("instrumentId")}>
            {instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.symbol || instrument.name} ·{" "}
                {instrument.quoteCurrency}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="price">Unit price</Label>
          <Input
            id="price"
            inputMode="decimal"
            placeholder="0.00"
            {...register("price")}
          />
          <FieldError>{errors.price?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="effectiveDate">Price date</Label>
          <Input
            id="effectiveDate"
            type="date"
            {...register("effectiveDate")}
          />
        </div>
        <div>
          <Label htmlFor="source">Source</Label>
          <Input id="source" placeholder="manual" {...register("source")} />
        </div>
        <div>
          <Label htmlFor="externalId">External price ID</Label>
          <Input
            id="externalId"
            placeholder="Optional stable source ID"
            {...register("externalId")}
          />
        </div>
        <div>
          <Label htmlFor="provenance">Provenance</Label>
          <Input
            id="provenance"
            placeholder="Statement or provider reference"
            {...register("provenance")}
          />
        </div>
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending} label="Save price" />
    </form>
  );
}

export function PositionReconciliationForm({
  action,
  accountId,
  accountCurrency,
  today,
}: {
  action: (formData: FormData) => Promise<ActionState>;
  accountId: string;
  accountCurrency: string;
  today: string;
}) {
  type Values = z.input<typeof positionReconciliationSchema>;
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit } = useForm<Values>({
    resolver: zodResolver(positionReconciliationSchema),
    defaultValues: { accountId, observationDate: today },
  });
  const submit = handleSubmit((_values, event) => {
    const formData = new FormData(event?.target as HTMLFormElement);
    startTransition(async () => setState(await action(formData)));
  });
  const progressiveAction = action as unknown as (formData: FormData) => void;
  return (
    <form
      action={progressiveAction}
      onSubmit={submit}
      className="space-y-6"
      noValidate
    >
      <input type="hidden" {...register("accountId")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="observationDate">Statement date</Label>
          <Input
            id="observationDate"
            type="date"
            {...register("observationDate")}
          />
        </div>
        <div>
          <Label htmlFor="reportedCash">
            Reported cash ({accountCurrency})
          </Label>
          <Input
            id="reportedCash"
            inputMode="decimal"
            placeholder="Optional"
            {...register("reportedCash")}
          />
        </div>
        <div>
          <Label htmlFor="reportedTotal">
            Reported total ({accountCurrency})
          </Label>
          <Input
            id="reportedTotal"
            inputMode="decimal"
            placeholder="0.00"
            {...register("reportedTotal")}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" {...register("notes")} />
        </div>
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending} label="Save reconciliation" />
    </form>
  );
}
