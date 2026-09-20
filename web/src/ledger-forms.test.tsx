import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountConversionForm,
  PositionTools,
  TransactionForm,
} from "./ledger-forms";
import { PrivacyBoundary } from "./privacy";
import type {
  Account,
  Instrument,
  PositionEvent,
  PositionReconciliation,
  Session,
} from "./types";

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
const positionAccount = { ...account, trackingMode: "positions" } as Account;
const positionEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  accountId: account.id,
  instrumentId: instrument.id,
  type: "buy",
  quantity: "10",
  unitPrice: "125.50",
  tradeCurrency: "KES",
  feeAmountMinor: "250",
  feeCurrency: "KES",
  cashEffectMinor: "-125750",
  tradeDate: "2026-09-19",
  eventSequence: 1,
  createdAt: "2026-09-19T12:00:00Z",
  updatedAt: "2026-09-19T12:00:00Z",
} as PositionEvent;
const reconciliation = {
  id: "44444444-4444-4444-8444-444444444444",
  accountId: account.id,
  observationDate: "2026-09-20",
  reportedCashMinor: "2500",
  reportedTotalMinor: "125000",
  notes: "Broker statement",
  createdAt: "2026-09-20T12:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
} as PositionReconciliation;

afterEach(cleanup);

describe("AccountConversionForm", () => {
  it("requires preview and explicit difference confirmation before execute", async () => {
    const user = userEvent.setup();
    const preview = vi.fn().mockResolvedValue({
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
    const execute = vi.fn().mockResolvedValue({
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

describe("PositionTools", () => {
  it("loads a persisted event for editing after reload", async () => {
    const user = userEvent.setup();
    const updateEvent = vi.fn().mockResolvedValue({ id: positionEvent.id });
    const onChanged = vi.fn();
    render(
      <PositionTools
        account={positionAccount}
        instruments={[instrument]}
        events={[positionEvent]}
        reconciliations={[reconciliation]}
        session={session}
        onChanged={onChanged}
        operations={{
          createEvent: vi.fn(),
          updateEvent,
          deleteEvent: vi.fn(),
          createReconciliation: vi.fn(),
          deleteReconciliation: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText("Broker statement")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Quantity")).toHaveValue("10");
    expect(screen.getByLabelText("Fee amount")).toHaveValue("2.50");
    expect(screen.getByLabelText("Cash effect")).toHaveValue("1257.50");
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "12");
    await user.click(
      screen.getByRole("button", { name: "Update position event" }),
    );

    expect(updateEvent).toHaveBeenCalledWith(
      positionEvent.id,
      expect.objectContaining({ quantity: "12", accountId: account.id }),
      "csrf",
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("deletes a persisted reconciliation and masks private values", async () => {
    const user = userEvent.setup();
    const deleteReconciliation = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <PrivacyBoundary hidden>
        <PositionTools
          account={positionAccount}
          instruments={[instrument]}
          events={[positionEvent]}
          reconciliations={[reconciliation]}
          session={session}
          onChanged={vi.fn()}
          operations={{
            createEvent: vi.fn(),
            updateEvent: vi.fn(),
            deleteEvent: vi.fn(),
            createReconciliation: vi.fn(),
            deleteReconciliation,
          }}
        />
      </PrivacyBoundary>,
    );

    expect(screen.queryByText("10 units")).not.toBeInTheDocument();
    expect(screen.queryByText("KES 1,250.00")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Delete reconciliation from 2026-09-20",
      }),
    );
    expect(deleteReconciliation).toHaveBeenCalledWith(
      reconciliation.id,
      "csrf",
    );
  });
});
