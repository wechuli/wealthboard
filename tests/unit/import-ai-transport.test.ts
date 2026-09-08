// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { AiImportResponseError, importAiTransport } from "@/lib/ai/provider";

const output = {
  schemaVersion: 1,
  sourceCurrency: "USD",
  records: [],
  exclusions: [],
  issues: ["No activity"],
};
const input = {
  provider: "deepseek" as const,
  baseUrl: "https://api.deepseek.com",
  apiKey: "fixture-secret",
  model: "fixture-model",
  maxOutputTokens: 1000,
  prompt: "Approved source JSON",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("structured import provider transport", () => {
  it("accepts only complete JSON from text-compatible providers without redirects or retries", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(output) },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await importAiTransport(input)).toMatchObject({
      extraction: output,
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 120_000);
  });

  it("rejects truncated output even when the returned JSON is syntactically valid", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: JSON.stringify(output) },
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(importAiTransport(input)).rejects.toThrow("output limit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses OpenAI native JSON schema with storage disabled and rejects refusals", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "fixture",
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "No" }],
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      importAiTransport({
        ...input,
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
      }),
    ).rejects.toBeInstanceOf(AiImportResponseError);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 120_000);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      model: "fixture-model",
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(body.tools).toBeUndefined();
  });
});
