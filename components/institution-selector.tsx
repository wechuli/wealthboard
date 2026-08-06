"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Building2,
  Check,
  ChevronDown,
  LoaderCircle,
  Plus,
  Search,
  X,
} from "lucide-react";

import { createInstitutionAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  Input,
  Label,
  Select,
} from "@/components/ui/form-controls";
import type { Institution } from "@/db/schema";
import {
  INSTITUTION_TYPE_OPTIONS,
  institutionTypeLabel,
} from "@/lib/institutions";
import type { ActionState } from "@/lib/validation";

export type InstitutionOption = Pick<
  Institution,
  "id" | "name" | "type" | "archivedAt"
>;

export function InstitutionSelector({
  institutions,
  value,
  onChange,
}: {
  institutions: InstitutionOption[];
  value?: string;
  onChange: (value: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [options, setOptions] = useState(institutions);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<ActionState["fieldErrors"]>();
  const [pending, startTransition] = useTransition();
  const selected = options.find((option) => option.id === value);
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return options.filter(
      (option) =>
        (!option.archivedAt || option.id === value) &&
        (!normalizedQuery ||
          option.name.toLocaleLowerCase().includes(normalizedQuery) ||
          institutionTypeLabel(option.type)
            .toLocaleLowerCase()
            .includes(normalizedQuery)),
    );
  }, [options, query, value]);

  const select = (institutionId: string) => {
    onChange(institutionId);
    setOpen(false);
    setAdding(false);
    setQuery("");
    setMessage(undefined);
    setFieldErrors(undefined);
  };

  return (
    <>
      <input type="hidden" name="institutionId" value={value ?? ""} />
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setAdding(false);
            setQuery("");
            setMessage(undefined);
            setFieldErrors(undefined);
          }
        }}
      >
        <Dialog.Trigger asChild>
          <Button
            id="institution"
            type="button"
            variant="secondary"
            className="w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Building2 className="shrink-0 text-slate-400" size={16} />
              <span className="truncate">
                {selected?.name ?? "No institution / self-custodied"}
              </span>
            </span>
            <ChevronDown className="shrink-0 text-slate-500" size={16} />
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-x-3 top-1/2 z-[60] max-h-[85vh] -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/10 bg-[#121918] p-5 shadow-2xl outline-none sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-semibold text-slate-100">
                  {adding ? "Add institution" : "Choose institution"}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-slate-400">
                  {adding
                    ? "Create the provider now and add further details later."
                    : "Search your active institutions or leave this account self-custodied."}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                >
                  <X size={17} />
                </Button>
              </Dialog.Close>
            </div>

            {adding ? (
              <form
                ref={formRef}
                className="mt-5 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  setMessage(undefined);
                  setFieldErrors(undefined);
                  startTransition(async () => {
                    const result = await createInstitutionAction(
                      new FormData(formRef.current!),
                    );
                    if (!result.ok || !result.institution) {
                      setMessage(result.message);
                      setFieldErrors(result.fieldErrors);
                      return;
                    }
                    const institution = {
                      ...result.institution,
                      archivedAt: null,
                    };
                    setOptions((current) => [...current, institution]);
                    select(institution.id);
                  });
                }}
              >
                <div>
                  <Label htmlFor="inline-institution-name">Name</Label>
                  <Input
                    id="inline-institution-name"
                    name="name"
                    autoFocus
                    required
                    maxLength={100}
                  />
                  <FieldError>{fieldErrors?.name?.[0]}</FieldError>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="inline-institution-type">Type</Label>
                    <Select
                      id="inline-institution-type"
                      name="type"
                      defaultValue="bank"
                    >
                      {INSTITUTION_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <FieldError>{fieldErrors?.type?.[0]}</FieldError>
                  </div>
                  <div>
                    <Label htmlFor="inline-institution-country">
                      Country code
                    </Label>
                    <Input
                      id="inline-institution-country"
                      name="countryCode"
                      placeholder="e.g. KE"
                      maxLength={2}
                    />
                    <FieldError>{fieldErrors?.countryCode?.[0]}</FieldError>
                  </div>
                </div>
                <div>
                  <Label htmlFor="inline-institution-website">Website</Label>
                  <Input
                    id="inline-institution-website"
                    name="websiteUrl"
                    type="url"
                    placeholder="https://example.com"
                    maxLength={500}
                  />
                  <FieldError>{fieldErrors?.websiteUrl?.[0]}</FieldError>
                </div>
                {message ? (
                  <p role="alert" className="text-sm text-red-300">
                    {message}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAdding(false);
                      setMessage(undefined);
                      setFieldErrors(undefined);
                    }}
                  >
                    Back
                  </Button>
                  <Button disabled={pending}>
                    {pending ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <Plus size={16} />
                    )}
                    Add institution
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="relative mt-5">
                  <Label htmlFor="institution-search" className="sr-only">
                    Search institutions
                  </Label>
                  <Search
                    className="absolute left-3 top-3.5 text-slate-500"
                    size={16}
                  />
                  <Input
                    id="institution-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search institutions"
                    className="pl-9"
                    autoFocus
                  />
                </div>
                <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => select("")}
                    className="flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <span>No institution / self-custodied</span>
                    {!value ? <Check size={16} /> : null}
                  </button>
                  {visibleOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      onClick={() => select(option.id)}
                      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-left hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-100">
                          {option.name}
                        </span>
                        <span className="text-xs text-slate-500">
                          {institutionTypeLabel(option.type)}
                          {option.archivedAt ? " · Archived" : ""}
                        </span>
                      </span>
                      {option.id === value ? (
                        <Check className="shrink-0" size={16} />
                      ) : null}
                    </button>
                  ))}
                  {visibleOptions.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-slate-500">
                      No institutions match your search.
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4 w-full"
                  onClick={() => setAdding(true)}
                >
                  <Plus size={16} />
                  Add institution
                </Button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
