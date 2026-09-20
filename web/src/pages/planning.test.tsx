import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { PortedPlanningRoutes } from "@/pages/planning";
import { PrivacyBoundary } from "@/components/privacy";
import type { Session } from "@/lib/types";

vi.mock("@/components/planning/support", () => ({
  GoalForm: ({ goal }: { goal?: { name: string } }) => (
    <form aria-label={goal ? `Edit ${goal.name} form` : "Create goal form"} />
  ),
  InstrumentForm: ({ instrument }: { instrument?: { name: string } }) => (
    <form
      aria-label={
        instrument ? `Edit ${instrument.name} form` : "Create instrument form"
      }
    />
  ),
  CategoryManager: () => <section aria-label="Category manager" />,
  InstitutionManager: () => <section aria-label="Institution manager" />,
}));

const fixtures = vi.hoisted(() => ({
  goal: {
    id: "goal-1",
    name: "Home deposit",
    description: "Build a deposit",
    targetAmountMinor: "10000000",
    currentAmountMinor: "2500000",
    currentAmountCurrency: "KES",
    currency: "KES",
    targetDate: "2028-09-20",
    linkedAccount: null,
    icon: "Target",
    status: "active",
    priority: 0,
    assumedAnnualReturnBps: 800,
    progressPercent: "25",
    valueIncomplete: false,
    missingCurrencies: [],
    plan: {
      plannedContributionMinor: "100000",
      frequency: "monthly",
      startDate: "2026-09-20",
      endDate: null,
    },
    projection: [
      { date: "2026-09-20T00:00:00Z", projectedMinor: "2500000", contributionsMinor: "2500000", targetMinor: "10000000" },
      { date: "2028-09-20T00:00:00Z", projectedMinor: "10000000", contributionsMinor: "4900000", targetMinor: "10000000" },
    ],
  },
  instrument: {
    id: "instrument-1",
    externalId: null,
    name: "Example Equity Fund",
    symbol: "EEF",
    identifierType: "custom",
    identifier: null,
    exchangeMic: null,
    assetType: "fund",
    quoteCurrency: "KES",
    archivedAt: null,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
    latestPrice: null,
  },
}));

vi.mock("@/api/client", () => ({
  archiveInstrument: vi.fn(),
  deleteGoal: vi.fn(),
  deleteInstrument: vi.fn(),
  dismissGoalAlert: vi.fn(),
  getAccountActivity: vi.fn().mockResolvedValue({
    items: [],
    limit: 100,
    offset: 0,
    hasMore: false,
  }),
  getAccounts: vi.fn().mockResolvedValue({ items: [] }),
  getCategories: vi.fn().mockResolvedValue({ items: [] }),
  getGoal: vi.fn().mockResolvedValue(fixtures.goal),
  getGoalAlerts: vi.fn().mockResolvedValue([]),
  getGoalMilestones: vi.fn().mockResolvedValue([]),
  getGoals: vi.fn().mockResolvedValue([fixtures.goal]),
  getInstitutions: vi.fn().mockResolvedValue({ items: [] }),
  getInstrument: vi.fn().mockResolvedValue({
    instrument: fixtures.instrument,
    prices: [],
  }),
  getInstruments: vi.fn().mockResolvedValue({
    instruments: [fixtures.instrument],
  }),
  getReportAllocation: vi.fn().mockResolvedValue({
    asOf: "2026-09-20",
    baseCurrency: "KES",
    currentComplete: true,
    missingCurrencies: [],
    valueBasis: "current",
    categories: [
      { name: "Investments", valueMinor: "2500000", sharePercent: "100" },
    ],
    institutions: [],
    currencies: [],
    investibleCategories: [
      { name: "Investments", valueMinor: "2500000", sharePercent: "100" },
    ],
    instruments: [
      { name: "EEF", valueMinor: "2500000", sharePercent: "100" },
    ],
  }),
  getReportSummary: vi.fn().mockResolvedValue({
    asOf: "2026-09-20",
    baseCurrency: "KES",
    totals: {
      assets: "2500000",
      liabilities: "0",
      netWorth: "2500000",
      liquid: "0",
      investible: "2500000",
      contributions: "2000000",
      withdrawals: "0",
      income: "250000",
      fees: "5000",
      capitalGrowth: "255000",
    },
    accountCount: 1,
    goalCount: 1,
    currentComplete: true,
    missingCurrencies: [],
    valueBasis: "current",
    history: [
      { date: "2025-09-20T00:00:00Z", assetsMinor: "2000000", liabilitiesMinor: "0", netWorthMinor: "2000000", liquidMinor: "0", investibleMinor: "2000000", complete: true, missingCurrencies: [] },
      { date: "2026-09-20T00:00:00Z", assetsMinor: "2500000", liabilitiesMinor: "0", netWorthMinor: "2500000", liquidMinor: "0", investibleMinor: "2500000", complete: true, missingCurrencies: [] },
    ],
    historicalComplete: true,
    compositionComplete: true,
    completenessReasons: [],
  }),
  setGoalStatus: vi.fn(),
}));

const session = { csrfToken: "csrf" } as Session;

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PrivacyBoundary hidden={false}>
        <PortedPlanningRoutes session={session} />
      </PrivacyBoundary>
    </MemoryRouter>,
  );
}

function expectNoLegacyClasses(container: HTMLElement) {
  for (const className of [
    "primary-button",
    "secondary-button",
    "icon-button",
    "progress-track",
  ]) {
    expect(container.querySelector(`.${className}`)).toBeNull();
  }
}

afterEach(cleanup);

describe("PortedPlanningRoutes", () => {
  it("preserves the goals list header and dedicated create route", async () => {
    const view = renderRoute("/goals");

    expect(
      await screen.findByRole("heading", { name: "Financial goals" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Create goal" }).getAttribute("href"),
    ).toBe("/goals/new");
    expect(await screen.findByText("Home deposit")).toBeTruthy();
    expect(screen.getByText("Required monthly (8% return)")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Home deposit progress" }),
    ).toBeTruthy();
    expectNoLegacyClasses(view.container);

    cleanup();
    renderRoute("/goals/new");
    expect(
      await screen.findByRole("heading", {
        name: "Create a financial goal",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("form", { name: "Create goal form" })).toBeTruthy();
  });

  it("keeps goal detail and edit as separate routes", async () => {
    const view = renderRoute("/goals/goal-1");
    expect(
      await screen.findByRole("heading", { name: "Home deposit" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Edit goal" }).getAttribute("href"),
    ).toBe("/goals/goal-1/edit");
    expect(screen.getByText("Required monthly (8% return)")).toBeTruthy();
    expect(screen.getByText("Current monthly plan")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Projection" })).toBeTruthy();
    expect(screen.getByText("Scenario comparison")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Milestones/ })).toBeTruthy();
    expectNoLegacyClasses(view.container);

    cleanup();
    renderRoute("/goals/goal-1/edit");
    expect(
      await screen.findByRole("heading", { name: "Edit Home deposit" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("form", { name: "Edit Home deposit form" }),
    ).toBeTruthy();
  });

  it("renders reports and metadata page copy from the original UI", async () => {
    renderRoute("/reports");
    expect(
      await screen.findByRole("heading", { name: "Reports & analytics" }),
    ).toBeTruthy();
    expect(await screen.findByText("Highest net worth")).toBeTruthy();
    expect(screen.getByText("Change since tracking")).toBeTruthy();
    expect(screen.getByText("Year-over-year")).toBeTruthy();
    expect(screen.getByText("Investment income")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Net-worth history" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Portfolio allocation" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Income and returns" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Asset classification" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Account comparison" }),
    ).toBeTruthy();

    cleanup();
    renderRoute("/categories");
    expect(
      await screen.findByRole("heading", { name: "Categories" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Category manager" }),
    ).toBeTruthy();

    cleanup();
    renderRoute("/institutions");
    expect(
      await screen.findByRole("heading", { name: "Institutions" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Institution manager" }),
    ).toBeTruthy();
  });

  it("preserves the instrument directory, new route, and edit route", async () => {
    renderRoute("/instruments");
    expect(
      await screen.findByRole("heading", { name: "Investment instruments" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Add instrument" }).getAttribute("href"),
    ).toBe("/instruments/new");
    expect(
      (
        await screen.findByRole("link", {
          name: "Edit Example Equity Fund",
        })
      ).getAttribute("href"),
    ).toBe("/instruments/instrument-1/edit");

    cleanup();
    renderRoute("/instruments/new");
    expect(
      await screen.findByRole("heading", { name: "Add instrument" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("form", { name: "Create instrument form" }),
    ).toBeTruthy();

    cleanup();
    renderRoute("/instruments/instrument-1/edit");
    expect(
      await screen.findByRole("heading", { name: "Edit Example Equity Fund" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("form", { name: "Edit Example Equity Fund form" }),
    ).toBeTruthy();
  });
});
