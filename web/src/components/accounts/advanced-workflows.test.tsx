import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportWorkspace } from "@/components/accounts/advanced-workflows";
import * as api from "@/api/client";
import type { Account } from "@/lib/types";

vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>();
  return { ...original, previewImport: vi.fn(), commitImport: vi.fn() };
});

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Brokerage",
  currency: "USD",
  trackingMode: "positions",
} as Account;
const session = { csrfToken: "csrf" } as never;
const preview = {
  hash: "a".repeat(64),
  account: { id: account.id, name: "Brokerage", currency: "USD" },
  dateRange: null,
  summary: { ready: 1, skippedDuplicates: 0, failed: 0 },
  rows: [
    {
      row: 2,
      externalId: "a",
      status: "ready",
      code: "ready",
      message: "",
      transactionId: null,
      type: "deposit",
      amount: "10.00",
      date: "2026-09-20",
    },
  ],
};

describe("ImportWorkspace", () => {
  afterEach(() => vi.clearAllMocks());

  it("previews and commits the exact selected account-history file", async () => {
    vi.mocked(api.previewImport).mockResolvedValue(preview);
    vi.mocked(api.commitImport).mockResolvedValue({
      ...preview,
      summary: { imported: 1, skippedDuplicates: 0, failed: 0 },
    });
    const changed = vi.fn();
    render(
      <ImportWorkspace
        account={account}
        session={session}
        onChanged={changed}
      />,
    );
    const file = new File(
      ["external_id,type,amount,date\na,deposit,10,2026-09-20"],
      "history.csv",
      { type: "text/csv" },
    );

    fireEvent.change(
      screen.getByLabelText("Import file", { selector: "#import-history" }),
      { target: { files: [file] } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);

    expect(await screen.findByText("Row 2 · Deposit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Commit import" }));

    await waitFor(() =>
      expect(api.commitImport).toHaveBeenCalledWith(
        account.id,
        "history",
        file,
        preview.hash,
        "csrf",
      ),
    );
    expect(changed).toHaveBeenCalledOnce();
  });
});
