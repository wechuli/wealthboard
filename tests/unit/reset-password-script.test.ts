// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const projectRoot = path.resolve(".");
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "wealthboard-password-reset-"),
);
const databasePath = path.join(workspace, "reset.db");

function reset(username: string, methods: string) {
  return spawnSync(process.execPath, ["scripts/reset-password.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      AUTH_METHODS: methods,
      TARGET_USERNAME: username,
      NEW_USER_PASSWORD: "replacement-password-12345",
    },
    encoding: "utf8",
  });
}

describe.sequential("operator password reset policy", () => {
  beforeAll(() => {
    const sqlite = new Database(databasePath);
    sqlite.exec(`
      CREATE TABLE users (
        id text PRIMARY KEY NOT NULL,
        username text NOT NULL UNIQUE,
        password_hash text,
        session_version integer NOT NULL,
        updated_at text NOT NULL
      );
      INSERT INTO users
        (id, username, password_hash, session_version, updated_at)
      VALUES
        ('local-user', 'local-user', 'existing-hash', 4, '2026-01-01T00:00:00.000Z'),
        ('oidc-user', 'oidc-user', NULL, 2, '2026-01-01T00:00:00.000Z');
    `);
    sqlite.close();
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test("refuses every reset while local authentication is disabled", () => {
    const result = reset("local-user", "oidc");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local authentication is disabled");
    const sqlite = new Database(databasePath, { readonly: true });
    expect(
      sqlite
        .prepare(
          "SELECT password_hash, session_version FROM users WHERE id = 'local-user'",
        )
        .get(),
    ).toEqual({ password_hash: "existing-hash", session_version: 4 });
    sqlite.close();
  });

  test("refuses to create a local credential for an OIDC-only user", () => {
    const result = reset("oidc-user", "local,oidc");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "does not have an existing local credential",
    );
    const sqlite = new Database(databasePath, { readonly: true });
    expect(
      sqlite
        .prepare(
          "SELECT password_hash, session_version FROM users WHERE id = 'oidc-user'",
        )
        .get(),
    ).toEqual({ password_hash: null, session_version: 2 });
    sqlite.close();
  });

  test("resets an existing local credential in hybrid mode", async () => {
    const result = reset("local-user", "local,oidc");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("existing sessions have been invalidated");
    const sqlite = new Database(databasePath, { readonly: true });
    const user = sqlite
      .prepare(
        "SELECT password_hash, session_version FROM users WHERE id = 'local-user'",
      )
      .get() as { password_hash: string; session_version: number };
    sqlite.close();
    expect(user.session_version).toBe(5);
    await expect(
      bcrypt.compare("replacement-password-12345", user.password_hash),
    ).resolves.toBe(true);
  });
});
