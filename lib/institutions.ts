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

export function canonicalizeInstitutionName(value: string) {
  return value
    .replace(/[\t\n\r\u00a0]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/^ +| +$/g, "");
}

export function normalizeInstitutionName(value: string) {
  return canonicalizeInstitutionName(value).replace(/[A-Z]/g, (character) =>
    character.toLowerCase(),
  );
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function institutionTypeLabel(type: InstitutionType) {
  return (
    INSTITUTION_TYPE_OPTIONS.find((option) => option.value === type)?.label ??
    "Other"
  );
}
