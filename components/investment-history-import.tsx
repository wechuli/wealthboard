"use client";

import { useState } from "react";
import { LoaderCircle, Upload } from "lucide-react";

import { MoneyValue, SensitiveValue } from "@/components/privacy-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form-controls";

type Preview = {
  hash: string;
  account: { id: string; name: string; currency: string };
  current: {
    cashMinor: string | number;
    positionsMinor: string | number;
    totalMinor: string | number;
    complete: boolean;
    issues: PreviewIssue[];
  };
  projected: Preview["current"] & {
    missingPrices: string[];
    missingCurrencies: string[];
    staleInstrumentIds: string[];
    issues: PreviewIssue[];
  };
  netChangeMinor: string | number;
  dateRange: { from: string; to: string } | null;
  instrumentChanges: Array<{
    instrumentId: string;
    externalId: string | null;
    name: string;
    symbol: string | null;
    resolution: "existing" | "new";
    currentQuantity: string;
    projectedQuantity: string;
    quantityChange: string;
  }>;
  eventChanges: Array<{
    externalId: string | null;
    instrumentId: string;
    instrumentName: string;
    instrumentSymbol: string | null;
    type: string;
    tradeDate: string;
    eventSequence: number;
    beforeQuantity: string;
    afterQuantity: string;
  }>;
  priceChanges: Array<{
    externalId: string | null;
    instrumentId: string;
    instrumentName: string;
    instrumentSymbol: string | null;
    price: string;
    currency: string;
    source: string;
    affectedFrom: string;
    affectedTo: string;
    affectedToExclusive: boolean;
  }>;
  summary: {
    records: number;
    ready: number;
    skippedDuplicates: number;
    failed: number;
  };
  canCommit: boolean;
  errors: Array<{
    collection: string;
    row: number;
    externalId: string | null;
    message: string;
  }>;
};

type PreviewIssue = {
  type: "missing_price" | "missing_rate" | "stale_price";
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  currency: string;
  affectedFrom: string;
  affectedTo: string;
  lastPriceDate: string | null;
  source: string | null;
  provenance: string | null;
  thresholdDays: number | null;
};

async function sha256(file: File) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function InvestmentHistoryImport({ accountId }: { accountId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  async function previewFile() {
    if (!file) return setError("Choose a CSV or JSON file.");
    setError("");
    setStatus("");
    setBusy("preview");
    try {
      const body = new FormData();
      body.set("file", file);
      const [hash, response] = await Promise.all([
        sha256(file),
        fetch(`/api/accounts/${accountId}/investment-import/preview`, {
          method: "POST",
          body,
        }),
      ]);
      const data = (await response.json()) as Preview & { error?: string };
      if (!response.ok) throw new Error(data.error || "Preview failed.");
      if (data.hash !== hash)
        throw new Error("The uploaded file hash did not match.");
      setPreview(data);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  async function commitFile() {
    if (!file || !preview) return;
    setError("");
    setBusy("commit");
    try {
      const hash = await sha256(file);
      if (hash !== preview.hash)
        throw new Error("The file changed after preview. Preview it again.");
      const body = new FormData();
      body.set("file", file);
      body.set("hash", hash);
      const response = await fetch(
        `/api/accounts/${accountId}/investment-import/commit`,
        { method: "POST", body },
      );
      const data = (await response.json()) as {
        summary?: { imported: number; skippedDuplicates: number };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Import failed.");
      setStatus(
        `${data.summary?.imported ?? 0} records imported; ${data.summary?.skippedDuplicates ?? 0} duplicates skipped.`,
      );
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Choose investment history</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Maximum 5 MB and 10,000 records. The file is not retained.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="investmentHistoryFile">CSV or JSON file</Label>
            <Input
              id="investmentHistoryFile"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setError("");
                setStatus("");
              }}
            />
          </div>
          <Button
            type="button"
            onClick={previewFile}
            disabled={!file || busy !== null}
          >
            {busy === "preview" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            Preview file
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          ) : null}
          {status ? (
            <p role="status" className="text-sm text-emerald-300">
              {status}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {preview ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Confirm projected account</CardTitle>
              <p className="mt-1 text-sm text-slate-400">
                {preview.account.name} · {preview.summary.records} source
                records
                {preview.dateRange
                  ? ` · ${preview.dateRange.from} to ${preview.dateRange.to}`
                  : ""}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Summary label="Current total">
                <MoneyValue
                  amount={BigInt(preview.current.totalMinor)}
                  currency={preview.account.currency}
                />
              </Summary>
              <Summary label="Projected cash">
                <MoneyValue
                  amount={BigInt(preview.projected.cashMinor)}
                  currency={preview.account.currency}
                />
              </Summary>
              <Summary label="Projected positions">
                <MoneyValue
                  amount={BigInt(preview.projected.positionsMinor)}
                  currency={preview.account.currency}
                />
              </Summary>
              <Summary label="Projected total">
                <MoneyValue
                  amount={BigInt(preview.projected.totalMinor)}
                  currency={preview.account.currency}
                />
              </Summary>
              <Summary label="Net change">
                <MoneyValue
                  amount={BigInt(preview.netChangeMinor)}
                  currency={preview.account.currency}
                />
              </Summary>
            </dl>
            <p className="text-sm text-slate-400">
              {preview.summary.ready} ready ·{" "}
              {preview.summary.skippedDuplicates} duplicates ·{" "}
              {preview.summary.failed} failed
            </p>
            {preview.instrumentChanges.length ? (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-white/[0.03] text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-3 font-medium">Instrument</th>
                      <th className="p-3 font-medium">Resolution</th>
                      <th className="p-3 text-right font-medium">Before</th>
                      <th className="p-3 text-right font-medium">After</th>
                      <th className="p-3 text-right font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {preview.instrumentChanges.map((instrument) => (
                      <tr key={instrument.instrumentId}>
                        <td className="p-3 font-medium text-slate-200">
                          {instrument.symbol || instrument.name}
                        </td>
                        <td className="p-3 capitalize text-slate-400">
                          {instrument.resolution}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <SensitiveValue>
                            {instrument.currentQuantity}
                          </SensitiveValue>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <SensitiveValue>
                            {instrument.projectedQuantity}
                          </SensitiveValue>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <SensitiveValue>
                            {instrument.quantityChange}
                          </SensitiveValue>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.eventChanges.length ? (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-white/[0.03] text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-3 font-medium">Event</th>
                      <th className="p-3 font-medium">Instrument</th>
                      <th className="p-3 font-medium">Date / order</th>
                      <th className="p-3 text-right font-medium">Before</th>
                      <th className="p-3 text-right font-medium">After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {preview.eventChanges.map((event, index) => (
                      <tr
                        key={
                          event.externalId ?? `${event.instrumentId}-${index}`
                        }
                      >
                        <td className="p-3 capitalize text-slate-300">
                          {event.type.replaceAll("_", " ")}
                        </td>
                        <td className="p-3 font-medium text-slate-200">
                          {event.instrumentSymbol || event.instrumentName}
                        </td>
                        <td className="p-3 text-slate-400">
                          {event.tradeDate.slice(0, 10)} · #
                          {event.eventSequence}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <SensitiveValue>
                            {event.beforeQuantity}
                          </SensitiveValue>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <SensitiveValue>{event.afterQuantity}</SensitiveValue>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.priceChanges.length ? (
              <div className="space-y-2">
                {preview.priceChanges.map((price) => (
                  <div
                    key={
                      price.externalId ??
                      `${price.instrumentId}-${price.affectedFrom}`
                    }
                    className="rounded-lg border border-white/10 p-3 text-sm"
                  >
                    <p className="font-medium text-slate-200">
                      {price.instrumentSymbol || price.instrumentName} ·{" "}
                      <SensitiveValue>
                        {price.currency} {price.price}
                      </SensitiveValue>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {price.source} · affects {price.affectedFrom.slice(0, 10)}{" "}
                      to {price.affectedToExclusive ? "before " : ""}
                      {price.affectedTo.slice(0, 10)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            {preview.projected.issues.length ? (
              <div className="space-y-2">
                {preview.projected.issues.map((issue) => (
                  <div
                    key={`${issue.type}-${issue.instrumentId}`}
                    className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm"
                  >
                    <p className="font-medium text-amber-200">
                      {issue.instrumentSymbol || issue.instrumentName} ·{" "}
                      {issue.type.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {issue.currency} · affected{" "}
                      {issue.affectedFrom.slice(0, 10)} to{" "}
                      {issue.affectedTo.slice(0, 10)}
                      {issue.lastPriceDate
                        ? ` · last price ${issue.lastPriceDate.slice(0, 10)}`
                        : ""}
                      {issue.source ? ` · ${issue.source}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            {preview.errors.length ? (
              <div className="max-h-72 overflow-auto rounded-lg border border-red-400/20">
                {preview.errors.map((item, index) => (
                  <div
                    key={`${item.collection}-${item.row}-${index}`}
                    className="border-b border-white/[0.06] p-3 text-sm last:border-0"
                  >
                    <p className="font-medium text-red-200">
                      {item.collection} · row {item.row || "sequence"}
                    </p>
                    <p className="mt-1 text-slate-400">{item.message}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <Button
              type="button"
              onClick={commitFile}
              disabled={
                !preview.canCommit ||
                busy !== null ||
                preview.summary.ready === 0
              }
            >
              {busy === "commit" ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Upload size={16} />
              )}
              Confirm atomic import
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Summary({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-slate-100">{children}</dd>
    </div>
  );
}
