// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  AiProviderAuthenticationError,
  AiProviderCancelledError,
  AiProviderResponseError,
  AiProviderUnavailableError,
  openAiCompatibleTransport,
} from "@/lib/ai/provider";
import {
  portfolioAiReviewSchema,
  portfolioReviewSnapshotSchema,
} from "@/lib/ai/schemas";

const snapshot = portfolioReviewSnapshotSchema.parse({
  schemaVersion: 1,
  asOf: "2026-08-04T12:00:00.000Z",
  period: "1y",
  focus: "overall",
  baseCurrency: "KES",
  sharing: { exactAmounts: false, accountNames: false },
  completeness: {
    complete: true,
    missingCurrencies: [],
    omittedMetrics: ["Annualized returns are unavailable."],
  },
  portfolio: {
    accountCount: 1,
    goalCount: 0,
    totals: { evidenceId: "portfolio.totals" },
    ratios: {
      evidenceId: "portfolio.ratios",
      liabilitiesToAssetsPercent: "0.0",
      liquidAssetsPercent: "100.0",
      investibleAssetsPercent: "100.0",
    },
    periodChange: {
      evidenceId: "portfolio.period-change",
      percent: "5.0",
    },
  },
  allocations: { categories: [], currencies: [] },
  topAccounts: [],
  cashFlow: {
    evidenceId: "cash-flow.summary",
    contributionsAsPercentOfAssets: "10.0",
    withdrawalsAsPercentOfAssets: "0.0",
    incomeAsPercentOfAssets: "2.0",
    feesAsPercentOfAssets: "0.1",
  },
  goals: [],
  dataQuality: [],
  methodology: ["Wealthboard calculated all supplied values."],
});

const validReview = portfolioAiReviewSchema.parse({
  schemaVersion: 1,
  headline: "A bounded review",
  executiveSummary: "The supplied ratios support a limited review.",
  dataQuality: [],
  strengths: [
    {
      id: "strength-1",
      category: "liquidity",
      severity: "info",
      confidence: "high",
      title: "Liquidity is measurable",
      explanation: "The supplied liquidity ratio supports this observation.",
      evidenceRefs: ["portfolio.ratios"],
    },
  ],
  attentionItems: [],
  goalObservations: [],
  questions: [],
  possibleNextChecks: [],
  limitations: ["This is explanatory analysis, not financial advice."],
});

function providerResponse(review: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? {
            id: "chatcmpl-review",
            object: "chat.completion",
            created: 1_785_844_800,
            model: "review-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify(review),
                  refusal: null,
                },
                finish_reason: "stop",
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 300,
              completion_tokens: 150,
              total_tokens: 450,
            },
          }
        : {
            error: {
              message: "Invalid API key",
              type: "invalid_request_error",
              code: "invalid_api_key",
            },
          },
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "request-review",
      },
    },
  );
}

const call = {
  baseUrl: "https://models.example.com/v1",
  apiKey: "sk-provider-test",
  model: "review-model",
  maxOutputTokens: 800,
  snapshot,
};

describe("OpenAI-compatible review transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses one non-redirecting Chat Completions request and validates output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(validReview));
    vi.stubGlobal("fetch", fetchMock);

    const result = await openAiCompatibleTransport(call);

    expect(result).toMatchObject({
      review: validReview,
      inputTokens: 300,
      outputTokens: 150,
      providerRequestId: "request-review",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(String(target)).toContain(
      "https://models.example.com/v1/chat/completions",
    );
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer sk-provider-test",
    );
  });

  test("rejects invented evidence as an invalid provider response", async () => {
    const invalidReview = {
      ...validReview,
      strengths: [
        {
          ...validReview.strengths[0],
          evidenceRefs: ["transaction.private-row"],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(providerResponse(invalidReview)),
    );

    await expect(openAiCompatibleTransport(call)).rejects.toBeInstanceOf(
      AiProviderResponseError,
    );
  });

  test("maps provider authentication failures and does not follow redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(providerResponse({}, 401)),
    );
    await expect(openAiCompatibleTransport(call)).rejects.toBeInstanceOf(
      AiProviderAuthenticationError,
    );

    const redirectFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/private" },
      }),
    );
    vi.stubGlobal("fetch", redirectFetch);
    await expect(openAiCompatibleTransport(call)).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
    expect(redirectFetch).toHaveBeenCalledTimes(1);
  });

  test("maps an aborted request to a cancellation error", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      openAiCompatibleTransport({ ...call, signal: controller.signal }),
    ).rejects.toBeInstanceOf(AiProviderCancelledError);
  });
});
