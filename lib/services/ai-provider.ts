import "server-only";

import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import {
  aiProviderSettings,
  aiUsageEvents,
  type AiProvider,
} from "@/db/schema";
import {
  AI_REVIEW_COOLDOWN_MS,
  AI_REVIEW_RATE_LIMIT,
  AI_USAGE_RETENTION_DAYS,
  aiEncryptionAvailable,
  aiEndpointHost,
  resolveAiBaseUrl,
} from "@/lib/ai/config";
import {
  aiCredentialHint,
  decryptAiCredential,
  encryptAiCredential,
} from "@/lib/ai/crypto";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

const activeUsageStatuses = ["started", "success", "error"] as const;

export class AiProviderNotConfiguredError extends Error {
  constructor() {
    super("Configure an AI provider before generating a review.");
    this.name = "AiProviderNotConfiguredError";
  }
}

export class AiCredentialRequiredError extends Error {
  constructor() {
    super("Enter an API key or remember one in AI provider settings.");
    this.name = "AiCredentialRequiredError";
  }
}

export class AiReviewRateLimitError extends Error {
  constructor() {
    super("Wait a minute before generating another portfolio review.");
    this.name = "AiReviewRateLimitError";
  }
}

export class AiReviewBudgetError extends Error {
  constructor() {
    super("This month's AI token limit has been reached.");
    this.name = "AiReviewBudgetError";
  }
}

export type AiProviderSettingsInput = {
  provider: AiProvider;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  rememberApiKey: boolean;
  includeExactAmounts: boolean;
  includeAccountNames: boolean;
  monthlyTokenLimit: number;
  maxOutputTokens: number;
};

function validateModel(value: string) {
  const model = value.trim();
  if (!model || model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error("Enter a valid provider model identifier.");
  }
  return model;
}

function validateLimits(monthlyTokenLimit: number, maxOutputTokens: number) {
  if (
    !Number.isInteger(monthlyTokenLimit) ||
    monthlyTokenLimit < 10_000 ||
    monthlyTokenLimit > 5_000_000
  ) {
    throw new Error("Monthly AI tokens must be between 10,000 and 5,000,000.");
  }
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 256 ||
    maxOutputTokens > monthlyTokenLimit
  ) {
    throw new Error(
      "AI output tokens must be at least 256 and cannot exceed the monthly token limit.",
    );
  }
}

function settingsView(row: typeof aiProviderSettings.$inferSelect | undefined) {
  if (!row) return null;
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    hasStoredApiKey: Boolean(row.encryptedApiKey),
    apiKeyHint: row.apiKeyHint,
    includeExactAmounts: row.includeExactAmounts,
    includeAccountNames: row.includeAccountNames,
    monthlyTokenLimit: row.monthlyTokenLimit,
    maxOutputTokens: row.maxOutputTokens,
    updatedAt: row.updatedAt,
  };
}

export async function getAiProviderSettings(userId: string) {
  const row = await getDatabase().query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.userId, userId),
  });
  return settingsView(row);
}

export function saveAiProviderSettings(
  userId: string,
  input: AiProviderSettingsInput,
) {
  const db = getDatabase();
  const baseUrl = resolveAiBaseUrl(input.provider, input.baseUrl);
  const model = validateModel(input.model);
  validateLimits(input.monthlyTokenLimit, input.maxOutputTokens);
  const providedApiKey = input.apiKey?.trim();

  return db.transaction((tx) => {
    const existing = tx.query.aiProviderSettings
      .findFirst({ where: eq(aiProviderSettings.userId, userId) })
      .sync();
    let encryptedApiKey: string | null = null;
    let apiKeyHint: string | null = null;
    if (input.rememberApiKey) {
      if (providedApiKey) {
        encryptedApiKey = encryptAiCredential(userId, providedApiKey);
        apiKeyHint = aiCredentialHint(providedApiKey);
      } else if (existing?.encryptedApiKey) {
        encryptedApiKey = existing.encryptedApiKey;
        apiKeyHint = existing.apiKeyHint;
      } else {
        throw new Error("Enter an API key before choosing to remember it.");
      }
    }

    const timestamp = nowIso();
    if (existing) {
      tx.update(aiProviderSettings)
        .set({
          provider: input.provider,
          baseUrl,
          model,
          encryptedApiKey,
          apiKeyHint,
          includeExactAmounts: input.includeExactAmounts,
          includeAccountNames: input.includeAccountNames,
          monthlyTokenLimit: input.monthlyTokenLimit,
          maxOutputTokens: input.maxOutputTokens,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(aiProviderSettings.userId, userId),
            eq(aiProviderSettings.id, existing.id),
          ),
        )
        .run();
    } else {
      tx.insert(aiProviderSettings)
        .values({
          id: crypto.randomUUID(),
          userId,
          provider: input.provider,
          baseUrl,
          model,
          encryptedApiKey,
          apiKeyHint,
          includeExactAmounts: input.includeExactAmounts,
          includeAccountNames: input.includeAccountNames,
          monthlyTokenLimit: input.monthlyTokenLimit,
          maxOutputTokens: input.maxOutputTokens,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }
    return settingsView(
      tx.query.aiProviderSettings
        .findFirst({ where: eq(aiProviderSettings.userId, userId) })
        .sync(),
    );
  });
}

export function deleteStoredAiCredential(userId: string) {
  const result = getDatabase()
    .update(aiProviderSettings)
    .set({ encryptedApiKey: null, apiKeyHint: null, updatedAt: nowIso() })
    .where(eq(aiProviderSettings.userId, userId))
    .run();
  if (result.changes === 0) throw new AiProviderNotConfiguredError();
}

export function clearAiUsageHistory(userId: string) {
  return getDatabase()
    .delete(aiUsageEvents)
    .where(eq(aiUsageEvents.userId, userId))
    .run().changes;
}

export function disconnectAiProvider(userId: string) {
  const result = getDatabase()
    .delete(aiProviderSettings)
    .where(eq(aiProviderSettings.userId, userId))
    .run();
  if (result.changes === 0) throw new AiProviderNotConfiguredError();
}

function validateSessionApiKey(value: string | undefined) {
  const apiKey = value?.trim();
  if (!apiKey) return undefined;
  if (apiKey.length < 8 || apiKey.length > 4096) {
    throw new Error("Enter a valid provider API key.");
  }
  return apiKey;
}

export async function resolveAiProviderRequest(
  userId: string,
  sessionApiKey?: string,
) {
  const row = await getDatabase().query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.userId, userId),
  });
  if (!row) throw new AiProviderNotConfiguredError();
  const apiKey =
    validateSessionApiKey(sessionApiKey) ??
    (row.encryptedApiKey
      ? decryptAiCredential(userId, row.encryptedApiKey)
      : undefined);
  if (!apiKey) throw new AiCredentialRequiredError();
  return {
    provider: row.provider,
    baseUrl: resolveAiBaseUrl(row.provider, row.baseUrl),
    model: row.model,
    apiKey,
    monthlyTokenLimit: row.monthlyTokenLimit,
    maxOutputTokens: row.maxOutputTokens,
    includeExactAmounts: row.includeExactAmounts,
    includeAccountNames: row.includeAccountNames,
  };
}

function billingMonth(now: Date) {
  return now.toISOString().slice(0, 7);
}

export function estimateAiReviewTokens(
  serializedSnapshot: string,
  output: number,
) {
  return Math.ceil(serializedSnapshot.length / 4) + output;
}

export function reserveAiReviewUsage(
  userId: string,
  estimatedTokens: number,
  now = new Date(),
) {
  if (!Number.isInteger(estimatedTokens) || estimatedTokens <= 0) {
    throw new Error("AI token reservation must be a positive integer.");
  }
  const db = getDatabase();
  const result = db.transaction((tx) => {
    const settings = tx.query.aiProviderSettings
      .findFirst({ where: eq(aiProviderSettings.userId, userId) })
      .sync();
    if (!settings) return { denied: "not_configured" as const };

    const timestamp = now.toISOString();
    const cutoff = new Date(
      now.getTime() - AI_USAGE_RETENTION_DAYS * 86_400_000,
    ).toISOString();
    tx.delete(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.userId, userId),
          lt(aiUsageEvents.createdAt, cutoff),
        ),
      )
      .run();

    const windowStart = new Date(
      now.getTime() - AI_REVIEW_COOLDOWN_MS,
    ).toISOString();
    const recentAttempts = tx
      .select({ count: sql<number>`count(*)` })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.userId, userId),
          inArray(aiUsageEvents.status, [...activeUsageStatuses]),
          gt(aiUsageEvents.createdAt, windowStart),
        ),
      )
      .get();
    if ((recentAttempts?.count ?? 0) >= AI_REVIEW_RATE_LIMIT) {
      tx.insert(aiUsageEvents)
        .values({
          id: crypto.randomUUID(),
          userId,
          provider: settings.provider,
          endpointHost: aiEndpointHost(settings.baseUrl),
          model: settings.model,
          status: "rate_limited",
          billingMonth: billingMonth(now),
          chargedTokens: 0,
          errorCode: "cooldown",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      return { denied: "rate_limited" as const };
    }

    const month = billingMonth(now);
    const usage = tx
      .select({
        total: sql<number>`coalesce(sum(${aiUsageEvents.chargedTokens}), 0)`,
      })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.userId, userId),
          eq(aiUsageEvents.billingMonth, month),
        ),
      )
      .get();
    if ((usage?.total ?? 0) + estimatedTokens > settings.monthlyTokenLimit) {
      tx.insert(aiUsageEvents)
        .values({
          id: crypto.randomUUID(),
          userId,
          provider: settings.provider,
          endpointHost: aiEndpointHost(settings.baseUrl),
          model: settings.model,
          status: "budget_exceeded",
          billingMonth: month,
          chargedTokens: 0,
          errorCode: "monthly_token_limit",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      return { denied: "budget_exceeded" as const };
    }

    const id = crypto.randomUUID();
    tx.insert(aiUsageEvents)
      .values({
        id,
        userId,
        provider: settings.provider,
        endpointHost: aiEndpointHost(settings.baseUrl),
        model: settings.model,
        status: "started",
        billingMonth: month,
        chargedTokens: estimatedTokens,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return { id, reservedTokens: estimatedTokens };
  });

  if ("denied" in result) {
    if (result.denied === "not_configured") {
      throw new AiProviderNotConfiguredError();
    }
    if (result.denied === "rate_limited") {
      throw new AiReviewRateLimitError();
    }
    throw new AiReviewBudgetError();
  }
  return result;
}

export function completeAiReviewUsage(
  userId: string,
  id: string,
  details: {
    status: "success" | "error";
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    errorCode?: string;
  },
) {
  const actualTokens =
    details.inputTokens !== undefined && details.outputTokens !== undefined
      ? Math.max(0, details.inputTokens + details.outputTokens)
      : details.status === "error"
        ? 0
        : undefined;
  const values = {
    status: details.status,
    inputTokens: details.inputTokens ?? null,
    outputTokens: details.outputTokens ?? null,
    latencyMs: Math.max(0, Math.round(details.latencyMs)),
    errorCode: details.errorCode?.slice(0, 80) ?? null,
    updatedAt: nowIso(),
    ...(actualTokens !== undefined ? { chargedTokens: actualTokens } : {}),
  };
  const result = getDatabase()
    .update(aiUsageEvents)
    .set(values)
    .where(
      and(
        eq(aiUsageEvents.userId, userId),
        eq(aiUsageEvents.id, id),
        eq(aiUsageEvents.status, "started"),
      ),
    )
    .run();
  if (result.changes !== 1) {
    throw new Error("AI usage reservation could not be finalized.");
  }
}

export async function getAiUsageSummary(userId: string, now = new Date()) {
  const settings = await getDatabase().query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.userId, userId),
  });
  if (!settings) return null;
  const month = billingMonth(now);
  const rows = await getDatabase()
    .select({
      status: aiUsageEvents.status,
      chargedTokens: aiUsageEvents.chargedTokens,
      createdAt: aiUsageEvents.createdAt,
    })
    .from(aiUsageEvents)
    .where(
      and(
        eq(aiUsageEvents.userId, userId),
        eq(aiUsageEvents.billingMonth, month),
      ),
    )
    .orderBy(desc(aiUsageEvents.createdAt));
  const chargedTokens = rows.reduce(
    (total, row) => total + row.chargedTokens,
    0,
  );
  return {
    billingMonth: month,
    chargedTokens,
    remainingTokens: Math.max(0, settings.monthlyTokenLimit - chargedTokens),
    monthlyTokenLimit: settings.monthlyTokenLimit,
    successfulReviews: rows.filter((row) => row.status === "success").length,
    lastUsedAt: rows.find((row) => row.status === "success")?.createdAt ?? null,
    encryptionAvailable: aiEncryptionAvailable(),
  };
}
