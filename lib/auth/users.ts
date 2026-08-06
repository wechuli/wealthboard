import "server-only";

import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

import { categories, oidcIdentities, users, userSettings } from "@/db/schema";
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

type DatabaseClient = ReturnType<typeof getDatabase>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

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

export class AuthenticationMethodError extends Error {
  constructor() {
    super("The authentication method could not be changed.");
    this.name = "AuthenticationMethodError";
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

function createUserFoundation(
  tx: TransactionClient,
  input: {
    userId: string;
    username: string;
    passwordHash: string | null;
    displayName: string;
    baseCurrency: string;
    timestamp: string;
  },
) {
  const supportedCurrencies = normalizeEnabledCurrencies(
    DEFAULT_ENABLED_CURRENCIES,
    [input.baseCurrency],
  );
  const sessionVersion = 1;
  tx.insert(users)
    .values({
      id: input.userId,
      username: input.username,
      passwordHash: input.passwordHash,
      status: "active",
      sessionVersion,
      lastLoginAt: input.timestamp,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .run();

  tx.insert(userSettings)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      displayName: input.displayName,
      baseCurrency: input.baseCurrency,
      supportedCurrencies: JSON.stringify(supportedCurrencies),
      timezone: process.env.TZ || "Africa/Nairobi",
      preferredDateFormat: "dd MMM yyyy",
      appName: "Wealthboard",
      defaultDashboardPeriod: "1y",
      sessionTimeoutMinutes: 10080,
      defaultGoalReturnBps: 800,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .run();
  tx.insert(categories)
    .values(defaultCategoryRows(input.userId, input.timestamp))
    .run();

  const settings = tx.query.userSettings
    .findFirst({
      where: eq(userSettings.userId, input.userId),
      columns: { sessionTimeoutMinutes: true },
    })
    .sync();
  if (!settings) throw new Error("User settings were not created.");
  return {
    userId: input.userId,
    sessionVersion,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
  };
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

    return createUserFoundation(tx, {
      userId,
      username,
      passwordHash,
      displayName: input.displayName,
      baseCurrency,
      timestamp,
    });
  });
}

function validateOidcIdentity(issuer: string, subject: string) {
  if (
    issuer.length > 2048 ||
    subject.length > 512 ||
    !subject ||
    subject.trim() !== subject ||
    /[\u0000-\u001f\u007f]/.test(subject)
  ) {
    throw new Error("OIDC identity is invalid.");
  }
}

function oidcHandle(issuer: string, subject: string, attempt: number) {
  const digest = createHash("sha256")
    .update(issuer)
    .update("\0")
    .update(subject)
    .update("\0")
    .update(String(attempt))
    .digest("hex");
  return `oidc-${digest.slice(0, 27)}`;
}

function availableOidcHandle(
  tx: TransactionClient,
  issuer: string,
  subject: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const username = oidcHandle(issuer, subject, attempt);
    const existing = tx.query.users
      .findFirst({
        where: eq(users.username, username),
        columns: { id: true },
      })
      .sync();
    if (!existing) return username;
  }
  throw new Error("An internal OIDC handle could not be allocated.");
}

function oidcDisplayName(candidates: readonly unknown[], fallback: string) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (
      value.length > 0 &&
      value.length <= 80 &&
      !/[\u0000-\u001f\u007f]/.test(value)
    ) {
      return value;
    }
  }
  return fallback;
}

function resolveExistingOidcLogin(
  tx: TransactionClient,
  issuer: string,
  subject: string,
  timestamp: string,
) {
  const identity = tx.query.oidcIdentities
    .findFirst({
      where: and(
        eq(oidcIdentities.issuer, issuer),
        eq(oidcIdentities.subject, subject),
      ),
    })
    .sync();
  if (!identity) return undefined;
  const user = tx.query.users
    .findFirst({ where: eq(users.id, identity.userId) })
    .sync();
  if (!user || user.status !== "active") return null;
  const settings = tx.query.userSettings
    .findFirst({
      where: eq(userSettings.userId, user.id),
      columns: { sessionTimeoutMinutes: true },
    })
    .sync();
  if (!settings) return null;

  tx.update(oidcIdentities)
    .set({ lastLoginAt: timestamp, updatedAt: timestamp })
    .where(eq(oidcIdentities.id, identity.id))
    .run();
  tx.update(users)
    .set({ lastLoginAt: timestamp, updatedAt: timestamp })
    .where(eq(users.id, user.id))
    .run();
  return {
    userId: user.id,
    sessionVersion: user.sessionVersion,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    isNewUser: false,
  };
}

export function resolveOidcLogin(input: {
  issuer: string;
  subject: string;
  name?: unknown;
  preferredUsername?: unknown;
}) {
  validateOidcIdentity(input.issuer, input.subject);
  const db = getDatabase();
  const timestamp = nowIso();
  try {
    return db.transaction((tx) => {
      const existing = resolveExistingOidcLogin(
        tx,
        input.issuer,
        input.subject,
        timestamp,
      );
      if (existing !== undefined) return existing;

      const userId = crypto.randomUUID();
      const username = availableOidcHandle(tx, input.issuer, input.subject);
      const created = createUserFoundation(tx, {
        userId,
        username,
        passwordHash: null,
        displayName: oidcDisplayName(
          [input.name, input.preferredUsername],
          username,
        ),
        baseCurrency: DEFAULT_BASE_CURRENCY,
        timestamp,
      });
      tx.insert(oidcIdentities)
        .values({
          id: crypto.randomUUID(),
          userId,
          issuer: input.issuer,
          subject: input.subject,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastLoginAt: timestamp,
        })
        .run();
      return { ...created, isNewUser: true };
    });
  } catch (error) {
    const raced = db.transaction((tx) =>
      resolveExistingOidcLogin(tx, input.issuer, input.subject, nowIso()),
    );
    if (raced !== undefined) return raced;
    throw error;
  }
}

export function getUserAuthState(userId: string, issuer?: string) {
  const db = getDatabase();
  const user = db.query.users
    .findFirst({
      where: eq(users.id, userId),
      columns: { id: true, passwordHash: true, status: true },
    })
    .sync();
  if (!user) return null;
  const identity = issuer
    ? db.query.oidcIdentities
        .findFirst({
          where: and(
            eq(oidcIdentities.userId, userId),
            eq(oidcIdentities.issuer, issuer),
          ),
          columns: { id: true, createdAt: true, lastLoginAt: true },
        })
        .sync()
    : undefined;
  return {
    status: user.status,
    hasPassword: Boolean(user.passwordHash),
    oidcIdentity: identity ?? null,
  };
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

export async function verifyUserPassword(userId: string, password: string) {
  const user = getDatabase()
    .query.users.findFirst({
      where: eq(users.id, userId),
      columns: { passwordHash: true, status: true },
    })
    .sync();
  return Boolean(
    user?.status === "active" &&
    user.passwordHash &&
    (await bcrypt.compare(password, user.passwordHash)),
  );
}

function sessionResult(
  tx: TransactionClient,
  userId: string,
  sessionVersion: number,
) {
  const settings = tx.query.userSettings
    .findFirst({
      where: eq(userSettings.userId, userId),
      columns: { sessionTimeoutMinutes: true },
    })
    .sync();
  if (!settings) throw new AuthenticationMethodError();
  return {
    userId,
    sessionVersion,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
  };
}

function requireActiveUser(tx: TransactionClient, userId: string) {
  const user = tx.query.users.findFirst({ where: eq(users.id, userId) }).sync();
  if (!user || user.status !== "active") throw new AuthenticationMethodError();
  return user;
}

export function linkOidcIdentity(
  userId: string,
  input: { issuer: string; subject: string },
  expectedSessionVersion: number,
) {
  validateOidcIdentity(input.issuer, input.subject);
  const db = getDatabase();
  const timestamp = nowIso();
  return db.transaction((tx) => {
    const user = requireActiveUser(tx, userId);
    if (user.sessionVersion !== expectedSessionVersion) {
      throw new AuthenticationMethodError();
    }
    if (!user.passwordHash) throw new AuthenticationMethodError();
    const claimedIdentity = tx.query.oidcIdentities
      .findFirst({
        where: and(
          eq(oidcIdentities.issuer, input.issuer),
          eq(oidcIdentities.subject, input.subject),
        ),
      })
      .sync();
    const existingProviderIdentity = tx.query.oidcIdentities
      .findFirst({
        where: and(
          eq(oidcIdentities.userId, userId),
          eq(oidcIdentities.issuer, input.issuer),
        ),
      })
      .sync();
    if (claimedIdentity || existingProviderIdentity) {
      throw new AuthenticationMethodError();
    }

    tx.insert(oidcIdentities)
      .values({
        id: crypto.randomUUID(),
        userId,
        issuer: input.issuer,
        subject: input.subject,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: timestamp,
      })
      .run();
    const sessionVersion = user.sessionVersion + 1;
    tx.update(users)
      .set({ sessionVersion, updatedAt: timestamp })
      .where(eq(users.id, userId))
      .run();
    return sessionResult(tx, userId, sessionVersion);
  });
}

export function reauthenticateOidcIdentity(
  userId: string,
  input: { issuer: string; subject: string },
  expectedSessionVersion: number,
) {
  validateOidcIdentity(input.issuer, input.subject);
  const db = getDatabase();
  return db.transaction((tx) => {
    const user = requireActiveUser(tx, userId);
    if (user.sessionVersion !== expectedSessionVersion) {
      throw new AuthenticationMethodError();
    }
    const identity = tx.query.oidcIdentities
      .findFirst({
        where: and(
          eq(oidcIdentities.userId, userId),
          eq(oidcIdentities.issuer, input.issuer),
          eq(oidcIdentities.subject, input.subject),
        ),
      })
      .sync();
    if (!identity) throw new AuthenticationMethodError();
    const timestamp = nowIso();
    tx.update(oidcIdentities)
      .set({ lastLoginAt: timestamp, updatedAt: timestamp })
      .where(eq(oidcIdentities.id, identity.id))
      .run();
    return sessionResult(tx, userId, user.sessionVersion);
  });
}

export function unlinkOidcIdentity(userId: string, issuer: string) {
  const db = getDatabase();
  return db.transaction((tx) => {
    const user = requireActiveUser(tx, userId);
    if (!user.passwordHash) throw new AuthenticationMethodError();
    const identity = tx.query.oidcIdentities
      .findFirst({
        where: and(
          eq(oidcIdentities.userId, userId),
          eq(oidcIdentities.issuer, issuer),
        ),
      })
      .sync();
    if (!identity) throw new AuthenticationMethodError();
    tx.delete(oidcIdentities).where(eq(oidcIdentities.id, identity.id)).run();
    const sessionVersion = user.sessionVersion + 1;
    tx.update(users)
      .set({ sessionVersion, updatedAt: nowIso() })
      .where(eq(users.id, userId))
      .run();
    return sessionResult(tx, userId, sessionVersion);
  });
}

export async function enableLocalCredential(
  userId: string,
  input: { username: string; password: string; issuer: string },
) {
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new AuthenticationMethodError();
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const db = getDatabase();
  return db.transaction((tx) => {
    const user = requireActiveUser(tx, userId);
    if (user.passwordHash) throw new AuthenticationMethodError();
    const identity = tx.query.oidcIdentities
      .findFirst({
        where: and(
          eq(oidcIdentities.userId, userId),
          eq(oidcIdentities.issuer, input.issuer),
        ),
        columns: { id: true },
      })
      .sync();
    if (!identity) throw new AuthenticationMethodError();
    const usernameOwner = tx.query.users
      .findFirst({
        where: eq(users.username, username),
        columns: { id: true },
      })
      .sync();
    if (usernameOwner && usernameOwner.id !== userId) {
      throw new UsernameUnavailableError();
    }
    const sessionVersion = user.sessionVersion + 1;
    tx.update(users)
      .set({
        username,
        passwordHash,
        sessionVersion,
        updatedAt: nowIso(),
      })
      .where(eq(users.id, userId))
      .run();
    return sessionResult(tx, userId, sessionVersion);
  });
}

export function removeLocalCredential(userId: string, issuer: string) {
  const db = getDatabase();
  return db.transaction((tx) => {
    const user = requireActiveUser(tx, userId);
    if (!user.passwordHash) throw new AuthenticationMethodError();
    const identity = tx.query.oidcIdentities
      .findFirst({
        where: and(
          eq(oidcIdentities.userId, userId),
          eq(oidcIdentities.issuer, issuer),
        ),
        columns: { id: true },
      })
      .sync();
    if (!identity) throw new AuthenticationMethodError();
    const sessionVersion = user.sessionVersion + 1;
    tx.update(users)
      .set({ passwordHash: null, sessionVersion, updatedAt: nowIso() })
      .where(eq(users.id, userId))
      .run();
    return sessionResult(tx, userId, sessionVersion);
  });
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const db = getDatabase();
  const user = db.query.users.findFirst({ where: eq(users.id, userId) }).sync();
  if (
    !user?.passwordHash ||
    !(await bcrypt.compare(currentPassword, user.passwordHash))
  ) {
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
