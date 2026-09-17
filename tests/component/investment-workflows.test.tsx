import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InstrumentsPage from "@/app/(app)/instruments/page";
import { AccountConversionForm } from "@/components/forms/account-conversion-form";
import { InvestmentCommandForm } from "@/components/forms/investment-command-form";
import { PrivacyProvider } from "@/components/privacy-provider";
import type { InvestmentInstrument } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  instruments: vi.fn(),
  deleteInstrument: vi.fn(),
  archiveInstrument: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ userId: "instrument-owner" }),
}));
vi.mock("@/lib/services/investments", () => ({
  listInvestmentInstruments: mocks.instruments,
}));
vi.mock("@/app/(app)/actions", () => ({
  deleteInvestmentInstrumentAction: mocks.deleteInstrument,
  archiveInvestmentInstrumentAction: mocks.archiveInstrument,
}));

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

describe("instrument directory deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.instruments.mockReturnValue([instrument]);
    mocks.deleteInstrument.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([null, "2026-09-01T12:00:00.000Z"])(
    "requires confirmation before deleting an instrument (archived: %s)",
    async (archivedAt) => {
      mocks.instruments.mockReturnValue([{ ...instrument, archivedAt }]);
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(await InstrumentsPage());
      const remove = screen.getByRole("button", { name: "Delete Example ETF" });
      await user.click(remove);
      expect(confirm).toHaveBeenCalledWith(
        "Permanently delete Example ETF and all its saved prices? This cannot be undone. Instruments linked to account history cannot be deleted.",
      );
      expect(mocks.deleteInstrument).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      await user.click(remove);
      await waitFor(() =>
        expect(mocks.deleteInstrument).toHaveBeenCalledWith(instrument.id),
      );
    },
  );

  it("keeps linked instruments visible and reports a rejected deletion", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteInstrument.mockResolvedValue({
      message: "This instrument is still linked to account history.",
    });
    render(await InstrumentsPage());
    await user.click(
      screen.getByRole("button", { name: "Delete Example ETF" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "still linked to account history",
    );
    expect(screen.getByText("Example ETF")).toBeVisible();
  });
});

describe("advanced investment workflows", () => {
  afterEach(cleanup);

  it("shows fields for each atomic investment command", async () => {
    const user = userEvent.setup();
    render(
      <InvestmentCommandForm
        action={vi.fn().mockResolvedValue({})}
        accountId="44444444-4444-4444-8444-444444444444"
        accountCurrency="USD"
        positionAccounts={[
          { id: "44444444-4444-4444-8444-444444444444", name: "Source" },
          {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Destination",
          },
        ]}
        instruments={[
          instrument,
          {
            ...instrument,
            id: "66666666-6666-4666-8666-666666666666",
            externalId: "instrument:result",
            name: "Result Equity",
            symbol: "RSLT",
            identifier: "RSLT",
          },
        ]}
        currencies={["USD", "KES"]}
        today="2026-01-01"
      />,
    );

    expect(screen.getByLabelText(/Dividend amount/)).toBeVisible();
    expect(screen.getByLabelText("Purchased quantity")).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Action"),
      "in_kind_transfer",
    );
    expect(screen.getByLabelText("Destination account")).toBeVisible();
    expect(screen.getByLabelText("Transferred quantity")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Action"), "split");
    expect(screen.getByLabelText("New or resulting shares")).toBeVisible();
    expect(screen.getByLabelText("Existing or source shares")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Action"), "spinoff");
    expect(screen.getByLabelText("Spin-off instrument")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Action"), "merger");
    expect(screen.getByLabelText("Resulting instrument")).toBeVisible();
  });

  it("previews conversion and gates a confirmed discrepancy", async () => {
    const user = userEvent.setup();
    const previewAction = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        currency: "USD",
        conversionDate: "2026-01-01T12:00:00.000Z",
        sourceBalanceMinor: "100000",
        openingCashMinor: "10000",
        positionsMinor: "89900",
        projectedTotalMinor: "99900",
        differenceMinor: "-100",
        holdings: [
          {
            instrumentId: instrument.id,
            name: instrument.name,
            symbol: instrument.symbol,
            quantity: "3",
            price: "299.666666",
            quoteCurrency: "USD",
          },
        ],
      },
    });
    const convertAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <PrivacyProvider>
        <AccountConversionForm
          previewAction={previewAction}
          convertAction={convertAction}
          sourceAccount={{
            id: "44444444-4444-4444-8444-444444444444",
            name: "Legacy Investment",
            currency: "USD",
            currentValueMinor: 100000,
          }}
          instruments={[instrument]}
          today="2026-01-01"
        />
      </PrivacyProvider>,
    );

    await user.type(screen.getByLabelText("Quantity"), "3");
    await user.type(screen.getByLabelText("Unit price"), "299.666666");
    await user.click(
      screen.getByRole("button", { name: "Preview conversion" }),
    );
    await waitFor(() => expect(previewAction).toHaveBeenCalledTimes(1));
    const previewBody = previewAction.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(previewBody.get("holdingsJson")))).toEqual([
      expect.objectContaining({
        instrumentId: instrument.id,
        quantity: "3",
        price: "299.666666",
      }),
    ]);
    expect(
      await screen.findByText(/replacement differs from the source balance/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Convert account" }),
    ).toBeDisabled();
    await user.click(
      screen.getByLabelText("I reviewed and accept this conversion difference"),
    );
    expect(
      screen.getByRole("button", { name: "Convert account" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Convert account" }));
    await waitFor(() => expect(convertAction).toHaveBeenCalledTimes(1));
    const commitBody = convertAction.mock.calls[0][0] as FormData;
    expect(commitBody.get("confirmDifference")).toBe("on");
  });
});
