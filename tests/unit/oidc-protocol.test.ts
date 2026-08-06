// @vitest-environment node

import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from "jose";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { parseAuthConfig } from "@/lib/auth/config";
import {
  clearOidcCachesForTests,
  constantTimeEqual,
  createAuthorizationRequest,
  discoverOidcProvider,
  exchangeAuthorizationCode,
  OidcProtocolError,
  openOidcTransaction,
  openOidcReauthGrant,
  safeRelativePath,
  sealOidcTransaction,
  sealOidcReauthGrant,
  verifyOidcIdToken,
  type OidcMetadata,
} from "@/lib/auth/oidc";

const config = parseAuthConfig({
  AUTH_METHODS: "oidc",
  APP_URL: "https://wealth.example.test",
  OIDC_ISSUER: "https://identity.example.test/realms/wealthboard",
  OIDC_CLIENT_ID: "wealthboard",
  OIDC_CLIENT_SECRET: "provider-secret",
  OIDC_TRANSACTION_SECRET: Buffer.alloc(32, 9).toString("base64"),
  OIDC_PROVIDER_NAME: "Example Identity",
}).oidc!;

const metadata: OidcMetadata = {
  issuer: config.issuer,
  authorizationEndpoint:
    "https://identity.example.test/realms/wealthboard/protocol/openid-connect/auth",
  tokenEndpoint:
    "https://identity.example.test/realms/wealthboard/protocol/openid-connect/token",
  jwksUri:
    "https://identity.example.test/realms/wealthboard/protocol/openid-connect/certs",
  algorithms: ["RS256"],
};

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let primaryPublicJwk: Awaited<ReturnType<typeof exportJWK>>;
let secondaryPublicJwk: Awaited<ReturnType<typeof exportJWK>>;
let localJwks: ReturnType<typeof createLocalJWKSet>;

function providerMetadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorizationEndpoint,
    token_endpoint: metadata.tokenEndpoint,
    jwks_uri: metadata.jwksUri,
    id_token_signing_alg_values_supported: ["RS256"],
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json", ...init.headers },
    ...init,
  });
}

async function signedIdToken(
  overrides: {
    issuer?: string;
    audience?: string;
    subject?: string;
    nonce?: string;
    expiration?: number | string;
    notBefore?: number | string;
    signingKey?: CryptoKey;
    kid?: string;
  } = {},
) {
  let token = new SignJWT({
    nonce: overrides.nonce ?? "expected-nonce",
    name: "Verified Name",
    preferred_username: "verified-user",
    email: "display-only@example.test",
  })
    .setProtectedHeader({ alg: "RS256", kid: overrides.kid ?? "key-1" })
    .setIssuer(overrides.issuer ?? config.issuer)
    .setAudience(overrides.audience ?? config.clientId)
    .setIssuedAt();
  if (overrides.subject !== "missing") {
    token = token.setSubject(overrides.subject ?? "opaque-subject");
  }
  token = token.setExpirationTime(overrides.expiration ?? "5m");
  if (overrides.notBefore !== undefined) {
    token = token.setNotBefore(overrides.notBefore);
  }
  return token.sign(overrides.signingKey ?? privateKey);
}

beforeAll(async () => {
  const primary = await generateKeyPair("RS256");
  const secondary = await generateKeyPair("RS256");
  privateKey = primary.privateKey;
  otherPrivateKey = secondary.privateKey;
  primaryPublicJwk = await exportJWK(primary.publicKey);
  secondaryPublicJwk = await exportJWK(secondary.publicKey);
  localJwks = createLocalJWKSet({
    keys: [{ ...primaryPublicJwk, kid: "key-1", alg: "RS256", use: "sig" }],
  });
});

afterEach(() => {
  clearOidcCachesForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("OIDC discovery", () => {
  test("supports Keycloak realm metadata and uses the bounded cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(providerMetadata()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverOidcProvider(config)).resolves.toEqual(metadata);
    await expect(discoverOidcProvider(config)).resolves.toEqual(metadata);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${config.issuer}/.well-known/openid-configuration`,
    );
  });

  test.each([
    { issuer: "https://wrong.example.test/realms/wealthboard" },
    { authorization_endpoint: "http://identity.example.test/auth" },
    { token_endpoint: "https://user:pass@identity.example.test/token" },
    { jwks_uri: "javascript:alert(1)" },
    { id_token_signing_alg_values_supported: ["HS256"] },
  ])("rejects unsafe or mismatched metadata %#", async (override) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(providerMetadata(override))),
    );

    await expect(discoverOidcProvider(config)).rejects.toMatchObject({
      code: "invalid_metadata",
    });
  });

  test("rejects non-JSON and oversized discovery responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response("not json", {
            headers: { "Content-Type": "text/plain" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("x".repeat(256 * 1024 + 1), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    await expect(discoverOidcProvider(config)).rejects.toBeInstanceOf(
      OidcProtocolError,
    );
    await expect(
      discoverOidcProvider(config, { force: true }),
    ).rejects.toBeInstanceOf(OidcProtocolError);
  });
});

describe("OIDC authorization transaction", () => {
  test("builds exact authorization parameters and encrypts transaction state", async () => {
    const request = createAuthorizationRequest(config, metadata, {
      next: "/reports?period=1y",
    });
    const url = request.authorizationUrl;

    expect(url.origin + url.pathname).toBe(metadata.authorizationEndpoint);
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("state")).toBe(request.transaction.state);
    expect(url.searchParams.get("nonce")).toBe(request.transaction.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(request.transaction.verifier)
        .digest("base64url"),
    );

    const encrypted = await sealOidcTransaction(config, request.transaction);
    expect(encrypted).not.toContain(request.transaction.state);
    await expect(openOidcTransaction(config, encrypted)).resolves.toMatchObject(
      {
        ...request.transaction,
        jti: expect.any(String),
        iat: expect.any(Number),
        exp: expect.any(Number),
      },
    );
    const parts = encrypted.split(".");
    parts[3] = `${parts[3][0] === "a" ? "b" : "a"}${parts[3].slice(1)}`;
    await expect(
      openOidcTransaction(config, parts.join(".")),
    ).rejects.toMatchObject({ code: "invalid_transaction" });
  });

  test("expires transactions within ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const request = createAuthorizationRequest(config, metadata);
    const encrypted = await sealOidcTransaction(config, request.transaction);
    vi.setSystemTime(new Date("2026-01-01T00:11:00.000Z"));

    await expect(openOidcTransaction(config, encrypted)).rejects.toMatchObject({
      code: "invalid_transaction",
    });
  });

  test("scopes short-lived reauthentication grants to one internal user", async () => {
    const userId = "00000000-0000-4000-8000-000000000010";
    const encrypted = await sealOidcReauthGrant(config, userId);

    expect(encrypted).not.toContain(userId);
    await expect(openOidcReauthGrant(config, encrypted)).resolves.toMatchObject(
      {
        userId,
        purpose: "manage_local_credential",
        jti: expect.any(String),
      },
    );
    const parts = encrypted.split(".");
    parts[3] = `${parts[3][0] === "a" ? "b" : "a"}${parts[3].slice(1)}`;
    await expect(
      openOidcReauthGrant(config, parts.join(".")),
    ).rejects.toMatchObject({ code: "invalid_transaction" });
  });

  test.each([
    ["https://evil.example/path", "/"],
    ["//evil.example/path", "/"],
    ["/safe\\path", "/"],
    ["/accounts?sort=oldest", "/accounts?sort=oldest"],
  ])("normalizes safe next path %j", (value, expected) => {
    expect(safeRelativePath(value)).toBe(expected);
  });

  test("compares callback state without direct string equality", () => {
    expect(constantTimeEqual("same-state", "same-state")).toBe(true);
    expect(constantTimeEqual("same-state", "other-state")).toBe(false);
    expect(constantTimeEqual("short", "shorter")).toBe(false);
  });
});

describe("OIDC token exchange and verification", () => {
  test("sends the code once with the exact callback and PKCE verifier", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id_token: "signed-id-token",
        access_token: "discarded-access-token",
        refresh_token: "discarded-refresh-token",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const verifier = "a".repeat(64);

    await expect(
      exchangeAuthorizationCode(config, metadata, {
        code: "one-use-code",
        verifier,
      }),
    ).resolves.toEqual({ idToken: "signed-id-token" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = init.body as URLSearchParams;
    expect(init.method).toBe("POST");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe(config.clientId);
    expect(body.get("client_secret")).toBe(config.clientSecret);
    expect(body.get("redirect_uri")).toBe(config.callbackUrl);
    expect(body.get("code")).toBe("one-use-code");
    expect(body.get("code_verifier")).toBe(verifier);
  });

  test.each([
    new Response("provider failure", { status: 502 }),
    new Response("{}", { headers: { "Content-Type": "text/plain" } }),
    jsonResponse({ access_token: "missing-id-token" }),
  ])(
    "fails closed for malformed token endpoint response %#",
    async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      await expect(
        exchangeAuthorizationCode(config, metadata, {
          code: "one-use-code",
          verifier: "a".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "token_exchange_failed" });
    },
  );

  test("accepts only verified claims needed for the internal identity", async () => {
    const token = await signedIdToken();

    await expect(
      verifyOidcIdToken(config, metadata, token, "expected-nonce", localJwks),
    ).resolves.toEqual({
      issuer: config.issuer,
      subject: "opaque-subject",
      name: "Verified Name",
      preferredUsername: "verified-user",
    });
  });

  test("caches remote JWKS and reloads a rotated key after cooldown", async () => {
    let requests = 0;
    let keys = [
      { ...primaryPublicJwk, kid: "key-1", alg: "RS256", use: "sig" },
    ];
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ keys }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const remoteMetadata = {
      ...metadata,
      jwksUri: `http://127.0.0.1:${address.port}/jwks`,
    };
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      const first = await signedIdToken();
      await verifyOidcIdToken(config, remoteMetadata, first, "expected-nonce");
      await verifyOidcIdToken(config, remoteMetadata, first, "expected-nonce");
      expect(requests).toBe(1);

      keys = [
        { ...secondaryPublicJwk, kid: "key-2", alg: "RS256", use: "sig" },
      ];
      now += 31_000;
      const rotated = await signedIdToken({
        signingKey: otherPrivateKey,
        kid: "key-2",
      });
      await verifyOidcIdToken(
        config,
        remoteMetadata,
        rotated,
        "expected-nonce",
      );
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test("accepts expiry and not-before values within the clock tolerance", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signedIdToken({
      expiration: now - 3,
      notBefore: now + 3,
    });

    await expect(
      verifyOidcIdToken(config, metadata, token, "expected-nonce", localJwks),
    ).resolves.toMatchObject({ subject: "opaque-subject" });
  });

  test.each([
    ["wrong issuer", { issuer: "https://wrong.example.test" }],
    ["wrong audience", { audience: "another-client" }],
    ["wrong nonce", { nonce: "wrong-nonce" }],
    ["expired token", { expiration: Math.floor(Date.now() / 1000) - 30 }],
    ["early token", { notBefore: Math.floor(Date.now() / 1000) + 30 }],
    ["missing subject", { subject: "missing" }],
    ["wrong signature", { signingKey: undefined }],
  ] as const)("rejects %s", async (name, overrides) => {
    void name;
    const token = await signedIdToken({
      ...overrides,
      ...(name === "wrong signature" ? { signingKey: otherPrivateKey } : {}),
    });

    await expect(
      verifyOidcIdToken(config, metadata, token, "expected-nonce", localJwks),
    ).rejects.toMatchObject({ code: "invalid_id_token" });
  });

  test("rejects an algorithm outside the explicit allowlist", async () => {
    const token = await new SignJWT({ nonce: "expected-nonce" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.issuer)
      .setAudience(config.clientId)
      .setSubject("opaque-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("a-secret-longer-than-thirty-two-bytes"));

    await expect(
      verifyOidcIdToken(config, metadata, token, "expected-nonce", localJwks),
    ).rejects.toMatchObject({ code: "invalid_id_token" });
  });
});
