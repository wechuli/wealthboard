import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountForm } from "@/components/forms/account-form";
import { PositionEventForm } from "@/components/forms/investment-forms";
import type { Category, InvestmentInstrument } from "@/db/schema";

const category: Category = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  name: "Securities",
  slug: "securities",
  icon: "Chart",
  displayOrder: 0,
  assetOrLiability: "asset",
  description: null,
  isLiquid: false,
  isInvestible: true,
  isArchived: false,
  isSystem: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const instrument: InvestmentInstrument = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  externalId: "instrument:example",
  name: "Example ETF",
  symbol: "EXMP",
  identifierType: "ticker_exchange",
  identifier: "EXMP",
  exchangeMic: "XNAS",
  assetType: "etf",
  quoteCurrency: "USD",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("investment forms", () => {
  afterEach(cleanup);

  it("switches account setup from total value to opening cash", async () => {
    const user = userEvent.setup();
    render(
      <AccountForm
        categories={[category]}
        action={vi.fn().mockResolvedValue({})}
        idempotencyKey="33333333-3333-4333-8333-333333333333"
        today="2026-01-01"
        currencies={["USD"]}
        baseCurrency="USD"
        institutions={[]}
      />,
    );
    expect(screen.getByLabelText("Opening value")).toBeVisible();
    expect(screen.getByLabelText("Cost basis")).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Tracking method"),
      "positions",
    );
    expect(screen.getByLabelText("Opening cash")).toBeVisible();
    expect(screen.queryByLabelText("Cost basis")).not.toBeInTheDocument();
    expect(screen.getByText(/Track brokerage cash/)).toBeVisible();
  });

  it("shows execution and settlement controls only for trades", async () => {
    const user = userEvent.setup();
    render(
      <PositionEventForm
        action={vi.fn().mockResolvedValue({})}
        accountId="44444444-4444-4444-8444-444444444444"
        accountCurrency="USD"
        instruments={[instrument]}
        currencies={["USD", "KES"]}
        today="2026-01-01"
      />,
    );
    expect(
      screen.queryByLabelText("Execution price per unit"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Reference opening cost basis/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Activity"), "buy");
    expect(screen.getByLabelText("Execution price per unit")).toBeVisible();
    expect(screen.getByLabelText("Trade currency")).toBeVisible();
    expect(screen.getByLabelText(/Actual settlement amount/)).toBeVisible();
    expect(
      screen.queryByLabelText("Applied settlement rate"),
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Trade currency"), "KES");
    expect(screen.getByLabelText("Applied settlement rate")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Trade currency"), "USD");
    expect(
      screen.queryByLabelText("Applied settlement rate"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Reference opening cost basis/),
    ).not.toBeInTheDocument();
  });
});
