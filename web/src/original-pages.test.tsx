import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountHistoryAiPrompt } from "./original-ai-prompts";
import { PortfolioReviewWorkspace } from "./original-review-page";
import { OriginalSettingsPage } from "./original-settings-page";
import { PrivacyProvider, PrivacyToggle } from "./ported-ui/privacy-provider";
import type { AIRead, Session, SettingsRead } from "./types";

afterEach(cleanup);

const session: Session = {
  user: { id: "00000000-0000-0000-0000-000000000001", username: "alex" },
  csrfToken: "csrf",
};

const ai: AIRead = {
  settings: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "test-model",
    hasStoredApiKey: true,
    apiKeyHint: "...1234",
    includeExactAmounts: false,
    includeAccountNames: false,
    monthlyTokenLimit: 100000,
    maxOutputTokens: 1200,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  },
  usage: {
    billingMonth: "2026-09",
    chargedTokens: 0,
    remainingTokens: 100000,
    monthlyTokenLimit: 100000,
    successfulReviews: 0,
    lastUsedAt: null,
  },
  events: [],
  reviewAvailability: {
    available: true,
    reason: "available",
    providerConfigured: true,
    storedCredentialAvailable: true,
    sessionCredentialAccepted: false,
    cooldownUntil: null,
    budgetRemainingTokens: 100000,
  },
};

const settings: SettingsRead = {
  settings: {
    displayName: "Alex",
    appName: "Wealthboard",
    baseCurrency: "USD",
    supportedCurrencies: ["EUR", "USD"],
    timezone: "UTC",
    preferredDateFormat: "dd MMM yyyy",
    defaultDashboardPeriod: "1y",
    sessionTimeoutMinutes: 60,
    defaultGoalReturnBps: 500,
    positionStaleDaysStock: 7,
    positionStaleDaysEtf: 7,
    positionStaleDaysFund: 30,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  },
  currencyConfiguration: {
    baseCurrency: "USD",
    enabledCurrencies: ["EUR", "USD"],
    referencedCurrencies: ["USD"],
  },
  exchangeRates: [],
  authMethods: {
    status: "configured",
    hasPassword: true,
    oidcIdentities: [],
  },
};

describe("original settings page", () => {
  it("preserves the original card order and password placement", async () => {
    const user = userEvent.setup();
    const noop = vi.fn().mockResolvedValue(undefined);
    const operations = {
      load: vi.fn().mockResolvedValue({
        settings,
        ai,
        authConfig: {
          localEnabled: true,
          oidcEnabled: false,
          providerName: "OIDC provider",
        },
      }),
      updateSettings: noop,
      createExchangeRate: noop,
      deleteExchangeRate: noop,
      saveAISettings: noop,
      saveAICredential: noop,
      deleteAICredential: noop,
      disconnectAI: noop,
      clearAIUsage: noop,
      downloadExport: noop,
      restoreUser: noop,
      authentication: {
        linkOidc: noop,
        unlinkOidc: noop,
        reauthenticateOidc: noop,
        enableLocalCredential: noop,
        removeLocalCredential: noop,
        changePassword: noop,
      },
    };
    render(
      <MemoryRouter>
        <OriginalSettingsPage session={session} operations={operations} />
      </MemoryRouter>,
    );

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Preferences",
      "Exchange rates",
      "AI provider",
      "Authentication methods",
      "Password",
      "Import, restore & export",
    ]);
    expect(
      screen.getByText(
        "Portable files contain only your portfolio, never credentials or another user's records.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Archived accounts" })).toHaveClass(
      "border-white/10",
    );
    expect(screen.getByLabelText("Default dashboard period")).toHaveValue("1y");
    expect(
      screen.queryByText(/deployment|operator|AI_ALLOWED_ENDPOINTS/i),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Provider"), "custom");
    const endpoint = screen.getByLabelText("API endpoint");
    expect(endpoint).not.toHaveAttribute("readonly");
    await user.clear(endpoint);
    await user.type(endpoint, "https://models.example.com/v1");
    expect(endpoint).toHaveValue("https://models.example.com/v1");
    expect(
      screen.getByText(
        "This endpoint must be enabled for your Wealthboard instance.",
      ),
    ).toBeInTheDocument();
  });
});

describe("original portfolio review", () => {
  it("removes generated review text while privacy mode is enabled", async () => {
    const user = userEvent.setup();
    const generate = vi.fn().mockResolvedValue({
      review: {
        headline: "Private portfolio headline",
        executiveSummary: "Private summary",
        dataQuality: [],
        strengths: [],
        attentionItems: [],
        goalObservations: [],
        questions: [],
        possibleNextChecks: [],
        limitations: [],
      },
      snapshot: {
        sharing: { exactAmounts: false },
        portfolio: {},
        allocations: {},
        topAccounts: [],
        goals: [],
        dataQuality: [],
      },
      provider: { name: "openai", host: "api.openai.com", model: "test-model" },
      usage: { inputTokens: 10, outputTokens: 10 },
      generatedAt: "2026-09-20T00:00:00Z",
    });
    localStorage.setItem("wealthboard-values-hidden", "true");
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <PortfolioReviewWorkspace
          ai={ai}
          session={session}
          generate={generate}
        />
      </PrivacyProvider>,
    );

    await screen.findByRole("button", { name: "Reveal financial values" });
    await user.click(screen.getByRole("button", { name: "Generate review" }));
    expect(
      await screen.findByRole("heading", { name: "Review hidden" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Private portfolio headline"),
    ).not.toBeInTheDocument();
    localStorage.removeItem("wealthboard-values-hidden");
  });
});

describe("original AI prompts", () => {
  it("copies the strict account-history CSV contract", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<AccountHistoryAiPrompt currency="USD" fractionDigits={2} />);

    await user.click(screen.getByRole("button", { name: "Show prompt" }));
    expect(
      (screen.getByLabelText("AI conversion prompt") as HTMLTextAreaElement)
        .value,
    ).toContain("external_id,type,amount,date,description,notes");
    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Prompt copied/)).toBeInTheDocument();
  });
});
