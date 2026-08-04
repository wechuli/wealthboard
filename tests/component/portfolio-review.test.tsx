import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioReviewWorkspace } from "@/components/portfolio-review-workspace";
import { PrivacyProvider, PrivacyToggle } from "@/components/privacy-provider";

const settings = {
  provider: "openai" as const,
  baseUrl: "https://api.openai.com/v1",
  model: "test-review-model",
  hasStoredApiKey: false,
  apiKeyHint: null,
  includeExactAmounts: false,
  includeAccountNames: false,
  monthlyTokenLimit: 100_000,
  maxOutputTokens: 1_200,
  updatedAt: "2026-08-04T12:00:00.000Z",
};

const reviewResponse = {
  review: {
    schemaVersion: 1,
    headline: "Evidence-based review headline",
    executiveSummary: "A bounded summary based on deterministic ratios.",
    dataQuality: [],
    strengths: [
      {
        id: "strength-1",
        category: "general",
        severity: "info",
        confidence: "high",
        title: "A measured strength",
        explanation: "This statement uses a supplied portfolio ratio.",
        evidenceRefs: ["portfolio.ratios"],
      },
    ],
    attentionItems: [],
    goalObservations: [],
    questions: ["Does this liquidity level match your needs?"],
    possibleNextChecks: ["Review the largest category concentration."],
    limitations: ["This is explanatory analysis, not financial advice."],
  },
  snapshot: {
    sharing: { exactAmounts: false, accountNames: false },
    portfolio: { totals: {} },
    allocations: { categories: [], currencies: [] },
    topAccounts: [],
    goals: [],
    dataQuality: [],
  },
  provider: {
    name: "openai",
    host: "api.openai.com",
    model: "test-review-model",
  },
  usage: { inputTokens: 300, outputTokens: 150 },
  generatedAt: "2026-08-04T12:00:00.000Z",
};

function renderWorkspace() {
  return render(
    <PrivacyProvider>
      <PrivacyToggle />
      <PortfolioReviewWorkspace settings={settings} usage={null} />
    </PrivacyProvider>,
  );
}

describe("portfolio review workspace", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends explicit sharing choices, clears the session key, and hides review prose", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(reviewResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    const keyInput = screen.getByLabelText("Session-only API key");
    await user.type(keyInput, "sk-session-review-key");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Include exact aggregate amounts",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Include account and goal names",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Generate review" }));

    expect(
      await screen.findByText("Evidence-based review headline"),
    ).toBeVisible();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      includeExactAmounts: true,
      includeAccountNames: true,
      apiKey: "sk-session-review-key",
    });
    expect(keyInput).toHaveValue("");

    await user.click(
      screen.getByRole("button", { name: "Hide financial values" }),
    );
    expect(screen.getByText("Review hidden")).toBeVisible();
    expect(
      screen.queryByText("Evidence-based review headline"),
    ).not.toBeInTheDocument();
  });

  it("aborts an in-flight provider request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace();

    await user.type(
      screen.getByLabelText("Session-only API key"),
      "sk-session-review-key",
    );
    await user.click(screen.getByRole("button", { name: "Generate review" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        screen.getByText("Portfolio review generation was cancelled."),
      ).toBeVisible(),
    );
    expect(
      screen.getByText("No review generated in this session"),
    ).toBeVisible();
  });
});
