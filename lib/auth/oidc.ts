import "server-only";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  createRemoteJWKSet,
  EncryptJWT,
  jwtDecrypt,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";

import type { OidcAuthConfig } from "@/lib/auth/config";

const DISCOVERY_TIMEOUT_MS = 5_000;
const TOKEN_TIMEOUT_MS = 8_000;
const DISCOVERY_CACHE_MS = 5 * 60_000;
const MAX_DISCOVERY_BYTES = 256 * 1024;
const MAX_TOKEN_RESPONSE_BYTES = 256 * 1024;
const CLOCK_TOLERANCE_SECONDS = 5;

export const OIDC_TRANSACTION_COOKIE = "wealthboard_oidc_transaction";
export const OIDC_TRANSACTION_MAX_AGE_SECONDS = 10 * 60;
export const OIDC_REAUTH_COOKIE = "wealthboard_oidc_reauth";
export const OIDC_REAUTH_MAX_AGE_SECONDS = 5 * 60;

export type OidcIntent = "login" | "link" | "reauth_local";

export class OidcProtocolError extends Error {
  constructor(
    public readonly code:
      | "provider_unavailable"
      | "invalid_metadata"
      | "invalid_transaction"
      | "invalid_callback"
      | "token_exchange_failed"
      | "invalid_id_token",
  ) {
    super("OIDC authentication could not be completed.");
    this.name = "OidcProtocolError";
  }
}

const discoverySchema = z
  .object({
    issuer: z.string().min(1).max(2048),
    authorization_endpoint: z.string().min(1).max(2048),
    token_endpoint: z.string().min(1).max(2048),
    jwks_uri: z.string().min(1).max(2048),
    id_token_signing_alg_values_supported: z.array(z.string()).min(1).max(20),
  })
  .passthrough();

const tokenResponseSchema = z
  .object({
    id_token: z.string().min(1).max(200_000),
  })
  .passthrough();

const transactionSchema = z
  .object({
    state: z.string().min(32).max(256),
    nonce: z.string().min(32).max(256),
    verifier: z.string().min(43).max(128),
    next: z.string().min(1).max(1000),
    intent: z.enum(["login", "link", "reauth_local"]),
    linkingUserId: z.string().uuid().optional(),
    linkingSessionVersion: z.number().int().positive().optional(),
    iat: z.number(),
    exp: z.number(),
    jti: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (
      value.intent === "login" &&
      (value.linkingUserId || value.linkingSessionVersion)
    ) {
      context.addIssue({
        code: "custom",
        message: "Login transactions must not include a user.",
      });
    }
    if (
      value.intent !== "login" &&
      (!value.linkingUserId || !value.linkingSessionVersion)
    ) {
      context.addIssue({
        code: "custom",
        message: "Authenticated transactions require a user.",
      });
    }
  });

const reauthGrantSchema = z.object({
  userId: z.string().uuid(),
  purpose: z.literal("manage_local_credential"),
  iat: z.number(),
  exp: z.number(),
  jti: z.string().uuid(),
});

export type OidcMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  algorithms: readonly ["RS256"];
};

export type OidcTransaction = z.infer<typeof transactionSchema>;

type DiscoveryCacheEntry = {
  metadata: OidcMetadata;
  expiresAt: number;
};

const discoveryCache = new Map<string, DiscoveryCacheEntry>();
const discoveryRequests = new Map<string, Promise<OidcMetadata>>();
const remoteJwksCache = new Map<string, JWTVerifyGetKey>();

function localhostUrl(url: URL) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
}

function secureEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcProtocolError("invalid_metadata");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && localhostUrl(url)))
  ) {
    throw new OidcProtocolError("invalid_metadata");
  }
  return url.toString();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new OidcProtocolError("provider_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedResponseText(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximumBytes) {
    throw new OidcProtocolError("provider_unavailable");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new OidcProtocolError("provider_unavailable");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function jsonResponse(
  response: Response,
  maximumBytes: number,
  errorCode: OidcProtocolError["code"],
) {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    !response.ok ||
    !mediaType ||
    (mediaType !== "application/json" && !mediaType.endsWith("+json"))
  ) {
    throw new OidcProtocolError(errorCode);
  }
  const text = await boundedResponseText(response, maximumBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OidcProtocolError(errorCode);
  }
}

async function fetchDiscovery(config: OidcAuthConfig) {
  const discoveryUrl = `${config.issuer}/.well-known/openid-configuration`;
  const response = await fetchWithTimeout(
    discoveryUrl,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
    DISCOVERY_TIMEOUT_MS,
  );
  const parsed = discoverySchema.safeParse(
    await jsonResponse(response, MAX_DISCOVERY_BYTES, "provider_unavailable"),
  );
  if (!parsed.success || parsed.data.issuer !== config.issuer) {
    throw new OidcProtocolError("invalid_metadata");
  }
  if (!parsed.data.id_token_signing_alg_values_supported.includes("RS256")) {
    throw new OidcProtocolError("invalid_metadata");
  }
  return {
    issuer: parsed.data.issuer,
    authorizationEndpoint: secureEndpoint(parsed.data.authorization_endpoint),
    tokenEndpoint: secureEndpoint(parsed.data.token_endpoint),
    jwksUri: secureEndpoint(parsed.data.jwks_uri),
    algorithms: ["RS256"] as const,
  };
}

export async function discoverOidcProvider(
  config: OidcAuthConfig,
  options: { force?: boolean } = {},
) {
  const cached = discoveryCache.get(config.issuer);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.metadata;
  }
  const pending = discoveryRequests.get(config.issuer);
  if (!options.force && pending) return pending;

  const request = fetchDiscovery(config)
    .then((metadata) => {
      discoveryCache.set(config.issuer, {
        metadata,
        expiresAt: Date.now() + DISCOVERY_CACHE_MS,
      });
      return metadata;
    })
    .finally(() => discoveryRequests.delete(config.issuer));
  discoveryRequests.set(config.issuer, request);
  return request;
}

function randomBase64Url(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}

export function safeRelativePath(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }
  try {
    const parsed = new URL(value, "https://wealthboard.invalid");
    if (parsed.origin !== "https://wealthboard.invalid" || parsed.hash)
      return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

export function createAuthorizationRequest(
  config: OidcAuthConfig,
  metadata: OidcMetadata,
  options: {
    next?: string | null;
    intent?: OidcIntent;
    linkingUserId?: string;
    linkingSessionVersion?: number;
  } = {},
) {
  const state = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizationUrl = new URL(metadata.authorizationEndpoint);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", config.callbackUrl);
  authorizationUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return {
    authorizationUrl,
    transaction: {
      state,
      nonce,
      verifier,
      next: safeRelativePath(options.next),
      intent: options.intent ?? "login",
      ...(options.linkingUserId
        ? { linkingUserId: options.linkingUserId }
        : {}),
      ...(options.linkingSessionVersion
        ? { linkingSessionVersion: options.linkingSessionVersion }
        : {}),
    },
  };
}

export async function sealOidcTransaction(
  config: OidcAuthConfig,
  transaction: ReturnType<typeof createAuthorizationRequest>["transaction"],
) {
  return new EncryptJWT({
    state: transaction.state,
    nonce: transaction.nonce,
    verifier: transaction.verifier,
    next: transaction.next,
    intent: transaction.intent,
    ...(transaction.linkingUserId
      ? { linkingUserId: transaction.linkingUserId }
      : {}),
    ...(transaction.linkingSessionVersion
      ? { linkingSessionVersion: transaction.linkingSessionVersion }
      : {}),
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuer("wealthboard:oidc-transaction")
    .setAudience("wealthboard:oidc-callback")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${OIDC_TRANSACTION_MAX_AGE_SECONDS}s`)
    .encrypt(config.transactionSecret);
}

export async function openOidcTransaction(
  config: OidcAuthConfig,
  token: string,
) {
  try {
    const { payload } = await jwtDecrypt(token, config.transactionSecret, {
      issuer: "wealthboard:oidc-transaction",
      audience: "wealthboard:oidc-callback",
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    const parsed = transactionSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Invalid transaction payload.");
    return parsed.data;
  } catch {
    throw new OidcProtocolError("invalid_transaction");
  }
}

export async function sealOidcReauthGrant(
  config: OidcAuthConfig,
  userId: string,
) {
  return new EncryptJWT({
    userId,
    purpose: "manage_local_credential",
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuer("wealthboard:oidc-reauth")
    .setAudience("wealthboard:settings")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${OIDC_REAUTH_MAX_AGE_SECONDS}s`)
    .encrypt(config.transactionSecret);
}

export async function openOidcReauthGrant(
  config: OidcAuthConfig,
  token: string,
) {
  try {
    const { payload } = await jwtDecrypt(token, config.transactionSecret, {
      issuer: "wealthboard:oidc-reauth",
      audience: "wealthboard:settings",
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    const parsed = reauthGrantSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Invalid reauthentication grant.");
    return parsed.data;
  } catch {
    throw new OidcProtocolError("invalid_transaction");
  }
}

export function constantTimeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash) && left.length === right.length;
}

export async function exchangeAuthorizationCode(
  config: OidcAuthConfig,
  metadata: OidcMetadata,
  input: { code: string; verifier: string },
) {
  if (
    !input.code ||
    input.code.length > 4096 ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)
  ) {
    throw new OidcProtocolError("invalid_callback");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    code: input.code,
    code_verifier: input.verifier,
  });
  const response = await fetchWithTimeout(
    metadata.tokenEndpoint,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    },
    TOKEN_TIMEOUT_MS,
  );
  const parsed = tokenResponseSchema.safeParse(
    await jsonResponse(
      response,
      MAX_TOKEN_RESPONSE_BYTES,
      "token_exchange_failed",
    ),
  );
  if (!parsed.success) {
    throw new OidcProtocolError("token_exchange_failed");
  }
  return { idToken: parsed.data.id_token };
}

function remoteJwks(metadata: OidcMetadata) {
  let keySet = remoteJwksCache.get(metadata.jwksUri);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(metadata.jwksUri), {
      timeoutDuration: DISCOVERY_TIMEOUT_MS,
      cooldownDuration: 30_000,
      cacheMaxAge: DISCOVERY_CACHE_MS,
    });
    remoteJwksCache.set(metadata.jwksUri, keySet);
  }
  return keySet;
}

export async function verifyOidcIdToken(
  config: OidcAuthConfig,
  metadata: OidcMetadata,
  idToken: string,
  expectedNonce: string,
  keySet: JWTVerifyGetKey = remoteJwks(metadata),
) {
  try {
    const { payload } = await jwtVerify(idToken, keySet, {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: [...config.algorithms],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 512 ||
      payload.sub.trim() !== payload.sub ||
      /[\u0000-\u001f\u007f]/.test(payload.sub) ||
      typeof payload.nonce !== "string" ||
      !constantTimeEqual(payload.nonce, expectedNonce)
    ) {
      throw new Error("Invalid required claims.");
    }
    return {
      issuer: config.issuer,
      subject: payload.sub,
      name: payload.name,
      preferredUsername: payload.preferred_username,
    };
  } catch {
    throw new OidcProtocolError("invalid_id_token");
  }
}

export function clearOidcCachesForTests() {
  discoveryCache.clear();
  discoveryRequests.clear();
  remoteJwksCache.clear();
}
