import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import DashboardPage from "@/app/(app)/page";
import AccountsPage from "@/app/(app)/accounts/page";
import { formatMoney } from "@/lib/money";
import { ArchivedAccountActions } from "@/components/archived-account-actions";

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  history: vi.fn(),
  netWorthAt: vi.fn(),
  settings: vi.fn(),
  accounts: vi.fn(),
  balanceAt: vi.fn(),
  positionSnapshot: vi.fn(),
  query: vi.fn(),
  deleteAccount: vi.fn(),
  archiveAccount: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(app)/actions", () => ({
  archiveAccountAction: mocks.archiveAccount,
  deleteAccountAction: mocks.deleteAccount,
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ userId: "overview-owner" }),
}));
vi.mock("@/lib/services/analytics", () => ({
  getDashboardData: mocks.dashboard,
  getNetWorthHistory: mocks.history,
  getNetWorthAt: mocks.netWorthAt,
}));
vi.mock("@/lib/bootstrap", () => ({ getSettings: mocks.settings }));
vi.mock("@/lib/services/accounts", () => ({
  listAccounts: mocks.accounts,
  accountBalanceAt: mocks.balanceAt,
}));
vi.mock("@/lib/services/investments", () => ({
  getPositionAccountSnapshot: mocks.positionSnapshot,
}));
vi.mock("@/lib/services/goals", () => ({
  listGoals: async () => [],
  listGoalAlerts: async () => [],
}));
vi.mock("@/lib/db", () => ({
  getDatabase: () => ({
    select: () => ({ from: () => ({ where: mocks.query }) }),
  }),
}));
vi.mock("@/components/goal-alerts", () => ({ GoalAlerts: () => null }));
vi.mock("@/components/charts", () => ({
  AllocationChart: () => <div>Allocation chart</div>,
  AssetsLiabilitiesChart: () => <div>Assets and liabilities chart</div>,
  ContributionsGrowthChart: () => <div>Contributions chart</div>,
  NetWorthChart: () => <div>Net worth chart</div>,
}));

const preferences = {
  baseCurrency: "KES",
  timezone: "Africa/Nairobi",
  preferredDateFormat: "dd MMM yyyy",
  updatedAt: "2026-09-16T08:00:00.000Z",
};
const account = {
  id: "overview-account",
  name: "Example savings",
  categoryName: "Savings",
  categoryIcon: "Wallet",
  currency: "KES",
  currentValueMinor: 10_000,
  trackingMode: "balance",
  isLiability: false,
  archivedAt: null,
  updatedAt: preferences.updatedAt,
};
const point = (date: string, netWorth = 5_000, complete = true) => ({
  date,
  netWorth,
  complete,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(preferences.updatedAt));
  mocks.dashboard.mockResolvedValue({
    settings: preferences,
    totals: {
      netWorth: 10_000n,
      assets: 10_000n,
      liabilities: 0n,
      liquid: 10_000n,
      investible: 0n,
      contributions: 10_000n,
      withdrawals: 0n,
      income: 0n,
      fees: 0n,
      capitalGrowth: 0n,
    },
    history: [point("2026-09-16T23:59:59.999Z", 10_000)],
    historyComplete: true,
    currentComplete: true,
    currentRateIssues: [],
    positionIssues: [],
    missingPrices: [],
    stalePrices: [],
    historicalRateGaps: [],
    allocation: [],
    investibleAllocation: [],
    recentActivity: [],
    accountCount: 1,
    goalCount: 0,
  });
  mocks.history.mockResolvedValue([point("2026-01-01T23:59:59.999Z")]);
  mocks.netWorthAt.mockImplementation(async (_userId, date: Date) =>
    point(date.toISOString()),
  );
  mocks.settings.mockResolvedValue(preferences);
  mocks.accounts.mockResolvedValue([account]);
  mocks.balanceAt.mockReturnValue(9_000n);
  mocks.query.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("does not display a signed loss from an incomplete monthly baseline", async () => {
  mocks.netWorthAt.mockResolvedValueOnce(
    point("2026-08-17T23:59:59.999Z", 20_000, false),
  );
  render(await DashboardPage({ searchParams: Promise.resolve({}) }));

  const month = screen.getByRole("group", { name: "1 month net worth change" });
  expect(within(month).getByText("Incomplete data")).toBeVisible();
  expect(month.textContent).not.toContain(formatMoney(-10_000n, "KES"));
  expect(
    screen.getByRole("group", { name: "3 months net worth change" }).textContent,
  ).toContain(formatMoney(5_000n, "KES", { compact: true }));
  expect(screen.getByText("Net worth chart")).toBeVisible();
  expect(screen.getByText("Allocation chart")).toBeVisible();
});

test("keeps real losses when both comparison endpoints are complete", async () => {
  mocks.netWorthAt.mockResolvedValueOnce(
    point("2026-08-17T23:59:59.999Z", 20_000),
  );
  render(await DashboardPage({ searchParams: Promise.resolve({}) }));
  const month = screen.getByRole("group", { name: "1 month net worth change" });
  expect(month.textContent).toContain(
    formatMoney(-10_000n, "KES", { compact: true }),
  );
  expect(within(month).queryByText("Incomplete data")).not.toBeInTheDocument();
});

test("marks all comparisons incomplete when the current total is incomplete", async () => {
  const data = await mocks.dashboard();
  mocks.dashboard.mockResolvedValue({ ...data, currentComplete: false });
  render(await DashboardPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getAllByText("Incomplete data")).toHaveLength(4);
});

test("marks an incomplete all-time baseline without hiding complete monthly changes", async () => {
  mocks.history.mockResolvedValue([
    point("2026-01-01T23:59:59.999Z", 0, false),
  ]);
  render(await DashboardPage({ searchParams: Promise.resolve({}) }));
  expect(
    screen.getByRole("group", { name: "All time net worth change" }),
  ).toHaveTextContent("Incomplete data");
  expect(
    screen.getByRole("group", { name: "1 month net worth change" }),
  ).not.toHaveTextContent("Incomplete data");
});

test("keeps today's conversion visible when only the historical rate is missing", async () => {
  mocks.accounts.mockResolvedValue([{ ...account, currency: "USD" }]);
  mocks.query.mockResolvedValueOnce([
    {
      baseCurrency: "USD",
      quoteCurrency: "KES",
      rate: "130",
      effectiveDate: "2026-08-18T12:00:00.000Z",
    },
  ]);
  render(await AccountsPage());

  const card = screen.getByRole("link", { name: /Example savings/ });
  expect(card.textContent).toContain(formatMoney(1_300_000n, "KES"));
  expect(within(card).queryByText("Exchange rate needed")).not.toBeInTheDocument();
  expect(within(card).getByText("Incomplete data")).toBeVisible();
});

test.each(["current", "historical"])(
  "uses live position values but hides changes with missing %s prices",
  async (missingEndpoint) => {
    mocks.accounts.mockResolvedValue([{ ...account, trackingMode: "positions" }]);
    mocks.positionSnapshot
      .mockReturnValueOnce({
        totalMinor: 20_000n,
        complete: missingEndpoint !== "current",
        positions: [],
        staleInstrumentIds: [],
      })
      .mockReturnValueOnce({
        totalMinor: 5_000n,
        complete: missingEndpoint !== "historical",
      });
    render(await AccountsPage());

    const card = screen.getByRole("link", { name: /Example savings/ });
    expect(card.textContent).toContain(formatMoney(20_000n, "KES"));
    expect(within(card).getByText("Incomplete data")).toBeVisible();
    expect(mocks.positionSnapshot).toHaveBeenCalledWith(
      "overview-owner",
      account.id,
      "2026-08-17T23:59:59.999Z",
    );
  },
);

test("does not require a historical rate when the account had no exposure", async () => {
  mocks.accounts.mockResolvedValue([{ ...account, currency: "USD" }]);
  mocks.balanceAt.mockReturnValue(0n);
  mocks.query.mockResolvedValueOnce([
    {
      baseCurrency: "USD",
      quoteCurrency: "KES",
      rate: "130",
      effectiveDate: "2026-08-18T12:00:00.000Z",
    },
  ]);
  render(await AccountsPage());

  const card = screen.getByRole("link", { name: /Example savings/ });
  expect(within(card).queryByText("Incomplete data")).not.toBeInTheDocument();
  expect(card.textContent?.split("30-day change")[1]).toContain(
    formatMoney(1_300_000n, "KES"),
  );
});

test("uses the same end-of-day baseline for dashboard and account changes", async () => {
  render(await DashboardPage({ searchParams: Promise.resolve({}) }));
  render(await AccountsPage());
  expect(mocks.netWorthAt).toHaveBeenCalledWith(
    "overview-owner",
    new Date("2026-08-17T23:59:59.999Z"),
  );
  expect(mocks.balanceAt).toHaveBeenCalledWith(
    "overview-owner",
    account.id,
    "2026-08-17T23:59:59.999Z",
  );
});

test("requires the exact archived account name before permanent deletion", async () => {
  const user = userEvent.setup();
  mocks.deleteAccount.mockResolvedValue({ ok: true });
  const accountId = "318b42a8-305d-4b3a-a828-7a03c8f7f882";
  render(<ArchivedAccountActions accountId={accountId} name="Archived Savings" canRestore />);
  await user.click(screen.getByRole("button", { name: "Delete Archived Savings" }));
  const dialog = screen.getByRole("dialog", { name: "Permanently delete account" });
  const remove = within(dialog).getByRole("button", { name: "Permanently delete" });
  expect(remove).toBeDisabled();
  await user.type(within(dialog).getByLabelText("Account name confirmation"), "Wrong name");
  expect(remove).toBeDisabled();
  await user.clear(within(dialog).getByLabelText("Account name confirmation"));
  await user.type(within(dialog).getByLabelText("Account name confirmation"), "Archived Savings");
  await user.click(remove);
  expect(mocks.deleteAccount).toHaveBeenCalledOnce();
  expect(mocks.deleteAccount.mock.calls[0][0].get("accountId")).toBe(accountId);
  expect(mocks.deleteAccount.mock.calls[0][0].get("confirmationName")).toBe("Archived Savings");
});