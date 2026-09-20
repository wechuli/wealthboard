import { zodResolver } from "@hookform/resolvers/zod";
import { Download, FileUp, Split, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import {
  commitImport,
  createCorporateAction,
  deleteCorporateActionGroup,
  previewImport,
} from "@/api/client";
import type {
  Account,
  CorporateActionInput,
  ImportResult,
  Instrument,
  PositionEvent,
  Session,
} from "@/lib/types";
import { Badge, Card, CardHeader, humanize, KeyValue } from "@/components/ui/resource";

const dateToday = () => new Date().toISOString().slice(0, 10);
const decimal = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, "Enter a positive decimal value.");
const corporateActionSchema = z
  .object({
    kind: z.enum([
      "stock-splits",
      "spinoffs",
      "mergers",
      "dividend-reinvestments",
      "in-kind-transfers",
    ]),
    instrumentId: z.string().uuid(),
    relatedInstrumentId: z.string(),
    destinationAccountId: z.string(),
    numerator: decimal,
    denominator: decimal,
    dividendAmount: z.string(),
    quantity: z.string(),
    unitPrice: z.string(),
    tradeCurrency: z.string().trim().toUpperCase(),
    feeAmount: z.string(),
    feeCurrency: z.string().trim().toUpperCase(),
    cashEffect: z.string(),
    appliedExchangeRate: z.string(),
    actionDate: z.iso.date(),
    notes: z.string().max(2000),
  })
  .superRefine((value, context) => {
    if (
      ["spinoffs", "mergers"].includes(value.kind) &&
      !z.string().uuid().safeParse(value.relatedInstrumentId).success
    )
      context.addIssue({
        code: "custom",
        path: ["relatedInstrumentId"],
        message: "Choose the related instrument.",
      });
    if (
      value.kind === "in-kind-transfers" &&
      !z.string().uuid().safeParse(value.destinationAccountId).success
    )
      context.addIssue({
        code: "custom",
        path: ["destinationAccountId"],
        message: "Choose the destination account.",
      });
    for (const field of value.kind === "dividend-reinvestments"
      ? (["dividendAmount", "quantity", "unitPrice"] as const)
      : value.kind === "in-kind-transfers"
        ? (["quantity"] as const)
        : [])
      if (!decimal.safeParse(value[field]).success)
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Enter a positive decimal value.",
        });
  });
type CorporateActionValues = z.infer<typeof corporateActionSchema>;

export function CorporateActionsPanel({
  account,
  accounts,
  instruments,
  events,
  session,
  onChanged,
}: {
  account: Account;
  accounts: Account[];
  instruments: Instrument[];
  events: PositionEvent[];
  session: Session;
  onChanged: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const form = useForm<CorporateActionValues>({
    resolver: zodResolver(corporateActionSchema),
    defaultValues: {
      kind: "stock-splits",
      instrumentId: instruments[0]?.id ?? "",
      relatedInstrumentId: "",
      destinationAccountId: "",
      numerator: "2",
      denominator: "1",
      dividendAmount: "",
      quantity: "",
      unitPrice: "",
      tradeCurrency: account.currency,
      feeAmount: "0",
      feeCurrency: account.currency,
      cashEffect: "0",
      appliedExchangeRate: "",
      actionDate: dateToday(),
      notes: "",
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const grouped = new Map(
    events
      .filter((event) => event.eventGroupId)
      .map((event) => [event.eventGroupId!, event]),
  );

  const submit = form.handleSubmit(async (values) => {
    setError("");
    setMessage("");
    const common = { idempotencyKey: key, notes: values.notes };
    let payload: Record<string, string>;
    if (values.kind === "stock-splits")
      payload = {
        ...common,
        accountId: account.id,
        instrumentId: values.instrumentId,
        numerator: values.numerator,
        denominator: values.denominator,
        actionDate: values.actionDate,
      };
    else if (values.kind === "spinoffs")
      payload = {
        ...common,
        accountId: account.id,
        sourceInstrumentId: values.instrumentId,
        newInstrumentId: values.relatedInstrumentId,
        numerator: values.numerator,
        denominator: values.denominator,
        actionDate: values.actionDate,
      };
    else if (values.kind === "mergers")
      payload = {
        ...common,
        accountId: account.id,
        sourceInstrumentId: values.instrumentId,
        destinationInstrumentId: values.relatedInstrumentId,
        numerator: values.numerator,
        denominator: values.denominator,
        actionDate: values.actionDate,
      };
    else if (values.kind === "in-kind-transfers")
      payload = {
        ...common,
        sourceAccountId: account.id,
        destinationAccountId: values.destinationAccountId,
        instrumentId: values.instrumentId,
        quantity: values.quantity,
        transferDate: values.actionDate,
        feeAmount: values.feeAmount,
      };
    else
      payload = {
        ...common,
        accountId: account.id,
        instrumentId: values.instrumentId,
        dividendAmount: values.dividendAmount,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        tradeCurrency: values.tradeCurrency,
        feeAmount: values.feeAmount,
        feeCurrency: values.feeCurrency,
        cashEffect: values.cashEffect,
        appliedExchangeRate: values.appliedExchangeRate,
        activityDate: values.actionDate,
      };
    try {
      await createCorporateAction(
        values.kind,
        payload as CorporateActionInput,
        session.csrfToken,
      );
      setMessage("Corporate action recorded.");
      setKey(crypto.randomUUID());
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The corporate action could not be recorded.",
      );
    }
  });

  return (
    <Card>
      <CardHeader
        title="Corporate actions"
        description="Grouped position and cash events are committed atomically."
        aside={<Split />}
      />
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="notice" role="status">
          {message}
        </div>
      ) : null}
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={submit}
      >
        <div className="form-grid">
          <Field label="Action" id="corporate-kind">
            <select id="corporate-kind" {...form.register("kind")}>
              <option value="stock-splits">Stock split</option>
              <option value="spinoffs">Spinoff</option>
              <option value="mergers">Merger</option>
              <option value="dividend-reinvestments">
                Dividend reinvestment
              </option>
              <option value="in-kind-transfers">In-kind transfer</option>
            </select>
          </Field>
          <Field label="Instrument" id="corporate-instrument">
            <select
              id="corporate-instrument"
              {...form.register("instrumentId")}
            >
              {instruments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.symbol || item.name}
                </option>
              ))}
            </select>
          </Field>
          {["spinoffs", "mergers"].includes(kind) ? (
            <Field
              label={
                kind === "spinoffs"
                  ? "New instrument"
                  : "Destination instrument"
              }
              id="corporate-related"
            >
              <select
                id="corporate-related"
                {...form.register("relatedInstrumentId")}
              >
                <option value="">Choose instrument</option>
                {instruments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.symbol || item.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {kind === "in-kind-transfers" ? (
            <Field label="Destination account" id="corporate-account">
              <select
                id="corporate-account"
                {...form.register("destinationAccountId")}
              >
                <option value="">Choose account</option>
                {accounts
                  .filter(
                    (item) =>
                      item.id !== account.id &&
                      item.trackingMode === "positions",
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
          {!["dividend-reinvestments", "in-kind-transfers"].includes(kind) ? (
            <>
              <Field label="Numerator" id="corporate-numerator">
                <input
                  id="corporate-numerator"
                  inputMode="decimal"
                  {...form.register("numerator")}
                />
              </Field>
              <Field label="Denominator" id="corporate-denominator">
                <input
                  id="corporate-denominator"
                  inputMode="decimal"
                  {...form.register("denominator")}
                />
              </Field>
            </>
          ) : null}
          {kind === "dividend-reinvestments" ? (
            <>
              <Field
                label={`Dividend (${account.currency})`}
                id="corporate-dividend"
              >
                <input
                  id="corporate-dividend"
                  inputMode="decimal"
                  {...form.register("dividendAmount")}
                />
              </Field>
              <Field label="Unit price" id="corporate-price">
                <input
                  id="corporate-price"
                  inputMode="decimal"
                  {...form.register("unitPrice")}
                />
              </Field>
            </>
          ) : null}
          {["dividend-reinvestments", "in-kind-transfers"].includes(kind) ? (
            <Field label="Quantity" id="corporate-quantity">
              <input
                id="corporate-quantity"
                inputMode="decimal"
                {...form.register("quantity")}
              />
            </Field>
          ) : null}
          <Field label="Effective date" id="corporate-date">
            <input
              id="corporate-date"
              type="date"
              {...form.register("actionDate")}
            />
          </Field>
          <Field label="Notes" id="corporate-notes">
            <input id="corporate-notes" {...form.register("notes")} />
          </Field>
        </div>
        <button
          className="primary-button compact"
          disabled={form.formState.isSubmitting || !instruments.length}
        >
          Record {humanize(kind.replace(/s$/, ""))}
        </button>
      </form>
      {grouped.size ? (
        <div className="data-list">
          {[...grouped].map(([groupId, event]) => (
            <div className="data-row" key={groupId}>
              <div>
                <strong>{humanize(event.type)}</strong>
                <span>{event.tradeDate} · grouped action</span>
              </div>
              <button
                className="icon-button"
                aria-label={`Delete ${humanize(event.type)} group`}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Delete every event in this corporate action group?",
                    )
                  )
                    return;
                  try {
                    await deleteCorporateActionGroup(
                      groupId,
                      session.csrfToken,
                    );
                    onChanged();
                  } catch (caught) {
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "The group could not be deleted.",
                    );
                  }
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function ImportWorkspace({
  account,
  session,
  onChanged,
}: {
  account: Account;
  session: Session;
  onChanged: () => void;
}) {
  return (
    <div className="detail-grid">
      <ImportPanel
        kind="history"
        account={account}
        session={session}
        onChanged={onChanged}
      />
      {account.trackingMode === "positions" ? (
        <ImportPanel
          kind="investment"
          account={account}
          session={session}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function ImportPanel({
  kind,
  account,
  session,
  onChanged,
}: {
  kind: "history" | "investment";
  account: Account;
  session: Session;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const title =
    kind === "history" ? "Account history import" : "Investment history import";
  const run = async (commit: boolean) => {
    if (!file) {
      setError("Choose a CSV or JSON file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = commit
        ? await commitImport(
            account.id,
            kind,
            file,
            result?.hash || "",
            session.csrfToken,
          )
        : await previewImport(account.id, kind, file, session.csrfToken);
      setResult(next);
      if (commit) onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The import could not be processed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title={title}
        description="Preview validation and balance effects before committing."
        aside={<FileUp />}
      />
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={(event) => {
          event.preventDefault();
          void run(false);
        }}
      >
        <Field label="Import file" id={`import-${kind}`}>
          <input
            id={`import-${kind}`}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              setResult(undefined);
            }}
          />
        </Field>
        <button className="primary-button compact" disabled={busy}>
          <FileUp size={16} />
          {busy ? "Checking..." : "Preview"}
        </button>
      </form>
      {result ? (
        <div className="settings-stack">
          <div className="key-grid">
            {Object.entries(result.summary).map(([label, value]) => (
              <KeyValue key={label} label={humanize(label)}>
                {value}
              </KeyValue>
            ))}
          </div>
          {result.rows.length ? (
            <div className="data-list">
              {result.rows.slice(0, 50).map((row) => (
                <div className="data-row" key={row.row}>
                  <div>
                    <strong>
                      Row {row.row} ·{" "}
                      {humanize(
                        ("type" in row ? row.type : "") || row.code || "record",
                      )}
                    </strong>
                    <span>
                      {row.message ||
                        ("collection" in row
                          ? row.collection
                          : [row.date, row.amount].filter(Boolean).join(" · "))}
                    </span>
                  </div>
                  <Badge
                    tone={
                      row.status === "ready" || row.status === "imported"
                        ? "positive"
                        : "warning"
                    }
                  >
                    {humanize(row.status)}
                  </Badge>
                </div>
              ))}
            </div>
          ) : null}
          <div className="page-actions">
            <button
              className="primary-button compact"
              data-financial-mutation="true"
              disabled={
                busy ||
                !result.hash ||
                result.summary.failed > 0 ||
                ("canCommit" in result && result.canCommit === false)
              }
              onClick={() => void run(true)}
            >
              Commit import
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                downloadReport(result, `${kind}-import-report.json`)
              }
            >
              <Download size={16} /> Report
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function downloadReport(result: ImportResult, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
