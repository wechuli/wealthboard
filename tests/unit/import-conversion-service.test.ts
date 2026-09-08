// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  accounts,
  aiUsageEvents,
  categories,
  transactions,
  users,
  userSettings,
} from "@/db/schema";
import { closeDatabase, getDatabase } from "@/lib/db";
import type {
  ImportConversionRequest,
  ImportExtraction,
} from "@/lib/ai/import-schemas";
import type { AiImportCall } from "@/lib/ai/provider";
import { commitAccountHistory } from "@/lib/services/account-history-import";
import { commitInvestmentHistory } from "@/lib/services/investment-history-import";
import { saveAiProviderSettings } from "@/lib/services/ai-provider";
import {
  convertImportSource,
  getImportProvider,
} from "@/lib/services/import-conversion";

const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-import-conversion-"),
);
const createdAt = "2025-01-01T00:00:00.000Z";
const source = {
  units: [
    {
      id: "source-1",
      location: "private-sheet-label",
      text: "2025-01-02 USD Deposit 12.30 original-cash",
    },
  ],
  warnings: [],
};
const extraction: ImportExtraction = {
  schemaVersion: 1,
  sourceCurrency: "USD",
  exclusions: [],
  issues: [],
  records: [
    {
      collection: "transactions",
      sourceIds: ["source-1"],
      fields: [
        { name: "external_id", value: "original-cash" },
        { name: "type", value: "deposit" },
        { name: "amount", value: "12.30" },
        { name: "date", value: "2025-01-02" },
      ],
    },
  ],
};

function save(userId: string, monthlyTokenLimit = 500_000) {
  return saveAiProviderSettings(userId, {
    provider: "openai",
    model: `${userId}-fixture-model`,
    apiKey: `fixture-secret-${userId}`,
    rememberApiKey: true,
    includeExactAmounts: false,
    includeAccountNames: false,
    monthlyTokenLimit,
    maxOutputTokens: 2000,
  });
}

async function request(
  userId = "alice",
  accountId = "alice-balance",
): Promise<ImportConversionRequest> {
  return {
    source,
    consent: true,
    configurationHash: (await getImportProvider(userId, accountId))!
      .configurationHash,
  };
}

describe.sequential("owner-scoped import conversion", () => {
  beforeAll(() => {
    vi.stubEnv("DATABASE_PATH", path.join(workspace, "test.db"));
    vi.stubEnv(
      "AI_CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 8).toString("base64"),
    );
    const sqlite = new Database(process.env.DATABASE_PATH);
    migrate(drizzle(sqlite), {
      migrationsFolder: path.resolve("db/migrations"),
    });
    sqlite.close();
    const db = getDatabase();
    for (const userId of ["alice", "bob"]) {
      db.insert(users)
        .values({
          id: userId,
          username: `${userId}-conversion`,
          passwordHash: "not-used",
          createdAt,
          updatedAt: createdAt,
        })
        .run();
      db.insert(userSettings)
        .values({
          id: `${userId}-settings`,
          userId,
          displayName: userId,
          baseCurrency: "USD",
          supportedCurrencies: '["USD"]',
          createdAt,
          updatedAt: createdAt,
        })
        .run();
      db.insert(categories)
        .values({
          id: `${userId}-category`,
          userId,
          name: "Savings",
          slug: "savings",
          createdAt,
          updatedAt: createdAt,
        })
        .run();
      for (const mode of ["balance", "positions"] as const) {
        db.insert(accounts)
          .values({
            id: `${userId}-${mode}`,
            userId,
            categoryId: `${userId}-category`,
            name: `${userId} private account`,
            trackingMode: mode,
            currency: "USD",
            createdAt,
            updatedAt: createdAt,
          })
          .run();
      }
      save(userId);
    }
  });
  afterAll(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("uses only the owner's remembered key and makes no financial changes before commit", async () => {
    const transport = vi.fn(async (input: AiImportCall) => {
      expect(input.apiKey).toBe("fixture-secret-alice");
      expect(input.model).toBe("alice-fixture-model");
      expect(input.prompt).not.toMatch(
        /private-sheet-label|private account|fixture-secret|bob/,
      );
      return { extraction, inputTokens: 100, outputTokens: 100 };
    });
    const before = await getDatabase().select().from(transactions);
    const draft = await convertImportSource(
      "alice",
      "alice-balance",
      await request(),
      { transport },
    );
    expect(draft.issues).toEqual([]);
    expect(await getDatabase().select().from(transactions)).toEqual(before);
    const result = commitAccountHistory(
      "alice",
      "alice-balance",
      draft.content,
      "json",
    );
    expect(result.summary.imported).toBe(1);
    expect(result.finalBalanceMinor).toBe(1230);
    const repeat = await convertImportSource(
      "alice",
      "alice-balance",
      await request(),
      { transport },
    );
    expect(repeat.content).toBe(draft.content);
    expect(
      commitAccountHistory("alice", "alice-balance", repeat.content, "json")
        .summary.skippedDuplicates,
    ).toBe(1);
    const events = await getDatabase().select().from(aiUsageEvents);
    expect(JSON.stringify(events)).not.toMatch(
      /original-cash|fixture-secret|Deposit/,
    );
  });

  it("rejects another user's account, missing consent, and changed settings before calling a provider", async () => {
    const transport = vi.fn();
    await expect(
      convertImportSource("bob", "alice-balance", await request(), {
        transport,
      }),
    ).rejects.toThrow("not found");
    await expect(
      convertImportSource(
        "alice",
        "alice-balance",
        {
          ...(await request()),
          consent: false,
        } as unknown as ImportConversionRequest,
        { transport },
      ),
    ).rejects.toThrow();
    const stale = await request();
    save("alice");
    await expect(
      convertImportSource(
        "alice",
        "alice-balance",
        { ...stale, configurationHash: "0".repeat(64) },
        { transport },
      ),
    ).rejects.toThrow("settings");
    expect(transport).not.toHaveBeenCalled();
  });

  it("converts investment source records into the existing atomic import contract", async () => {
    const input = await request("bob", "bob-positions");
    input.source = {
      units: [
        {
          id: "source-1",
          location: "Row 1",
          text: "USD 2025-01-02 inst-1 ACME open-1 price-1 2 units at 10",
        },
      ],
      warnings: [],
    };
    const records: ImportExtraction["records"] = [
      {
        collection: "instruments",
        sourceIds: ["source-1"],
        fields: [
          { name: "external_id", value: "inst-1" },
          { name: "identifier_type", value: "custom" },
          { name: "identifier", value: "ACME" },
          { name: "name", value: "ACME" },
          { name: "asset_type", value: "stock" },
          { name: "quote_currency", value: "USD" },
        ],
      },
      {
        collection: "position_events",
        sourceIds: ["source-1"],
        fields: [
          { name: "external_id", value: "open-1" },
          { name: "instrument_external_id", value: "inst-1" },
          { name: "type", value: "opening_position" },
          { name: "quantity", value: "2" },
          { name: "trade_currency", value: "USD" },
          { name: "trade_date", value: "2025-01-02" },
        ],
      },
      {
        collection: "prices",
        sourceIds: ["source-1"],
        fields: [
          { name: "external_id", value: "price-1" },
          { name: "instrument_external_id", value: "inst-1" },
          { name: "price", value: "10" },
          { name: "effective_date", value: "2025-01-02" },
          { name: "source", value: "statement" },
        ],
      },
    ];
    const transport = vi.fn(async (call: AiImportCall) => {
      expect(call.apiKey).toBe("fixture-secret-bob");
      return {
        extraction: { ...extraction, records },
        inputTokens: 200,
        outputTokens: 200,
      };
    });
    const draft = await convertImportSource("bob", "bob-positions", input, {
      transport,
    });
    expect(draft.issues).toEqual([]);
    expect(
      commitInvestmentHistory("bob", "bob-positions", draft.content, "json")
        .summary.imported,
    ).toBe(3);
  });

  it("retains a conservative reservation after failure and enforces shared budgets", async () => {
    const transport = vi.fn(async () => {
      throw new Error("fixture provider failure");
    });
    await expect(
      convertImportSource(
        "bob",
        "bob-balance",
        await request("bob", "bob-balance"),
        { transport },
      ),
    ).rejects.toThrow("fixture provider");
    const events = await getDatabase().select().from(aiUsageEvents);
    expect(
      events.find((event) => event.errorCode === "import_conversion_failed")
        ?.chargedTokens,
    ).toBeGreaterThan(0);
    save("bob", 10_000);
    transport.mockClear();
    await expect(
      convertImportSource(
        "bob",
        "bob-balance",
        await request("bob", "bob-balance"),
        { transport },
      ),
    ).rejects.toThrow("token limit");
    expect(transport).not.toHaveBeenCalled();
  });
});
