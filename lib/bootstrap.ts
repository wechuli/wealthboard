import "server-only";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { categories, exchangeRates, userSettings } from "@/db/schema";
import { CATEGORY_SEEDS } from "@/lib/constants";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

export class SetupRequiredError extends Error {
  constructor() {
    super("Set INITIAL_ADMIN_PASSWORD before the first launch.");
    this.name = "SetupRequiredError";
  }
}

let bootstrapPromise: Promise<void> | undefined;

async function bootstrap() {
  const db = getDatabase();
  const existing = await db.select({ id: userSettings.id }).from(userSettings).limit(1);
  if (existing.length > 0) return;

  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (!initialPassword || initialPassword.length < 10) {
    throw new SetupRequiredError();
  }

  const passwordHash = await bcrypt.hash(initialPassword, 12);
  const timestamp = nowIso();

  db.transaction((tx) => {
    const concurrent = tx.select({ id: userSettings.id }).from(userSettings).limit(1).all();
    if (concurrent.length > 0) return;

    tx.insert(userSettings)
      .values({
        id: "single-user",
        displayName: "Owner",
        passwordHash,
        baseCurrency: "KES",
        supportedCurrencies: '["KES","USD"]',
        timezone: process.env.TZ || "Africa/Nairobi",
        preferredDateFormat: "dd MMM yyyy",
        appName: "Worthboard",
        defaultDashboardPeriod: "1y",
        sessionTimeoutMinutes: 10080,
        defaultGoalReturnBps: 800,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    tx.insert(categories)
      .values(
        CATEGORY_SEEDS.map(
          ([name, slug, icon, assetOrLiability, isLiquid, isInvestible], index) => ({
            id: `category-${slug}`,
            name,
            slug,
            icon,
            displayOrder: index,
            assetOrLiability,
            description: null,
            isLiquid,
            isInvestible,
            isArchived: false,
            isSystem: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        ),
      )
      .run();

    tx.insert(exchangeRates)
      .values({
        id: crypto.randomUUID(),
        baseCurrency: "USD",
        quoteCurrency: "KES",
        rate: "130",
        effectiveDate: "2000-01-01T00:00:00.000Z",
        source: "initial-default",
        createdAt: timestamp,
      })
      .run();
  });
}

export async function ensureBootstrap() {
  bootstrapPromise ??= bootstrap().catch((error) => {
    bootstrapPromise = undefined;
    throw error;
  });
  await bootstrapPromise;
}

export async function getSettings() {
  await ensureBootstrap();
  const setting = await getDatabase().query.userSettings.findFirst({
    where: eq(userSettings.id, "single-user"),
  });
  if (!setting) throw new Error("Worthboard settings are unavailable.");
  return setting;
}

export function clearBootstrapCache() {
  bootstrapPromise = undefined;
}
