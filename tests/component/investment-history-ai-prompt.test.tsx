import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InvestmentHistoryAiPrompt,
  investmentHistoryAiPrompt,
} from "@/components/investment-history-ai-prompt";

describe("investment history AI prompt", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("builds and copies a strict currency-aware complete JSON prompt", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <InvestmentHistoryAiPrompt
        accountCurrency="USD"
        accountFractionDigits={2}
        enabledCurrencies={["USD", "KES"]}
      />,
    );

    expect(
      screen.queryByLabelText("AI conversion prompt"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show prompt" }));

    const prompt = screen.getByLabelText(
      "AI conversion prompt",
    ) as HTMLTextAreaElement;
    expect(prompt.value).toContain("OUTPUT CONTRACT: COMPLETE JSON");
    expect(prompt.value).toContain(
      '"format": "wealthboard-investment-history"',
    );
    expect(prompt.value).toContain('"position_events"');
    expect(prompt.value).toContain('"cash_transactions"');
    expect(prompt.value).toContain("The account currency is USD");
    expect(prompt.value).toContain("Enabled currencies are: USD, KES");
    expect(prompt.value).toContain("stay long-only at every date");
    expect(prompt.value).toContain("NEEDS CLARIFICATION");
    expect(prompt.value).toContain("in-kind transfers, stock splits");
    expect(prompt.value).toContain("event_group_id");
    expect(prompt.value).toContain("untrusted financial data");
    expect(prompt.value).toContain(
      "derived-<date>-<transaction_type>-<amount>",
    );
    expect(prompt.value).toContain(
      "Format cash amounts with exactly 2 decimal places",
    );

    await user.click(screen.getByRole("button", { name: "Copy prompt" }));

    expect(writeText).toHaveBeenCalledWith(
      investmentHistoryAiPrompt("json", "USD", 2, ["USD", "KES"]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Prompt copied",
    );
  });

  it("switches to the exact trade CSV contract", async () => {
    const user = userEvent.setup();
    render(
      <InvestmentHistoryAiPrompt
        accountCurrency="KES"
        accountFractionDigits={2}
        enabledCurrencies={["KES", "USD", "UGX"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Show prompt" }));
    await user.selectOptions(
      screen.getByLabelText("AI prompt output format"),
      "trades_csv",
    );

    const prompt = screen.getByLabelText(
      "AI conversion prompt",
    ) as HTMLTextAreaElement;
    expect(prompt.value).toContain("OUTPUT CONTRACT: TRADES CSV");
    expect(prompt.value).toContain(
      "external_id,instrument_external_id,type,quantity,unit_price,trade_currency,fee_amount,fee_currency,cash_effect,applied_exchange_rate,trade_date,settlement_date,description,notes",
    );
    expect(prompt.value).toContain(
      "CSV files cannot represent an atomic dividend-reinvestment group",
    );
    expect(prompt.value).toContain("actual settlement in KES");
    expect(prompt.value).toContain("Enabled currencies are: KES, USD, UGX");
  });

  it("defines every collection-specific CSV header", () => {
    expect(
      investmentHistoryAiPrompt("holdings_csv", "USD", 2, ["USD"]),
    ).toContain(
      "instrument_external_id,event_external_id,price_external_id,instrument_name,symbol,identifier_type,identifier,exchange_mic,asset_type,quote_currency,quantity,unit_price,price_date,opening_cost_basis,notes",
    );
    expect(investmentHistoryAiPrompt("cash_csv", "USD", 2, ["USD"])).toContain(
      "external_id,type,amount,date,description,notes",
    );
    expect(
      investmentHistoryAiPrompt("prices_csv", "USD", 2, ["USD"]),
    ).toContain(
      "external_id,instrument_external_id,price,effective_date,source,provenance",
    );
  });
});
