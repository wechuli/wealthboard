import "server-only";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

import { categories, users, userSettings } from "@/db/schema";
import { CATEGORY_SEEDS } from "@/lib/constants";
import {
  DEFAULT_BASE_CURRENCY,
  DEFAULT_ENABLED_CURRENCIES,
  isCatalogCurrencyCode,
  normalizeCurrencyCode,
  normalizeEnabledCurrencies,
} from "@/lib/currencies";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "wealthboard-login-placeholder",
  12,
);

export class UsernameUnavailableError extends Error {
  constructor() {
    super("That username is unavailable.");
    this.name = "UsernameUnavailableError";
  }
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function defaultCategoryRows(userId: string, timestamp: string) {
  return CATEGORY_SEEDS.map(
    (
      [name, slug, icon, assetOrLiability, isLiquid, isInvestible],
      displayOrder,
    ) => ({
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

export async function registerUser(input: {
  username: string;
  displayName: string;
  password: string;
  baseCurrency?: string;
}) {
  const db = getDatabase();
  const username = normalizeUsername(input.username);
  const baseCurrency = normalizeCurrencyCode(
    input.baseCurrency ?? DEFAULT_BASE_CURRENCY,
  );
  if (!isCatalogCurrencyCode(baseCurrency)) {
    throw new Error("Choose a currency from the catalog.");
  }
  const supportedCurrencies = normalizeEnabledCurrencies(
    DEFAULT_ENABLED_CURRENCIES,
    [baseCurrency],
  );
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

    const sessionVersion = 1;
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

    tx.insert(userSettings)
      .values({
        id: crypto.randomUUID(),
        userId,
        displayName: input.displayName,
        baseCurrency,
        supportedCurrencies: JSON.stringify(supportedCurrencies),
        timezone: process.env.TZ || "Africa/Nairobi",
        preferredDateFormat: "dd MMM yyyy",
        appName: "Wealthboard",
        defaultDashboardPeriod: "1y",
        sessionTimeoutMinutes: 10080,
        defaultGoalReturnBps: 800,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    tx.insert(categories).values(defaultCategoryRows(userId, timestamp)).run();

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

export async function authenticateUser(
  usernameInput: string,
  password: string,
) {
  const db = getDatabase();
  const username = normalizeUsername(usernameInput);
  const user = db.query.users
    .findFirst({
      where: eq(users.username, username),
    })
    .sync();
  const validPassword = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
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
    .where(
      and(eq(users.id, userId), eq(users.sessionVersion, user.sessionVersion)),
    )
    .run();

  const settings = db.query.userSettings
    .findFirst({
      where: eq(userSettings.userId, userId),
      columns: { sessionTimeoutMinutes: true },
    })
    .sync();
  if (!settings) throw new Error("User settings are unavailable.");
  return {
    sessionVersion,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
  };
}
