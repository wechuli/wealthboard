// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/config", () => ({ getAuthConfig: vi.fn() }));
vi.mock("@/lib/auth/oidc-cookie", () => ({
  storeOidcTransaction: vi.fn(),
  consumeOidcTransaction: vi.fn(),
  storeOidcReauthGrant: vi.fn(),
}));
vi.mock("@/lib/auth/oidc", () => ({
  constantTimeEqual: vi.fn(),
  createAuthorizationRequest: vi.fn(),
  discoverOidcProvider: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  openOidcTransaction: vi.fn(),
  sealOidcReauthGrant: vi.fn(),
  sealOidcTransaction: vi.fn(),
  verifyOidcIdToken: vi.fn(),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  oidcRequestRateLimit: vi.fn(),
}));
vi.mock("@/lib/auth/request", () => ({ clientAddress: vi.fn(() => "client") }));
vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/auth/users", () => ({
  linkOidcIdentity: vi.fn(),
  reauthenticateOidcIdentity: vi.fn(),
  resolveOidcLogin: vi.fn(),
}));

import { GET as callbackGet } from "@/app/api/auth/oidc/callback/route";
import { GET as startGet } from "@/app/api/auth/oidc/start/route";
import { getAuthConfig, type AuthConfig } from "@/lib/auth/config";
import {
  consumeOidcTransaction,
  storeOidcTransaction,
  storeOidcReauthGrant,
} from "@/lib/auth/oidc-cookie";
import {
  constantTimeEqual,
  createAuthorizationRequest,
  discoverOidcProvider,
  exchangeAuthorizationCode,
  openOidcTransaction,
  sealOidcReauthGrant,
  sealOidcTransaction,
  verifyOidcIdToken,
} from "@/lib/auth/oidc";
import { oidcRequestRateLimit } from "@/lib/auth/rate-limit";
import { createSession, getSession } from "@/lib/auth/session";
import {
  linkOidcIdentity,
  reauthenticateOidcIdentity,
  resolveOidcLogin,
} from "@/lib/auth/users";

const oidc = {
  issuer: "https://identity.example.test/realm",
  clientId: "wealthboard",
  clientSecret: "provider-secret",
  transactionSecret: new Uint8Array(32),
  providerName: "Example Identity",
  callbackUrl: "https://wealth.example.test/api/auth/oidc/callback",
  scopes: ["openid", "profile", "email"],
  algorithms: ["RS256"],
} as const;
const enabledConfig: AuthConfig = {
  methods: ["oidc"],
  localEnabled: false,
  oidcEnabled: true,
  appUrl: "https://wealth.example.test",
  oidc,
};
const metadata = {
  issuer: oidc.issuer,
  authorizationEndpoint: "https://identity.example.test/auth",
  tokenEndpoint: "https://identity.example.test/token",
  jwksUri: "https://identity.example.test/jwks",
  algorithms: ["RS256"] as const,
};
const transaction = {
  state: "s".repeat(43),
  nonce: "n".repeat(43),
  verifier: "v".repeat(64),
  next: "/reports",
  intent: "login" as const,
  iat: 1,
  exp: 2,
  jti: "00000000-0000-4000-8000-000000000001",
};

function request(path: string) {
  return new NextRequest(`https://wealth.example.test${path}`, {
    headers: { "x-real-ip": "192.0.2.1" },
  });
}

describe("OIDC routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getAuthConfig).mockReturnValue(enabledConfig);
    vi.mocked(oidcRequestRateLimit).mockReturnValue({
      allowed: true,
      retryAfterMinutes: 15,
    });
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(discoverOidcProvider).mockResolvedValue(metadata);
    vi.mocked(createAuthorizationRequest).mockReturnValue({
      authorizationUrl: new URL("https://identity.example.test/authorize"),
      transaction: {
        state: transaction.state,
        nonce: transaction.nonce,
        verifier: transaction.verifier,
        next: transaction.next,
        intent: transaction.intent,
      },
    });
    vi.mocked(sealOidcTransaction).mockResolvedValue("encrypted-transaction");
    vi.mocked(consumeOidcTransaction).mockResolvedValue(
      "encrypted-transaction",
    );
    vi.mocked(openOidcTransaction).mockResolvedValue(transaction);
    vi.mocked(constantTimeEqual).mockReturnValue(true);
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
      idToken: "signed-id-token",
    });
    vi.mocked(verifyOidcIdToken).mockResolvedValue({
      issuer: oidc.issuer,
      subject: "provider-subject",
      name: "OIDC User",
      preferredUsername: "oidc-user",
    });
    vi.mocked(resolveOidcLogin).mockReturnValue({
      userId: "00000000-0000-4000-8000-000000000010",
      sessionVersion: 1,
      sessionTimeoutMinutes: 10080,
      isNewUser: true,
    });
    vi.mocked(linkOidcIdentity).mockReturnValue({
      userId: "00000000-0000-4000-8000-000000000010",
      sessionVersion: 2,
      sessionTimeoutMinutes: 10080,
    });
    vi.mocked(reauthenticateOidcIdentity).mockReturnValue({
      userId: "00000000-0000-4000-8000-000000000010",
      sessionVersion: 2,
      sessionTimeoutMinutes: 10080,
    });
    vi.mocked(sealOidcReauthGrant).mockResolvedValue("encrypted-reauth-grant");
  });

  test("disabled OIDC routes are indistinguishable from missing routes", async () => {
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["local"],
      localEnabled: true,
      oidcEnabled: false,
    });

    const start = await startGet(request("/api/auth/oidc/start"));
    const callback = await callbackGet(
      request("/api/auth/oidc/callback?state=x&code=y"),
    );

    expect(start.status).toBe(404);
    expect(callback.status).toBe(404);
    expect(discoverOidcProvider).not.toHaveBeenCalled();
    expect(consumeOidcTransaction).toHaveBeenCalledTimes(1);
  });

  test("start stores one encrypted transaction and redirects to the provider", async () => {
    const response = await startGet(
      request("/api/auth/oidc/start?next=%2Freports"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://identity.example.test/authorize",
    );
    expect(createAuthorizationRequest).toHaveBeenCalledWith(oidc, metadata, {
      next: "/reports",
    });
    expect(storeOidcTransaction).toHaveBeenCalledWith("encrypted-transaction");
  });

  test("start reports temporary provider unavailability without exposing details", async () => {
    vi.mocked(discoverOidcProvider).mockRejectedValueOnce(
      new Error("provider host and secret details"),
    );

    const response = await startGet(request("/api/auth/oidc/start"));

    expect(response.headers.get("location")).toBe(
      "https://wealth.example.test/login?oidc_error=unavailable",
    );
    expect(storeOidcTransaction).not.toHaveBeenCalled();
  });

  test("callback consumes the cookie before rejecting missing or mismatched state", async () => {
    vi.mocked(consumeOidcTransaction).mockResolvedValueOnce(null);
    const missing = await callbackGet(
      request("/api/auth/oidc/callback?state=x&code=y"),
    );
    expect(missing.headers.get("location")).toContain(
      "oidc_error=invalid_callback",
    );
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();

    vi.mocked(consumeOidcTransaction).mockResolvedValueOnce(
      "encrypted-transaction",
    );
    vi.mocked(constantTimeEqual).mockReturnValueOnce(false);
    const mismatch = await callbackGet(
      request("/api/auth/oidc/callback?state=wrong&code=one-use-code"),
    );
    expect(mismatch.headers.get("location")).toContain(
      "oidc_error=invalid_callback",
    );
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(consumeOidcTransaction).toHaveBeenCalledTimes(2);
  });

  test("provider errors consume the transaction without exchanging a code", async () => {
    const response = await callbackGet(
      request(
        `/api/auth/oidc/callback?state=${transaction.state}&error=access_denied`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://wealth.example.test/login?oidc_error=provider",
    );
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  test("a valid callback issues the session before a same-origin handoff", async () => {
    const response = await callbackGet(
      request(
        `/api/auth/oidc/callback?state=${transaction.state}&code=one-use-code`,
      ),
    );

    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(oidc, metadata, {
      code: "one-use-code",
      verifier: transaction.verifier,
    });
    expect(verifyOidcIdToken).toHaveBeenCalledWith(
      oidc,
      metadata,
      "signed-id-token",
      transaction.nonce,
    );
    expect(resolveOidcLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        issuer: oidc.issuer,
        subject: "provider-subject",
      }),
    );
    expect(createSession).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      1,
      10080,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(await response.text()).toContain(
      'window.location.replace("https://wealth.example.test/reports")',
    );
  });

  test("disabled internal users receive a generic access denial", async () => {
    vi.mocked(resolveOidcLogin).mockReturnValueOnce(null);

    const response = await callbackGet(
      request(
        `/api/auth/oidc/callback?state=${transaction.state}&code=one-use-code`,
      ),
    );

    expect(createSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://wealth.example.test/login?oidc_error=access_denied",
    );
  });

  test("link intent attaches only the verified identity to the authenticated user", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      userId: "00000000-0000-4000-8000-000000000010",
      username: "local-user",
      version: 1,
    });
    vi.mocked(openOidcTransaction).mockResolvedValueOnce({
      ...transaction,
      intent: "link",
      linkingUserId: "00000000-0000-4000-8000-000000000010",
      linkingSessionVersion: 1,
      next: "/settings?auth=linked",
    });

    const response = await callbackGet(
      request(
        `/api/auth/oidc/callback?state=${transaction.state}&code=one-use-code`,
      ),
    );

    expect(resolveOidcLogin).not.toHaveBeenCalled();
    expect(linkOidcIdentity).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      expect.objectContaining({
        issuer: oidc.issuer,
        subject: "provider-subject",
      }),
      1,
    );
    expect(createSession).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      2,
      10080,
    );
    expect(storeOidcReauthGrant).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'window.location.replace("https://wealth.example.test/settings?auth=linked")',
    );
  });

  test("reauth intent proves the linked identity and issues a short-lived grant", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      userId: "00000000-0000-4000-8000-000000000010",
      username: "oidc-user",
      version: 2,
    });
    vi.mocked(openOidcTransaction).mockResolvedValueOnce({
      ...transaction,
      intent: "reauth_local",
      linkingUserId: "00000000-0000-4000-8000-000000000010",
      linkingSessionVersion: 2,
      next: "/settings?auth=reauthenticated",
    });

    const response = await callbackGet(
      request(
        `/api/auth/oidc/callback?state=${transaction.state}&code=one-use-code`,
      ),
    );

    expect(resolveOidcLogin).not.toHaveBeenCalled();
    expect(reauthenticateOidcIdentity).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      expect.objectContaining({ subject: "provider-subject" }),
      2,
    );
    expect(sealOidcReauthGrant).toHaveBeenCalledWith(
      oidc,
      "00000000-0000-4000-8000-000000000010",
    );
    expect(storeOidcReauthGrant).toHaveBeenCalledWith("encrypted-reauth-grant");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'window.location.replace("https://wealth.example.test/settings?auth=reauthenticated")',
    );
  });

  test("link collisions fail generically without provisioning another user", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      userId: "00000000-0000-4000-8000-000000000010",
      username: "local-user",
      version: 1,
    });
    vi.mocked(openOidcTransaction).mockResolvedValueOnce({
      ...transaction,
      intent: "link",
      linkingUserId: "00000000-0000-4000-8000-000000000010",
      linkingSessionVersion: 1,
      next: "/settings?auth=linked",
    });
    vi.mocked(linkOidcIdentity).mockImplementationOnce(() => {
      throw new Error("identity already owned by secret user id");
    });

    const response = await callbackGet(
      request(
        `/api/auth/oidc/callback?state=${transaction.state}&code=one-use-code`,
      ),
    );

    expect(resolveOidcLogin).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'window.location.replace("https://wealth.example.test/settings?auth=invalid_callback")',
    );
  });

  test("link callbacks reject a stale initiating session version", async () => {
    vi.mocked(openOidcTransaction).mockResolvedValueOnce({
      ...transaction,
      intent: "link",
      linkingUserId: "00000000-0000-4000-8000-000000000010",
      linkingSessionVersion: 1,
      next: "/settings",
    });
    vi.mocked(linkOidcIdentity).mockImplementationOnce(() => {
      throw new Error("stale initiating session");
    });

    const response = await callbackGet(
      request(
        `/api/auth/oidc/callback?state=${transaction.state}&code=one-use-code`,
      ),
    );
    expect(linkOidcIdentity).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      expect.any(Object),
      1,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'window.location.replace("https://wealth.example.test/settings?auth=invalid_callback")',
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  test("rate limits initiation and callback independently", async () => {
    vi.mocked(oidcRequestRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMinutes: 15,
    });

    const start = await startGet(request("/api/auth/oidc/start"));
    const callback = await callbackGet(
      request("/api/auth/oidc/callback?state=x&code=y"),
    );

    expect(start.headers.get("location")).toContain("oidc_error=rate_limited");
    expect(callback.headers.get("location")).toContain(
      "oidc_error=rate_limited",
    );
    expect(discoverOidcProvider).not.toHaveBeenCalled();
  });
});
