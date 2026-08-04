// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  AI_PROVIDER_BASE_URLS,
  aiEncryptionAvailable,
  resolveAiBaseUrl,
} from "@/lib/ai/config";
import {
  aiCredentialHint,
  decryptAiCredential,
  encryptAiCredential,
} from "@/lib/ai/crypto";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const originalEncryptionKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
const originalAllowedEndpoints = process.env.AI_ALLOWED_ENDPOINTS;

describe.sequential("AI provider security", () => {
  beforeEach(() => {
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    process.env.AI_ALLOWED_ENDPOINTS = "";
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey;
    }
    if (originalAllowedEndpoints === undefined) {
      delete process.env.AI_ALLOWED_ENDPOINTS;
    } else {
      process.env.AI_ALLOWED_ENDPOINTS = originalAllowedEndpoints;
    }
  });

  test("encrypts credentials for only their owning user", () => {
    const apiKey = "sk-review-secret-value";
    const encrypted = encryptAiCredential("alice-id", apiKey);

    expect(encrypted).not.toContain(apiKey);
    expect(decryptAiCredential("alice-id", encrypted)).toBe(apiKey);
    expect(() => decryptAiCredential("bob-id", encrypted)).toThrow(
      "could not be decrypted",
    );
    expect(aiCredentialHint(apiKey)).toBe("...alue");
  });

  test("rejects tampered ciphertext and invalid encryption configuration", () => {
    const encrypted = encryptAiCredential("alice-id", "sk-review-secret");
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptAiCredential("alice-id", tampered)).toThrow(
      "could not be decrypted",
    );

    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "not-a-32-byte-key";
    expect(aiEncryptionAvailable()).toBe(false);
    expect(() => encryptAiCredential("alice-id", "sk-review-secret")).toThrow(
      "base64-encoded 32-byte key",
    );
  });

  test("uses fixed endpoints for OpenAI and DeepSeek presets", () => {
    expect(resolveAiBaseUrl("openai", "http://127.0.0.1:3000")).toBe(
      AI_PROVIDER_BASE_URLS.openai,
    );
    expect(resolveAiBaseUrl("deepseek", "http://127.0.0.1:3000")).toBe(
      AI_PROVIDER_BASE_URLS.deepseek,
    );
  });

  test("allows only exact operator-approved custom endpoints", () => {
    process.env.AI_ALLOWED_ENDPOINTS =
      "https://models.example.com/v1/,http://ollama:11434/v1";

    expect(resolveAiBaseUrl("custom", "https://models.example.com/v1")).toBe(
      "https://models.example.com/v1",
    );
    expect(resolveAiBaseUrl("custom", "HTTPS://MODELS.EXAMPLE.COM/v1")).toBe(
      "https://models.example.com/v1",
    );
    expect(resolveAiBaseUrl("custom", "http://ollama:11434/v1/")).toBe(
      "http://ollama:11434/v1",
    );
    expect(() =>
      resolveAiBaseUrl("custom", "https://models.example.com/other"),
    ).toThrow("not approved");
    expect(() =>
      resolveAiBaseUrl("custom", "https://user:secret@models.example.com/v1"),
    ).toThrow("cannot contain credentials");
    expect(() =>
      resolveAiBaseUrl("custom", "https://models.example.com/v1?target=local"),
    ).toThrow("cannot contain credentials");
    process.env.AI_ALLOWED_ENDPOINTS = "ftp://models.example.com/v1";
    expect(() =>
      resolveAiBaseUrl("custom", "ftp://models.example.com/v1"),
    ).toThrow("HTTP or HTTPS");
  });
});
