import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/(app)/estate/actions", () => ({
  archiveBeneficiaryAction: vi.fn(),
  createBeneficiaryAction: vi.fn(),
  updateBeneficiaryAction: vi.fn(),
}));

import {
  archiveBeneficiaryAction,
  createBeneficiaryAction,
} from "@/app/(app)/estate/actions";
import { BeneficiaryManager } from "@/components/beneficiary-manager";
import { EstateSummaryDocument } from "@/components/estate-summary-document";
import { PrivacyProvider, PrivacyToggle } from "@/components/privacy-provider";
import type { EstateSnapshotContent } from "@/lib/services/estate-planning";

const timestamp = "2026-08-11T10:00:00.000Z";
const beneficiary = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "owner-1",
  kind: "person" as const,
  name: "Amina Example",
  relationship: "Child",
  contactSummary: "amina@example.test",
  notes: "Discuss the education trust.",
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const snapshotContent: EstateSnapshotContent = {
  format: "wealthboard-estate-summary",
  version: 1,
  generatedAt: timestamp,
  valueAsOfDate: "2026-08-11",
  ownerDisplayName: "Estate Owner",
  plan: {
    title: "Family estate plan",
    jurisdiction: "Example jurisdiction",
    lastReviewedDate: timestamp,
    reviewReminderDate: null,
  },
  baseCurrency: "KES",
  totals: {
    grossAssetsBaseMinor: "100000",
    liabilitiesBaseMinor: "20000",
    netEstateBaseMinor: "80000",
    complete: true,
  },
  beneficiaries: [
    {
      id: beneficiary.id,
      kind: beneficiary.kind,
      name: beneficiary.name,
      relationship: beneficiary.relationship,
      contactSummary: beneficiary.contactSummary,
      notes: beneficiary.notes,
      archivedAt: null,
    },
  ],
  assets: [
    {
      id: "account-1",
      name: "Family land",
      categoryName: "Land and Real Estate",
      institutionName: null,
      accountReference: "TITLE-PRIVATE-001",
      currency: "KES",
      archivedAt: null,
      latestActivityAt: timestamp,
      isIncluded: true,
      ownershipShareBps: 10000,
      transferContext: "estate",
      distributionMethod: "transfer_asset",
      documentReference: "Title deed in home safe",
      notes: "Obtain a current valuation.",
      reviewedAt: timestamp,
      estateValueMinor: "100000",
      estateValueBaseMinor: "100000",
      primaryAllocatedBps: 10000,
      contingentAllocatedBps: 0,
      unallocatedBps: 0,
      allocations: [
        {
          id: "allocation-1",
          beneficiaryId: beneficiary.id,
          beneficiaryName: beneficiary.name,
          beneficiaryKind: beneficiary.kind,
          beneficiaryArchivedAt: null,
          tier: "primary",
          allocationBps: 10000,
          notes: "Keep in the family if practical.",
          amountMinor: "100000",
          amountBaseMinor: "100000",
        },
      ],
      residualAllocations: [],
    },
  ],
  liabilities: [
    {
      id: "liability-1",
      name: "Estate loan",
      categoryName: "Liability",
      institutionName: null,
      currency: "KES",
      valueMinor: "20000",
      valueBaseMinor: "20000",
    },
  ],
  residuaryAllocations: [],
  beneficiaryTotals: [
    {
      beneficiaryId: beneficiary.id,
      beneficiaryName: beneficiary.name,
      amountBaseMinor: "100000",
      incomplete: false,
    },
  ],
  reviewItems: [],
  mathematicallyComplete: true,
  disclaimer:
    "This Estate Planning Summary is a planning record, not a legally executed will.",
};

describe("estate planning components", () => {
  beforeEach(() => {
    vi.mocked(createBeneficiaryAction).mockResolvedValue({
      ok: true,
      message: "Beneficiary added.",
    });
    vi.mocked(archiveBeneficiaryAction).mockResolvedValue({
      ok: true,
      message: "Beneficiary archived.",
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("adds and archives beneficiaries through labelled controls", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BeneficiaryManager beneficiaries={[beneficiary]} />);

    const addHeading = screen.getByRole("heading", { name: "Add beneficiary" });
    const addCard = addHeading.closest<HTMLElement>("div.rounded-2xl")!;
    await user.type(
      within(addCard).getByLabelText("Name"),
      "Future Foundation",
    );
    await user.selectOptions(
      within(addCard).getByLabelText("Type"),
      "organization",
    );
    await user.click(
      within(addCard).getByRole("button", { name: "Add beneficiary" }),
    );

    expect(createBeneficiaryAction).toHaveBeenCalledOnce();
    const formData = vi.mocked(createBeneficiaryAction).mock.calls[0][0];
    expect(formData.get("name")).toBe("Future Foundation");
    expect(formData.get("kind")).toBe("organization");
    expect(await screen.findByText("Beneficiary added.")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Archive Amina Example" }),
    );
    expect(archiveBeneficiaryAction).toHaveBeenCalledWith(beneficiary.id, true);
  });

  it("keeps sensitive document fields excluded until explicitly revealed", async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    Object.defineProperty(window, "print", {
      configurable: true,
      value: print,
    });
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <EstateSummaryDocument
          snapshotId="snapshot-1"
          content={snapshotContent}
          contentHash={"a".repeat(64)}
        />
      </PrivacyProvider>,
    );

    expect(screen.getAllByText("Value excluded").length).toBeGreaterThan(0);
    expect(screen.queryByText("amina@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText(/TITLE-PRIVATE-001/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Obtain a current valuation."),
    ).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Include exact values"));
    expect(screen.getAllByText(/1,000\.00/).length).toBeGreaterThan(0);
    await user.click(screen.getByLabelText("Include contacts"));
    await user.click(screen.getByLabelText("Include account references"));
    await user.click(screen.getByLabelText("Include private notes"));
    expect(screen.getByText("amina@example.test")).toBeVisible();
    expect(screen.getByText(/TITLE-PRIVATE-001/)).toBeVisible();
    expect(screen.getByText("Obtain a current valuation.")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Hide financial values" }),
    );
    expect(screen.getAllByText("••••••").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Print or save PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });
});
