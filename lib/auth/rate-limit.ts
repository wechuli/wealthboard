import "server-only";

import { createHash } from "node:crypto";
import { and, count, eq, gte, lt } from "drizzle-orm";

import { loginAttempts } from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db";

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 5;
const GLOBAL_MAX_FAILURES = 20;

function clientKey(value: string) {
  return createHash("sha256")
    .update(`${process.env.SESSION_SECRET}:${value}`)
    .digest("hex");
}

export function loginRateLimit(identity: string) {
  const db = getDatabase();
  const key = clientKey(identity);
  const globalKey = clientKey("all-login-clients");
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
    const allowed =
      countFailures(key) < MAX_FAILURES &&
      countFailures(globalKey) < GLOBAL_MAX_FAILURES;
    if (allowed) {
      const timestamp = nowIso();
      tx.insert(loginAttempts)
        .values(
          [key, globalKey].map((clientKeyValue) => ({
            id: crypto.randomUUID(),
            clientKey: clientKeyValue,
            succeeded: false,
            attemptedAt: timestamp,
          })),
        )
        .run();
    }
    return {
      key,
      globalKey,
      allowed,
      retryAfterMinutes: WINDOW_MINUTES,
    };
  });
}

export function recordLoginAttempt(
  keys: { key: string; globalKey: string },
  succeeded: boolean,
) {
  const db = getDatabase();
  if (!succeeded) return;
  db.transaction((tx) => {
    tx.delete(loginAttempts).where(eq(loginAttempts.clientKey, keys.key)).run();
    tx.delete(loginAttempts)
      .where(eq(loginAttempts.clientKey, keys.globalKey))
      .run();
  });
}
