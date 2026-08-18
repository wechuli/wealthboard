import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GoalScenarioComparison } from "@/components/goal-scenario-comparison";
import { PrivacyProvider } from "@/components/privacy-provider";

describe("goal scenario comparison", () => {
  afterEach(cleanup);

  it("honors saved contribution dates while keeping Required pace hypothetical", () => {
    render(
      <PrivacyProvider>
        <GoalScenarioComparison
          currentMinor="0"
          targetMinor="50000"
          currency="KES"
          fromDate="2026-01-01"
          targetDate="2026-12-01T12:00:00.000Z"
          planStartDate="2026-04-01T12:00:00.000Z"
          planEndDate="2026-06-01T12:00:00.000Z"
          savedMonthlyContribution="100.00"
          requiredMonthlyContribution="50.00"
          savedAnnualReturn={0}
          timezone="UTC"
        />
      </PrivacyProvider>,
    );

    const savedPlan = screen.getByRole("heading", { name: "Saved plan" })
      .parentElement?.parentElement;
    const requiredPace = screen.getByRole("heading", {
      name: "Required pace",
    }).parentElement?.parentElement;

    expect(savedPlan).not.toBeNull();
    expect(requiredPace).not.toBeNull();
    expect(within(savedPlan!).getByText("Shortfall")).toBeInTheDocument();
    expect(within(requiredPace!).getByText("Target met")).toBeInTheDocument();
  });
});
