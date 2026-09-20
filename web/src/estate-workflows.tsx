import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Camera, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  archiveBeneficiary,
  createBeneficiary,
  createEstateSnapshot,
  deleteEstateAllocation,
  deleteEstateSnapshot,
  deleteResiduaryAllocation,
  updateBeneficiary,
  updateEstatePlan,
  upsertEstateAllocation,
  upsertEstateDirective,
  upsertResiduaryAllocation,
} from "./api";
import type { Account, EstateWorkspace, Session } from "./types";
import { Card, CardHeader, humanize } from "./ui";

const optionalDate = z.union([z.literal(""), z.iso.date()]);
const planSchema = z.object({
  title: z.string().trim().min(1).max(120),
  jurisdiction: z.string().max(120),
  lastReviewedDate: optionalDate,
  reviewReminderDate: optionalDate,
});
const beneficiarySchema = z.object({
  kind: z.enum(["person", "trust", "organization"]),
  name: z.string().trim().min(1).max(120),
  relationship: z.string().max(120),
  contactSummary: z.string().max(500),
  notes: z.string().max(2000),
});
const directiveSchema = z.object({
  accountId: z.string().uuid(),
  isIncluded: z.boolean(),
  ownershipShareBps: z.coerce.number().int().min(1).max(10000),
  transferContext: z.enum([
    "estate",
    "joint_survivorship",
    "provider_designation",
    "trust_entity",
    "unknown",
  ]),
  distributionMethod: z.enum([
    "transfer_asset",
    "sell_and_divide",
    "cash_equivalent",
    "undecided",
  ]),
  documentReference: z.string().max(500),
  notes: z.string().max(2000),
  reviewedAt: optionalDate,
});
const allocationSchema = z.object({
  directiveId: z.string(),
  beneficiaryId: z.string().uuid(),
  tier: z.enum(["primary", "contingent"]),
  allocationBps: z.coerce.number().int().min(1).max(10000),
  notes: z.string().max(2000),
});
type Beneficiary = EstateWorkspace["beneficiaries"][number];

export function EstateMutationWorkspace({
  estate,
  accounts,
  session,
  onChanged,
}: {
  estate: EstateWorkspace;
  accounts: Account[];
  session: Session;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const reportError = (caught: unknown) =>
    setError(
      caught instanceof Error
        ? caught.message
        : "The estate plan could not be changed.",
    );
  return (
    <div className="settings-stack">
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <PlanForm
        estate={estate}
        session={session}
        onChanged={onChanged}
        onError={reportError}
      />
      <BeneficiaryManager
        estate={estate}
        session={session}
        onChanged={onChanged}
        onError={reportError}
      />
      <DirectiveForm
        estate={estate}
        accounts={accounts}
        session={session}
        onChanged={onChanged}
        onError={reportError}
      />
      <AllocationForm
        estate={estate}
        session={session}
        onChanged={onChanged}
        onError={reportError}
      />
      <SnapshotManager
        estate={estate}
        session={session}
        onChanged={onChanged}
        onError={reportError}
      />
    </div>
  );
}

function PlanForm({ estate, session, onChanged, onError }: WorkflowProps) {
  const form = useForm({
    resolver: zodResolver(planSchema),
    defaultValues: {
      title: estate.plan?.title ?? "My estate plan",
      jurisdiction: estate.plan?.jurisdiction ?? "",
      lastReviewedDate: estate.plan?.lastReviewedDate?.slice(0, 10) ?? "",
      reviewReminderDate: estate.plan?.reviewReminderDate?.slice(0, 10) ?? "",
    },
  });
  return (
    <Card>
      <CardHeader
        title="Estate plan"
        description="Review metadata for the current plan."
      />
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await updateEstatePlan(
              {
                ...values,
                lastReviewedDate: values.lastReviewedDate || null,
                reviewReminderDate: values.reviewReminderDate || null,
              },
              session.csrfToken,
            );
            onChanged();
          } catch (caught) {
            onError(caught);
          }
        })}
      >
        <div className="form-grid">
          <Labeled label="Title" id="estate-title">
            <input id="estate-title" {...form.register("title")} />
          </Labeled>
          <Labeled label="Jurisdiction" id="estate-jurisdiction">
            <input
              id="estate-jurisdiction"
              {...form.register("jurisdiction")}
            />
          </Labeled>
          <Labeled label="Last reviewed" id="estate-reviewed">
            <input
              id="estate-reviewed"
              type="date"
              {...form.register("lastReviewedDate")}
            />
          </Labeled>
          <Labeled label="Review reminder" id="estate-reminder">
            <input
              id="estate-reminder"
              type="date"
              {...form.register("reviewReminderDate")}
            />
          </Labeled>
        </div>
        <Submit busy={form.formState.isSubmitting} label="Save estate plan" />
      </form>
    </Card>
  );
}

function BeneficiaryManager({
  estate,
  session,
  onChanged,
  onError,
}: WorkflowProps) {
  const [editing, setEditing] = useState<Beneficiary>();
  const defaults = (item?: Beneficiary) => ({
    kind: (item?.kind || "person") as "person" | "organization" | "trust",
    name: item?.name ?? "",
    relationship: item?.relationship ?? "",
    contactSummary: item?.contactSummary ?? "",
    notes: item?.notes ?? "",
  });
  const form = useForm({
    resolver: zodResolver(beneficiarySchema),
    defaultValues: defaults(),
  });
  return (
    <Card>
      <CardHeader
        title="Beneficiaries"
        description="Create, edit, archive, or restore plan beneficiaries."
      />
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            if (editing)
              await updateBeneficiary(editing.id, values, session.csrfToken);
            else await createBeneficiary(values, session.csrfToken);
            setEditing(undefined);
            form.reset(defaults());
            onChanged();
          } catch (caught) {
            onError(caught);
          }
        })}
      >
        <div className="form-grid">
          <Labeled label="Kind" id="beneficiary-kind">
            <select id="beneficiary-kind" {...form.register("kind")}>
              <option value="person">Person</option>
              <option value="trust">Trust</option>
              <option value="organization">Organization</option>
            </select>
          </Labeled>
          <Labeled label="Name" id="beneficiary-name">
            <input id="beneficiary-name" {...form.register("name")} />
          </Labeled>
          <Labeled label="Relationship" id="beneficiary-relationship">
            <input
              id="beneficiary-relationship"
              {...form.register("relationship")}
            />
          </Labeled>
          <Labeled label="Contact summary" id="beneficiary-contact">
            <input
              id="beneficiary-contact"
              {...form.register("contactSummary")}
            />
          </Labeled>
          <Labeled label="Notes" id="beneficiary-notes">
            <input id="beneficiary-notes" {...form.register("notes")} />
          </Labeled>
        </div>
        <Submit
          busy={form.formState.isSubmitting}
          label={editing ? "Update beneficiary" : "Add beneficiary"}
        />
      </form>
      <div className="data-list">
        {estate.beneficiaries.map((item) => (
          <div className="data-row" key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <span>
                {humanize(item.kind)}
                {item.archivedAt ? " · Archived" : ""}
              </span>
            </div>
            <div className="page-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setEditing(item);
                  form.reset(defaults(item));
                }}
              >
                Edit
              </button>
              <button
                className="icon-button"
                aria-label={`${item.archivedAt ? "Restore" : "Archive"} ${item.name}`}
                onClick={async () => {
                  try {
                    await archiveBeneficiary(
                      item.id,
                      !item.archivedAt,
                      session.csrfToken,
                    );
                    onChanged();
                  } catch (caught) {
                    onError(caught);
                  }
                }}
              >
                <Archive />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DirectiveForm({
  estate,
  accounts = [],
  session,
  onChanged,
  onError,
}: WorkflowProps & { accounts?: Account[] }) {
  const form = useForm({
    resolver: zodResolver(directiveSchema),
    defaultValues: {
      accountId: accounts[0]?.id ?? "",
      isIncluded: true,
      ownershipShareBps: 10000,
      transferContext: "estate" as const,
      distributionMethod: "undecided" as const,
      documentReference: "",
      notes: "",
      reviewedAt: "",
    },
  });
  return (
    <Card>
      <CardHeader
        title="Account directives"
        description="Upsert transfer and distribution instructions by account."
      />
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={form.handleSubmit(async ({ accountId, ...values }) => {
          try {
            await upsertEstateDirective(
              accountId,
              { ...values, reviewedAt: values.reviewedAt || null },
              session.csrfToken,
            );
            onChanged();
          } catch (caught) {
            onError(caught);
          }
        })}
      >
        <div className="form-grid">
          <Labeled label="Account" id="directive-account">
            <select id="directive-account" {...form.register("accountId")}>
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Distribution method" id="directive-method">
            <select
              id="directive-method"
              {...form.register("distributionMethod")}
            >
              <option value="undecided">Undecided</option>
              <option value="transfer_asset">Transfer asset</option>
              <option value="sell_and_divide">Sell and divide</option>
              <option value="cash_equivalent">Cash equivalent</option>
            </select>
          </Labeled>
          <Labeled label="Ownership basis points" id="directive-share">
            <input
              id="directive-share"
              type="number"
              {...form.register("ownershipShareBps")}
            />
          </Labeled>
          <Labeled label="Transfer context" id="directive-context">
            <select
              id="directive-context"
              {...form.register("transferContext")}
            >
              <option value="estate">Estate</option>
              <option value="joint_survivorship">Joint survivorship</option>
              <option value="provider_designation">Provider designation</option>
              <option value="trust_entity">Trust entity</option>
              <option value="unknown">Unknown</option>
            </select>
          </Labeled>
          <Labeled label="Document reference" id="directive-document">
            <input
              id="directive-document"
              {...form.register("documentReference")}
            />
          </Labeled>
          <Labeled label="Reviewed" id="directive-reviewed">
            <input
              id="directive-reviewed"
              type="date"
              {...form.register("reviewedAt")}
            />
          </Labeled>
          <Labeled label="Notes" id="directive-notes">
            <input id="directive-notes" {...form.register("notes")} />
          </Labeled>
        </div>
        <label>
          <input type="checkbox" {...form.register("isIncluded")} /> Include in
          estate plan
        </label>
        <Submit busy={form.formState.isSubmitting} label="Save directive" />
      </form>
      <div className="data-list">
        {estate.directives.map((item) => (
          <button
            className="data-row"
            key={item.id}
            onClick={() =>
              form.reset({
                accountId: item.accountId,
                isIncluded: item.isIncluded,
                ownershipShareBps: item.ownershipShareBps,
                transferContext: item.transferContext,
                distributionMethod: item.distributionMethod,
                documentReference: item.documentReference ?? "",
                notes: item.notes ?? "",
                reviewedAt: item.reviewedAt?.slice(0, 10) ?? "",
              })
            }
          >
            <div>
              <strong>{item.accountName}</strong>
              <span>
                {humanize(item.distributionMethod)} ·{" "}
                {item.ownershipShareBps / 100}%
              </span>
            </div>
            <span>Edit</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function AllocationForm({
  estate,
  session,
  onChanged,
  onError,
}: WorkflowProps) {
  const form = useForm({
    resolver: zodResolver(allocationSchema),
    defaultValues: {
      directiveId: estate.directives[0]?.id ?? "residuary",
      beneficiaryId:
        estate.beneficiaries.find((item) => !item.archivedAt)?.id ?? "",
      tier: "primary" as const,
      allocationBps: 10000,
      notes: "",
    },
  });
  const save = form.handleSubmit(async ({ directiveId, ...values }) => {
    try {
      if (directiveId === "residuary")
        await upsertResiduaryAllocation(values, session.csrfToken);
      else await upsertEstateAllocation(directiveId, values, session.csrfToken);
      onChanged();
    } catch (caught) {
      onError(caught);
    }
  });
  const remove = async (id: string, residuary: boolean) => {
    if (!window.confirm("Delete this allocation?")) return;
    try {
      if (residuary) await deleteResiduaryAllocation(id, session.csrfToken);
      else await deleteEstateAllocation(id, session.csrfToken);
      onChanged();
    } catch (caught) {
      onError(caught);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Allocations"
        description="Assign primary or contingent shares in basis points."
      />
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={save}
      >
        <div className="form-grid">
          <Labeled label="Directive" id="allocation-directive">
            <select id="allocation-directive" {...form.register("directiveId")}>
              <option value="residuary">Residuary estate</option>
              {estate.directives.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.accountName}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Beneficiary" id="allocation-beneficiary">
            <select
              id="allocation-beneficiary"
              {...form.register("beneficiaryId")}
            >
              {estate.beneficiaries
                .filter((item) => !item.archivedAt)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Labeled>
          <Labeled label="Tier" id="allocation-tier">
            <select id="allocation-tier" {...form.register("tier")}>
              <option value="primary">Primary</option>
              <option value="contingent">Contingent</option>
            </select>
          </Labeled>
          <Labeled label="Allocation basis points" id="allocation-bps">
            <input
              id="allocation-bps"
              type="number"
              {...form.register("allocationBps")}
            />
          </Labeled>
          <Labeled label="Notes" id="allocation-notes">
            <input id="allocation-notes" {...form.register("notes")} />
          </Labeled>
        </div>
        <Submit busy={form.formState.isSubmitting} label="Save allocation" />
      </form>
      <div className="data-list">
        {[
          ...estate.allocations.map((item) => ({ ...item, residuary: false })),
          ...estate.residuaryAllocations.map((item) => ({
            ...item,
            directiveId: "residuary",
            residuary: true,
          })),
        ].map((item) => (
          <div className="data-row" key={item.id}>
            <div>
              <strong>
                {estate.beneficiaries.find(
                  (beneficiary) => beneficiary.id === item.beneficiaryId,
                )?.name || "Beneficiary"}
              </strong>
              <span>
                {item.directiveId === "residuary"
                  ? "Residuary"
                  : estate.directives.find(
                      (directive) => directive.id === item.directiveId,
                    )?.accountName}{" "}
                · {item.allocationBps / 100}%
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Delete allocation"
              onClick={() => void remove(item.id, item.residuary)}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SnapshotManager({
  estate,
  session,
  onChanged,
  onError,
}: WorkflowProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Snapshots"
        description="Create immutable, integrity-hashed estate records."
        aside={<Camera />}
      />
      <button
        className="primary-button compact"
        data-financial-mutation="true"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await createEstateSnapshot(session.csrfToken);
            onChanged();
          } catch (caught) {
            onError(caught);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Camera size={16} />
        {busy ? "Creating..." : "Create snapshot"}
      </button>
      <div className="data-list">
        {estate.snapshots.map((item) => (
          <div className="data-row" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>
                Version {item.version} · {item.valueAsOfDate.slice(0, 10)}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={`Delete snapshot ${item.title}`}
              onClick={async () => {
                if (!window.confirm("Delete this immutable snapshot record?"))
                  return;
                try {
                  await deleteEstateSnapshot(item.id, session.csrfToken);
                  onChanged();
                } catch (caught) {
                  onError(caught);
                }
              }}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

type WorkflowProps = {
  estate: EstateWorkspace;
  session: Session;
  onChanged: () => void;
  onError: (caught: unknown) => void;
};
function Labeled({
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
function Submit({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button className="primary-button compact" disabled={busy}>
      <Save size={16} />
      {busy ? "Saving..." : label}
    </button>
  );
}
