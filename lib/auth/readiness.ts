import "server-only";

import { eq } from "drizzle-orm";

import { oidcIdentities, users } from "@/db/schema";
import {
  getAuthConfig,
  type AuthConfig,
  type OidcAuthConfig,
} from "@/lib/auth/config";
import { discoverOidcProvider } from "@/lib/auth/oidc";
import { getDatabase, getSqlite } from "@/lib/db";

export type AuthReadiness = {
  ready: boolean;
  oidcAvailable: boolean | null;
  reason:
    | "ready"
    | "database_unavailable"
    | "provider_unavailable"
    | "users_missing_oidc"
    | "users_missing_password";
};

type DiscoverProvider = (config: OidcAuthConfig) => Promise<unknown>;

function activeUserCoverage(config: AuthConfig) {
  const db = getDatabase();
  const activeUsers = db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.status, "active"))
    .all();

  if (config.localEnabled && !config.oidcEnabled) {
    return activeUsers.some((user) => !user.passwordHash)
      ? "users_missing_password"
      : null;
  }
  if (config.oidcEnabled && !config.localEnabled && config.oidc) {
    const linkedUsers = new Set(
      db
        .select({ userId: oidcIdentities.userId })
        .from(oidcIdentities)
        .where(eq(oidcIdentities.issuer, config.oidc.issuer))
        .all()
        .map((identity) => identity.userId),
    );
    return activeUsers.some((user) => !linkedUsers.has(user.id))
      ? "users_missing_oidc"
      : null;
  }
  return null;
}

export async function checkAuthReadiness(
  config: AuthConfig,
  discoverProvider: DiscoverProvider = discoverOidcProvider,
): Promise<AuthReadiness> {
  try {
    getSqlite().prepare("SELECT 1").get();
    const coverageFailure = activeUserCoverage(config);
    if (coverageFailure) {
      return {
        ready: false,
        oidcAvailable: config.oidcEnabled ? null : false,
        reason: coverageFailure,
      };
    }
  } catch {
    return {
      ready: false,
      oidcAvailable: config.oidcEnabled ? null : false,
      reason: "database_unavailable",
    };
  }

  if (!config.oidcEnabled || !config.oidc) {
    return { ready: true, oidcAvailable: null, reason: "ready" };
  }
  try {
    await discoverProvider(config.oidc);
    return { ready: true, oidcAvailable: true, reason: "ready" };
  } catch {
    return {
      ready: config.localEnabled,
      oidcAvailable: false,
      reason: config.localEnabled ? "ready" : "provider_unavailable",
    };
  }
}

export async function assertAuthStartupReady() {
  const config = getAuthConfig();
  const readiness = await checkAuthReadiness(config);
  if (!readiness.ready) {
    throw new Error(
      `Authentication startup validation failed: ${readiness.reason}.`,
    );
  }
  return readiness;
}
