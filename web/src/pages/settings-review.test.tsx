import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountHistoryAiPrompt } from "@/components/review/ai-prompts";
import { PortfolioReviewWorkspace } from "@/pages/review";
import { PersonalAPIKeys, SettingsPage } from "@/pages/settings";
import {
  PrivacyProvider,
  PrivacyToggle,
} from "@/components/providers/privacy-provider";
import type { AIRead, Session, SettingsRead } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    const existingKey = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "CLI key",
      prefix: "wbk_v1_00000000",
      scopes: ["portfolio:read" as const],
      createdAt: "2026-09-20T00:00:00Z",
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    };
    const getAPIKeys = vi.fn().mockResolvedValue({ keys: [existingKey] });
    const createAPIKey = vi.fn().mockResolvedValue({
      ...existingKey,
      id: "00000000-0000-4000-8000-000000000003",
      name: "Automation",
      token: "wbk_v1_00000000_fixture-secret",
    });
    const revokeAPIKey = vi.fn().mockResolvedValue(undefined);
    const revokeAllAPIKeys = vi.fn().mockResolvedValue({ revoked: 1 });
    const saveAISettings = vi.fn().mockResolvedValue(undefined);
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
      saveAISettings,
      saveAICredential: noop,
      deleteAICredential: noop,
      disconnectAI: noop,
      clearAIUsage: noop,
      getAPIKeys,
      createAPIKey,
      revokeAPIKey,
      revokeAllAPIKeys,
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
        <SettingsPage session={session} operations={operations} />
      </MemoryRouter>,
    );

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Preferences",
      "Exchange rates",
      "AI provider",
      "Authentication methods",
      "Password",
      "Personal API keys",
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

    const provider = screen.getByLabelText("Provider");
    expect(
      Array.from(provider.querySelectorAll("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual(["OpenAI", "Anthropic", "DeepSeek"]);
    const endpoint = screen.getByLabelText("API endpoint");
    const model = screen.getByLabelText("Model");
    expect(endpoint).toHaveAttribute("readonly");
    expect(endpoint).toHaveValue("https://api.openai.com/v1");
    expect(model).toHaveValue("test-model");

    await user.selectOptions(provider, "anthropic");
    expect(endpoint).toHaveValue("https://api.anthropic.com");
    expect(model).toHaveValue("test-model");
    const suggestions = Array.from(
      document.querySelectorAll("#aiModelSuggestions option"),
    ).map((option) => option.getAttribute("value"));
    expect(suggestions).toContain("claude-sonnet-5");
    expect(suggestions).not.toContain("gpt-5.5");

    await user.clear(model);
    await user.selectOptions(provider, "deepseek");
    expect(model).toHaveValue("deepseek-v4-flash");
    await user.selectOptions(provider, "anthropic");
    expect(model).toHaveValue("claude-sonnet-5");

    await user.clear(model);
    await user.type(model, "claude-custom-preview");
    await user.click(screen.getByRole("button", { name: "Save AI settings" }));
    await waitFor(() => expect(saveAISettings).toHaveBeenCalledTimes(1));
    expect(saveAISettings.mock.calls[0][0]).toEqual({
      provider: "anthropic",
      model: "claude-custom-preview",
      includeExactAmounts: false,
      includeAccountNames: false,
      monthlyTokenLimit: 100000,
      maxOutputTokens: 1200,
    });
  });

  it("creates, copies, dismisses, and revokes personal API keys", async () => {
    const user = userEvent.setup();
    const existingKey = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "CLI key",
      prefix: "wbk_v1_00000000",
      scopes: ["portfolio:read" as const],
      createdAt: "2026-09-20T00:00:00Z",
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    };
    const createAPIKey = vi.fn().mockResolvedValue({
      ...existingKey,
      id: "00000000-0000-4000-8000-000000000003",
      name: "Automation",
      token: "wbk_v1_00000000_fixture-secret",
    });
    const revokeAPIKey = vi.fn().mockResolvedValue(undefined);
    const revokeAllAPIKeys = vi.fn().mockResolvedValue({ revoked: 1 });
    const operations = {
      getAPIKeys: vi.fn().mockResolvedValue({ keys: [existingKey] }),
      createAPIKey,
      revokeAPIKey,
      revokeAllAPIKeys,
    };
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<PersonalAPIKeys session={session} operations={operations} />);

    await screen.findByText("CLI key");
    await user.type(
      screen.getByLabelText("Name", { selector: "#apiKeyName" }),
      "Automation",
    );
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    expect(await screen.findByLabelText("New API key secret")).toHaveValue(
      "wbk_v1_00000000_fixture-secret",
    );
    expect(createAPIKey).toHaveBeenCalledWith(
      { name: "Automation", scopes: ["portfolio:read"], expiresAt: null },
      "csrf",
    );

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("wbk_v1_00000000_fixture-secret");
    await user.click(
      screen.getByRole("button", { name: "Dismiss API key secret" }),
    );
    expect(
      screen.queryByLabelText("New API key secret"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(revokeAPIKey).toHaveBeenCalledWith(existingKey.id, "csrf"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "API key revoked.",
    );
    const revokeAll = screen.getByRole("button", {
      name: "Revoke all active keys",
    });
    await waitFor(() => expect(revokeAll).toBeEnabled());
    await user.click(revokeAll);
    await waitFor(() => expect(revokeAllAPIKeys).toHaveBeenCalledWith("csrf"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "All active API keys revoked.",
    );
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
