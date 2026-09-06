"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  History,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  deleteExchangeRateAction,
  exchangeRateAction,
} from "@/app/(app)/actions";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SensitiveValue } from "@/components/privacy-provider";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  Input,
  Label,
  Select,
} from "@/components/ui/form-controls";
import { currencyOptions } from "@/lib/currencies";
import { formatDate } from "@/lib/dates";
import { exchangeRateSchema, type ActionState } from "@/lib/validation";
import type { listExchangeRateGroups } from "@/lib/services/settings";

type Group = Awaited<ReturnType<typeof listExchangeRateGroups>>[number];
type Entry = Group["latest"];
type Draft = z.input<typeof exchangeRateSchema>;

export function ExchangeRateManager({
  groups,
  enabledCurrencies,
  baseCurrency,
  today,
  timezone,
  dateFormat,
  initial,
}: {
  groups: Group[];
  enabledCurrencies: string[];
  baseCurrency: string;
  today: string;
  timezone: string;
  dateFormat: string;
  initial?: {
    baseCurrency: string;
    quoteCurrency: string;
    effectiveDate: string;
  };
}) {
  const emptyDraft = {
    baseCurrency:
      enabledCurrencies.find((currency) => currency !== baseCurrency) ??
      baseCurrency,
    quoteCurrency: baseCurrency,
    rate: "",
    effectiveDate: today,
  };
  const initialGroup =
    initial &&
    groups.find(
      (group) =>
        group.key ===
        [initial.baseCurrency, initial.quoteCurrency].sort().join("/"),
    );
  const [draft, setDraft] = useState<Draft | null>(
    initial
      ? {
          ...initial,
          rate: "",
          baseCurrency: initialGroup
            ? initialGroup.latest.baseCurrency
            : initial.baseCurrency,
          quoteCurrency: initialGroup
            ? initialGroup.latest.quoteCurrency
            : initial.quoteCurrency,
        }
      : null,
  );
  const [editorKey, setEditorKey] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const openEditor = (values: Draft) => {
    setNotice("");
    setDraft(values);
    setEditorKey((key) => key + 1);
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ block: "nearest" });
      editorRef.current
        ?.querySelector<HTMLInputElement>("#exchange-rate-value")
        ?.focus();
    });
  };
  const dateLabel = (value: string) => formatDate(value, timezone, dateFormat);

  return (
    <section
      id="exchange-rates"
      aria-labelledby="exchange-rates-title"
      className="scroll-mt-6 border-t border-white/10 py-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="exchange-rates-title" className="text-base font-semibold">
          Exchange rates
        </h2>
        <Button
          type="button"
          variant="secondary"
          disabled={enabledCurrencies.length < 2}
          onClick={() => openEditor(emptyDraft)}
        >
          <Plus size={16} /> Add pair
        </Button>
      </div>
      <p role="status" className="text-sm text-emerald-300">
        {notice}
      </p>
      <div ref={editorRef}>
        {draft ? (
          <RateEditor
            key={editorKey}
            draft={draft}
            enabledCurrencies={enabledCurrencies}
            onCancel={() => setDraft(null)}
            onSaved={() => {
              setDraft(null);
              setNotice("Exchange rate saved.");
            }}
          />
        ) : null}
      </div>
      {!groups.length ? (
        <p className="py-4 text-sm text-slate-400">No exchange rates saved.</p>
      ) : null}
      {enabledCurrencies.length < 2 ? (
        <p className="text-sm text-slate-400">
          Enable another currency in Preferences to add a rate.
        </p>
      ) : null}
      <div className="divide-y divide-white/10">
        {groups.map((group) => {
          const pair = `${group.latest.baseCurrency}/${group.latest.quoteCurrency}`;
          return (
            <div key={group.key} className="py-4" data-rate-pair={group.key}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{pair}</h3>
                  <p className="break-all text-sm text-slate-300">
                    <SensitiveValue>{group.latest.rate}</SensitiveValue>
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  <p>{dateLabel(group.latest.effectiveDate)}</p>
                  <p
                    className={
                      group.status === "Over a month old"
                        ? "text-amber-200"
                        : "text-slate-400"
                    }
                  >
                    {group.status}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  title={`Update ${pair}`}
                  aria-label={`Update ${pair}`}
                  size="icon"
                  onClick={() =>
                    openEditor({
                      baseCurrency: group.latest.baseCurrency,
                      quoteCurrency: group.latest.quoteCurrency,
                      rate: group.latest.rate,
                      effectiveDate: today,
                    })
                  }
                >
                  <RefreshCw size={16} />
                </Button>
              </div>
              <details className="mt-2" open={group.needsReview || undefined}>
                <summary className="cursor-pointer py-2 text-xs text-slate-400">
                  <History size={14} className="mr-1 inline" /> {pair} history (
                  {group.history.length})
                </summary>
                {group.needsReview ? (
                  <p className="mb-2 text-sm text-amber-200">
                    Both directions have saved entries. Review their values
                    before correcting or deleting them; no entries have been
                    removed.
                  </p>
                ) : null}
                <ul className="divide-y divide-white/5">
                  {group.history.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p>
                          {dateLabel(entry.effectiveDate)}{" "}
                          <span className="text-xs text-slate-500">
                            {entry.source}
                          </span>
                        </p>
                        <p className="break-all text-slate-300">
                          {entry.baseCurrency}/{entry.quoteCurrency}:{" "}
                          <SensitiveValue>{entry.rate}</SensitiveValue>
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={`Edit ${entry.baseCurrency}/${entry.quoteCurrency} rate from ${dateLabel(entry.effectiveDate)}`}
                        aria-label={`Edit ${entry.baseCurrency}/${entry.quoteCurrency} rate from ${dateLabel(entry.effectiveDate)}`}
                        onClick={() =>
                          openEditor({
                            id: entry.id,
                            baseCurrency: entry.baseCurrency,
                            quoteCurrency: entry.quoteCurrency,
                            rate: entry.rate,
                            effectiveDate: entry.effectiveDate.slice(0, 10),
                          })
                        }
                      >
                        <Pencil size={16} />
                      </Button>
                      <DeleteRate
                        entry={entry}
                        dateLabel={dateLabel(entry.effectiveDate)}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RateEditor({
  draft,
  enabledCurrencies,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  enabledCurrencies: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Draft, unknown, z.output<typeof exchangeRateSchema>>({
    resolver: zodResolver(exchangeRateSchema),
    defaultValues: draft,
  });
  const options = currencyOptions(enabledCurrencies).filter((currency) =>
    enabledCurrencies.includes(currency.code),
  );
  const submit = handleSubmit((values) => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) formData.set(key, value);
    startTransition(async () => {
      try {
        const result = await exchangeRateAction({}, formData);
        setState(result);
        if (result.ok) {
          router.refresh();
          onSaved();
        }
      } catch {
        setState({
          message:
            "The rate could not be saved. Check your connection and try again.",
        });
      }
    });
  });
  return (
    <form
      onSubmit={submit}
      className="mb-4 border-y border-white/10 py-4"
      aria-label={draft.id ? "Correct exchange rate" : "Save exchange rate"}
    >
      <h3 className="mb-3 text-sm font-semibold">
        {draft.id ? "Correct exchange rate" : "Save exchange rate"}
      </h3>
      <fieldset
        disabled={pending}
        className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input type="hidden" {...register("id")} />
        <div className="min-w-0">
          <Label htmlFor="rateBase">Base currency</Label>
          <Select
            id="rateBase"
            {...register("baseCurrency")}
            aria-readonly={Boolean(draft.id)}
          >
            {options
              .filter(
                (currency) => !draft.id || currency.code === draft.baseCurrency,
              )
              .map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
          </Select>
          <FieldError>
            {errors.baseCurrency?.message ||
              state.fieldErrors?.baseCurrency?.[0]}
          </FieldError>
        </div>
        <div className="min-w-0">
          <Label htmlFor="rateQuote">Quote currency</Label>
          <Select
            id="rateQuote"
            {...register("quoteCurrency")}
            aria-readonly={Boolean(draft.id)}
          >
            {options
              .filter(
                (currency) =>
                  !draft.id || currency.code === draft.quoteCurrency,
              )
              .map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
          </Select>
          <FieldError>
            {errors.quoteCurrency?.message ||
              state.fieldErrors?.quoteCurrency?.[0]}
          </FieldError>
        </div>
        <div className="min-w-0">
          <Label htmlFor="exchange-rate-value">Rate (quote per base)</Label>
          <Input
            id="exchange-rate-value"
            inputMode="decimal"
            {...register("rate")}
          />
          <FieldError>
            {errors.rate?.message || state.fieldErrors?.rate?.[0]}
          </FieldError>
        </div>
        <div className="min-w-0">
          <Label htmlFor="effectiveDate">Effective date</Label>
          <Input
            id="effectiveDate"
            type="date"
            {...register("effectiveDate")}
          />
          <FieldError>
            {errors.effectiveDate?.message ||
              state.fieldErrors?.effectiveDate?.[0]}
          </FieldError>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2 lg:col-span-4">
          <p role="status" className="mr-auto text-sm text-red-300">
            {state.message}
          </p>
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X size={16} /> Cancel
          </Button>
          <Button type="submit">
            <Save size={16} /> {pending ? "Saving..." : "Save rate"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function DeleteRate({ entry, dateLabel }: { entry: Entry; dateLabel: string }) {
  const [state, action, pending] = useActionState(deleteExchangeRateAction, {});
  const label = `Delete ${entry.baseCurrency}/${entry.quoteCurrency} rate from ${dateLabel}`;
  return (
    <form action={action} className="max-w-full">
      <input type="hidden" name="id" value={entry.id} />
      <ConfirmSubmit
        type="submit"
        variant="danger"
        size="icon"
        disabled={pending}
        title={label}
        aria-label={label}
        message={`Delete this ${entry.baseCurrency}/${entry.quoteCurrency} rate from ${dateLabel}? Current balances will use an older rate if available. Historical totals may become incomplete.`}
      >
        <Trash2 size={16} />
      </ConfirmSubmit>
      {state.message ? (
        <p role="status" className="text-xs text-red-300">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
