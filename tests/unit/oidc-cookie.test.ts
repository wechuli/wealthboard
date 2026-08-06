// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(cookieStore),
}));

import {
  clearOidcReauthGrant,
  consumeOidcReauthGrant,
  consumeOidcTransaction,
  storeOidcReauthGrant,
  storeOidcTransaction,
} from "@/lib/auth/oidc-cookie";
import {
  OIDC_REAUTH_COOKIE,
  OIDC_REAUTH_MAX_AGE_SECONDS,
  OIDC_TRANSACTION_COOKIE,
  OIDC_TRANSACTION_MAX_AGE_SECONDS,
} from "@/lib/auth/oidc";

describe("OIDC transaction cookie", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("stores an encrypted transaction separately with narrow attributes", async () => {
    await storeOidcTransaction("encrypted-transaction");

    expect(cookieStore.set).toHaveBeenCalledWith(
      OIDC_TRANSACTION_COOKIE,
      "encrypted-transaction",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/api/auth/oidc/callback",
        expires: new Date(Date.now() + OIDC_TRANSACTION_MAX_AGE_SECONDS * 1000),
      }),
    );
  });

  test("reads and clears the transaction on every callback attempt", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "one-use-transaction" });

    await expect(consumeOidcTransaction()).resolves.toBe("one-use-transaction");
    expect(cookieStore.set).toHaveBeenCalledWith(
      OIDC_TRANSACTION_COOKIE,
      "",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/api/auth/oidc/callback",
        expires: new Date(0),
      }),
    );
  });

  test("stores reauthentication separately for Settings with stricter attributes", async () => {
    await storeOidcReauthGrant("encrypted-reauth");

    expect(cookieStore.set).toHaveBeenCalledWith(
      OIDC_REAUTH_COOKIE,
      "encrypted-reauth",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/settings",
        expires: new Date(Date.now() + OIDC_REAUTH_MAX_AGE_SECONDS * 1000),
      }),
    );
  });

  test("consumes a Settings reauthentication grant once", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "encrypted-reauth" });
    await expect(consumeOidcReauthGrant()).resolves.toBe("encrypted-reauth");
    expect(cookieStore.set).toHaveBeenCalledWith(
      OIDC_REAUTH_COOKIE,
      "",
      expect.objectContaining({ path: "/settings", expires: new Date(0) }),
    );

    await clearOidcReauthGrant();
  });
});
