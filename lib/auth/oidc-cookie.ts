import "server-only";

import { cookies } from "next/headers";

import {
  OIDC_REAUTH_COOKIE,
  OIDC_REAUTH_MAX_AGE_SECONDS,
  OIDC_TRANSACTION_COOKIE,
  OIDC_TRANSACTION_MAX_AGE_SECONDS,
} from "@/lib/auth/oidc";

const callbackPath = "/api/auth/oidc/callback";
const settingsPath = "/settings";

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: callbackPath,
    expires,
  };
}

export async function storeOidcTransaction(token: string) {
  const expires = new Date(
    Date.now() + OIDC_TRANSACTION_MAX_AGE_SECONDS * 1000,
  );
  (await cookies()).set(OIDC_TRANSACTION_COOKIE, token, cookieOptions(expires));
}

export async function consumeOidcTransaction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(OIDC_TRANSACTION_COOKIE)?.value ?? null;
  cookieStore.set(OIDC_TRANSACTION_COOKIE, "", cookieOptions(new Date(0)));
  return token;
}

function reauthCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: settingsPath,
    expires,
  };
}

export async function storeOidcReauthGrant(token: string) {
  const expires = new Date(Date.now() + OIDC_REAUTH_MAX_AGE_SECONDS * 1000);
  (await cookies()).set(
    OIDC_REAUTH_COOKIE,
    token,
    reauthCookieOptions(expires),
  );
}

export async function consumeOidcReauthGrant() {
  const cookieStore = await cookies();
  const token = cookieStore.get(OIDC_REAUTH_COOKIE)?.value ?? null;
  cookieStore.set(OIDC_REAUTH_COOKIE, "", reauthCookieOptions(new Date(0)));
  return token;
}

export async function clearOidcReauthGrant() {
  (await cookies()).set(
    OIDC_REAUTH_COOKIE,
    "",
    reauthCookieOptions(new Date(0)),
  );
}
