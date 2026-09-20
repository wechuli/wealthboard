import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AllocationChart, NetWorthChart } from "@/components/charts";
import { PrivacyProvider } from "@/components/providers/privacy-provider";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("financial charts", () => {
  it("replaces sensitive chart content while privacy mode is enabled", async () => {
    localStorage.setItem("wealthboard-values-hidden", "true");
    render(
      <MemoryRouter>
        <PrivacyProvider>
          <NetWorthChart
            currency="KES"
            range="1y"
            data={[
              { date: "2026-08-20T00:00:00Z", netWorthMinor: "10000", assetsMinor: "10000", liabilitiesMinor: "0" },
              { date: "2026-09-20T00:00:00Z", netWorthMinor: "12000", assetsMinor: "12000", liabilitiesMinor: "0" },
            ]}
          />
        </PrivacyProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Financial chart hidden")).toBeInTheDocument();
    expect(screen.queryByText(/Net worth moved from/)).not.toBeInTheDocument();
  });

  it("supports hiding allocation segments from the accessible legend", async () => {
    const user = userEvent.setup();
    render(
      <PrivacyProvider>
        <AllocationChart
          currency="KES"
          total={[
            { name: "Cash", valueMinor: "6000" },
            { name: "Investments", valueMinor: "4000" },
          ]}
          investible={[{ name: "Investments", valueMinor: "4000" }]}
        />
      </PrivacyProvider>,
    );

    const cash = await screen.findByRole("button", { name: /Cash/ });
    expect(cash).toHaveAttribute("aria-pressed", "true");
    await user.click(cash);
    expect(cash).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Investible only" }));
    expect(screen.getByRole("button", { name: /Investments/ })).toBeInTheDocument();
  });
});