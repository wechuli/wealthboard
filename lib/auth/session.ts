import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSettings } from "@/lib/bootstrap";
import { SESSION_COOKIE, signSession, verifySessionToken } from "@/lib/auth/token";

export async function createSession() {
  const settings = await getSettings();
  const expiresAt = new Date(Date.now() + settings.sessionTimeoutMinutes * 60_000);
  const token = await signSession(
    { sub: "single-user", version: settings.sessionVersion },
    expiresAt,
  );
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
  const settings = await getSettings();
  return payload.version === settings.sessionVersion ? payload : null;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
