import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { readAiEncryptionKey } from "@/lib/ai/config";

const VERSION = "v1";

function associatedData(userId: string) {
  return Buffer.from(`wealthboard-ai-credential:${VERSION}:${userId}`, "utf8");
}

export function encryptAiCredential(userId: string, apiKey: string) {
  const value = apiKey.trim();
  if (value.length < 8 || value.length > 4096) {
    throw new Error("Enter a valid provider API key.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readAiEncryptionKey(), iv);
  cipher.setAAD(associatedData(userId));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptAiCredential(userId: string, encrypted: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] =
    encrypted.split(".");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra
  ) {
    throw new Error("The stored AI credential is invalid.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      readAiEncryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(associatedData(userId));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("The stored AI credential could not be decrypted.");
  }
}

export function aiCredentialHint(apiKey: string) {
  return `...${apiKey.trim().slice(-4)}`;
}
