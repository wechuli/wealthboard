import "server-only";

import bcrypt from "bcryptjs";
import { and, count, eq, isNull } from "drizzle-orm";

import {
  accounts,
  categories,
  exchangeRates,
  goalContributionPlans,
  goals,
  idempotencyKeys,
  legacyClaims,
  transactions,
  users,
  userSettings,
  valuationSnapshots,
} from "@/db/schema";
import { CATEGORY_SEEDS } from "@/lib/constants";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

const LEGACY_CLAIM_ID = "singleton";
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("worthboard-login-placeholder", 12);

export class UsernameUnavailableError extends Error {
  constructor() {
    super("That username is unavailable.");
    this.name = "UsernameUnavailableError";
  }
}

export class LegacyClaimError extends Error {
  constructor() {
    super("The previous Worthboard password could not be verified.");
    this.name = "LegacyClaimError";
  }
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function defaultCategoryRows(userId: string, timestamp: string) {
  return CATEGORY_SEEDS.map(
    ([name, slug, icon, assetOrLiability, isLiquid, isInvestible], displayOrder) => ({
      id: crypto.randomUUID(),
      userId,
      name,
      slug,
      icon,
      displayOrder,
      assetOrLiability,
      description: null,
      isLiquid,
      isInvestible,
      isArchived: false,
      isSystem: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
}

function defaultRateRow(userId: string, timestamp: string) {
  return {
    id: crypto.randomUUID(),
    userId,
    baseCurrency: "USD",
    quoteCurrency: "KES",
    rate: "130",
    effectiveDate: "2000-01-01T00:00:00.000Z",
    source: "initial-default",
    createdAt: timestamp,
  };
}

function assertLegacyOwnershipComplete(
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0],
) {
  const ownedTables = [
    userSettings,
    categories,
    accounts,
    transactions,
    valuationSnapshots,
    exchangeRates,
    goals,
    goalContributionPlans,
    idempotencyKeys,
  ] as const;

  for (const table of ownedTables) {
    const unowned = tx
      .select({ total: count() })
      .from(table)
      .where(isNull(table.userId))
      .get()?.total;
    if (unowned) throw new Error("Legacy ownership assignment was incomplete.");
  }
}

export async function registerUser(input: {
  username: string;
  displayName: string;
  password: string;
  legacyPassword?: string;
}) {
  const db = getDatabase();
  const username = normalizeUsername(input.username);
  const existingClaim = db.query.legacyClaims.findFirst({
    where: eq(legacyClaims.id, LEGACY_CLAIM_ID),
  }).sync();
  const wantsLegacyClaim = input.legacyPassword !== undefined;

  if (wantsLegacyClaim) {
    const verified =
      existingClaim &&
      (await bcrypt.compare(input.legacyPassword ?? "", existingClaim.passwordHash));
    if (!verified) throw new LegacyClaimError();
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const timestamp = nowIso();
  const userId = crypto.randomUUID();

  return db.transaction((tx) => {
    const existingUser = tx.query.users
      .findFirst({
        where: eq(users.username, username),
        columns: { id: true },
      })
      .sync();
    if (existingUser) throw new UsernameUnavailableError();

    const claim = wantsLegacyClaim
      ? tx.query.legacyClaims
          .findFirst({ where: eq(legacyClaims.id, LEGACY_CLAIM_ID) })
          .sync()
      : undefined;
    if (
      wantsLegacyClaim &&
      (!claim || !existingClaim || claim.passwordHash !== existingClaim.passwordHash)
    ) {
      throw new LegacyClaimError();
    }

    const sessionVersion = claim?.sessionVersion ?? 1;
    tx.insert(users)
      .values({
        id: userId,
        username,
        passwordHash,
        status: "active",
        sessionVersion,
        lastLoginAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    if (claim) {
      const legacySettings = tx.query.userSettings
        .findFirst({
          where: and(
            eq(userSettings.id, claim.settingsId),
            isNull(userSettings.userId),
          ),
        })
        .sync();
      if (!legacySettings) throw new LegacyClaimError();

      tx.update(userSettings)
        .set({ userId, displayName: input.displayName, updatedAt: timestamp })
        .where(eq(userSettings.id, claim.settingsId))
        .run();
      tx.update(categories).set({ userId }).where(isNull(categories.userId)).run();
      tx.update(accounts).set({ userId }).where(isNull(accounts.userId)).run();
      tx.update(transactions).set({ userId }).where(isNull(transactions.userId)).run();
      tx.update(valuationSnapshots)
        .set({ userId })
        .where(isNull(valuationSnapshots.userId))
        .run();
      tx.update(exchangeRates).set({ userId }).where(isNull(exchangeRates.userId)).run();
      tx.update(goals).set({ userId }).where(isNull(goals.userId)).run();
      tx.update(goalContributionPlans)
        .set({ userId })
        .where(isNull(goalContributionPlans.userId))
        .run();
      tx.update(idempotencyKeys)
        .set({ userId })
        .where(isNull(idempotencyKeys.userId))
        .run();

      const categoryCount = tx
        .select({ total: count() })
        .from(categories)
        .where(eq(categories.userId, userId))
        .get()?.total;
      if (!categoryCount) {
        tx.insert(categories).values(defaultCategoryRows(userId, timestamp)).run();
      }
      const rateCount = tx
        .select({ total: count() })
        .from(exchangeRates)
        .where(eq(exchangeRates.userId, userId))
        .get()?.total;
      if (!rateCount) {
        tx.insert(exchangeRates).values(defaultRateRow(userId, timestamp)).run();
      }

      assertLegacyOwnershipComplete(tx);
      tx.delete(legacyClaims).where(eq(legacyClaims.id, claim.id)).run();
    } else {
      tx.insert(userSettings)
        .values({
          id: crypto.randomUUID(),
          userId,
          displayName: input.displayName,
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
      tx.insert(categories).values(defaultCategoryRows(userId, timestamp)).run();
      tx.insert(exchangeRates).values(defaultRateRow(userId, timestamp)).run();
    }

    const settings = tx.query.userSettings
      .findFirst({
        where: eq(userSettings.userId, userId),
        columns: { sessionTimeoutMinutes: true },
      })
      .sync();
    if (!settings) throw new Error("User settings were not created.");

    return {
      userId,
      sessionVersion,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    };
  });
}

export async function authenticateUser(usernameInput: string, password: string) {
  const db = getDatabase();
  const username = normalizeUsername(usernameInput);
  const user = db.query.users
    .findFirst({
      where: eq(users.username, username),
    })
    .sync();
  const validPassword = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || user.status !== "active" || !validPassword) return null;

  const settings = db.query.userSettings
    .findFirst({
      where: eq(userSettings.userId, user.id),
      columns: { sessionTimeoutMinutes: true },
    })
    .sync();
  if (!settings) return null;

  const timestamp = nowIso();
  db.update(users)
    .set({ lastLoginAt: timestamp, updatedAt: timestamp })
    .where(eq(users.id, user.id))
    .run();

  return {
    userId: user.id,
    sessionVersion: user.sessionVersion,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
  };
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const db = getDatabase();
  const user = db.query.users.findFirst({ where: eq(users.id, userId) }).sync();
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return null;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const timestamp = nowIso();
  const sessionVersion = user.sessionVersion + 1;
  db.update(users)
    .set({ passwordHash, sessionVersion, updatedAt: timestamp })
    .where(and(eq(users.id, userId), eq(users.sessionVersion, user.sessionVersion)))
    .run();

  const settings = db.query.userSettings
    .findFirst({
      where: eq(userSettings.userId, userId),
      columns: { sessionTimeoutMinutes: true },
    })
    .sync();
  if (!settings) throw new Error("User settings are unavailable.");
  return { sessionVersion, sessionTimeoutMinutes: settings.sessionTimeoutMinutes };
}
