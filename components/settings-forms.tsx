"use client";

import { useActionState, useRef, useState } from "react";
import {
  Download,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  changePasswordAction,
  exchangeRateAction,
  updateSettingsAction,
} from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FieldError,
  Input,
  Label,
  Select,
} from "@/components/ui/form-controls";
import type { UserSettings } from "@/db/schema";
import {
  currencyOptions,
  normalizeEnabledCurrencies,
  parseEnabledCurrencies,
} from "@/lib/currencies";
import { formatDate } from "@/lib/dates";

function SubmitButton({
  pending,
  label,
  icon,
  disabled = false,
}: {
  pending: boolean;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button disabled={pending || disabled}>
      {pending ? <LoaderCircle className="animate-spin" size={16} /> : icon}
      {label}
    </Button>
  );
}

export function GeneralSettingsForm({
  settings,
  referencedCurrencies,
}: {
  settings: UserSettings;
  referencedCurrencies: string[];
}) {
  const [state, action, pending] = useActionState(updateSettingsAction, {});
  const initialEnabled = normalizeEnabledCurrencies(
    parseEnabledCurrencies(settings.supportedCurrencies),
    [settings.baseCurrency, ...referencedCurrencies],
  );
  const [baseCurrency, setBaseCurrency] = useState(settings.baseCurrency);
  const [enabledCurrencies, setEnabledCurrencies] = useState(initialEnabled);
  const options = currencyOptions(initialEnabled);
  const referenced = new Set(referencedCurrencies);

  const selectBaseCurrency = (currency: string) => {
    setBaseCurrency(currency);
    setEnabledCurrencies((current) =>
      normalizeEnabledCurrencies(current, [currency]),
    );
  };

  const toggleCurrency = (currency: string, enabled: boolean) => {
    setEnabledCurrencies((current) =>
      enabled
        ? normalizeEnabledCurrencies(current, [currency])
        : current.filter((code) => code !== currency),
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={settings.displayName}
            />
            <FieldError>{state.fieldErrors?.displayName?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor="appName">Application name</Label>
            <Input
              id="appName"
              name="appName"
              defaultValue={settings.appName}
            />
          </div>
          <div>
            <Label htmlFor="baseCurrency">Base currency</Label>
            <Select
              id="baseCurrency"
              name="baseCurrency"
              value={baseCurrency}
              onChange={(event) => selectBaseCurrency(event.target.value)}
            >
              {options.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
            </Select>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-slate-300">
              Enabled currencies
            </legend>
            <div className="grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/15 p-2 sm:grid-cols-2 lg:grid-cols-3">
              {options.map((currency) => {
                const isBase = currency.code === baseCurrency;
                const isReferenced = referenced.has(currency.code);
                const locked = isBase || isReferenced;
                return (
                  <label
                    key={currency.code}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-300 hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={enabledCurrencies.includes(currency.code)}
                      disabled={locked}
                      onChange={(event) =>
                        toggleCurrency(currency.code, event.target.checked)
                      }
                      className="h-4 w-4 shrink-0 accent-emerald-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-200">
                        {currency.code}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {currency.name}
                      </span>
                    </span>
                    {isBase ? (
                      <span className="text-xs text-emerald-300">Base</span>
                    ) : isReferenced ? (
                      <span className="text-xs text-slate-500">In use</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <input
              id="supportedCurrencies"
              name="supportedCurrencies"
              type="hidden"
              value={enabledCurrencies.join(",")}
            />
            <FieldError>
              {state.fieldErrors?.supportedCurrencies?.[0]}
            </FieldError>
          </fieldset>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              name="timezone"
              defaultValue={settings.timezone}
            />
          </div>
          <div>
            <Label htmlFor="preferredDateFormat">Date format</Label>
            <Select
              id="preferredDateFormat"
              name="preferredDateFormat"
              defaultValue={settings.preferredDateFormat}
            >
              <option value="dd MMM yyyy">31 Dec 2026</option>
              <option value="dd/MM/yyyy">31/12/2026</option>
              <option value="MM/dd/yyyy">12/31/2026</option>
              <option value="yyyy-MM-dd">2026-12-31</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="defaultDashboardPeriod">
              Default dashboard period
            </Label>
            <Select
              id="defaultDashboardPeriod"
              name="defaultDashboardPeriod"
              defaultValue={settings.defaultDashboardPeriod}
            >
              <option value="1m">One month</option>
              <option value="3m">Three months</option>
              <option value="6m">Six months</option>
              <option value="1y">One year</option>
              <option value="all">All time</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="sessionTimeoutMinutes">
              Session timeout (minutes)
            </Label>
            <Input
              id="sessionTimeoutMinutes"
              name="sessionTimeoutMinutes"
              type="number"
              min="15"
              defaultValue={settings.sessionTimeoutMinutes}
            />
          </div>
          <div>
            <Label htmlFor="defaultGoalReturn">Default goal return (%)</Label>
            <Input
              id="defaultGoalReturn"
              name="defaultGoalReturn"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue={settings.defaultGoalReturnBps / 100}
            />
          </div>
          <div className="flex items-end justify-between gap-3 sm:col-span-2">
            <p
              role="status"
              className={
                state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"
              }
            >
              {state.message}
            </p>
            <SubmitButton
              pending={pending}
              label="Save preferences"
              icon={<Save size={16} />}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ExchangeRateForm({
  rates,
  enabledCurrencies,
  baseCurrency,
}: {
  rates: Array<{
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    effectiveDate: string;
    source: string;
  }>;
  enabledCurrencies: string[];
  baseCurrency: string;
}) {
  const [state, action, pending] = useActionState(exchangeRateAction, {});
  const options = currencyOptions(enabledCurrencies).filter((currency) =>
    enabledCurrencies.includes(currency.code),
  );
  const defaultRateBase =
    options.find((currency) => currency.code !== baseCurrency)?.code ??
    baseCurrency;
  const canAddRate = options.length > 1;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Exchange rates</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Quote units received for one base unit, for example 130 KES per USD.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="rateBase">Base</Label>
            <Select
              id="rateBase"
              name="baseCurrency"
              defaultValue={defaultRateBase}
              disabled={!canAddRate}
            >
              {options.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rateQuote">Quote</Label>
            <Select
              id="rateQuote"
              name="quoteCurrency"
              defaultValue={baseCurrency}
              disabled={!canAddRate}
            >
              {options.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rate">Rate</Label>
            <Input
              id="rate"
              name="rate"
              inputMode="decimal"
              placeholder="130.00"
            />
          </div>
          <div>
            <Label htmlFor="effectiveDate">Effective date</Label>
            <Input
              id="effectiveDate"
              name="effectiveDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-4">
            <p
              role="status"
              className={
                state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"
              }
            >
              {state.message}
            </p>
            <SubmitButton
              pending={pending}
              label="Save rate"
              icon={<RefreshCw size={16} />}
              disabled={!canAddRate}
            />
          </div>
        </form>
        <div className="mt-5 max-h-56 overflow-auto rounded-xl border border-white/[0.06]">
          {rates.map((rate) => (
            <div
              key={rate.id}
              className="flex items-center justify-between border-b border-white/[0.05] px-3 py-2 text-sm last:border-0"
            >
              <span>
                {rate.baseCurrency}/{rate.quoteCurrency}
              </span>
              <span className="tabular-nums text-slate-300">{rate.rate}</span>
              <span className="text-xs text-slate-500">
                {formatDate(rate.effectiveDate, "UTC", "dd MMM yyyy")} ·{" "}
                {rate.source}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <div>
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
            />
            <FieldError>{state.fieldErrors?.newPassword?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
            />
            <FieldError>{state.fieldErrors?.confirmPassword?.[0]}</FieldError>
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-3">
            <p
              role="status"
              className={
                state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"
              }
            >
              {state.message}
            </p>
            <SubmitButton
              pending={pending}
              label="Change password"
              icon={<KeyRound size={16} />}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function DataPortability() {
  const restoreRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function restore() {
    const file = restoreRef.current?.files?.[0];
    if (!file) return toast.error("Choose a file first.");
    if (
      !window.confirm(
        "Replace only your portfolio with this export? A copy of your current data will download first.",
      )
    )
      return;
    const current = await fetch("/api/export/json", { cache: "no-store" });
    if (!current.ok)
      return toast.error("Your pre-restore export could not be created.");
    const url = URL.createObjectURL(await current.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `wealthboard-before-restore-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    const body = new FormData();
    body.set("file", file);
    setBusy(true);
    try {
      const response = await fetch("/api/restore/user", {
        method: "POST",
        body,
      });
      const result = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      toast.success(result.message);
      window.location.assign("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Import, restore & export</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Portable files contain only your portfolio, never credentials or
            another user&apos;s records.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <a href="/api/export/json">
              <Download size={16} />
              Export JSON
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href="/api/export/transactions.csv">
              <Download size={16} />
              Transactions CSV
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href="/api/export/accounts.csv">
              <Download size={16} />
              Accounts CSV
            </a>
          </Button>
        </div>
        <div className="border-t border-white/[0.06] pt-5">
          <div className="rounded-xl border border-amber-400/10 bg-amber-400/[0.035] p-4">
            <Label htmlFor="userRestore">Restore your JSON export</Label>
            <Input
              ref={restoreRef}
              id="userRestore"
              type="file"
              accept=".json,application/json"
            />
            <Button
              type="button"
              variant="danger"
              className="mt-3"
              onClick={restore}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Upload size={16} />
              )}
              Replace my portfolio
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
