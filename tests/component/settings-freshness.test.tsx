import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneralSettingsForm } from "@/components/settings-forms";
import { ThemeProvider } from "@/components/theme-provider";
import type { UserSettings } from "@/db/schema";

const settings: UserSettings = {
  id: "settings-1",
  userId: "user-1",
  displayName: "Example User",
  baseCurrency: "USD",
  supportedCurrencies: JSON.stringify(["USD", "KES"]),
  timezone: "Africa/Nairobi",
  preferredDateFormat: "dd MMM yyyy",
  appName: "Wealthboard",
  defaultDashboardPeriod: "1y",
  sessionTimeoutMinutes: 10080,
  defaultGoalReturnBps: 800,
  positionStaleDaysStock: 5,
  positionStaleDaysEtf: 10,
  positionStaleDaysFund: 45,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("position freshness settings", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows independent asset-class thresholds", () => {
    render(
      <ThemeProvider>
        <GeneralSettingsForm
          settings={settings}
          referencedCurrencies={["USD"]}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Stocks (days)")).toHaveValue(5);
    expect(screen.getByLabelText("ETFs (days)")).toHaveValue(10);
    expect(screen.getByLabelText("Funds (days)")).toHaveValue(45);
  });
});
