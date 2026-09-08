// @vitest-environment node

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
import { ImportSourceError } from "@/lib/services/import-source";

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
  function pdfRequest(password?: string | Blob, duplicate = false) {
    const body = new FormData();
    body.set(
      "file",
      new File(["%PDF-fictional"], "statement.pdf", {
        type: "application/pdf",
      }),
    );
    if (password !== undefined) body.set("documentPassword", password);
    if (duplicate) body.append("documentPassword", "second-value");
    return new Request("http://localhost/api/accounts/alice/import/extract", {
      method: "POST",
      headers: { origin: "http://localhost" },
      body,
    });
  }

  it("passes the exact password only to local extraction and returns no credential", async () => {
    mocks.getSession.mockResolvedValue({ userId: "alice" });
    mocks.requireAccount.mockResolvedValue({ id: "alice" });
    mocks.extract.mockResolvedValue({ units: [], warnings: [] });
    mocks.provider.mockResolvedValue(null);
    const password = " fictional password with spaces ";
    const response = await extract(pdfRequest(password), {
      params: Promise.resolve({ id: "alice" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.extract).toHaveBeenCalledWith(
      "statement.pdf",
      expect.any(Uint8Array),
      expect.any(AbortSignal),
      password,
    );
    expect(await response.text()).not.toContain(password);
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each(["password_required", "incorrect_password"] as const)(
    "returns the safe %s code without provider lookup",
    async (code) => {
      mocks.getSession.mockResolvedValue({ userId: "alice" });
      mocks.requireAccount.mockResolvedValue({ id: "alice" });
      mocks.extract.mockRejectedValue(
        new ImportSourceError("Enter the PDF password again.", code),
      );
      const response = await extract(pdfRequest("fictional-password"), {
        params: Promise.resolve({ id: "alice" }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Enter the PDF password again.",
        code,
      });
      expect(mocks.provider).not.toHaveBeenCalled();
    },
  );

  it("rejects password files, excessive lengths, and duplicate password fields before extraction", async () => {
    mocks.getSession.mockResolvedValue({ userId: "alice" });
    mocks.requireAccount.mockResolvedValue({ id: "alice" });
    for (const request of [
      pdfRequest(new Blob(["not text"])),
      pdfRequest("x".repeat(1025)),
      pdfRequest("first-value", true),
    ]) {
      expect(
        (await extract(request, { params: Promise.resolve({ id: "alice" }) }))
          .status,
      ).toBe(400);
    }
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("denies another user's password-bearing upload before parsing it", async () => {
    mocks.getSession.mockResolvedValue({ userId: "bob" });
    mocks.requireAccount.mockRejectedValue(new ImportAccountAccessError());
    const response = await extract(pdfRequest("fictional-password"), {
      params: Promise.resolve({ id: "alice" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("fictional-password");
  });

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
