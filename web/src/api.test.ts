import { afterEach, describe, expect, it, vi } from "vitest";

import { mutate } from "./api";

describe("mutate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends session CSRF and a stable caller-provided idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const key = "11111111-1111-4111-8111-111111111111";

    await mutate("/transactions", "csrf-token", {
      method: "POST",
      idempotencyKey: key,
      body: { idempotencyKey: key, amountMinor: "2500" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/transactions",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
          "Idempotency-Key": key,
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      idempotencyKey: key,
      amountMinor: "2500",
    });
  });
});
