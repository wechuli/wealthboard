import {
  AiProviderError,
  AiProviderAuthenticationError,
  AiProviderCancelledError,
  AiProviderRateLimitError,
  AiProviderResponseError,
  AiProviderTimeoutError,
  AiProviderUnavailableError,
} from "@/lib/ai/provider";
import { portfolioReviewRequestSchema } from "@/lib/ai/schemas";
import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import {
  AiCredentialRequiredError,
  AiProviderNotConfiguredError,
  AiReviewBudgetError,
  AiReviewRateLimitError,
} from "@/lib/services/ai-provider";
import { generatePortfolioAiReview } from "@/lib/services/ai-review";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AiReviewRateLimitError) {
    return Response.json({ error: error.message }, { status: 429 });
  }
  if (error instanceof AiReviewBudgetError) {
    return Response.json({ error: error.message }, { status: 429 });
  }
  if (
    error instanceof AiProviderNotConfiguredError ||
    error instanceof AiCredentialRequiredError
  ) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AiProviderAuthenticationError) {
    return Response.json({ error: error.message }, { status: 502 });
  }
  if (error instanceof AiProviderRateLimitError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  if (error instanceof AiProviderTimeoutError) {
    return Response.json({ error: error.message }, { status: 504 });
  }
  if (error instanceof AiProviderCancelledError) {
    return Response.json({ error: error.message }, { status: 408 });
  }
  if (
    error instanceof AiProviderResponseError ||
    error instanceof AiProviderUnavailableError
  ) {
    return Response.json({ error: error.message }, { status: 502 });
  }
  return Response.json(
    { error: "The portfolio review could not be generated." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  try {
    requireTrustedOrigin(request);
  } catch {
    return Response.json(
      { error: "The request origin is not trusted." },
      { status: 403 },
    );
  }
  let body: string;
  try {
    body = await request.text();
  } catch {
    return Response.json(
      { error: "Enter a valid review request." },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(body, "utf8") > 8 * 1024) {
    return Response.json(
      { error: "The review request is too large." },
      { status: 413 },
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json(
      { error: "Enter a valid review request." },
      { status: 400 },
    );
  }
  const parsed = portfolioReviewRequestSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json(
      { error: "Check the review options." },
      { status: 400 },
    );
  }
  try {
    const result = await generatePortfolioAiReview(
      session.userId,
      parsed.data,
      {
        signal: request.signal,
      },
    );
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = errorResponse(error);
    console.error("AI portfolio review failed:", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      responseStatus: response.status,
      ...(error instanceof AiProviderError ? error.details : undefined),
    });
    return response;
  }
}
