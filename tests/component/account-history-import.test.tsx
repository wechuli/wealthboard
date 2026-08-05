import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountHistoryImport } from "@/components/account-history-import";
import { PrivacyProvider, PrivacyToggle } from "@/components/privacy-provider";

const account = {
  id: "account-1",
  name: "Prepared Savings",
  institution: "Example Bank",
  currency: "USD",
};
const row = {
  row: 1,
  externalId: "stable-1",
  status: "ready",
  code: "ready",
  message: "Ready to import.",
  transactionId: null,
  type: "deposit",
  amount: "10.00",
  date: "2025-01-01",
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("account history import workflow", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("previews, confirms, respects privacy, and exposes reports accessibly", async () => {
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
          account,
          dateRange: { from: "2025-01-01", to: "2025-01-01" },
          currentBalanceMinor: 10_000,
          projectedBalanceMinor: 11_000,
          netChangeMinor: 1_000,
          summary: { ready: 1, skippedDuplicates: 0, failed: 0 },
          rows: [row],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          account,
          finalBalanceMinor: 11_000,
          summary: { imported: 1, skippedDuplicates: 0, failed: 0 },
          rows: [
            {
              ...row,
              status: "imported",
              code: "imported",
              message: "Transaction imported.",
              transactionId: "transaction-1",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <AccountHistoryImport accountId="account-1" />
      </PrivacyProvider>,
    );

    const file = new File(
      [
        "external_id,type,amount,date,description,notes\nstable-1,deposit,10.00,2025-01-01,,",
      ],
      "history.csv",
      { type: "text/csv" },
    );
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
    });
    await user.upload(screen.getByLabelText("CSV or JSON file"), file);
    await user.click(screen.getByRole("button", { name: "Preview file" }));

    expect(
      await screen.findByText("Prepared Savings · Example Bank · USD"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeEnabled();
    expect(screen.getByRole("table")).toHaveTextContent("stable-1");

    await user.click(
      screen.getByRole("button", { name: "Hide financial values" }),
    );
    expect(screen.getAllByText("••••••")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(
      await screen.findByText("1 imported, 0 duplicates skipped, 0 failed."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Download CSV report" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Download JSON report" }),
    ).toBeEnabled();

    const commitBody = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(commitBody.get("hash")).toBe(hash);
  });

  it("rejects a preview whose server hash does not match the selected file", async () => {
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
          hash: "ff".repeat(32),
          account,
          dateRange: null,
          currentBalanceMinor: 0,
          projectedBalanceMinor: 0,
          netChangeMinor: 0,
          summary: { ready: 0, skippedDuplicates: 0, failed: 0 },
          rows: [],
        }),
      ),
    );

    render(
      <PrivacyProvider>
        <AccountHistoryImport accountId="account-1" />
      </PrivacyProvider>,
    );
    const file = new File(["history"], "history.csv", { type: "text/csv" });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
    });
    await user.upload(screen.getByLabelText("CSV or JSON file"), file);
    await user.click(screen.getByRole("button", { name: "Preview file" }));

    expect(
      await screen.findByText("The uploaded file hash did not match."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Confirm import" }),
    ).not.toBeInTheDocument();
  });
});
