// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { oidcIdentities, users } from "@/db/schema";
import { parseAuthConfig } from "@/lib/auth/config";
import { checkAuthReadiness } from "@/lib/auth/readiness";
import { closeDatabase, getDatabase } from "@/lib/db";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-auth-readiness-"),
);
const databasePath = path.join(workspace, "readiness.db");
const issuer = "https://identity.example.test/realms/wealthboard";
const timestamp = "2026-01-01T00:00:00.000Z";
const oidcEnvironment = {
  APP_URL: "https://wealth.example.test",
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: "wealthboard",
  OIDC_CLIENT_SECRET: "provider-secret",
  OIDC_TRANSACTION_SECRET: Buffer.alloc(32, 3).toString("base64"),
  OIDC_PROVIDER_NAME: "Example Identity",
};

describe.sequential("authentication readiness", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = databasePath;
    const sqlite = new Database(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.close();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("an empty or fully credentialed deployment is ready in local mode", async () => {
    const local = parseAuthConfig({ AUTH_METHODS: "local" });
    await expect(checkAuthReadiness(local)).resolves.toMatchObject({
      ready: true,
      reason: "ready",
    });

    getDatabase()
      .insert(users)
      .values({
        id: "00000000-0000-4000-8000-000000000001",
        username: "local-user",
        passwordHash: "existing-hash",
        status: "active",
        sessionVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    await expect(checkAuthReadiness(local)).resolves.toMatchObject({
      ready: true,
      reason: "ready",
    });
  });

  test("OIDC-only fails before discovery when an active user is not linked", async () => {
    const oidc = parseAuthConfig({ AUTH_METHODS: "oidc", ...oidcEnvironment });
    const discover = vi.fn().mockResolvedValue({});

    await expect(checkAuthReadiness(oidc, discover)).resolves.toEqual({
      ready: false,
      oidcAvailable: null,
      reason: "users_missing_oidc",
    });
    expect(discover).not.toHaveBeenCalled();
  });

  test("OIDC-only requires valid discovery after all active users are linked", async () => {
    getDatabase()
      .insert(oidcIdentities)
      .values({
        id: "00000000-0000-4000-8000-000000000011",
        userId: "00000000-0000-4000-8000-000000000001",
        issuer,
        subject: "local-user-subject",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: timestamp,
      })
      .run();
    const oidc = parseAuthConfig({ AUTH_METHODS: "oidc", ...oidcEnvironment });

    await expect(
      checkAuthReadiness(oidc, vi.fn().mockRejectedValue(new Error("offline"))),
    ).resolves.toEqual({
      ready: false,
      oidcAvailable: false,
      reason: "provider_unavailable",
    });
    await expect(
      checkAuthReadiness(oidc, vi.fn().mockResolvedValue({})),
    ).resolves.toEqual({
      ready: true,
      oidcAvailable: true,
      reason: "ready",
    });
  });

  test("local-only refuses active OIDC users without dormant hashes", async () => {
    getDatabase()
      .insert(users)
      .values({
        id: "00000000-0000-4000-8000-000000000002",
        username: "oidc-user",
        passwordHash: null,
        status: "active",
        sessionVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    getDatabase()
      .insert(oidcIdentities)
      .values({
        id: "00000000-0000-4000-8000-000000000012",
        userId: "00000000-0000-4000-8000-000000000002",
        issuer,
        subject: "oidc-user-subject",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: timestamp,
      })
      .run();

    await expect(
      checkAuthReadiness(parseAuthConfig({ AUTH_METHODS: "local" })),
    ).resolves.toMatchObject({
      ready: false,
      reason: "users_missing_password",
    });
  });

  test("hybrid remains ready while reporting provider unavailability", async () => {
    const hybrid = parseAuthConfig({
      AUTH_METHODS: "local,oidc",
      ...oidcEnvironment,
    });

    await expect(
      checkAuthReadiness(
        hybrid,
        vi.fn().mockRejectedValue(new Error("temporary outage")),
      ),
    ).resolves.toEqual({
      ready: true,
      oidcAvailable: false,
      reason: "ready",
    });
  });

  test("disabled users do not block a deliberate mode transition", async () => {
    getDatabase().update(users).set({ status: "disabled" }).run();

    await expect(
      checkAuthReadiness(parseAuthConfig({ AUTH_METHODS: "local" })),
    ).resolves.toMatchObject({ ready: true, reason: "ready" });
  });
});
