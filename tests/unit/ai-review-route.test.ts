// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/origin", () => ({ requireTrustedOrigin: vi.fn() }));
vi.mock("@/lib/services/ai-review", () => ({
  generatePortfolioAiReview: vi.fn(),
}));

import { POST } from "@/app/api/ai/review/route";
import { AiProviderUnavailableError } from "@/lib/ai/provider";
import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import { generatePortfolioAiReview } from "@/lib/services/ai-review";

function request(body: unknown) {
  return new Request("https://wealthboard.example.com/api/ai/review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://wealthboard.example.com",
    },
    body: JSON.stringify(body),
  });
}

const validRequest = {
  period: "1y",
  focus: "overall",
  includeExactAmounts: false,
  includeAccountNames: false,
  apiKey: "sk-session-review",
};

describe("AI review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireTrustedOrigin).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("rejects unauthenticated requests before origin or provider work", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await POST(request(validRequest));

    expect(response.status).toBe(401);
    expect(requireTrustedOrigin).not.toHaveBeenCalled();
    expect(generatePortfolioAiReview).not.toHaveBeenCalled();
  });

  test("rejects an untrusted origin before provider work", async () => {
    vi.mocked(getSession).mockResolvedValue({
      userId: "session-user",
      username: "session-user",
      version: 1,
    });
    vi.mocked(requireTrustedOrigin).mockImplementation(() => {
      throw new Error("untrusted");
    });

    const response = await POST(request(validRequest));

    expect(response.status).toBe(403);
    expect(generatePortfolioAiReview).not.toHaveBeenCalled();
  });

  test("uses only the verified session owner for a valid request", async () => {
    vi.mocked(getSession).mockResolvedValue({
      userId: "session-user",
      username: "session-user",
      version: 1,
    });
    vi.mocked(generatePortfolioAiReview).mockResolvedValue({
      review: { headline: "Review" },
      snapshot: { schemaVersion: 1 },
      provider: { name: "openai", host: "api.openai.com", model: "model" },
      usage: { inputTokens: 10, outputTokens: 5 },
      generatedAt: "2026-08-04T12:00:00.000Z",
    } as Awaited<ReturnType<typeof generatePortfolioAiReview>>);

    const incoming = request({ ...validRequest, userId: "attacker-user" });
    const invalidResponse = await POST(incoming);
    expect(invalidResponse.status).toBe(400);
    expect(generatePortfolioAiReview).not.toHaveBeenCalled();

    const validIncoming = request(validRequest);
    const response = await POST(validIncoming);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(generatePortfolioAiReview).toHaveBeenCalledWith(
      "session-user",
      validRequest,
      expect.objectContaining({ signal: validIncoming.signal }),
    );
  });

  test("logs safe provider diagnostics for a 502 response", async () => {
    vi.mocked(getSession).mockResolvedValue({
      userId: "session-user",
      username: "session-user",
      version: 1,
    });
    vi.mocked(generatePortfolioAiReview).mockRejectedValue(
      new AiProviderUnavailableError({
        failureKind: "api_error",
        providerHost: "api.openai.com",
        providerModel: "missing-model",
        providerStatus: 404,
        providerCode: "model_not_found",
        providerType: "invalid_request_error",
        providerParam: "model",
        providerRequestId: "request-error",
      }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request(validRequest));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "The AI provider is unavailable. Try again later.",
    });
    expect(errorLog).toHaveBeenCalledWith("AI portfolio review failed:", {
      errorName: "AiProviderUnavailableError",
      responseStatus: 502,
      failureKind: "api_error",
      providerHost: "api.openai.com",
      providerModel: "missing-model",
      providerStatus: 404,
      providerCode: "model_not_found",
      providerType: "invalid_request_error",
      providerParam: "model",
      providerRequestId: "request-error",
    });
    const serializedLog = JSON.stringify(errorLog.mock.calls);
    expect(serializedLog).not.toContain(validRequest.apiKey);
    expect(serializedLog).not.toContain("session-user");
  });
});
