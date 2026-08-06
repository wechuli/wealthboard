// @vitest-environment node

import { describe, expect, test } from "vitest";

import { AuthConfigurationError, parseAuthConfig } from "@/lib/auth/config";

const transactionSecret = Buffer.alloc(32, 7).toString("base64");

function oidcEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    AUTH_METHODS: "oidc",
    APP_URL: "https://wealth.example.test",
    OIDC_ISSUER: "https://identity.example.test/realms/wealthboard/",
    OIDC_CLIENT_ID: "wealthboard",
    OIDC_CLIENT_SECRET: "provider-secret",
    OIDC_TRANSACTION_SECRET: transactionSecret,
    OIDC_PROVIDER_NAME: "Example Identity",
    ...overrides,
  };
}

describe("authentication configuration", () => {
  test("defaults to backward-compatible local authentication", () => {
    expect(parseAuthConfig({})).toEqual({
      methods: ["local"],
      localEnabled: true,
      oidcEnabled: false,
    });
  });

  test.each(["oidc", "local,oidc"])(
    "validates and canonicalizes %s mode",
    (methods) => {
      const config = parseAuthConfig(
        oidcEnvironment({ AUTH_METHODS: methods }),
      );

      expect(config.methods).toEqual(methods.split(","));
      expect(config.localEnabled).toBe(methods.startsWith("local"));
      expect(config.oidc).toMatchObject({
        issuer: "https://identity.example.test/realms/wealthboard",
        clientId: "wealthboard",
        providerName: "Example Identity",
        callbackUrl: "https://wealth.example.test/api/auth/oidc/callback",
        scopes: ["openid", "profile", "email"],
        algorithms: ["RS256"],
      });
      expect(config.oidc?.transactionSecret).toHaveLength(32);
    },
  );

  test.each(["", "password", "local,local", "local,oidc,oidc", "oidc,local"])(
    "rejects invalid method list %j",
    (methods) => {
      expect(() => parseAuthConfig({ AUTH_METHODS: methods })).toThrow(
        AuthConfigurationError,
      );
    },
  );

  test.each([
    ["APP_URL", undefined],
    ["OIDC_ISSUER", undefined],
    ["OIDC_CLIENT_ID", undefined],
    ["OIDC_CLIENT_SECRET", undefined],
    ["OIDC_TRANSACTION_SECRET", undefined],
    ["OIDC_PROVIDER_NAME", undefined],
  ] as const)("requires %s in OIDC modes", (name, value) => {
    expect(() => parseAuthConfig(oidcEnvironment({ [name]: value }))).toThrow(
      name,
    );
  });

  test.each([
    ["APP_URL", "http://wealth.example.test"],
    ["APP_URL", "https://user:pass@wealth.example.test"],
    ["APP_URL", "https://wealth.example.test/base"],
    ["OIDC_ISSUER", "https://identity.example.test/realm?tenant=one"],
    ["OIDC_ISSUER", "ftp://identity.example.test/realm"],
  ])("rejects unsafe %s URLs", (name, value) => {
    expect(() => parseAuthConfig(oidcEnvironment({ [name]: value }))).toThrow(
      AuthConfigurationError,
    );
  });

  test("allows HTTP only for explicit localhost development", () => {
    const config = parseAuthConfig(
      oidcEnvironment({
        APP_URL: "http://localhost:3000",
        OIDC_ISSUER: "http://127.0.0.1:8080/realms/wealthboard",
      }),
    );

    expect(config.appUrl).toBe("http://localhost:3000");
    expect(config.oidc?.issuer).toBe(
      "http://127.0.0.1:8080/realms/wealthboard",
    );
  });

  test.each(["not-base64", Buffer.alloc(31).toString("base64")])(
    "rejects malformed transaction secret %j",
    (value) => {
      expect(() =>
        parseAuthConfig(oidcEnvironment({ OIDC_TRANSACTION_SECRET: value })),
      ).toThrow("OIDC_TRANSACTION_SECRET");
    },
  );
});
