"use client";

import { Archive, RotateCcw, UserPlus } from "lucide-react";

import {
  archiveBeneficiaryAction,
  createBeneficiaryAction,
  updateBeneficiaryAction,
} from "@/app/(app)/estate/actions";
import { EstateManagedForm } from "@/components/estate-managed-form";
import { MutationButton } from "@/components/mutation-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  FieldError,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/form-controls";
import type { Beneficiary } from "@/db/schema";

const kindOptions = [
  { value: "person", label: "Person" },
  { value: "organization", label: "Organization" },
  { value: "trust", label: "Trust" },
] as const;

function BeneficiaryEditor({ beneficiary }: { beneficiary?: Beneficiary }) {
  const suffix = beneficiary?.id ?? "new";
  return (
    <EstateManagedForm
      action={
        beneficiary
          ? updateBeneficiaryAction.bind(null, beneficiary.id)
          : createBeneficiaryAction
      }
      submitLabel={beneficiary ? "Save beneficiary" : "Add beneficiary"}
      resetOnSuccess={!beneficiary}
      className="lg:grid-cols-2"
    >
      {(state) => (
        <>
          <div>
            <Label htmlFor={`beneficiary-name-${suffix}`}>Name</Label>
            <Input
              id={`beneficiary-name-${suffix}`}
              name="name"
              defaultValue={beneficiary?.name}
              maxLength={120}
              required
            />
            <FieldError>{state.fieldErrors?.name?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`beneficiary-kind-${suffix}`}>Type</Label>
            <Select
              id={`beneficiary-kind-${suffix}`}
              name="kind"
              defaultValue={beneficiary?.kind ?? "person"}
            >
              {kindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError>{state.fieldErrors?.kind?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`beneficiary-relationship-${suffix}`}>
              Relationship
            </Label>
            <Input
              id={`beneficiary-relationship-${suffix}`}
              name="relationship"
              defaultValue={beneficiary?.relationship ?? ""}
              placeholder="e.g. Child, sibling, charity"
              maxLength={80}
            />
            <FieldError>{state.fieldErrors?.relationship?.[0]}</FieldError>
          </div>
          <div>
            <Label htmlFor={`beneficiary-contact-${suffix}`}>
              Contact summary
            </Label>
            <Input
              id={`beneficiary-contact-${suffix}`}
              name="contactSummary"
              defaultValue={beneficiary?.contactSummary ?? ""}
              placeholder="Optional phone, email, or adviser reference"
              maxLength={300}
            />
            <FieldError>{state.fieldErrors?.contactSummary?.[0]}</FieldError>
          </div>
          <div className="lg:col-span-2">
            <Label htmlFor={`beneficiary-notes-${suffix}`}>Private notes</Label>
            <Textarea
              id={`beneficiary-notes-${suffix}`}
              name="notes"
              defaultValue={beneficiary?.notes ?? ""}
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

export function BeneficiaryManager({
  beneficiaries,
}: {
  beneficiaries: Beneficiary[];
}) {
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded-lg bg-emerald-400/10 p-2 text-emerald-300">
            <UserPlus size={17} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Add beneficiary
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              This record does not create a login or grant portfolio access.
            </p>
          </div>
        </div>
        <BeneficiaryEditor />
      </Card>

      {beneficiaries.map((beneficiary) => (
        <Card key={beneficiary.id} className="p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium text-slate-100">{beneficiary.name}</h2>
              <Badge>
                {
                  kindOptions.find(
                    (option) => option.value === beneficiary.kind,
                  )?.label
                }
              </Badge>
              {beneficiary.archivedAt ? (
                <Badge tone="warning">Archived</Badge>
              ) : null}
            </div>
            <MutationButton
              action={archiveBeneficiaryAction.bind(
                null,
                beneficiary.id,
                !beneficiary.archivedAt,
              )}
              confirm={
                beneficiary.archivedAt
                  ? undefined
                  : "Archive this beneficiary? Existing estate allocations remain and will require review."
              }
              successMessage={
                beneficiary.archivedAt
                  ? "Beneficiary restored."
                  : "Beneficiary archived."
              }
              variant="ghost"
              size="icon"
              aria-label={
                beneficiary.archivedAt
                  ? `Restore ${beneficiary.name}`
                  : `Archive ${beneficiary.name}`
              }
            >
              {beneficiary.archivedAt ? (
                <RotateCcw size={16} />
              ) : (
                <Archive size={16} />
              )}
            </MutationButton>
          </div>
          <BeneficiaryEditor beneficiary={beneficiary} />
        </Card>
      ))}
    </div>
  );
}
