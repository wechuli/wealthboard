import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EstateBeneficiariesPage,
  EstateDistributionPage,
  EstateIndexPage,
  EstateSnapshotPage,
  EstateSummaryPage,
} from "@/pages/estate";
import { PrivacyBoundary } from "@/components/privacy";
import type { Session } from "@/lib/types";

const api = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getEstate: vi.fn(),
  getEstateSnapshot: vi.fn(),
  getOverview: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ...api,
  archiveBeneficiary: vi.fn(),
  createBeneficiary: vi.fn(),
  createEstateSnapshot: vi.fn(),
  deleteEstateAllocation: vi.fn(),
  deleteEstateSnapshot: vi.fn(),
  deleteResiduaryAllocation: vi.fn(),
  updateBeneficiary: vi.fn(),
  updateEstatePlan: vi.fn(),
  upsertEstateAllocation: vi.fn(),
  upsertEstateDirective: vi.fn(),
  upsertResiduaryAllocation: vi.fn(),
}));

const session = {
  user: { id: "user-1", username: "casey" },
  csrfToken: "csrf-token",
} as Session;

const estate = {
  plan: {
    id: "plan-1",
    title: "Family plan",
    jurisdiction: "Kenya",
    lastReviewedDate: null,
    reviewReminderDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  beneficiaries: [
    {
      id: "beneficiary-1",
      kind: "person",
      name: "Jordan Example",
      relationship: "Child",
      contactSummary: "Private contact",
      notes: "Private note",
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  directives: [
    {
      id: "directive-1",
      estatePlanId: "plan-1",
      accountId: "account-1",
      accountName: "Family home",
      currency: "KES",
      currentValueMinor: "100000",
      isLiability: false,
      accountArchivedAt: null,
      isIncluded: true,
      ownershipShareBps: 10000,
      transferContext: "estate",
      distributionMethod: "sell_and_divide",
      documentReference: "Home safe",
      notes: "Planning note",
      reviewedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  allocations: [
    {
      id: "allocation-1",
      estatePlanId: "plan-1",
      directiveId: "directive-1",
      beneficiaryId: "beneficiary-1",
      tier: "primary",
      allocationBps: 10000,
      notes: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  residuaryAllocations: [],
  snapshots: [],
  currentValuesComplete: true,
  currentValuesWarning: "",
};

const accounts = {
  items: [
    {
      id: "account-1",
      categoryId: "category-1",
      name: "Family home",
      currency: "KES",
      trackingMode: "balance",
      currentValueMinor: "100000",
      isLiability: false,
      isIncludedInNetWorth: true,
      categoryName: "Property",
    },
  ],
};

const overview = {
  settings: {
    displayName: "Casey Example",
    appName: "Wealthboard",
    baseCurrency: "KES",
    timezone: "Africa/Nairobi",
    preferredDateFormat: "medium",
    defaultDashboardPeriod: "1y",
  },
};

beforeEach(() => {
  api.getEstate.mockResolvedValue(estate);
  api.getAccounts.mockResolvedValue(accounts);
  api.getOverview.mockResolvedValue(overview);
  api.getEstateSnapshot.mockResolvedValue({
    id: "snapshot-1",
    estatePlanId: "plan-1",
    version: 1,
    title: "Family plan",
    valueAsOfDate: "2026-09-20",
    baseCurrency: "KES",
    contentHash: "abc123",
    generatedAt: "2026-09-20T08:00:00Z",
    content: {
      generatedAt: "2026-09-20T08:00:00Z",
      valueAsOfDate: "2026-09-20",
      ownerDisplayName: "Casey Example",
      plan: { title: "Family plan", jurisdiction: "Kenya" },
      baseCurrency: "KES",
      beneficiaries: estate.beneficiaries,
      assets: [
        {
          id: "account-1",
          name: "Family home",
          currency: "KES",
          currentValueMinor: "100000",
          directive: {
            isIncluded: true,
            ownershipShareBps: 10000,
            transferContext: "estate",
            distributionMethod: "sell_and_divide",
          },
          allocations: estate.allocations,
        },
      ],
      liabilities: [],
      residuaryAllocations: [],
      reviewItems: [],
      mathematicallyComplete: true,
      disclaimer: "Planning record only.",
    },
  });
});

afterEach(cleanup);

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PrivacyBoundary hidden={false}>{element}</PrivacyBoundary>
    </MemoryRouter>,
  );
}

describe("estate route pages", () => {
  it("redirects /estate to the distribution route", async () => {
    renderAt(
      "/estate",
      <Routes>
        <Route path="/estate" element={<EstateIndexPage />} />
        <Route
          path="/estate/distribution"
          element={<p>Distribution route</p>}
        />
      </Routes>,
    );
    expect(await screen.findByText("Distribution route")).toBeInTheDocument();
  });

  it("keeps beneficiary management isolated on its original route", async () => {
    renderAt(
      "/estate/beneficiaries",
      <EstateBeneficiariesPage session={session} />,
    );
    const heading = screen.getByRole("heading", {
      name: "Beneficiaries",
      level: 1,
    });
    expect(heading.closest("header")).toHaveClass("mb-6", "sm:items-end");
    expect(await screen.findByText("Jordan Example")).toBeInTheDocument();
    expect(
      screen.getByText(/do not become Wealthboard users/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/This plan records intent only/),
    ).not.toBeInTheDocument();
  });

  it("renders the original distribution composition and selected asset", async () => {
    renderAt(
      "/estate/distribution?account=account-1",
      <EstateDistributionPage session={session} />,
    );
    expect(
      screen.getByRole("heading", { name: "Estate distribution" }),
    ).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Family home" });
    expect(
      screen.getByText(/This plan records intent only/),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("heading", { name: "Family home" })
        .closest("div[id='asset-account-1']"),
    ).toHaveClass("ring-2");
    expect(
      screen.queryByText("Base-currency value unavailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Will Preparation Worksheet/),
    ).not.toBeInTheDocument();
  });

  it("renders the original summary composition", async () => {
    api.getEstate.mockResolvedValueOnce({
      ...estate,
      snapshots: [
        {
          id: "snapshot-1",
          estatePlanId: "plan-1",
          version: 1,
          title: "Family plan",
          valueAsOfDate: "2026-09-20",
          baseCurrency: "KES",
          contentHash: "abc123def456",
          generatedAt: "2026-09-20T08:00:00Z",
        },
      ],
    });
    api.getOverview.mockResolvedValueOnce({
      settings: { ...overview.settings, preferredDateFormat: "dd/MM/yyyy" },
    });
    renderAt("/estate/summary", <EstateSummaryPage session={session} />);
    expect(
      screen.getByRole("heading", { name: "Estate planning summary" }),
    ).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Completion review" });
    expect(screen.getByText(/Will Preparation Worksheet/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Completion review" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Created 20\/09\/2026/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Add beneficiary" }),
    ).not.toBeInTheDocument();
  });

  it("keeps snapshot values excluded until explicitly selected", async () => {
    const user = userEvent.setup();
    renderAt(
      "/estate/snapshots/snapshot-1",
      <Routes>
        <Route path="/estate/snapshots/:id" element={<EstateSnapshotPage />} />
      </Routes>,
    );
    expect(
      await screen.findByRole("heading", { name: "Print controls" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Value excluded").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("KES 1,000.00")).toHaveLength(0);
    await user.click(
      screen.getByRole("checkbox", { name: "Include exact values" }),
    );
    expect(screen.getAllByText("KES 1,000.00").length).toBeGreaterThan(0);
  });
});
