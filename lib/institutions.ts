import type { InstitutionType } from "@/db/schema";

export const INSTITUTION_TYPE_OPTIONS = [
  { value: "bank", label: "Bank" },
  { value: "credit_union", label: "Credit union / SACCO" },
  { value: "brokerage", label: "Brokerage" },
  { value: "asset_manager", label: "Asset or fund manager" },
  { value: "pension_provider", label: "Pension provider" },
  { value: "insurer", label: "Insurer" },
  { value: "lender", label: "Lender" },
  { value: "digital_wallet", label: "Digital wallet / mobile money" },
  { value: "government", label: "Government" },
  { value: "employer", label: "Employer" },
  { value: "other", label: "Other" },
] as const satisfies ReadonlyArray<{
  value: InstitutionType;
  label: string;
}>;

export function normalizeInstitutionName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function institutionTypeLabel(type: InstitutionType) {
  return (
    INSTITUTION_TYPE_OPTIONS.find((option) => option.value === type)?.label ??
    "Other"
  );
}
