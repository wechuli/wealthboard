import "server-only";

import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, signSession, verifySessionToken } from "@/lib/auth/token";
import { users } from "@/db/schema";
import { getDatabase } from "@/lib/db";

export async function createSession(
  userId: string,
  sessionVersion: number,
  sessionTimeoutMinutes: number,
) {
  const expiresAt = new Date(Date.now() + sessionTimeoutMinutes * 60_000);
  const token = await signSession({ sub: userId, version: sessionVersion }, expiresAt);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const user = await getDatabase().query.users.findFirst({
    where: and(
      eq(users.id, payload.sub),
      eq(users.status, "active"),
      eq(users.sessionVersion, payload.version),
    ),
    columns: { id: true, username: true, sessionVersion: true },
  });
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    version: user.sessionVersion,
  };
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
