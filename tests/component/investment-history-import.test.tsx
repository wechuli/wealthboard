import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvestmentHistoryImport } from "@/components/investment-history-import";
import { PrivacyProvider, PrivacyToggle } from "@/components/privacy-provider";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("investment history import workflow", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("previews exact totals, respects privacy, and commits with the same hash", async () => {
    const user = userEvent.setup();
    const hash = "00".repeat(32);
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          hash,
          account: { id: "account-1", name: "Brokerage", currency: "USD" },
          current: {
            cashMinor: 1_000,
            positionsMinor: 2_000,
            totalMinor: 3_000,
            complete: true,
          },
          projected: {
            cashMinor: 2_000,
            positionsMinor: 4_000,
            totalMinor: 6_000,
            complete: true,
            missingPrices: [],
            missingCurrencies: [],
          },
          summary: { records: 4, ready: 4, skippedDuplicates: 0, failed: 0 },
          canCommit: true,
          errors: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          account: { id: "account-1", name: "Brokerage", currency: "USD" },
          finalBalanceMinor: 6_000,
          summary: { imported: 4, skippedDuplicates: 0 },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <InvestmentHistoryImport accountId="account-1" />
      </PrivacyProvider>,
    );
    const file = new File(["{}"], "investment.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
    });
    await user.upload(screen.getByLabelText("CSV or JSON file"), file);
    await user.click(screen.getByRole("button", { name: "Preview file" }));

    expect(
      await screen.findByText("Brokerage · 4 source records"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm atomic import" }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Hide financial values" }),
    );
    expect(screen.getAllByText("••••••")).toHaveLength(4);
    await user.click(
      screen.getByRole("button", { name: "Confirm atomic import" }),
    );
    expect(
      await screen.findByText("4 records imported; 0 duplicates skipped."),
    ).toBeVisible();
    const body = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(body.get("hash")).toBe(hash);
  });

  it("shows all-or-nothing errors and disables commit", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          hash: "00".repeat(32),
          account: { id: "account-1", name: "Brokerage", currency: "USD" },
          current: {
            cashMinor: 0,
            positionsMinor: 0,
            totalMinor: 0,
            complete: true,
          },
          projected: {
            cashMinor: 0,
            positionsMinor: 0,
            totalMinor: 0,
            complete: false,
            missingPrices: ["instrument-1"],
            missingCurrencies: [],
          },
          summary: { records: 1, ready: 0, skippedDuplicates: 0, failed: 1 },
          canCommit: false,
          errors: [
            {
              collection: "position_events",
              row: 1,
              externalId: "event-1",
              message: "A position cannot have a negative quantity.",
            },
          ],
        }),
      ),
    );
    render(
      <PrivacyProvider>
        <InvestmentHistoryImport accountId="account-1" />
      </PrivacyProvider>,
    );
    const file = new File(["{}"], "investment.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
    });
    await user.upload(screen.getByLabelText("CSV or JSON file"), file);
    await user.click(screen.getByRole("button", { name: "Preview file" }));
    expect(
      await screen.findByText("A position cannot have a negative quantity."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm atomic import" }),
    ).toBeDisabled();
  });
});
