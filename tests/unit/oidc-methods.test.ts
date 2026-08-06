// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { oidcIdentities, users } from "@/db/schema";
import {
  AuthenticationMethodError,
  authenticateUser,
  enableLocalCredential,
  getUserAuthState,
  linkOidcIdentity,
  registerUser,
  reauthenticateOidcIdentity,
  removeLocalCredential,
  resolveOidcLogin,
  unlinkOidcIdentity,
  UsernameUnavailableError,
  verifyUserPassword,
} from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-oidc-methods-"),
);
const databasePath = path.join(workspace, "oidc-methods.db");
const issuer = "https://identity.example.test/realms/wealthboard";

describe.sequential("hybrid authentication methods", () => {
  let localUserId = "";
  let oidcUserId = "";
  let localVersion = 0;
  let oidcVersion = 0;

  beforeAll(async () => {
    process.env.DATABASE_PATH = databasePath;
    const sqlite = new Database(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.close();

    const local = await registerUser({
      username: "local-owner",
      displayName: "Local Owner",
      password: "local-password-12345",
    });
    const oidc = resolveOidcLogin({
      issuer,
      subject: "claimed-provider-subject",
      name: "OIDC Owner",
    });
    if (!oidc) throw new Error("OIDC user was not provisioned.");
    localUserId = local.userId;
    oidcUserId = oidc.userId;
    localVersion = local.sessionVersion;
    oidcVersion = oidc.sessionVersion;
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("fresh local-password verification does not alter sessions", async () => {
    await expect(
      verifyUserPassword(localUserId, "local-password-12345"),
    ).resolves.toBe(true);
    await expect(
      verifyUserPassword(localUserId, "wrong-password"),
    ).resolves.toBe(false);
    await expect(verifyUserPassword(oidcUserId, "any-password")).resolves.toBe(
      false,
    );
    expect(
      getDatabase()
        .query.users.findFirst({ where: eq(users.id, localUserId) })
        .sync()?.sessionVersion,
    ).toBe(localVersion);
  });

  test("an identity owned by another user can never be linked", () => {
    expect(() =>
      linkOidcIdentity(
        localUserId,
        {
          issuer,
          subject: "claimed-provider-subject",
        },
        localVersion,
      ),
    ).toThrow(AuthenticationMethodError);
    expect(getUserAuthState(localUserId, issuer)?.oidcIdentity).toBeNull();
  });

  test("explicit linking creates one mapping and invalidates prior sessions", () => {
    const linked = linkOidcIdentity(
      localUserId,
      {
        issuer,
        subject: "local-owner-provider-subject",
      },
      localVersion,
    );
    localVersion += 1;

    expect(linked.sessionVersion).toBe(localVersion);
    expect(getUserAuthState(localUserId, issuer)).toMatchObject({
      hasPassword: true,
      oidcIdentity: { id: expect.any(String) },
    });
    expect(
      getDatabase()
        .select()
        .from(oidcIdentities)
        .where(eq(oidcIdentities.userId, localUserId))
        .all(),
    ).toHaveLength(1);
    expect(() =>
      linkOidcIdentity(
        localUserId,
        {
          issuer,
          subject: "another-subject-from-same-provider",
        },
        localVersion,
      ),
    ).toThrow(AuthenticationMethodError);
  });

  test("OIDC reauthentication requires the exact linked identity", () => {
    expect(
      reauthenticateOidcIdentity(
        localUserId,
        {
          issuer,
          subject: "local-owner-provider-subject",
        },
        localVersion,
      ),
    ).toMatchObject({
      userId: localUserId,
      sessionVersion: localVersion,
    });
    expect(() =>
      reauthenticateOidcIdentity(
        localUserId,
        {
          issuer,
          subject: "claimed-provider-subject",
        },
        localVersion,
      ),
    ).toThrow(AuthenticationMethodError);
  });

  test("unlinking retains the local credential and invalidates sessions", async () => {
    const unlinked = unlinkOidcIdentity(localUserId, issuer);
    localVersion += 1;

    expect(unlinked.sessionVersion).toBe(localVersion);
    expect(getUserAuthState(localUserId, issuer)).toMatchObject({
      hasPassword: true,
      oidcIdentity: null,
    });
    await expect(
      authenticateUser("local-owner", "local-password-12345"),
    ).resolves.toMatchObject({
      userId: localUserId,
      sessionVersion: localVersion,
    });
  });

  test("local credential enablement never merges on username collision", async () => {
    await expect(
      enableLocalCredential(oidcUserId, {
        username: "local-owner",
        password: "oidc-local-password-12345",
        issuer,
      }),
    ).rejects.toBeInstanceOf(UsernameUnavailableError);
    expect(getUserAuthState(oidcUserId, issuer)?.hasPassword).toBe(false);

    const enabled = await enableLocalCredential(oidcUserId, {
      username: "oidc-local-owner",
      password: "oidc-local-password-12345",
      issuer,
    });
    oidcVersion += 1;
    expect(enabled.sessionVersion).toBe(oidcVersion);
    await expect(
      authenticateUser("oidc-local-owner", "oidc-local-password-12345"),
    ).resolves.toMatchObject({
      userId: oidcUserId,
      sessionVersion: oidcVersion,
    });
  });

  test("removing a local credential requires OIDC and invalidates sessions", async () => {
    const removed = removeLocalCredential(oidcUserId, issuer);
    oidcVersion += 1;

    expect(removed.sessionVersion).toBe(oidcVersion);
    expect(getUserAuthState(oidcUserId, issuer)).toMatchObject({
      hasPassword: false,
      oidcIdentity: { id: expect.any(String) },
    });
    await expect(
      authenticateUser("oidc-local-owner", "oidc-local-password-12345"),
    ).resolves.toBeNull();
    expect(() => unlinkOidcIdentity(oidcUserId, issuer)).toThrow(
      AuthenticationMethodError,
    );
  });
});
