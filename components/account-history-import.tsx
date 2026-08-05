"use client";

import { useMemo, useState } from "react";
import { Download, LoaderCircle, Upload } from "lucide-react";

import { MoneyValue } from "@/components/privacy-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form-controls";

type ReportRow = {
  row: number;
  externalId: string | null;
  status: string;
  code: string;
  message: string;
  transactionId: string | null;
  type: string | null;
  amount: string | null;
  date: string | null;
};

type Preview = {
  hash: string;
  account: {
    id: string;
    name: string;
    institution: string | null;
    currency: string;
  };
  dateRange: { from: string; to: string } | null;
  currentBalanceMinor: number;
  projectedBalanceMinor: number;
  netChangeMinor: number;
  summary: { ready: number; skippedDuplicates: number; failed: number };
  rows: ReportRow[];
};

type Result = {
  account: Preview["account"];
  finalBalanceMinor: number;
  summary: { imported: number; skippedDuplicates: number; failed: number };
  rows: ReportRow[];
};

const PAGE_SIZE = 50;

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reportRows(rows: ReportRow[]) {
  return rows.map((row) => ({
    row: row.row,
    external_id: row.externalId,
    status: row.status,
    code: row.code,
    message: row.message,
    transaction_id: row.transactionId,
  }));
}

function downloadReport(rows: ReportRow[], format: "csv" | "json") {
  const report = reportRows(rows);
  const content =
    format === "json"
      ? JSON.stringify(report, null, 2)
      : [
          "row,external_id,status,code,message,transaction_id",
          ...report.map((row) =>
            Object.values(row).map(csvCell).join(","),
          ),
        ].join("\n");
  const url = URL.createObjectURL(
    new Blob([content], {
      type:
        format === "json"
          ? "application/json;charset=utf-8"
          : "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `wealthboard-account-history-report.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export function AccountHistoryImport({ accountId }: { accountId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [page, setPage] = useState(1);
  const rows = useMemo(
    () => result?.rows ?? preview?.rows ?? [],
    [preview?.rows, result?.rows],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, rows],
  );

  async function previewFile() {
    if (!file) {
      setError("Choose a CSV or JSON file.");
      return;
    }
    setError("");
    setBusy("preview");
    try {
      const [hash, response] = await Promise.all([
        sha256(file),
        fetch(`/api/accounts/${accountId}/history-import/preview`, {
          method: "POST",
          body: (() => {
            const body = new FormData();
            body.set("file", file);
            return body;
          })(),
        }),
      ]);
      const data = (await response.json()) as Preview & { error?: string };
      if (!response.ok) throw new Error(data.error || "Preview failed.");
      if (data.hash !== hash) throw new Error("The uploaded file hash did not match.");
      setPreview(data);
      setResult(null);
      setPage(1);
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
      if (hash !== preview.hash) {
        throw new Error("The file changed after preview. Preview it again.");
      }
      const body = new FormData();
      body.set("file", file);
      body.set("hash", hash);
      const response = await fetch(
        `/api/accounts/${accountId}/history-import/commit`,
        { method: "POST", body },
      );
      const data = (await response.json()) as Result & { error?: string };
      if (!response.ok) throw new Error(data.error || "Import failed.");
      setResult(data);
      setPreview(null);
      setPage(1);
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
            <CardTitle>Choose account history</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Maximum 5 MB and 10,000 rows. Your file is parsed for this preview
              and is not retained.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="accountHistoryFile">CSV or JSON file</Label>
            <Input
              id="accountHistoryFile"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setResult(null);
                setError("");
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
        </CardContent>
      </Card>

      {preview ? (
        <>
          <AccountSummary preview={preview} />
          <Card>
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-400">
                Confirm to import the {preview.summary.ready} currently ready
                rows atomically. Failed and duplicate rows will be excluded.
              </p>
              <Button
                type="button"
                onClick={commitFile}
                disabled={busy !== null || preview.summary.ready === 0}
              >
                {busy === "commit" ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Upload size={16} />
                )}
                Confirm import
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Import complete</CardTitle>
              <p role="status" className="mt-1 text-sm text-slate-400">
                {result.summary.imported} imported,{" "}
                {result.summary.skippedDuplicates} duplicates skipped,{" "}
                {result.summary.failed} failed.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-400">
              Final balance:{" "}
              <MoneyValue
                amount={result.finalBalanceMinor}
                currency={result.account.currency}
                className="font-medium text-slate-100"
              />
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadReport(result.rows, "csv")}
              >
                <Download size={16} />
                Download CSV report
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadReport(result.rows, "json")}
              >
                <Download size={16} />
                Download JSON report
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {rows.length ? (
        <ReportTable
          rows={visibleRows}
          page={page}
          pageCount={pageCount}
          setPage={setPage}
        />
      ) : null}
    </div>
  );
}

function AccountSummary({ preview }: { preview: Preview }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Confirm target account</CardTitle>
          <p className="mt-1 text-sm text-slate-400">
            {preview.account.name} ·{" "}
            {preview.account.institution || "No institution"} ·{" "}
            {preview.account.currency}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Imported date range">
            {preview.dateRange
              ? `${preview.dateRange.from} – ${preview.dateRange.to}`
              : "No ready rows"}
          </Summary>
          <Summary label="Current balance">
            <MoneyValue
              amount={preview.currentBalanceMinor}
              currency={preview.account.currency}
            />
          </Summary>
          <Summary label="Projected balance">
            <MoneyValue
              amount={preview.projectedBalanceMinor}
              currency={preview.account.currency}
            />
          </Summary>
          <Summary label="Net change">
            <MoneyValue
              amount={preview.netChangeMinor}
              currency={preview.account.currency}
            />
          </Summary>
        </dl>
        <p className="mt-4 text-sm text-slate-400">
          {preview.summary.ready} ready · {preview.summary.skippedDuplicates}{" "}
          existing duplicates · {preview.summary.failed} failed
        </p>
      </CardContent>
    </Card>
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
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-200">{children}</dd>
    </div>
  );
}

function ReportTable({
  rows,
  page,
  pageCount,
  setPage,
}: {
  rows: ReportRow[];
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Row report</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Row</th>
                <th className="py-2 pr-3">External ID</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map((row) => (
                <tr key={row.row}>
                  <td className="py-3 pr-3">{row.row}</td>
                  <td className="max-w-48 truncate py-3 pr-3">
                    {row.externalId || "—"}
                  </td>
                  <td className="py-3 pr-3">{row.type || "—"}</td>
                  <td className="py-3 pr-3">{row.date || "—"}</td>
                  <td className="py-3 pr-3 font-medium text-slate-200">
                    {row.status}
                  </td>
                  <td className="py-3 text-slate-400">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 ? (
          <nav
            aria-label="Import report pages"
            className="mt-4 flex items-center justify-between gap-3"
          >
            <Button
              type="button"
              variant="secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-500">
              Page {page} of {pageCount}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={page === pageCount}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </nav>
        ) : null}
      </CardContent>
    </Card>
  );
}
