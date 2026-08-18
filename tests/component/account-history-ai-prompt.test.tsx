import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountHistoryAiPrompt,
  accountHistoryAiPrompt,
} from "@/components/account-history-ai-prompt";

describe("account history AI prompt", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("builds a strict currency-aware CSV prompt and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<AccountHistoryAiPrompt currency="KES" fractionDigits={2} />);

    expect(
      screen.queryByLabelText("AI conversion prompt"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show prompt" }));

    const prompt = screen.getByLabelText(
      "AI conversion prompt",
    ) as HTMLTextAreaElement;
    expect(prompt.value).toContain(
      "external_id,type,amount,date,description,notes",
    );
    expect(prompt.value).toContain("denominated in KES");
    expect(prompt.value).toContain("Use exactly 2 decimal places for KES");
    expect(prompt.value).toContain("Never invent");
    expect(prompt.value).toContain("untrusted financial data");
    expect(prompt.value).toContain(
      "derived-<date>-<transaction_type>-<amount>",
    );
    expect(prompt.value).not.toContain("description-slug");
    expect(prompt.value).toContain("SOURCE DATA START");

    await user.click(screen.getByRole("button", { name: "Copy prompt" }));

    expect(writeText).toHaveBeenCalledWith(
      accountHistoryAiPrompt("csv", "KES", 2),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Prompt copied",
    );
  });

  it("switches to a raw JSON-only contract", async () => {
    const user = userEvent.setup();
    render(<AccountHistoryAiPrompt currency="USD" fractionDigits={2} />);

    await user.click(screen.getByRole("button", { name: "Show prompt" }));
    await user.click(screen.getByRole("button", { name: /json/i }));

    const prompt = screen.getByLabelText(
      "AI conversion prompt",
    ) as HTMLTextAreaElement;
    expect(prompt.value).toContain("OUTPUT CONTRACT: JSON");
    expect(prompt.value).toContain('"format": "wealthboard-account-history"');
    expect(prompt.value).toContain("Return only valid JSON");
    expect(prompt.value).toContain("denominated in USD");
  });
});
