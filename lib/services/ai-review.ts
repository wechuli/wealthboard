import "server-only";

import { AI_MAX_SNAPSHOT_BYTES, aiEndpointHost } from "@/lib/ai/config";
import {
  AiProviderError,
  AiProviderAuthenticationError,
  AiProviderCancelledError,
  AiProviderRateLimitError,
  AiProviderResponseError,
  AiProviderTimeoutError,
  type AiReviewTransport,
  openAiCompatibleTransport,
} from "@/lib/ai/provider";
import {
  portfolioReviewOptionsSchema,
  type PortfolioReviewOptions,
} from "@/lib/ai/schemas";
import {
  completeAiReviewUsage,
  estimateAiReviewTokens,
  reserveAiReviewUsage,
  resolveAiProviderRequest,
} from "@/lib/services/ai-provider";
import { buildPortfolioReviewSnapshot } from "@/lib/services/portfolio-review";

function providerErrorCode(error: unknown) {
  if (error instanceof AiProviderAuthenticationError) return "provider_auth";
  if (error instanceof AiProviderRateLimitError) return "provider_rate_limit";
  if (error instanceof AiProviderTimeoutError) return "provider_timeout";
  if (error instanceof AiProviderCancelledError) return "request_cancelled";
  if (error instanceof AiProviderResponseError) return "invalid_response";
  return "provider_unavailable";
}

export async function generatePortfolioAiReview(
  userId: string,
  input: Partial<PortfolioReviewOptions> & { apiKey?: string },
  options: {
    transport?: AiReviewTransport;
    now?: Date;
    signal?: AbortSignal;
  } = {},
) {
  const parsedOptions = portfolioReviewOptionsSchema.parse(input);
  const provider = await resolveAiProviderRequest(userId, input.apiKey);
  const snapshot = await buildPortfolioReviewSnapshot(
    userId,
    parsedOptions,
    options.now,
  );
  const serializedSnapshot = JSON.stringify(snapshot);
  if (Buffer.byteLength(serializedSnapshot, "utf8") > AI_MAX_SNAPSHOT_BYTES) {
    throw new Error(
      "The portfolio review snapshot is too large to send safely.",
    );
  }
  const estimatedTokens = estimateAiReviewTokens(
    serializedSnapshot,
    provider.maxOutputTokens,
  );
  const reservation = reserveAiReviewUsage(
    userId,
    estimatedTokens,
    options.now,
  );
  const startedAt = performance.now();
  try {
    const result = await (options.transport ?? openAiCompatibleTransport)({
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      maxOutputTokens: provider.maxOutputTokens,
      snapshot,
      signal: options.signal,
    });
    completeAiReviewUsage(userId, reservation.id, {
      status: "success",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: performance.now() - startedAt,
    });
    return {
      review: result.review,
      snapshot,
      provider: {
        name: provider.provider,
        host: aiEndpointHost(provider.baseUrl),
        model: provider.model,
      },
      usage: {
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
      },
      generatedAt: (options.now ?? new Date()).toISOString(),
    };
  } catch (error) {
    completeAiReviewUsage(userId, reservation.id, {
      status: "error",
      inputTokens:
        error instanceof AiProviderError
          ? error.details?.providerInputTokens
          : undefined,
      outputTokens:
        error instanceof AiProviderError
          ? error.details?.providerOutputTokens
          : undefined,
      latencyMs: performance.now() - startedAt,
      errorCode: providerErrorCode(error),
    });
    throw error;
  }
}
