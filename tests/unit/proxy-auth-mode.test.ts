// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: vi.fn() }));
vi.mock("@/lib/auth/token", () => ({
  SESSION_COOKIE: "wealthboard_session",
  verifySessionToken: vi.fn(),
}));

import { proxy } from "@/proxy";
import { getAuthConfig } from "@/lib/auth/config";
import { verifySessionToken } from "@/lib/auth/token";

function request(path: string, session?: string) {
  return new NextRequest(`https://wealth.example.test${path}`, {
    headers: session ? { Cookie: `wealthboard_session=${session}` } : undefined,
  });
}

describe("proxy authentication mode policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifySessionToken).mockResolvedValue(null);
  });

  test("local mode exposes signup and hides both OIDC protocol endpoints", async () => {
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["local"],
      localEnabled: true,
      oidcEnabled: false,
    });

    const signup = await proxy(request("/signup"));
    const start = await proxy(request("/api/auth/oidc/start"));
    const callback = await proxy(request("/api/auth/oidc/callback"));

    expect(signup.headers.get("x-middleware-next")).toBe("1");
    expect(start.status).toBe(404);
    expect(callback.status).toBe(404);
  });

  test("OIDC-only hides signup and exposes only the two protocol endpoints", async () => {
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["oidc"],
      localEnabled: false,
      oidcEnabled: true,
    });
    vi.mocked(verifySessionToken).mockResolvedValue({
      sub: "00000000-0000-4000-8000-000000000001",
      version: 1,
    });

    const signup = await proxy(request("/signup", "valid-session"));
    const start = await proxy(request("/api/auth/oidc/start"));
    const callback = await proxy(request("/api/auth/oidc/callback"));

    expect(signup.headers.get("location")).toBe(
      "https://wealth.example.test/login",
    );
    expect(start.headers.get("x-middleware-next")).toBe("1");
    expect(callback.headers.get("x-middleware-next")).toBe("1");
  });

  test("hybrid exposes local signup and both OIDC endpoints", async () => {
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["local", "oidc"],
      localEnabled: true,
      oidcEnabled: true,
    });

    expect(
      (await proxy(request("/signup"))).headers.get("x-middleware-next"),
    ).toBe("1");
    expect(
      (await proxy(request("/api/auth/oidc/start"))).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });

  test("other APIs remain protected independently of auth mode", async () => {
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["oidc"],
      localEnabled: false,
      oidcEnabled: true,
    });

    const response = await proxy(request("/api/export/json"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  });
});
