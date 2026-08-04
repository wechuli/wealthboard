// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { aiProviderSettings, aiUsageEvents } from "@/db/schema";
import { AI_PROVIDER_BASE_URLS } from "@/lib/ai/config";
import { aiProviderSettingsInputSchema } from "@/lib/ai/schemas";
import { registerUser } from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  AiCredentialRequiredError,
  AiProviderNotConfiguredError,
  AiReviewBudgetError,
  AiReviewRateLimitError,
  clearAiUsageHistory,
  completeAiReviewUsage,
  deleteStoredAiCredential,
  disconnectAiProvider,
  getAiProviderSettings,
  getAiUsageSummary,
  reserveAiReviewUsage,
  resolveAiProviderRequest,
  saveAiProviderSettings,
} from "@/lib/services/ai-provider";
import { exportData } from "@/lib/services/portability";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-ai-provider-"),
);
const databasePath = path.join(workspace, "ai-provider.db");

describe.sequential("AI provider persistence and limits", () => {
  let aliceId = "";
  let bobId = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET =
      "unit-test-session-secret-longer-than-32-characters";
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      "base64",
    );
    process.env.TZ = "Africa/Nairobi";

    const sqlite = new Database(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.close();
    process.env.DATABASE_PATH = databasePath;

    ({ userId: aliceId } = await registerUser({
      username: "alice-ai-provider",
      displayName: "Alice AI",
      password: "correct-horse-battery-staple",
    }));
    ({ userId: bobId } = await registerUser({
      username: "bob-ai-provider",
      displayName: "Bob AI",
      password: "correct-horse-battery-staple",
    }));
  });

  afterAll(() => {
    closeDatabase();
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("stores only owner-bound ciphertext and returns sanitized settings", async () => {
    const apiKey = "sk-alice-private-provider-key";
    const saved = saveAiProviderSettings(aliceId, {
      provider: "openai",
      baseUrl: "http://127.0.0.1:9999",
      model: "review-model",
      apiKey,
      rememberApiKey: true,
      includeExactAmounts: true,
      includeAccountNames: false,
      monthlyTokenLimit: 10_000,
      maxOutputTokens: 1_000,
    });
    const row = await getDatabase().query.aiProviderSettings.findFirst({
      where: eq(aiProviderSettings.userId, aliceId),
    });

    expect(saved).toMatchObject({
      provider: "openai",
      baseUrl: AI_PROVIDER_BASE_URLS.openai,
      model: "review-model",
      hasStoredApiKey: true,
      apiKeyHint: "...-key",
    });
    expect(JSON.stringify(saved)).not.toContain(apiKey);
    expect(row?.encryptedApiKey).toBeTruthy();
    expect(row?.encryptedApiKey).not.toContain(apiKey);
    expect(await getAiProviderSettings(bobId)).toBeNull();
    await expect(resolveAiProviderRequest(bobId)).rejects.toBeInstanceOf(
      AiProviderNotConfiguredError,
    );
    await expect(resolveAiProviderRequest(aliceId)).resolves.toMatchObject({
      provider: "openai",
      apiKey,
    });
  });

  test("supports session-only credentials without persisting them", async () => {
    saveAiProviderSettings(bobId, {
      provider: "deepseek",
      model: "deepseek-review-model",
      apiKey: "sk-bob-session-only",
      rememberApiKey: false,
      includeExactAmounts: false,
      includeAccountNames: false,
      monthlyTokenLimit: 50_000,
      maxOutputTokens: 25_000,
    });
    const row = await getDatabase().query.aiProviderSettings.findFirst({
      where: eq(aiProviderSettings.userId, bobId),
    });

    expect(row?.encryptedApiKey).toBeNull();
    expect(row?.maxOutputTokens).toBe(25_000);
    await expect(resolveAiProviderRequest(bobId)).rejects.toBeInstanceOf(
      AiCredentialRequiredError,
    );
    await expect(
      resolveAiProviderRequest(bobId, "sk-bob-session-only"),
    ).resolves.toMatchObject({
      baseUrl: AI_PROVIDER_BASE_URLS.deepseek,
      apiKey: "sk-bob-session-only",
    });
  });

  test("accepts user-selected output limits within the monthly budget", () => {
    const input = {
      provider: "openai" as const,
      model: "review-model",
      rememberApiKey: false,
      includeExactAmounts: false,
      includeAccountNames: false,
      monthlyTokenLimit: 100_000,
      maxOutputTokens: 25_000,
    };

    expect(aiProviderSettingsInputSchema.safeParse(input).success).toBe(true);

    const result = aiProviderSettingsInputSchema.safeParse({
      ...input,
      maxOutputTokens: 100_001,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["maxOutputTokens"],
          message:
            "Maximum output tokens cannot exceed the monthly token limit.",
        }),
      );
    }
  });

  test("reserves, finalizes, rate-limits, and budgets usage per user", async () => {
    const startedAt = new Date("2026-08-04T10:00:00.000Z");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const reservation = reserveAiReviewUsage(
        aliceId,
        500,
        new Date(startedAt.getTime() + attempt * 1_000),
      );
      completeAiReviewUsage(aliceId, reservation.id, {
        status: "success",
        inputTokens: 40,
        outputTokens: 10,
        latencyMs: 100,
      });
    }

    expect(() =>
      reserveAiReviewUsage(
        aliceId,
        500,
        new Date(startedAt.getTime() + 30_000),
      ),
    ).toThrow(AiReviewRateLimitError);

    const summary = await getAiUsageSummary(aliceId, startedAt);
    expect(summary).toMatchObject({
      chargedTokens: 500,
      remainingTokens: 9_500,
      successfulReviews: 10,
    });

    expect(() =>
      reserveAiReviewUsage(
        aliceId,
        9_501,
        new Date(startedAt.getTime() + 61_000),
      ),
    ).toThrow(AiReviewBudgetError);

    const bobReservation = reserveAiReviewUsage(bobId, 1_000, startedAt);
    completeAiReviewUsage(bobId, bobReservation.id, {
      status: "success",
      inputTokens: 250,
      outputTokens: 150,
      latencyMs: 500,
    });
    expect(await getAiUsageSummary(bobId, startedAt)).toMatchObject({
      chargedTokens: 400,
      successfulReviews: 1,
    });

    const events = await getDatabase().select().from(aiUsageEvents);
    expect(events.some((event) => event.status === "rate_limited")).toBe(true);
    expect(events.some((event) => event.status === "budget_exceeded")).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toContain("sk-");
  });

  test("deletes a remembered credential without removing provider settings", async () => {
    deleteStoredAiCredential(aliceId);
    expect(await getAiProviderSettings(aliceId)).toMatchObject({
      provider: "openai",
      hasStoredApiKey: false,
      apiKeyHint: null,
    });
    await expect(resolveAiProviderRequest(aliceId)).rejects.toBeInstanceOf(
      AiCredentialRequiredError,
    );
  });

  test("excludes credentials from exports and scopes retention commands", async () => {
    const exported = JSON.stringify(await exportData(aliceId));
    expect(exported).not.toContain("ai_provider_settings");
    expect(exported).not.toContain("encryptedApiKey");
    expect(exported).not.toContain("sk-");

    expect(clearAiUsageHistory(aliceId)).toBeGreaterThan(0);
    expect(await getAiUsageSummary(aliceId)).toMatchObject({
      chargedTokens: 0,
      successfulReviews: 0,
    });
    expect(await getAiUsageSummary(bobId)).toMatchObject({
      chargedTokens: 400,
      successfulReviews: 1,
    });

    disconnectAiProvider(aliceId);
    expect(await getAiProviderSettings(aliceId)).toBeNull();
    expect(await getAiProviderSettings(bobId)).toMatchObject({
      provider: "deepseek",
    });
    await expect(resolveAiProviderRequest(aliceId)).rejects.toBeInstanceOf(
      AiProviderNotConfiguredError,
    );
  });
});
