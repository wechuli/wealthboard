import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InvestmentActivity,
  PositionsCard,
} from "@/components/accounts/position-account-details";
import { PrivacyBoundary } from "@/components/privacy";
import type {
  Account,
  AccountPositionSummary,
  ActivityItem,
} from "@/lib/types";

const { getAccountActivity } = vi.hoisted(() => ({
  getAccountActivity: vi.fn(),
}));
vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  getAccountActivity,
}));

const account: Account = {
  id: "11111111-1111-4111-8111-111111111111",
  categoryId: "22222222-2222-4222-8222-222222222222",
  name: "Fictional brokerage",
  currency: "USD",
  trackingMode: "positions",
  currentValueMinor: "11139",
  convertedValueMinor: "22278",
  monthlyChangeMinor: null,
  isLiability: false,
  isIncludedInNetWorth: true,
  categoryName: "Securities",
};
const instrumentId = "33333333-3333-4333-8333-333333333333";
const summary: AccountPositionSummary = {
  cashMinor: "10000",
  positionsMinor: "1139",
  complete: false,
  positions: [
    {
      instrumentId,
      instrumentName: "Fractional ETF",
      instrumentSymbol: "FUND",
      quoteCurrency: "USD",
      instrumentArchived: false,
      quantity: "1.125",
      unitPrice: "10.12345678",
      priceDate: "2026-09-20",
      priceSource: "Fictional quote",
      valueMinor: "1139",
      complete: true,
      stale: true,
    },
    {
      instrumentId: "44444444-4444-4444-8444-444444444444",
      instrumentName: "Unpriced holding",
      instrumentSymbol: "MISSING",
      quoteCurrency: "USD",
      instrumentArchived: false,
      quantity: "2",
      unitPrice: null,
      priceDate: null,
      priceSource: "",
      valueMinor: null,
      complete: false,
      stale: false,
    },
  ],
};
const cash: ActivityItem = {
  kind: "transaction",
  id: "55555555-5555-4555-8555-555555555555",
  accountId: account.id,
  accountName: account.name,
  type: "deposit",
  amountMinor: "2345",
  currency: "USD",
  date: "2026-09-20",
  description: "Fictional deposit",
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("position account detail", () => {
  it("shows individual quantities, exact prices, missing data, and holding controls", () => {
    render(
      <MemoryRouter>
        <PositionsCard account={account} summary={summary} />
      </MemoryRouter>,
    );
    const row = within(screen.getByRole("row", { name: /Fractional ETF/ }));
    expect(row.getByText("1.125")).toBeVisible();
    expect(row.getByText("USD 10.12345678")).toBeVisible();
    expect(row.getByText("USD 11.39")).toBeVisible();
    expect(row.getByText("Fictional quote")).toBeVisible();
    expect(row.getByText("Stale")).toBeVisible();
    expect(row.getByRole("link", { name: "Update Fractional ETF price" }))
      .toHaveAttribute("href", `/accounts/${account.id}/prices/new?instrumentId=${instrumentId}`);
    const missing = within(screen.getByRole("row", { name: /Unpriced holding/ }));
    expect(missing.getByText("Missing price")).toBeVisible();
    expect(missing.getByText("Incomplete")).toBeVisible();
    expect(screen.getByRole("link", { name: "Add holding" }))
      .toHaveAttribute("href", `/accounts/${account.id}/positions/new?type=opening_position`);
    expect(screen.getByRole("link", { name: "Add instrument" }))
      .toHaveAttribute("href", `/accounts/${account.id}/instruments/new`);
  });

  it("masks quantities, unit prices, and values while keeping instruments identifiable", () => {
    render(
      <MemoryRouter>
        <PrivacyBoundary hidden>
          <PositionsCard account={account} summary={summary} />
        </PrivacyBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("Fractional ETF")).toBeVisible();
    expect(screen.queryByText("1.125")).not.toBeInTheDocument();
    expect(screen.queryByText("USD 10.12345678")).not.toBeInTheDocument();
    expect(screen.queryByText("USD 11.39")).not.toBeInTheDocument();
  });

  it("keeps add controls available for an empty account", () => {
    render(
      <MemoryRouter>
        <PositionsCard
          account={account}
          summary={{ cashMinor: "0", positionsMinor: "0", complete: true, positions: [] }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No positions recorded/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Add holding" })).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a missing quote-to-account exchange rate without inventing a zero value", () => {
    render(
      <MemoryRouter>
        <PositionsCard
          account={account}
          summary={{
            ...summary,
            positions: [{ ...summary.positions[0], complete: false, valueMinor: null }],
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Exchange rate needed")).toBeVisible();
    expect(screen.queryByText("USD 0.00")).not.toBeInTheDocument();
  });

  it("paginates a unified cash, position, and price timeline and preserves managed events", async () => {
    const user = userEvent.setup();
    const items: ActivityItem[] = Array.from({ length: 25 }, (_, index) => ({
      ...cash,
      id: `deposit-${index}`,
      description: `Deposit ${index + 1}`,
    }));
    items[0] = {
      ...cash, kind: "position", id: "ordinary-event", type: "buy",
      instrumentId, instrumentName: "Fractional ETF", quantity: "1.125",
      amountMinor: "-1139",
    };
    items[1] = {
      ...cash, kind: "price", id: "price-1", type: "security_price",
      instrumentId, instrumentName: "Fractional ETF", unitPrice: "10.12345678",
      amountMinor: "0",
    };
    items[2] = {
      ...items[0], id: "grouped-event", eventGroupId: "group-1",
      description: "Grouped reinvestment",
    };
    getAccountActivity.mockImplementation((_id, { limit, offset }) =>
      Promise.resolve({
        items: offset === 0 ? items : [{ ...cash, type: "opening_balance", description: "Original opening" }],
        limit, offset, hasMore: offset === 0,
      }),
    );
    render(
      <MemoryRouter initialEntries={[`/accounts/${account.id}`]}>
        <InvestmentActivity accountId={account.id} />
      </MemoryRouter>,
    );
    const history = await screen.findByRole("list", { name: "Investment activity history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(25);
    expect(within(history).getByText("USD 10.12345678")).toBeVisible();
    expect(within(history).getByText("Managed workflow")).toBeVisible();
    expect(within(history).getAllByRole("link", { name: /Edit Buy/ })).toHaveLength(1);
    expect(within(history).getByRole("link", { name: /Edit Buy/ }))
      .toHaveAttribute("href", `/accounts/${account.id}/positions/ordinary-event/edit`);
    await user.click(screen.getByRole("link", { name: "Next" }));
    expect(await screen.findByText("Original opening")).toBeVisible();
    expect(screen.getByText("Page 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(getAccountActivity).toHaveBeenLastCalledWith(account.id, { limit: 25, offset: 25 });
    await user.click(screen.getByRole("link", { name: "Previous" }));
    expect(await screen.findByText("Page 1")).toBeVisible();
  });

  it("shows history load failures instead of an empty success state", async () => {
    getAccountActivity.mockRejectedValue(new Error("History is unavailable. Please retry."));
    render(
      <MemoryRouter><InvestmentActivity accountId={account.id} /></MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("History is unavailable.");
    expect(screen.queryByText("No investment activity on this page.")).not.toBeInTheDocument();
  });

  it("rejects invalid history pages before requesting financial data", async () => {
    render(
      <MemoryRouter initialEntries={[`/accounts/${account.id}?activityPage=-1`]}>
        <InvestmentActivity accountId={account.id} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Activity page must be between");
    expect(getAccountActivity).not.toHaveBeenCalled();
  });
});
