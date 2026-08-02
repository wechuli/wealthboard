"use client";

import { useActionState, useRef, useState } from "react";
import {
  Download,
  FileInput,
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
import { FieldError, Input, Label, Select } from "@/components/ui/form-controls";
import type { UserSettings } from "@/db/schema";
import { formatDate } from "@/lib/dates";

function SubmitButton({
  pending,
  label,
  icon,
}: {
  pending: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return <Button disabled={pending}>{pending ? <LoaderCircle className="animate-spin" size={16} /> : icon}{label}</Button>;
}

export function GeneralSettingsForm({ settings }: { settings: UserSettings }) {
  const [state, action, pending] = useActionState(updateSettingsAction, {});
  return (
    <Card>
      <CardHeader><CardTitle>Preferences</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-5 sm:grid-cols-2">
          <div><Label htmlFor="displayName">Display name</Label><Input id="displayName" name="displayName" defaultValue={settings.displayName} /><FieldError>{state.fieldErrors?.displayName?.[0]}</FieldError></div>
          <div><Label htmlFor="appName">Application name</Label><Input id="appName" name="appName" defaultValue={settings.appName} /></div>
          <div><Label htmlFor="baseCurrency">Base currency</Label><Input id="baseCurrency" name="baseCurrency" maxLength={3} defaultValue={settings.baseCurrency} /></div>
          <div><Label htmlFor="supportedCurrencies">Supported currencies</Label><Input id="supportedCurrencies" name="supportedCurrencies" defaultValue={(JSON.parse(settings.supportedCurrencies) as string[]).join(", ")} /><p className="mt-1 text-xs text-slate-500">Comma-separated ISO codes</p></div>
          <div><Label htmlFor="timezone">Timezone</Label><Input id="timezone" name="timezone" defaultValue={settings.timezone} /></div>
          <div><Label htmlFor="preferredDateFormat">Date format</Label><Select id="preferredDateFormat" name="preferredDateFormat" defaultValue={settings.preferredDateFormat}><option value="dd MMM yyyy">31 Dec 2026</option><option value="dd/MM/yyyy">31/12/2026</option><option value="MM/dd/yyyy">12/31/2026</option><option value="yyyy-MM-dd">2026-12-31</option></Select></div>
          <div><Label htmlFor="defaultDashboardPeriod">Default dashboard period</Label><Select id="defaultDashboardPeriod" name="defaultDashboardPeriod" defaultValue={settings.defaultDashboardPeriod}><option value="1m">One month</option><option value="3m">Three months</option><option value="6m">Six months</option><option value="1y">One year</option><option value="all">All time</option></Select></div>
          <div><Label htmlFor="sessionTimeoutMinutes">Session timeout (minutes)</Label><Input id="sessionTimeoutMinutes" name="sessionTimeoutMinutes" type="number" min="15" defaultValue={settings.sessionTimeoutMinutes} /></div>
          <div><Label htmlFor="defaultGoalReturn">Default goal return (%)</Label><Input id="defaultGoalReturn" name="defaultGoalReturn" type="number" min="0" max="100" step="0.1" defaultValue={settings.defaultGoalReturnBps / 100} /></div>
          <div className="flex items-end justify-between gap-3 sm:col-span-2">
            <p role="status" className={state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"}>{state.message}</p>
            <SubmitButton pending={pending} label="Save preferences" icon={<Save size={16} />} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ExchangeRateForm({
  rates,
}: {
  rates: Array<{ id: string; baseCurrency: string; quoteCurrency: string; rate: string; effectiveDate: string; source: string }>;
}) {
  const [state, action, pending] = useActionState(exchangeRateAction, {});
  return (
    <Card>
      <CardHeader><div><CardTitle>Exchange rates</CardTitle><p className="mt-1 text-xs text-slate-500">Quote units received for one base unit, for example 130 KES per USD.</p></div></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 sm:grid-cols-4">
          <div><Label htmlFor="rateBase">Base</Label><Input id="rateBase" name="baseCurrency" maxLength={3} defaultValue="USD" /></div>
          <div><Label htmlFor="rateQuote">Quote</Label><Input id="rateQuote" name="quoteCurrency" maxLength={3} defaultValue="KES" /></div>
          <div><Label htmlFor="rate">Rate</Label><Input id="rate" name="rate" inputMode="decimal" placeholder="130.00" /></div>
          <div><Label htmlFor="effectiveDate">Effective date</Label><Input id="effectiveDate" name="effectiveDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div className="flex items-center justify-between gap-3 sm:col-span-4"><p role="status" className={state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"}>{state.message}</p><SubmitButton pending={pending} label="Save rate" icon={<RefreshCw size={16} />} /></div>
        </form>
        <div className="mt-5 max-h-56 overflow-auto rounded-xl border border-white/[0.06]">
          {rates.map((rate) => (
            <div key={rate.id} className="flex items-center justify-between border-b border-white/[0.05] px-3 py-2 text-sm last:border-0">
              <span>{rate.baseCurrency}/{rate.quoteCurrency}</span>
              <span className="tabular-nums text-slate-300">{rate.rate}</span>
              <span className="text-xs text-slate-500">{formatDate(rate.effectiveDate, "UTC", "dd MMM yyyy")} · {rate.source}</span>
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
      <CardHeader><CardTitle>Password</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-3">
          <div><Label htmlFor="currentPassword">Current password</Label><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" /></div>
          <div><Label htmlFor="newPassword">New password</Label><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" /><FieldError>{state.fieldErrors?.newPassword?.[0]}</FieldError></div>
          <div><Label htmlFor="confirmPassword">Confirm new password</Label><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" /><FieldError>{state.fieldErrors?.confirmPassword?.[0]}</FieldError></div>
          <div className="flex items-center justify-between gap-3 sm:col-span-3"><p role="status" className={state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"}>{state.message}</p><SubmitButton pending={pending} label="Change password" icon={<KeyRound size={16} />} /></div>
        </form>
      </CardContent>
    </Card>
  );
}

export function DataPortability() {
  const restoreRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"restore" | "import" | null>(null);

  async function upload(kind: "restore" | "import") {
    const input = kind === "restore" ? restoreRef.current : importRef.current;
    const file = input?.files?.[0];
    if (!file) return toast.error("Choose a file first.");
    if (
      kind === "restore" &&
      !window.confirm(
        "Replace only your portfolio with this export? A copy of your current data will download first.",
      )
    ) return;
    if (kind === "restore") {
      const current = await fetch("/api/export/json", { cache: "no-store" });
      if (!current.ok) return toast.error("Your pre-restore export could not be created.");
      const url = URL.createObjectURL(await current.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `worthboard-before-restore-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
    const body = new FormData();
    body.set("file", file);
    setBusy(kind);
    try {
      const response = await fetch(
        kind === "restore" ? "/api/restore/user" : "/api/import/transactions",
        { method: "POST", body },
      );
      const result = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      toast.success(result.message);
      if (kind === "restore") window.location.assign("/");
      else window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader><div><CardTitle>Import, restore & export</CardTitle><p className="mt-1 text-xs text-slate-500">Portable files contain only your portfolio, never credentials or another user's records.</p></div></CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary"><a href="/api/export/json"><Download size={16} />Export JSON</a></Button>
          <Button asChild variant="secondary"><a href="/api/export/transactions.csv"><Download size={16} />Transactions CSV</a></Button>
          <Button asChild variant="secondary"><a href="/api/export/accounts.csv"><Download size={16} />Accounts CSV</a></Button>
        </div>
        <div className="grid gap-4 border-t border-white/[0.06] pt-5 md:grid-cols-2">
          <div className="rounded-xl bg-white/[0.025] p-4">
            <Label htmlFor="csvImport">Import transactions CSV</Label>
            <Input ref={importRef} id="csvImport" type="file" accept=".csv,text/csv" />
            <Button type="button" variant="secondary" className="mt-3" onClick={() => upload("import")} disabled={busy !== null}>
              {busy === "import" ? <LoaderCircle className="animate-spin" size={16} /> : <FileInput size={16} />}Import transactions
            </Button>
          </div>
          <div className="rounded-xl border border-amber-400/10 bg-amber-400/[0.035] p-4">
            <Label htmlFor="userRestore">Restore your JSON export</Label>
            <Input ref={restoreRef} id="userRestore" type="file" accept=".json,application/json" />
            <Button type="button" variant="danger" className="mt-3" onClick={() => upload("restore")} disabled={busy !== null}>
              {busy === "restore" ? <LoaderCircle className="animate-spin" size={16} /> : <Upload size={16} />}Replace my portfolio
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
