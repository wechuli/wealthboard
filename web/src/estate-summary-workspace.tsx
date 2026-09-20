import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FilePlus2,
  LoaderCircle,
  ScrollText,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createEstateSnapshot,
  deleteEstateSnapshot,
  updateEstatePlan,
} from "./api";
import {
  actionError,
  EstateManagedForm,
  type EstateFormAction,
} from "./estate-managed-form";
import { MoneyValue } from "./privacy";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
  MutationButton,
} from "./estate-ui";
import type { EstateViewWorkspace } from "./estate-view-model";
import type { Session } from "./types";

function formatDate(value: string, timezone: string, pattern: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: pattern === "dd MMM yyyy" ? "short" : "2-digit",
    year: "numeric",
    timeZone: timezone,
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  switch (pattern) {
    case "dd/MM/yyyy":
      return `${parts.day}/${parts.month}/${parts.year}`;
    case "MM/dd/yyyy":
      return `${parts.month}/${parts.day}/${parts.year}`;
    case "yyyy-MM-dd":
      return `${parts.year}-${parts.month}-${parts.day}`;
    case "dd MMM yyyy":
      return `${parts.day} ${parts.month} ${parts.year}`;
    default:
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeZone: timezone,
      }).format(new Date(value));
  }
}

function SnapshotButton({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            const snapshot = await createEstateSnapshot(session.csrfToken);
            navigate(`/estate/snapshots/${snapshot.id}`);
          } catch (caught) {
            setError(
              caught instanceof Error
                ? caught.message
                : "The summary could not be created.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? (
          <LoaderCircle size={16} className="animate-spin" />
        ) : (
          <FilePlus2 size={16} />
        )}
        Create summary
      </Button>
      {error ? (
        <p className="mt-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function EstateSummaryWorkspace({
  workspace,
  session,
  onChanged,
}: {
  workspace: EstateViewWorkspace;
  session: Session;
  onChanged: () => void;
}) {
  const blocking = workspace.reviewItems.filter(
    (item) => item.severity === "blocking",
  );
  const warnings = workspace.reviewItems.filter(
    (item) => item.severity === "warning",
  );
  const planAction: EstateFormAction = async (formData) => {
    try {
      await updateEstatePlan(
        {
          title: String(formData.get("title") ?? ""),
          jurisdiction: String(formData.get("jurisdiction") ?? ""),
          lastReviewedDate:
            String(formData.get("lastReviewedDate") ?? "") || null,
          reviewReminderDate:
            String(formData.get("reviewReminderDate") ?? "") || null,
        },
        session.csrfToken,
      );
      onChanged();
      return { ok: true, message: "Plan details saved." };
    } catch (error) {
      return actionError(error);
    }
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Gross estate assets</p>
          <p className="mt-2 text-lg font-semibold">
            <MoneyValue amount={workspace.totals.grossAssetsBaseMinor} currency={workspace.baseCurrency} />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Recorded liabilities</p>
          <p className="mt-2 text-lg font-semibold text-amber-200">
            <MoneyValue amount={workspace.totals.liabilitiesBaseMinor} currency={workspace.baseCurrency} />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Estimated net estate</p>
          <p className="mt-2 text-lg font-semibold">
            <MoneyValue amount={workspace.totals.netEstateBaseMinor} currency={workspace.baseCurrency} />
          </p>
          {!workspace.totals.complete ? (
            <p className="mt-1 text-xs text-amber-300">Known values only; exchange rates are missing.</p>
          ) : null}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-base">Plan details</CardTitle>
            <p className="mt-1 text-sm text-slate-400">Jurisdiction is a reference only; Wealthboard does not infer local law.</p>
          </div>
        </CardHeader>
        <CardContent>
          <EstateManagedForm action={planAction} submitLabel="Save plan details" className="md:grid-cols-2">
            {(state) => (
              <>
                <div>
                  <Label htmlFor="estate-plan-title">Plan title</Label>
                  <Input id="estate-plan-title" name="title" defaultValue={workspace.plan.title} maxLength={120} required />
                  <FieldError>{state.fieldErrors?.title?.[0]}</FieldError>
                </div>
                <div>
                  <Label htmlFor="estate-jurisdiction">Jurisdiction or residence</Label>
                  <Input id="estate-jurisdiction" name="jurisdiction" defaultValue={workspace.plan.jurisdiction ?? ""} placeholder="Optional planning reference" maxLength={120} />
                  <FieldError>{state.fieldErrors?.jurisdiction?.[0]}</FieldError>
                </div>
                <div>
                  <Label htmlFor="estate-last-reviewed">Last reviewed</Label>
                  <Input id="estate-last-reviewed" name="lastReviewedDate" type="date" defaultValue={workspace.plan.lastReviewedDate?.slice(0, 10) ?? ""} />
                  <FieldError>{state.fieldErrors?.lastReviewedDate?.[0]}</FieldError>
                </div>
                <div>
                  <Label htmlFor="estate-review-reminder">Review again on</Label>
                  <Input id="estate-review-reminder" name="reviewReminderDate" type="date" defaultValue={workspace.plan.reviewReminderDate?.slice(0, 10) ?? ""} />
                  <FieldError>{state.fieldErrors?.reviewReminderDate?.[0]}</FieldError>
                </div>
              </>
            )}
          </EstateManagedForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Completion review</CardTitle>
              <Badge tone={workspace.mathematicallyComplete ? "positive" : "warning"}>
                {workspace.mathematicallyComplete ? "Allocation math complete" : "Decisions needed"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-400">Mathematical completeness is not a legal-validity assessment.</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {blocking.length === 0 ? (
            <div className="flex gap-3 rounded-xl bg-emerald-400/10 p-4 text-sm text-emerald-100">
              <CheckCircle2 size={18} className="shrink-0" />Every included asset has complete primary coverage through specific or residual allocations.
            </div>
          ) : (
            <div className="space-y-2">{blocking.map((item) => <div key={`${item.code}-${item.accountId ?? "plan"}`} className="flex gap-3 rounded-xl bg-red-400/10 p-3 text-sm text-red-100"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{item.message}</div>)}</div>
          )}
          {warnings.length ? <div className="space-y-2">{warnings.map((item) => <div key={`${item.code}-${item.accountId ?? "plan"}`} className="flex gap-3 rounded-xl bg-amber-400/[0.08] p-3 text-sm text-amber-100"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{item.message}</div>)}</div> : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Indicative beneficiary totals</CardTitle></CardHeader>
          <CardContent className="divide-y divide-white/[0.06]">
            {workspace.beneficiaryTotals.length ? workspace.beneficiaryTotals.map((total) => (
              <div key={total.beneficiaryId} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium text-slate-100">{total.beneficiaryName}</p>{total.incomplete ? <p className="text-xs text-amber-300">Missing exchange rate</p> : null}</div><MoneyValue amount={total.amountBaseMinor} currency={workspace.baseCurrency} /></div>
            )) : <p className="py-4 text-sm text-slate-500">No beneficiaries have been added.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Estate Planning Summary</CardTitle></CardHeader>
          <CardContent><p className="text-sm leading-6 text-slate-400">Create an immutable as-of snapshot for printing or adviser review. Exact values, contact details, references, and notes are excluded from print until you choose to reveal them.</p><div className="mt-4"><SnapshotButton session={session} /></div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Retained summaries</CardTitle></CardHeader>
        <CardContent>
          {workspace.snapshots.length ? <div className="divide-y divide-white/[0.06]">{workspace.snapshots.map((snapshot) => (
            <div key={snapshot.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div><p className="text-sm font-medium text-slate-100">{snapshot.title}</p><p className="mt-1 text-xs text-slate-500">Values as of {snapshot.valueAsOfDate} · Created {formatDate(snapshot.generatedAt, workspace.timezone, workspace.preferredDateFormat)} · Hash {snapshot.contentHash.slice(0, 12)}…</p></div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm"><Link to={`/estate/snapshots/${snapshot.id}`}><ScrollText size={15} /> View</Link></Button>
                <Button asChild variant="outline" size="sm"><a href={`/api/v1/estate/snapshots/${snapshot.id}`}><Download size={15} /> JSON</a></Button>
                <MutationButton action={async () => { await deleteEstateSnapshot(snapshot.id, session.csrfToken); onChanged(); }} confirm="Delete this retained estate summary? The current plan will not change." successMessage="Estate summary deleted." variant="ghost" size="icon" aria-label={`Delete ${snapshot.title} summary`}><Trash2 size={15} /></MutationButton>
              </div>
            </div>
          ))}</div> : <p className="py-4 text-sm text-slate-500">No summaries have been retained yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}