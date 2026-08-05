"use client";

import { useRef, useState, useTransition } from "react";
import {
  Archive,
  Building2,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import {
  archiveInstitutionAction,
  createInstitutionAction,
  updateInstitutionAction,
} from "@/app/(app)/actions";
import { MutationButton } from "@/components/mutation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import type { Institution } from "@/db/schema";
import { INSTITUTION_TYPE_OPTIONS } from "@/lib/institutions";
import type { ActionState } from "@/lib/validation";

type InstitutionRow = Institution & { accountCount: number };

function InstitutionEditor({
  institution,
  action,
}: {
  institution?: InstitutionRow;
  action: (formData: FormData) => Promise<ActionState>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();

  return (
    <form
      ref={formRef}
      className="grid gap-4 lg:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await action(new FormData(formRef.current!));
          setMessage(result.message);
          if (result.ok) {
            toast.success(result.message);
            if (!institution) formRef.current?.reset();
          } else if (result.message) {
            toast.error(result.message);
          }
        });
      }}
    >
      <div>
        <Label htmlFor={`institution-name-${institution?.id ?? "new"}`}>
          Name
        </Label>
        <Input
          id={`institution-name-${institution?.id ?? "new"}`}
          name="name"
          defaultValue={institution?.name}
          required
          maxLength={100}
        />
      </div>
      <div>
        <Label htmlFor={`institution-type-${institution?.id ?? "new"}`}>
          Type
        </Label>
        <Select
          id={`institution-type-${institution?.id ?? "new"}`}
          name="type"
          defaultValue={institution?.type ?? "bank"}
        >
          {INSTITUTION_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`institution-website-${institution?.id ?? "new"}`}>
          Website
        </Label>
        <Input
          id={`institution-website-${institution?.id ?? "new"}`}
          name="websiteUrl"
          type="url"
          defaultValue={institution?.websiteUrl ?? ""}
          placeholder="https://example.com"
          maxLength={500}
        />
      </div>
      <div>
        <Label htmlFor={`institution-country-${institution?.id ?? "new"}`}>
          Country code
        </Label>
        <Input
          id={`institution-country-${institution?.id ?? "new"}`}
          name="countryCode"
          defaultValue={institution?.countryCode ?? ""}
          placeholder="e.g. KE"
          maxLength={2}
        />
      </div>
      <div className="lg:col-span-2">
        <Label htmlFor={`institution-address-${institution?.id ?? "new"}`}>
          Address
        </Label>
        <Textarea
          id={`institution-address-${institution?.id ?? "new"}`}
          name="address"
          defaultValue={institution?.address ?? ""}
          maxLength={500}
          className="min-h-20"
        />
      </div>
      <div className="lg:col-span-2">
        <Label htmlFor={`institution-notes-${institution?.id ?? "new"}`}>
          Notes
        </Label>
        <Textarea
          id={`institution-notes-${institution?.id ?? "new"}`}
          name="notes"
          defaultValue={institution?.notes ?? ""}
          maxLength={2000}
          className="min-h-20"
        />
      </div>
      {message ? (
        <p
          role={message ? "status" : undefined}
          className="text-sm text-slate-400 lg:col-span-2"
        >
          {message}
        </p>
      ) : null}
      <div className="flex justify-end lg:col-span-2">
        <Button size="sm" disabled={pending}>
          {pending ? (
            <LoaderCircle className="animate-spin" size={15} />
          ) : institution ? (
            <Save size={15} />
          ) : (
            <Plus size={15} />
          )}
          {institution ? "Save institution" : "Add institution"}
        </Button>
      </div>
    </form>
  );
}

export function InstitutionManager({
  institutions,
}: {
  institutions: InstitutionRow[];
}) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Add institution</h2>
        <InstitutionEditor action={createInstitutionAction} />
      </Card>
      {institutions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-5 py-12 text-center">
          <Building2 className="mx-auto text-slate-600" size={24} />
          <p className="mt-3 text-sm text-slate-400">
            No institutions have been added yet.
          </p>
        </div>
      ) : (
        institutions.map((institution) => (
          <Card key={institution.id} className="p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium text-slate-100">
                    {institution.name}
                  </h2>
                  {institution.archivedAt ? (
                    <Badge tone="warning">Archived</Badge>
                  ) : null}
                  <Badge>
                    {institution.accountCount}{" "}
                    {institution.accountCount === 1 ? "account" : "accounts"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Changes apply to every linked account and report.
                </p>
              </div>
              <MutationButton
                action={archiveInstitutionAction.bind(
                  null,
                  institution.id,
                  !institution.archivedAt,
                )}
                confirm={
                  institution.archivedAt
                    ? undefined
                    : "Archive this institution? Existing account links will remain."
                }
                successMessage={
                  institution.archivedAt
                    ? "Institution restored."
                    : "Institution archived."
                }
                variant="ghost"
                size="icon"
                aria-label={
                  institution.archivedAt
                    ? "Restore institution"
                    : "Archive institution"
                }
              >
                {institution.archivedAt ? (
                  <RotateCcw size={16} />
                ) : (
                  <Archive size={16} />
                )}
              </MutationButton>
            </div>
            <InstitutionEditor
              institution={institution}
              action={updateInstitutionAction.bind(null, institution.id)}
            />
          </Card>
        ))
      )}
    </div>
  );
}
