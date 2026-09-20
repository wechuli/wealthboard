import {
  AlertTriangle,
  Landmark,
  Scale,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  deleteEstateAllocation,
  deleteResiduaryAllocation,
  upsertEstateAllocation,
  upsertEstateDirective,
  upsertResiduaryAllocation,
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
  Checkbox,
  cn,
  FieldError,
  Input,
  Label,
  MutationButton,
  Select,
  Textarea,
} from "./estate-ui";
import type { EstateAssetView, EstateViewWorkspace } from "./estate-view-model";
import type { Session } from "./types";

const transferContexts = [
  { value: "estate", label: "Passes through the estate" },
  { value: "joint_survivorship", label: "Joint ownership / survivorship" },
  { value: "provider_designation", label: "Provider beneficiary designation" },
  { value: "trust_entity", label: "Held by a trust or entity" },
  { value: "unknown", label: "Not confirmed" },
] as const;

const distributionMethods = [
  { value: "transfer_asset", label: "Transfer the asset" },
  { value: "sell_and_divide", label: "Sell and divide proceeds" },
  { value: "cash_equivalent", label: "Provide cash equivalent" },
  { value: "undecided", label: "Not decided" },
] as const;

function percent(basisPoints: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
    basisPoints / 100,
  );
}

function basisPoints(value: FormDataEntryValue | null) {
  return Math.round(Number(value ?? 0) * 100);
}

type ActiveBeneficiary = EstateViewWorkspace["beneficiaries"][number];

function AllocationForm({
  action,
  beneficiaries,
  label,
}: {
  action: EstateFormAction;
  beneficiaries: ActiveBeneficiary[];
  label: string;
}) {
  return (
    <EstateManagedForm
      action={action}
      submitLabel={label}
      resetOnSuccess
      className="rounded-xl border border-white/[0.07] bg-black/10 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,.7fr)]"
    >
      {(state) => (
        <>
          <div>
            <Label htmlFor={`${label}-beneficiary`}>Beneficiary</Label>
            <Select id={`${label}-beneficiary`} name="beneficiaryId" required>
              <option value="">Choose beneficiary</option>
              {beneficiaries.map((beneficiary) => (
                <option key={beneficiary.id} value={beneficiary.id}>
                  {beneficiary.name}
                </option>
              ))}
            </Select>
            <FieldError>{state.fieldErrors?.beneficiaryId?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`${label}-tier`}>Priority</Label>
            <Select id={`${label}-tier`} name="tier" defaultValue="primary">
              <option value="primary">Primary</option>
              <option value="contingent">Contingent</option>
            </Select>
            <FieldError>{state.fieldErrors?.tier?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`${label}-percentage`}>Percentage</Label>
            <div className="relative">
              <Input
                id={`${label}-percentage`}
                name="allocationBps"
                inputMode="decimal"
                placeholder="50"
                required
                className="pr-9"
              />
              <span className="pointer-events-none absolute right-3 top-3 text-sm text-slate-500">
                %
              </span>
            </div>
            <FieldError>{state.fieldErrors?.allocationBps?.[0]}</FieldError>
          </div>
          <div className="md:col-span-3">
            <Label htmlFor={`${label}-notes`}>Allocation notes</Label>
            <Input
              id={`${label}-notes`}
              name="notes"
              maxLength={2000}
              placeholder="Optional instruction or condition to discuss with an adviser"
            />
            <FieldError>{state.fieldErrors?.notes?.[0]}</FieldError>
          </div>
        </>
      )}
    </EstateManagedForm>
  );
}

function AllocationRows({
  asset,
  session,
  onChanged,
}: {
  asset: EstateAssetView;
  session: Session;
  onChanged: () => void;
}) {
  if (!asset.allocations.length) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-slate-500">
        No account-specific beneficiaries yet.
      </p>
    );
  }
  return (
    <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07]">
      {asset.allocations.map((allocation) => (
        <div
          key={allocation.id}
          className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-slate-100">
                {allocation.beneficiaryName}
              </p>
              <Badge tone={allocation.tier === "primary" ? "positive" : "info"}>
                {allocation.tier === "primary" ? "Primary" : "Contingent"}
              </Badge>
              {allocation.beneficiaryArchivedAt ? (
                <Badge tone="warning">Archived</Badge>
              ) : null}
            </div>
            {allocation.notes ? (
              <p className="mt-1 truncate text-xs text-slate-500">
                {allocation.notes}
              </p>
            ) : null}
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm font-semibold tabular-nums text-slate-200">
              {percent(allocation.allocationBps)}%
            </p>
            <p className="text-xs text-slate-500">
              <MoneyValue
                amount={allocation.amountMinor}
                currency={asset.currency}
              />
            </p>
          </div>
          <MutationButton
            action={async () => {
              await deleteEstateAllocation(allocation.id, session.csrfToken);
              onChanged();
            }}
            confirm={`Remove ${allocation.beneficiaryName}'s allocation from ${asset.name}?`}
            successMessage="Asset allocation removed."
            variant="ghost"
            size="icon"
            aria-label={`Remove ${allocation.beneficiaryName} allocation`}
          >
            <Trash2 size={15} />
          </MutationButton>
        </div>
      ))}
    </div>
  );
}

function DirectiveForm({
  asset,
  session,
  onChanged,
}: {
  asset: EstateAssetView;
  session: Session;
  onChanged: () => void;
}) {
  const action: EstateFormAction = async (formData) => {
    try {
      await upsertEstateDirective(
        asset.id,
        {
          isIncluded: formData.get("isIncluded") === "on",
          ownershipShareBps: basisPoints(formData.get("ownershipShareBps")),
          transferContext: String(
            formData.get("transferContext"),
          ) as EstateAssetView["transferContext"],
          distributionMethod: String(
            formData.get("distributionMethod"),
          ) as EstateAssetView["distributionMethod"],
          documentReference: String(formData.get("documentReference") ?? ""),
          notes: String(formData.get("notes") ?? ""),
          reviewedAt: String(formData.get("reviewedAt") ?? "") || null,
        },
        session.csrfToken,
      );
      onChanged();
      return { ok: true, message: "Asset directive saved." };
    } catch (error) {
      return actionError(error);
    }
  };
  return (
    <EstateManagedForm
      action={action}
      submitLabel="Save asset directive"
      className="grid gap-4 md:grid-cols-2"
    >
      {(state) => (
        <>
          <div className="md:col-span-2">
            <Checkbox
              name="isIncluded"
              label="Include this asset in the estate distribution plan"
              defaultChecked={asset.isIncluded}
            />
          </div>
          <div>
            <Label htmlFor={`ownership-${asset.id}`}>
              Estate ownership share
            </Label>
            <div className="relative">
              <Input
                id={`ownership-${asset.id}`}
                name="ownershipShareBps"
                inputMode="decimal"
                defaultValue={percent(asset.ownershipShareBps)}
                className="pr-9"
                required
              />
              <span className="pointer-events-none absolute right-3 top-3 text-sm text-slate-500">
                %
              </span>
            </div>
            <FieldError>{state.fieldErrors?.ownershipShareBps?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`reviewed-${asset.id}`}>Last checked</Label>
            <Input
              id={`reviewed-${asset.id}`}
              name="reviewedAt"
              type="date"
              defaultValue={asset.reviewedAt?.slice(0, 10) ?? ""}
            />
            <FieldError>{state.fieldErrors?.reviewedAt?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`context-${asset.id}`}>How it passes</Label>
            <Select
              id={`context-${asset.id}`}
              name="transferContext"
              defaultValue={asset.transferContext}
            >
              {transferContexts.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError>{state.fieldErrors?.transferContext?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`method-${asset.id}`}>Distribution method</Label>
            <Select
              id={`method-${asset.id}`}
              name="distributionMethod"
              defaultValue={asset.distributionMethod}
            >
              {distributionMethods.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError>
              {state.fieldErrors?.distributionMethod?.[0]}
            </FieldError>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor={`document-${asset.id}`}>
              Document or location reference
            </Label>
            <Input
              id={`document-${asset.id}`}
              name="documentReference"
              defaultValue={asset.documentReference ?? ""}
              maxLength={300}
              placeholder="e.g. Title deed in home safe; provider designation on file"
            />
            <FieldError>{state.fieldErrors?.documentReference?.[0]}</FieldError>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor={`directive-notes-${asset.id}`}>
              Planning notes
            </Label>
            <Textarea
              id={`directive-notes-${asset.id}`}
              name="notes"
              defaultValue={asset.notes ?? ""}
              maxLength={2000}
              className="min-h-20"
            />
            <FieldError>{state.fieldErrors?.notes?.[0]}</FieldError>
          </div>
        </>
      )}
    </EstateManagedForm>
  );
}

function AssetCard({
  asset,
  beneficiaries,
  highlighted,
  baseCurrency,
  reviewItems,
  session,
  onChanged,
}: {
  asset: EstateAssetView;
  beneficiaries: ActiveBeneficiary[];
  highlighted: boolean;
  baseCurrency: string;
  reviewItems: EstateViewWorkspace["reviewItems"];
  session: Session;
  onChanged: () => void;
}) {
  const accountReviewItems = reviewItems.filter(
    (item) => item.accountId === asset.id,
  );
  const allocationAction: EstateFormAction = async (formData) => {
    try {
      await upsertEstateAllocation(
        asset.directiveId!,
        {
          beneficiaryId: String(formData.get("beneficiaryId")),
          tier: String(formData.get("tier")) as "primary" | "contingent",
          allocationBps: basisPoints(formData.get("allocationBps")),
          notes: String(formData.get("notes") ?? ""),
        },
        session.csrfToken,
      );
      onChanged();
      return { ok: true, message: "Asset allocation saved." };
    } catch (error) {
      return actionError(error);
    }
  };
  return (
    <Card
      id={`asset-${asset.id}`}
      className={cn(
        "scroll-mt-24",
        highlighted && "ring-2 ring-emerald-400/50",
      )}
    >
      <CardHeader className="flex-col gap-3 border-b border-white/[0.06] pb-4 sm:flex-row">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{asset.name}</CardTitle>
            <Badge>{asset.categoryName}</Badge>
            {!asset.isIncluded ? <Badge tone="neutral">Excluded</Badge> : null}
            {asset.archivedAt ? <Badge tone="warning">Archived</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {[asset.institutionName, asset.currency]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs uppercase text-slate-500">
            Indicative estate share
          </p>
          <p className="mt-1 font-semibold text-slate-100">
            <MoneyValue
              amount={asset.estateValueMinor}
              currency={asset.currency}
            />
          </p>
          {asset.currency !== baseCurrency &&
          asset.estateValueBaseMinor !== null ? (
            <p className="text-xs text-slate-500">
              <MoneyValue
                amount={asset.estateValueBaseMinor}
                currency={baseCurrency}
              />
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {accountReviewItems.length ? (
          <div className="grid gap-2">
            {accountReviewItems.map((item) => (
              <div
                key={`${item.code}-${item.message}`}
                className={cn(
                  "flex gap-2 rounded-lg px-3 py-2 text-xs",
                  item.severity === "blocking"
                    ? "bg-red-400/10 text-red-200"
                    : "bg-amber-400/10 text-amber-200",
                )}
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {item.message}
              </div>
            ))}
          </div>
        ) : null}
        {asset.archivedAt ? (
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
            Restore this account before changing its estate directive.
          </p>
        ) : (
          <DirectiveForm
            asset={asset}
            session={session}
            onChanged={onChanged}
          />
        )}
        {asset.directiveId && asset.isIncluded ? (
          <section className="space-y-3 border-t border-white/[0.06] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Specific allocations
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Primary {percent(asset.primaryAllocatedBps)}% · Remaining{" "}
                  {percent(asset.unallocatedBps)}%
                </p>
              </div>
              {asset.unallocatedBps === 0 ? (
                <Badge tone="positive">Fully allocated</Badge>
              ) : (
                <Badge tone="warning">
                  {percent(asset.unallocatedBps)}% remaining
                </Badge>
              )}
            </div>
            <AllocationRows
              asset={asset}
              session={session}
              onChanged={onChanged}
            />
            {beneficiaries.length ? (
              <AllocationForm
                action={allocationAction}
                beneficiaries={beneficiaries}
                label={`Add allocation to ${asset.name}`}
              />
            ) : (
              <Button asChild variant="secondary" size="sm">
                <Link to="/estate/beneficiaries">Add a beneficiary first</Link>
              </Button>
            )}
          </section>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-slate-500">
            Save an included asset directive before assigning beneficiaries.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function EstateDistributionWorkspace({
  workspace,
  selectedAccountId,
  session,
  onChanged,
}: {
  workspace: EstateViewWorkspace;
  selectedAccountId?: string;
  session: Session;
  onChanged: () => void;
}) {
  const activeBeneficiaries = workspace.beneficiaries.filter(
    (beneficiary) => !beneficiary.archivedAt,
  );
  const residualAction: EstateFormAction = async (formData) => {
    try {
      await upsertResiduaryAllocation(
        {
          beneficiaryId: String(formData.get("beneficiaryId")),
          tier: String(formData.get("tier")) as "primary" | "contingent",
          allocationBps: basisPoints(formData.get("allocationBps")),
          notes: String(formData.get("notes") ?? ""),
        },
        session.csrfToken,
      );
      onChanged();
      return { ok: true, message: "Residual allocation saved." };
    } catch (error) {
      return actionError(error);
    }
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Active assets</p>
          <p className="mt-2 text-2xl font-semibold">
            {workspace.assets.filter((asset) => !asset.archivedAt).length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Beneficiaries</p>
          <p className="mt-2 text-2xl font-semibold">
            {activeBeneficiaries.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">
            Estimated net estate
          </p>
          <p className="mt-2 text-lg font-semibold">
            <MoneyValue
              amount={workspace.totals.netEstateBaseMinor}
              currency={workspace.baseCurrency}
            />
          </p>
          {!workspace.totals.complete ? (
            <p className="mt-1 text-xs text-amber-300">Incomplete rates</p>
          ) : null}
        </Card>
      </div>
      {workspace.assets.length ? (
        workspace.assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            beneficiaries={activeBeneficiaries}
            highlighted={selectedAccountId === asset.id}
            baseCurrency={workspace.baseCurrency}
            reviewItems={workspace.reviewItems}
            session={session}
            onChanged={onChanged}
          />
        ))
      ) : (
        <Card className="p-8 text-center">
          <Landmark className="mx-auto text-slate-600" size={26} />
          <p className="mt-3 text-sm text-slate-400">
            Add an asset account before planning its distribution.
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link to="/accounts/new">Add account</Link>
          </Button>
        </Card>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale size={17} className="text-cyan-300" /> Residual estate
            </CardTitle>
            <p className="mt-1 text-sm text-slate-400">
              Applies to unallocated portions and property not specifically
              listed.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {workspace.residuaryAllocations.length ? (
            <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07]">
              {workspace.residuaryAllocations.map((allocation) => (
                <div
                  key={allocation.id}
                  className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-100">
                      {allocation.beneficiaryName}
                    </p>
                    <Badge
                      tone={allocation.tier === "primary" ? "positive" : "info"}
                    >
                      {allocation.tier === "primary" ? "Primary" : "Contingent"}
                    </Badge>
                    {allocation.beneficiaryArchivedAt ? (
                      <Badge tone="warning">Archived</Badge>
                    ) : null}
                  </div>
                  <p className="font-semibold tabular-nums">
                    {percent(allocation.allocationBps)}%
                  </p>
                  <MutationButton
                    action={async () => {
                      await deleteResiduaryAllocation(
                        allocation.id,
                        session.csrfToken,
                      );
                      onChanged();
                    }}
                    confirm={`Remove ${allocation.beneficiaryName} from the residual estate?`}
                    successMessage="Residual allocation removed."
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${allocation.beneficiaryName} residual allocation`}
                  >
                    <Trash2 size={15} />
                  </MutationButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-slate-500">
              No residual beneficiaries configured.
            </p>
          )}
          {activeBeneficiaries.length ? (
            <AllocationForm
              action={residualAction}
              beneficiaries={activeBeneficiaries}
              label="Add residual allocation"
            />
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert size={17} className="text-amber-300" /> Liabilities
              and expenses
            </CardTitle>
            <p className="mt-1 text-sm text-slate-400">
              Debts reduce the estimate but are not assigned to beneficiaries.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {workspace.liabilities.length ? (
            <div className="divide-y divide-white/[0.06]">
              {workspace.liabilities.map((liability) => (
                <div
                  key={liability.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {liability.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {liability.categoryName}
                    </p>
                  </div>
                  <MoneyValue
                    amount={liability.valueMinor}
                    currency={liability.currency}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No active liabilities are recorded.
            </p>
          )}
          <div className="mt-4 flex gap-2 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-100">
            <AlertTriangle size={15} className="shrink-0" />
            Actual debts, taxes, secured claims, administration costs, and
            liquidity needs may change distributions.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
