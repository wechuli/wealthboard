import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIDocumentImport } from "@/components/accounts/ai-document-import";
import { PrivacyProvider } from "@/components/providers/privacy-provider";
import type { Account, Session } from "@/lib/types";

const { convertAIDocument, extractAIDocument, getAI } = vi.hoisted(() => ({
  convertAIDocument: vi.fn(),
  extractAIDocument: vi.fn(),
  getAI: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  convertAIDocument,
  extractAIDocument,
  getAI,
}));

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Daily account",
  trackingMode: "balance",
  currency: "USD",
} as Account;
const session = { csrfToken: "csrf" } as Session;
const settings = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "fixture-model",
  hasStoredApiKey: true,
  maxOutputTokens: 2000,
  updatedAt: "2026-09-20T10:00:00Z",
};

function renderImport(onPrepared = vi.fn()) {
  render(
    <PrivacyProvider>
      <AIDocumentImport
        account={account}
        session={session}
        onPrepared={onPrepared}
      />
    </PrivacyProvider>,
  );
  return onPrepared;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
  getAI.mockResolvedValue({ settings });
  extractAIDocument.mockResolvedValue({
    source: {
      units: [
        {
          id: "source-1",
          location: "Page 1",
          text: "Private reference; Deposit 12.30",
        },
      ],
      warnings: ["One footer was omitted."],
    },
  });
  convertAIDocument.mockResolvedValue({
    content:
      '{"format":"wealthboard-account-history","version":1,"transactions":[]}',
    references: [
      { collection: "transactions", row: 1, sourceIds: ["source-1"] },
    ],
    exclusions: [{ sourceId: "source-2", reason: "Footer" }],
    issues: ["Verify the transaction date."],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AIDocumentImport", () => {
  it("clears PDF passwords and omits them from conversion", async () => {
    const user = userEvent.setup();
    renderImport();
    const file = new File(["encrypted"], "statement.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText("Source file"), file);
    await user.type(
      screen.getByLabelText("PDF password (if required)"),
      "fictional-password",
    );
    await user.click(screen.getByRole("button", { name: "Extract source" }));

    expect(extractAIDocument).toHaveBeenCalledWith(
      file,
      "fictional-password",
      "csrf",
    );
    expect(
      await screen.findByLabelText("Approved text for source-1"),
    ).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /I approve sending/ }));
    await user.click(
      screen.getByRole("button", { name: "Convert selected text" }),
    );
    const payload = convertAIDocument.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toMatch(/documentPassword|fictional-password/);
  });

  it("sends only redacted text after renewed explicit consent", async () => {
    const user = userEvent.setup();
    renderImport();
    await user.upload(
      screen.getByLabelText("Source file"),
      new File(["content"], "statement.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Extract source" }));
    const send = await screen.findByRole("button", {
      name: "Convert selected text",
    });
    expect(send).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I approve sending/ }));
    expect(send).toBeEnabled();
    const text = screen.getByLabelText("Approved text for source-1");
    await user.clear(text);
    await user.type(text, "Deposit 12.30");
    expect(send).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I approve sending/ }));
    await user.click(send);

    const payload = convertAIDocument.mock.calls[0][0];
    expect(payload.source.units[0].text).toBe("Deposit 12.30");
    expect(JSON.stringify(payload)).not.toContain("Private reference");
    expect(payload).toMatchObject({
      consent: true,
      trackingMode: "balance",
      currency: "USD",
    });
    expect(await screen.findByText("Verify the transaction date.")).toBeVisible();
    await user.click(screen.getByText("Evidence references and exclusions"));
    expect(screen.getByText(/transactions row 1/)).toBeVisible();
    expect(screen.getByText(/Excluded source-2/)).toBeVisible();
  });

  it("shows conversion errors and never auto-commits a prepared draft", async () => {
    const user = userEvent.setup();
    convertAIDocument.mockRejectedValueOnce(new Error("Provider unavailable."));
    const onPrepared = renderImport();
    await user.upload(
      screen.getByLabelText("Source file"),
      new File(["content"], "statement.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Extract source" }));
    await user.click(
      await screen.findByRole("checkbox", { name: /I approve sending/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Convert selected text" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider unavailable.",
    );
    expect(onPrepared).not.toHaveBeenCalled();

    convertAIDocument.mockResolvedValueOnce({
      content: "{}",
      references: [],
      exclusions: [],
      issues: [],
    });
    await user.click(screen.getByRole("checkbox", { name: /I approve sending/ }));
    await user.click(
      screen.getByRole("button", { name: "Convert selected text" }),
    );
    await user.click(
      await screen.findByRole("checkbox", {
        name: /I reviewed the source coverage/,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Use draft for preview" }),
    );
    expect(onPrepared).toHaveBeenCalledTimes(1);
    expect(onPrepared.mock.calls[0][0]).toBeInstanceOf(File);
    expect(convertAIDocument).toHaveBeenCalledTimes(2);
  });
});