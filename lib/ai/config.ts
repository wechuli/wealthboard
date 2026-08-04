import "server-only";

import type { AiProvider } from "@/db/schema";

export const AI_PROVIDER_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
} as const;

export const AI_REVIEW_COOLDOWN_MS = 60_000;
export const AI_REVIEW_RATE_LIMIT = 10;
export const AI_USAGE_RETENTION_DAYS = 90;
export const AI_REQUEST_TIMEOUT_MS = 45_000;
export const AI_MAX_SNAPSHOT_BYTES = 25_000;
export const AI_REVIEW_MAX_ACCOUNTS = 1_000;
export const AI_REVIEW_MAX_GOALS = 1_000;
export const AI_REVIEW_MAX_EVENTS = 50_000;

function normalizeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AI endpoints must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "AI endpoints cannot contain credentials, query parameters, or fragments.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function allowedCustomEndpoints() {
  return new Set(
    (process.env.AI_ALLOWED_ENDPOINTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map(normalizeUrl),
  );
}

export function resolveAiBaseUrl(provider: AiProvider, requested?: string) {
  if (provider === "openai") return AI_PROVIDER_BASE_URLS.openai;
  if (provider === "deepseek") return AI_PROVIDER_BASE_URLS.deepseek;
  if (!requested?.trim()) {
    throw new Error("Enter an operator-approved OpenAI-compatible endpoint.");
  }
  const normalized = normalizeUrl(requested.trim());
  if (!allowedCustomEndpoints().has(normalized)) {
    throw new Error("This AI endpoint is not approved by the operator.");
  }
  return normalized;
}

export function aiEndpointHost(baseUrl: string) {
  return new URL(baseUrl).host;
}

export function aiEncryptionAvailable() {
  try {
    readAiEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function readAiEncryptionKey() {
  const value = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  if (!value) {
    throw new Error(
      "Remembering AI credentials requires AI_CREDENTIAL_ENCRYPTION_KEY.",
    );
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error(
      "AI_CREDENTIAL_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.",
    );
  }
  return key;
}
