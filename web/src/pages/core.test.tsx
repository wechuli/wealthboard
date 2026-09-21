import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountDetailPage,
  AccountsPage,
  DashboardPage,
  NewSecurityPricePage,
  TransactionsPage,
  coreRouteIntents,
} from "@/pages/core";
import { PrivacyBoundary } from "@/components/privacy";

const {
  getAccount,
  getAccountAnalytics,
  getAccountActivity,
  getAccountPositionEvents,
  getAccountValuations,
  getAccounts,
  getDashboard,
  getGoalAlerts,
  getGoals,
  getInstruments,
  getSettings,
  getTransactions,
} = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getAccountAnalytics: vi.fn(),
  getAccountActivity: vi.fn(),
  getAccountPositionEvents: vi.fn(),
  getAccountValuations: vi.fn(),
  getAccounts: vi.fn(),
  getDashboard: vi.fn(),
  getGoalAlerts: vi.fn(),
  getGoals: vi.fn(),
  getInstruments: vi.fn(),
  getSettings: vi.fn(),
  getTransactions: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  archiveAccount: vi.fn(),
  deleteAccount: vi.fn(),
  deleteTransaction: vi.fn(),
  deleteValuation: vi.fn(),
  getAccount,
  getAccountAnalytics,
  getAccountActivity,
  getAccountPositionEvents,
  getAccountPositionReconciliations: vi.fn(),
  getAccountTransactions: vi.fn(),
  getAccountValuations,
  getCategories: vi.fn(),
  getInstitutions: vi.fn(),
  getInstruments,
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
  convertedValueMinor: "125000",
  monthlyChangeMinor: "5000",
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
      contributions: "125000",
      withdrawals: "0",
      income: "4250",
      fees: "0",
      capitalGrowth: "0",
    },
    accountCount: 1,
    goalCount: 0,
    currentComplete: true,
    missingCurrencies: [],
    historicalAvailable: true,
    historicalComplete: true,
    periodChanges: {
      oneMonth: "5000",
      threeMonths: "5000",
      oneYear: "5000",
      allTime: "5000",
    },
    valueBasis: "effective_dated_replay",
    history: [
      {
        date: "2026-08-20T23:59:59Z",
        assetsMinor: "120000",
        liabilitiesMinor: "0",
        netWorthMinor: "120000",
        liquidMinor: "120000",
        investibleMinor: "0",
        complete: true,
        missingCurrencies: [],
      },
      {
        date: "2026-09-20T23:59:59Z",
        assetsMinor: "125000",
        liabilitiesMinor: "0",
        netWorthMinor: "125000",
        liquidMinor: "125000",
        investibleMinor: "0",
        complete: true,
        missingCurrencies: [],
      },
    ],
    allocation: [{ name: "Cash", valueMinor: "125000", sharePercent: "100" }],
    investibleAllocation: [],
    institutionAllocation: [],
    currencyAllocation: [],
    instrumentAllocation: [],
    compositionComplete: true,
    completenessReasons: [],
  });
  getAccount.mockResolvedValue(account);
  getAccountAnalytics.mockResolvedValue({
    accountId: account.id,
    currency: "KES",
    metrics: {
      contributionsMinor: "125000",
      withdrawalsMinor: "0",
      incomeMinor: "4250",
      feesMinor: "0",
      capitalGrowthMinor: "0",
      estimatedGainMinor: "4250",
    },
    positionSummary: null,
    history: [
      { date: "2026-08-20", valueMinor: "120000", complete: true },
      { date: "2026-09-20", valueMinor: "125000", complete: true },
    ],
    historyComplete: true,
    movementAttributionAvailable: false,
    completenessReasons: [],
  });
  getAccountActivity.mockResolvedValue({ items: [] });
  getAccountValuations.mockResolvedValue({ items: [] });
});

afterEach(cleanup);

describe("ported core pages", () => {
  it("preserves the prominent dashboard hierarchy", async () => {
    renderPage(<DashboardPage />);

    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Total net worth")).toBeInTheDocument();
    expect(screen.getByText("Net-worth history")).toBeInTheDocument();
    expect(screen.getByText("Asset allocation")).toBeInTheDocument();
    expect(screen.getByText("Assets versus liabilities")).toBeInTheDocument();
    expect(screen.getByText("Contributions versus growth")).toBeInTheDocument();
    expect(screen.getByText("Goal progress")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByLabelText("Allocation legend")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1Y" })).toHaveAttribute(
      "href",
      "/?range=1y",
    );
    expect(screen.getByRole("link", { name: /Quick add/ })).toHaveAttribute(
      "href",
      "/transactions/new",
    );
    expect(
      screen.getByRole("group", { name: "1 month net worth change" }),
    ).toHaveTextContent("KES 50.00");
    for (const label of ["1 month", "3 months", "1 year", "All time"]) {
      expect(
        screen.getByRole("group", { name: `${label} net worth change` }),
      ).not.toHaveTextContent("Incomplete data");
    }
    expect(
      screen.getByRole("group", { name: "Contributions metric" }),
    ).toHaveTextContent("KES 1,250.00");
    expect(
      screen.getByRole("group", { name: "Income & gains metric" }),
    ).toHaveTextContent("KES 42.50");
    expect(
      screen.getByRole("group", { name: "Withdrawals metric" }),
    ).toHaveTextContent("KES 0.00");
    expect(
      screen.getByRole("group", { name: "Fees metric" }),
    ).toHaveTextContent("KES 0.00");
    expect(screen.queryByText(/current API/i)).not.toBeInTheDocument();
  });

  it("preserves account filters and both source views", async () => {
    const user = userEvent.setup();
    renderPage(<AccountsPage />);

    expect(
      await screen.findByRole("heading", { name: "Accounts & assets" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add account/ })).toHaveAttribute(
      "href",
      "/accounts/new",
    );
    expect(await screen.findByLabelText("Search accounts")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Filter by tracking method"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by price state")).toHaveValue("all");
    expect(screen.getByLabelText("Sort accounts")).toHaveValue("value");
    expect(
      screen.getByRole("option", { name: "Complete prices" }),
    ).toBeEnabled();
    expect(screen.getByRole("option", { name: "Recent change" })).toBeEnabled();
    expect(screen.getByText("Daily account")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Daily account/ }),
    ).toHaveTextContent("KES 50.00");
    expect(
      screen.getByRole("link", { name: /Daily account/ }),
    ).not.toHaveTextContent("Incomplete data");

    await user.click(screen.getByRole("button", { name: "Table view" }));
    expect(
      screen.getByRole("columnheader", { name: "30-day change" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: /Daily account/ }),
    ).toHaveTextContent("KES 50.00");
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("preserves transaction filters, export, create, and row actions", async () => {
    renderPage(
      <TransactionsPage
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
    expect(
      screen.getByLabelText("Filter by amount direction"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Monthly interest", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Edit transaction" }),
    ).toHaveAttribute("href", "/transactions/transaction-1/edit");
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
            <AccountDetailPage
              session={{ csrfToken: "csrf", username: "owner" } as never}
            />
          }
        />
      </Routes>,
      ["/accounts/account-1"],
    );

    expect(
      await screen.findByRole("heading", { name: "Daily account" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Estate plan/ })).toHaveAttribute(
      "href",
      "/estate/distribution?account=account-1#asset-account-1",
    );
    expect(screen.getByRole("link", { name: "Fee" })).toHaveAttribute(
      "href",
      "/transactions/new?accountId=account-1&type=fee",
    );
    expect(
      screen.getByRole("link", { name: /Emergency fund/ }),
    ).toHaveAttribute("href", "/goals/goal-1");
    expect(
      screen.getByRole("group", { name: "Contributions metric" }),
    ).toHaveTextContent("KES 1,250.00");
    expect(
      screen.getByRole("group", { name: "Income metric" }),
    ).toHaveTextContent("KES 42.50");
    expect(
      screen.getByRole("group", { name: "Valuation change metric" }),
    ).toHaveTextContent("KES 42.50");
    expect(
      screen.queryByText(/workflow controls|current API/i),
    ).not.toBeInTheDocument();
  });

  it("renders position movement attribution when the owner-scoped read provides it", async () => {
    getAccount.mockResolvedValue({ ...account, trackingMode: "positions" });
    getAccountAnalytics.mockResolvedValue({
      accountId: account.id,
      currency: "KES",
      metrics: {
        contributionsMinor: "100000",
        withdrawalsMinor: "0",
        incomeMinor: "0",
        feesMinor: "0",
        capitalGrowthMinor: "0",
        estimatedGainMinor: "25000",
      },
      positionSummary: {
        cashMinor: "25000",
        positionsMinor: "100000",
        complete: true,
      },
      history: [],
      historyComplete: true,
      movementAttributionAvailable: true,
      completenessReasons: [],
      movementAttribution: {
        from: "2026-08-20T00:00:00Z",
        to: "2026-09-20T00:00:00Z",
        startValueMinor: "100000",
        endValueMinor: "125000",
        changeMinor: "25000",
        externalCashMinor: "0",
        incomeMinor: "0",
        feesMinor: "0",
        cashAdjustmentsMinor: "0",
        internalTradeCashMinor: "0",
        quantityMovementMinor: "0",
        priceMovementMinor: "25000",
        currencyMovementMinor: "0",
        unattributedMinor: "0",
        complete: true,
        methodology: "position_bridge_v1",
        returnStatus: "unavailable",
        returnMessage:
          "Annualized return is unavailable until cash-flow-aware TWR methodology is implemented.",
      },
    });
    renderPage(
      <Routes>
        <Route
          path="/accounts/:id"
          element={
            <AccountDetailPage session={{ csrfToken: "csrf" } as never} />
          }
        />
      </Routes>,
      ["/accounts/account-1"],
    );

    expect(await screen.findByText("Movement attribution")).toBeInTheDocument();
    expect(screen.getByText("Price movement")).toBeInTheDocument();
    expect(screen.getByText(/cash-flow-aware TWR/)).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Cash metric" }),
    ).toHaveTextContent("KES 250.00");
    expect(
      screen.getByRole("group", { name: "Positions metric" }),
    ).toHaveTextContent("KES 1,000.00");
  });

  it("defaults price entry to the first instrument held by the account", async () => {
    getAccount.mockResolvedValue({ ...account, trackingMode: "positions" });
    getInstruments.mockResolvedValue({
      instruments: [
        {
          id: "instrument-1",
          name: "Example World ETF",
          symbol: "EWLD",
          quoteCurrency: "KES",
        },
      ],
    });
    getAccountPositionEvents.mockResolvedValue({
      items: [{ instrumentId: "instrument-1" }],
      limit: 100,
      offset: 0,
      hasMore: false,
    });

    renderPage(
      <Routes>
        <Route
          path="/accounts/:id/prices/new"
          element={
            <NewSecurityPricePage session={{ csrfToken: "csrf" } as never} />
          }
        />
      </Routes>,
      ["/accounts/account-1/prices/new"],
    );

    expect(
      await screen.findByRole("heading", { name: "Update security price" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Price \(/)).toBeInTheDocument();
  });

  it("keeps every original page as a separate route intent", () => {
    expect(coreRouteIntents).toHaveLength(18);
    expect(coreRouteIntents).toEqual(
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
