import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireAccount: vi.fn(),
  convert: vi.fn(),
  provider: vi.fn(),
  extract: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/services/import-conversion", async (original) => ({
  ...(await original<typeof import("@/lib/services/import-conversion")>()),
  requireImportAccount: mocks.requireAccount,
  convertImportSource: mocks.convert,
  getImportProvider: mocks.provider,
}));
vi.mock("@/lib/services/import-source", async (original) => ({
  ...(await original<typeof import("@/lib/services/import-source")>()),
  extractImportSource: mocks.extract,
}));

import { POST as extract } from "@/app/api/accounts/[id]/import/extract/route";
import { POST as convert } from "@/app/api/accounts/[id]/import/convert/route";
import { ImportAccountAccessError } from "@/lib/services/import-conversion";

beforeEach(() => vi.stubEnv("APP_URL", "http://localhost"));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function request(
  body: BodyInit,
  contentType = "application/json",
  origin = "http://localhost",
) {
  return new Request("http://localhost/api/accounts/alice/import/convert", {
    method: "POST",
    headers: { origin, "content-type": contentType },
    body,
  });
}

describe("import preparation HTTP boundary", () => {
  it("requires authentication and a trusted origin", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect(
      (
        await convert(request("{}"), {
          params: Promise.resolve({ id: "alice" }),
        })
      ).status,
    ).toBe(401);
    mocks.getSession.mockResolvedValue({ userId: "alice" });
    expect(
      (
        await convert(
          request("{}", "application/json", "https://foreign.test"),
          { params: Promise.resolve({ id: "alice" }) },
        )
      ).status,
    ).toBe(403);
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("denies Bob's direct request for Alice's account before reading or extracting files", async () => {
    mocks.getSession.mockResolvedValue({ userId: "bob" });
    mocks.requireAccount.mockRejectedValue(new ImportAccountAccessError());
    const response = await extract(request("not a file"), {
      params: Promise.resolve({ id: "alice" }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireAccount).toHaveBeenCalledWith("bob", "alice");
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("passes only the verified user to conversion and never caches the draft", async () => {
    mocks.getSession.mockResolvedValue({ userId: "alice" });
    mocks.requireAccount.mockResolvedValue({ id: "alice" });
    mocks.convert.mockResolvedValue({ content: "{}" });
    const response = await convert(request('{"consent":true}'), {
      params: Promise.resolve({ id: "alice" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.convert).toHaveBeenCalledWith(
      "alice",
      "alice",
      { consent: true },
      expect.any(Object),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
