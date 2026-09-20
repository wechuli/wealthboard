import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PortedAccountDetailPage,
  PortedAccountsPage,
  PortedDashboardPage,
  PortedTransactionsPage,
  portedCoreRouteIntents,
} from "./ported-core-pages";
import { PrivacyBoundary } from "./privacy";

const {
  getAccount,
  getAccountActivity,
  getAccountValuations,
  getAccounts,
  getDashboard,
  getGoalAlerts,
  getGoals,
  getSettings,
  getTransactions,
} = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getAccountActivity: vi.fn(),
  getAccountValuations: vi.fn(),
  getAccounts: vi.fn(),
  getDashboard: vi.fn(),
  getGoalAlerts: vi.fn(),
  getGoals: vi.fn(),
  getSettings: vi.fn(),
  getTransactions: vi.fn(),
}));

vi.mock("./api", () => ({
  archiveAccount: vi.fn(),
  deleteAccount: vi.fn(),
  deleteTransaction: vi.fn(),
  deleteValuation: vi.fn(),
  getAccount,
  getAccountActivity,
  getAccountPositionEvents: vi.fn(),
  getAccountPositionReconciliations: vi.fn(),
  getAccountTransactions: vi.fn(),
  getAccountValuations,
  getCategories: vi.fn(),
  getInstitutions: vi.fn(),
  getInstruments: vi.fn(),
  getAccounts,
  getDashboard,
  getGoalAlerts,
  getGoals,
  getSettings,
  getTransactions,
}));

const account = {
  id: "account-1",
  categoryId: "category-1",
  name: "Daily account",
  currency: "KES",
  trackingMode: "balance",
  currentValueMinor: "125000",
  isLiability: false,
  isIncludedInNetWorth: true,
  categoryName: "Cash",
  institutionName: "Example Bank",
};

const transaction = {
  id: "transaction-1",
  accountId: account.id,
  accountName: account.name,
  type: "interest",
  amountMinor: "4250",
  currency: "KES",
  transactionDate: "2026-09-20",
  description: "Monthly interest",
};

function renderPage(node: React.ReactNode, initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <PrivacyBoundary hidden={false}>{node}</PrivacyBoundary>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccounts.mockResolvedValue({ items: [account] });
  getTransactions.mockResolvedValue({
    items: [transaction],
    limit: 100,
    offset: 0,
    hasMore: false,
  });
  getGoals.mockResolvedValue([]);
  getGoalAlerts.mockResolvedValue([]);
  getSettings.mockResolvedValue({
    settings: { baseCurrency: "KES" },
  });
  getDashboard.mockResolvedValue({
    asOf: "2026-09-20",
    baseCurrency: "KES",
    totals: {
      assets: "125000",
      liabilities: "0",
      netWorth: "125000",
      liquid: "125000",
      investible: "0",
    },
    accountCount: 1,
    goalCount: 0,
    currentComplete: true,
    missingCurrencies: [],
    historicalAvailable: false,
    historicalComplete: false,
    valueBasis: "current",
  });
  getAccount.mockResolvedValue(account);
  getAccountActivity.mockResolvedValue({ items: [] });
  getAccountValuations.mockResolvedValue({ items: [] });
});

afterEach(cleanup);

describe("ported core pages", () => {
  it("preserves the prominent dashboard hierarchy", async () => {
    renderPage(<PortedDashboardPage />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Total net worth")).toBeInTheDocument();
    expect(screen.getByText("Net-worth history")).toBeInTheDocument();
    expect(screen.getByText("Asset allocation")).toBeInTheDocument();
    expect(screen.getByText("Assets versus liabilities")).toBeInTheDocument();
    expect(screen.getByText("Contributions versus growth")).toBeInTheDocument();
    expect(screen.getByText("Goal progress")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1Y" })).toHaveAttribute(
      "href",
      "/?range=1y",
    );
    expect(screen.getByRole("link", { name: /Quick add/ })).toHaveAttribute(
      "href",
      "/transactions/new",
    );
    expect(screen.queryByText(/current API/i)).not.toBeInTheDocument();
  });

  it("preserves account filters and both source views", async () => {
    const user = userEvent.setup();
    renderPage(<PortedAccountsPage />);

    expect(
      await screen.findByRole("heading", { name: "Accounts & assets" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add account/ })).toHaveAttribute(
      "href",
      "/accounts/new",
    );
    expect(await screen.findByLabelText("Search accounts")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by tracking method")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by price state")).toHaveValue("all");
    expect(screen.getByLabelText("Sort accounts")).toHaveValue("value");
    expect(screen.getByRole("option", { name: "Complete prices" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Recent change" })).toBeEnabled();
    expect(screen.getByText("Daily account")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Table view" }));
    expect(screen.getByRole("columnheader", { name: "30-day change" })).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("preserves transaction filters, export, create, and row actions", async () => {
    renderPage(
      <PortedTransactionsPage
        session={{ csrfToken: "csrf", username: "owner" } as never}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Transactions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export CSV/ })).toHaveAttribute(
      "href",
      "/api/export/transactions.csv?sort=newest",
    );
    expect(
      screen.getByRole("link", { name: /Record transaction/ }),
    ).toHaveAttribute("href", "/transactions/new");
    expect(
      await screen.findByLabelText("Search transactions"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by amount direction")).toBeInTheDocument();
    expect(screen.getByText("Monthly interest", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit transaction" })).toHaveAttribute(
      "href",
      "/transactions/transaction-1/edit",
    );
  });

  it("keeps account detail actions and linked-goal framing without internal controls", async () => {
    getGoals.mockResolvedValue([
      {
        id: "goal-1",
        name: "Emergency fund",
        linkedAccount: { id: account.id, name: account.name, currency: "KES" },
        progressPercent: "50",
      },
    ]);
    renderPage(
      <Routes>
        <Route
          path="/accounts/:id"
          element={
            <PortedAccountDetailPage
              session={{ csrfToken: "csrf", username: "owner" } as never}
            />
          }
        />
      </Routes>,
      ["/accounts/account-1"],
    );

    expect(await screen.findByRole("heading", { name: "Daily account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Estate plan/ })).toHaveAttribute(
      "href",
      "/estate/distribution?account=account-1#asset-account-1",
    );
    expect(screen.getByRole("link", { name: "Fee" })).toHaveAttribute(
      "href",
      "/transactions/new?accountId=account-1&type=fee",
    );
    expect(screen.getByRole("link", { name: /Emergency fund/ })).toHaveAttribute(
      "href",
      "/goals/goal-1",
    );
    expect(screen.queryByText(/workflow controls|current API/i)).not.toBeInTheDocument();
  });

  it("keeps every original page as a separate route intent", () => {
    expect(portedCoreRouteIntents).toHaveLength(18);
    expect(portedCoreRouteIntents).toEqual(
      expect.arrayContaining([
        "/",
        "/accounts",
        "/accounts/:id",
        "/accounts/:id/import",
        "/accounts/:id/investment-actions",
        "/accounts/:id/positions/:eventId/edit",
        "/transactions",
        "/transactions/:id/edit",
      ]),
    );
  });
});