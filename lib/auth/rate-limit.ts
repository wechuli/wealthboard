import "server-only";

import { createHash } from "node:crypto";
import { and, count, eq, gte, lt } from "drizzle-orm";

import { loginAttempts } from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 5;

function clientKey(value: string) {
  return createHash("sha256")
    .update(`${process.env.SESSION_SECRET}:${value}`)
    .digest("hex");
}

function takeRateLimit(values: string[]) {
  const db = getDatabase();
  const keys = values.map(clientKey);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  return db.transaction((tx) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    tx.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, cutoff)).run();
    const countFailures = (lookupKey: string) =>
      tx
        .select({ total: count() })
        .from(loginAttempts)
        .where(
          and(
            eq(loginAttempts.clientKey, lookupKey),
            eq(loginAttempts.succeeded, false),
            gte(loginAttempts.attemptedAt, since),
          ),
        )
        .get()?.total ?? 0;
    const allowed = keys.every((key) => countFailures(key) < MAX_FAILURES);
    if (allowed) {
      const timestamp = nowIso();
      tx.insert(loginAttempts)
        .values(
          keys.map((clientKeyValue) => ({
            id: crypto.randomUUID(),
            clientKey: clientKeyValue,
            succeeded: false,
            attemptedAt: timestamp,
          })),
        )
        .run();
    }
    return {
      keys,
      allowed,
      retryAfterMinutes: WINDOW_MINUTES,
    };
  });
}

export function loginRateLimit(username: string, address: string) {
  return takeRateLimit([
    `login-user:${username}:${address}`,
    `login-client:${address}`,
  ]);
}

export function signupRateLimit(address: string) {
  return takeRateLimit([`signup-client:${address}`]);
}

export function recordLoginAttempt(
  rateLimit: { keys: string[] },
  succeeded: boolean,
) {
  const db = getDatabase();
  if (!succeeded) return;
  db.transaction((tx) => {
    for (const key of rateLimit.keys) {
      tx.delete(loginAttempts).where(eq(loginAttempts.clientKey, key)).run();
    }
  });
}
