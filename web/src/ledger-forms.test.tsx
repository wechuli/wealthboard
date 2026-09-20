import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountConversionForm, TransactionForm } from "./ledger-forms";
import type { Account, Instrument, Session } from "./types";

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Brokerage",
  currency: "KES",
  currentValueMinor: "100000",
  trackingMode: "balance",
} as Account;
const instrument = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Index Fund",
  symbol: "IDX",
  quoteCurrency: "KES",
} as Instrument;
const session = { csrfToken: "csrf" } as Session;

afterEach(cleanup);

describe("AccountConversionForm", () => {
  it("requires preview and explicit difference confirmation before execute", async () => {
    const user = userEvent.setup();
    const preview = vi
      .fn()
      .mockResolvedValue({
        sourceAccountId: account.id,
        sourceAccountName: account.name,
        currency: "KES",
        conversionDate: "2026-09-20",
        sourceBalanceMinor: "100000",
        openingCashMinor: "0",
        positionsMinor: "90000",
        projectedTotalMinor: "90000",
        differenceMinor: "-10000",
        holdings: [],
      });
    const execute = vi
      .fn()
      .mockResolvedValue({
        targetAccountId: "33333333-3333-4333-8333-333333333333",
        replayed: false,
      });
    const onConverted = vi.fn();
    render(
      <AccountConversionForm
        account={account}
        instruments={[instrument]}
        session={session}
        onConverted={onConverted}
        operations={{ preview, execute }}
      />,
    );

    const convert = screen.getByRole("button", { name: "Convert account" });
    expect(convert).toBeDisabled();
    await user.type(screen.getByLabelText("Quantity"), "10");
    await user.type(screen.getByLabelText("Unit price"), "90");
    await user.click(
      screen.getByRole("button", { name: "Preview conversion" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("difference");
    expect(convert).toBeDisabled();
    await user.click(
      screen.getByLabelText("I reviewed and accept this conversion difference"),
    );
    expect(convert).toBeEnabled();
    await user.click(convert);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ confirmDifference: true }),
      "csrf",
    );
    expect(onConverted).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("exposes labelled controls and full-width commands for mobile interaction", () => {
    render(
      <AccountConversionForm
        account={account}
        instruments={[instrument]}
        session={session}
        onConverted={vi.fn()}
        operations={{ preview: vi.fn(), execute: vi.fn() }}
      />,
    );
    expect(screen.getByLabelText("Replacement account name")).toBeVisible();
    expect(screen.getByLabelText("Conversion date")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview conversion" }),
    ).toBeVisible();
  });
});

describe("TransactionForm", () => {
  it("keeps its idempotency key stable when a create is retried", async () => {
    const user = userEvent.setup();
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("Try again."))
      .mockResolvedValueOnce({ id: "tx" });
    render(
      <TransactionForm
        account={account}
        session={session}
        onChanged={vi.fn()}
        operations={{ create, update: vi.fn() }}
      />,
    );
    await user.type(screen.getByLabelText("Amount (KES)"), "25.00");
    await user.click(
      screen.getByRole("button", { name: "Record transaction" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again.");
    await user.click(
      screen.getByRole("button", { name: "Record transaction" }),
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].idempotencyKey).toBe(
      create.mock.calls[1][0].idempotencyKey,
    );
  });
});
