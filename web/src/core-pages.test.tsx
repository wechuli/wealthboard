import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TransactionsPage } from "./core-pages";
import { PrivacyBoundary } from "./privacy";

vi.mock("./api", () => ({
  getTransactions: vi.fn().mockResolvedValue({
    items: [{ id: "tx-1", accountId: "account-1", accountName: "Daily account", type: "interest", amountMinor: "4250", currency: "KES", transactionDate: "2026-09-20", description: "Monthly interest" }],
    limit: 100,
    offset: 0,
    hasMore: false,
  }),
}));

describe("TransactionsPage", () => {
  it("renders a transaction read response", async () => {
    render(<MemoryRouter><PrivacyBoundary hidden={false}><TransactionsPage /></PrivacyBoundary></MemoryRouter>);

    expect(await screen.findByText("Interest")).toBeInTheDocument();
    expect(screen.getByText(/Daily account/)).toBeInTheDocument();
    expect(screen.getByText("KES 42.50")).toBeInTheDocument();
  });
});