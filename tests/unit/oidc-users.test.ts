// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  accounts,
  categories,
  exchangeRates,
  goals,
  oidcIdentities,
  userSettings,
  users,
} from "@/db/schema";
import {
  authenticateUser,
  changeUserPassword,
  getUserAuthState,
  registerUser,
  resolveOidcLogin,
} from "@/lib/auth/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { exportData } from "@/lib/services/portability";

const migrationsFolder = path.resolve("db/migrations");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-oidc-users-"),
);
const databasePath = path.join(workspace, "oidc-users.db");
const issuer = "https://identity.example.test/realms/wealthboard";

describe.sequential("OIDC internal identities", () => {
  let oidcUserId = "";
  let oidcUsername = "";

  beforeAll(() => {
    process.env.DATABASE_PATH = databasePath;
    process.env.TZ = "Africa/Nairobi";
    const sqlite = new Database(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.close();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("first login provisions only the isolated internal user foundation", async () => {
    const result = resolveOidcLogin({
      issuer,
      subject: "provider-subject-1",
      name: "OIDC Example",
      preferredUsername: "provider-user",
    });
    if (!result) throw new Error("OIDC user was not provisioned.");
    oidcUserId = result.userId;

    const db = getDatabase();
    const user = db.query.users
      .findFirst({ where: eq(users.id, oidcUserId) })
      .sync();
    if (!user) throw new Error("OIDC user is unavailable.");
    oidcUsername = user.username;

    expect(result.isNewUser).toBe(true);
    expect(user).toMatchObject({
      username: expect.stringMatching(/^oidc-[0-9a-f]{27}$/),
      passwordHash: null,
      status: "active",
      sessionVersion: 1,
    });
    expect(
      db.query.userSettings
        .findFirst({ where: eq(userSettings.userId, oidcUserId) })
        .sync(),
    ).toMatchObject({ displayName: "OIDC Example", baseCurrency: "KES" });
    expect(
      db
        .select()
        .from(categories)
        .where(eq(categories.userId, oidcUserId))
        .all(),
    ).toHaveLength(11);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(exchangeRates).all()).toHaveLength(0);
    expect(db.select().from(goals).all()).toHaveLength(0);
    expect(
      db
        .select()
        .from(oidcIdentities)
        .where(eq(oidcIdentities.userId, oidcUserId))
        .all(),
    ).toHaveLength(1);

    await expect(
      authenticateUser(oidcUsername, "any-password"),
    ).resolves.toBeNull();
    await expect(
      changeUserPassword(oidcUserId, "any-password", "new-password-12345"),
    ).resolves.toBeNull();
  });

  test("repeat and concurrent-style logins resolve one immutable UUID", () => {
    const results = Array.from({ length: 8 }, () =>
      resolveOidcLogin({
        issuer,
        subject: "provider-subject-1",
        name: "Changed Provider Name",
        preferredUsername: "changed-provider-user",
      }),
    );

    expect(results.every((result) => result?.userId === oidcUserId)).toBe(true);
    expect(results.every((result) => result?.isNewUser === false)).toBe(true);
    expect(
      getDatabase()
        .select()
        .from(oidcIdentities)
        .where(eq(oidcIdentities.subject, "provider-subject-1"))
        .all(),
    ).toHaveLength(1);
    expect(
      getDatabase()
        .query.userSettings.findFirst({
          where: eq(userSettings.userId, oidcUserId),
        })
        .sync()?.displayName,
    ).toBe("OIDC Example");
  });

  test("mutable claim collisions never auto-link or merge users", async () => {
    const local = await registerUser({
      username: "provider-user",
      displayName: "OIDC Example",
      password: "local-password-12345",
    });
    const secondOidc = resolveOidcLogin({
      issuer,
      subject: "provider-subject-2",
      name: "OIDC Example",
      preferredUsername: "provider-user",
    });

    expect(secondOidc?.userId).not.toBe(local.userId);
    expect(secondOidc?.userId).not.toBe(oidcUserId);
    expect(
      getDatabase()
        .query.users.findFirst({ where: eq(users.id, secondOidc!.userId) })
        .sync()?.username,
    ).toMatch(/^oidc-/);
  });

  test("the same subject from a different issuer is a different identity", () => {
    const result = resolveOidcLogin({
      issuer: "https://other.example.test/realms/wealthboard",
      subject: "provider-subject-1",
      preferredUsername: oidcUsername,
    });

    expect(result?.userId).not.toBe(oidcUserId);
  });

  test("disabled users stay denied and identity mappings are not portable", async () => {
    const archive = await exportData(oidcUserId);
    const serialized = JSON.stringify(archive);
    expect(serialized).not.toContain(issuer);
    expect(serialized).not.toContain("provider-subject-1");

    getDatabase()
      .update(users)
      .set({ status: "disabled" })
      .where(eq(users.id, oidcUserId))
      .run();
    expect(
      resolveOidcLogin({ issuer, subject: "provider-subject-1" }),
    ).toBeNull();
    expect(getUserAuthState(oidcUserId, issuer)).toMatchObject({
      status: "disabled",
      hasPassword: false,
    });
  });

  test.each(["", " padded", "line\nbreak"])(
    "rejects invalid opaque subject %j",
    (subject) => {
      expect(() => resolveOidcLogin({ issuer, subject })).toThrow(
        "OIDC identity is invalid.",
      );
    },
  );
});
