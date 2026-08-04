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

function openAiResponsesResponse(
  review: unknown,
  options: {
    status?: "completed" | "incomplete";
    incompleteReason?: "max_output_tokens" | "content_filter";
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  } = {},
) {
  const status = options.status ?? "completed";
  return new Response(
    JSON.stringify({
      id: "resp-review",
      object: "response",
      created_at: 1_785_844_800,
      model: "reasoning-review-model",
      status,
      error: null,
      incomplete_details: options.incompleteReason
        ? { reason: options.incompleteReason }
        : null,
      output:
        review === undefined
          ? []
          : [
              {
                id: "msg-review",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(review),
                    annotations: [],
                    logprobs: [],
                  },
                ],
              },
            ],
      usage: {
        input_tokens: options.inputTokens ?? 300,
        input_tokens_details: {
          cached_tokens: 0,
          cache_write_tokens: 0,
        },
        output_tokens: options.outputTokens ?? 150,
        output_tokens_details: {
          reasoning_tokens: options.reasoningTokens ?? 50,
        },
        total_tokens:
          (options.inputTokens ?? 300) + (options.outputTokens ?? 150),
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "request-responses",
      },
    },
  );
}

function providerErrorResponse(
  status: number,
  error: {
    message: string;
    type: string;
    code: string;
    param?: string;
  },
) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "request-error",
    },
  });
}

const call = {
  provider: "custom" as const,
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
    const requestBody = JSON.parse(String(init.body)) as Record<
      string,
      unknown
    >;
    expect(requestBody.max_tokens).toBe(800);
    expect(requestBody).not.toHaveProperty("max_completion_tokens");
  });

  test("uses the Responses API with bounded reasoning for OpenAI", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(openAiResponsesResponse(validReview));
    vi.stubGlobal("fetch", fetchMock);

    const result = await openAiCompatibleTransport({
      ...call,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "reasoning-review-model",
    });

    expect(result).toMatchObject({
      review: validReview,
      inputTokens: 300,
      outputTokens: 150,
      providerRequestId: "request-responses",
    });
    const [target, init] = fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(String(target)).toBe("https://api.openai.com/v1/responses");
    const requestBody = JSON.parse(String(init.body)) as Record<
      string,
      unknown
    >;
    expect(requestBody).toMatchObject({
      model: "reasoning-review-model",
      max_output_tokens: 800,
      reasoning: { effort: "low" },
      text: {
        format: { type: "json_object" },
        verbosity: "low",
      },
      store: false,
    });
    expect(requestBody).not.toHaveProperty("max_tokens");
    expect(requestBody).not.toHaveProperty("max_completion_tokens");
    expect(String(init.body)).not.toContain(call.apiKey);
  });

  test("reports incomplete OpenAI reasoning responses with usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        openAiResponsesResponse(undefined, {
          status: "incomplete",
          incompleteReason: "max_output_tokens",
          inputTokens: 725,
          outputTokens: 800,
          reasoningTokens: 800,
        }),
      ),
    );

    const error = await openAiCompatibleTransport({
      ...call,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "reasoning-review-model",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderResponseError);
    expect((error as AiProviderResponseError).details).toEqual({
      failureKind: "incomplete_response",
      providerHost: "api.openai.com",
      providerModel: "reasoning-review-model",
      providerRequestId: "request-responses",
      providerResponseStatus: "incomplete",
      providerIncompleteReason: "max_output_tokens",
      providerInputTokens: 725,
      providerOutputTokens: 800,
      providerReasoningTokens: 800,
    });
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

  test("preserves safe diagnostics for provider API failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        providerErrorResponse(404, {
          message: "Sensitive provider message must not be retained.",
          type: "invalid_request_error",
          code: "model_not_found",
          param: "model",
        }),
      ),
    );

    const error = await openAiCompatibleTransport(call).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AiProviderUnavailableError);
    expect((error as AiProviderUnavailableError).details).toEqual({
      failureKind: "api_error",
      providerHost: "models.example.com",
      providerModel: "review-model",
      providerStatus: 404,
      providerCode: "model_not_found",
      providerType: "invalid_request_error",
      providerParam: "model",
      providerRequestId: "request-error",
    });
    expect(JSON.stringify((error as AiProviderUnavailableError).details)).not.toContain(
      "Sensitive provider message",
    );
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
