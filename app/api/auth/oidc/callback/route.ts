import { randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import {
  consumeOidcTransaction,
  storeOidcReauthGrant,
} from "@/lib/auth/oidc-cookie";
import {
  constantTimeEqual,
  discoverOidcProvider,
  exchangeAuthorizationCode,
  openOidcTransaction,
  sealOidcReauthGrant,
  verifyOidcIdToken,
} from "@/lib/auth/oidc";
import { oidcRequestRateLimit } from "@/lib/auth/rate-limit";
import { clientAddress } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import {
  linkOidcIdentity,
  reauthenticateOidcIdentity,
  resolveOidcLogin,
} from "@/lib/auth/users";

export const dynamic = "force-dynamic";

function errorRedirect(
  appOrigin: string,
  intent: "login" | "link" | "reauth_local",
  error: string,
) {
  const url = new URL(intent === "login" ? "/login" : "/settings", appOrigin);
  url.searchParams.set(intent === "login" ? "oidc_error" : "auth", error);
  return intent === "login"
    ? NextResponse.redirect(url)
    : sessionHandoff(appOrigin, `${url.pathname}${url.search}`);
}

function serializeForInlineScript(value: string) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sessionHandoff(appOrigin: string, next: string) {
  const destination = new URL(next, appOrigin).toString();
  const serializedDestination = serializeForInlineScript(destination);
  const escapedDestination = escapeHtmlAttribute(destination);
  const nonce = randomBytes(16).toString("base64");
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Completing sign in</title>
    <style nonce="${nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101615;color:#d1fae5;font:500 1rem/1.5 sans-serif}</style>
    <script nonce="${nonce}">window.addEventListener("DOMContentLoaded",()=>window.location.replace(${serializedDestination}),{once:true});</script>
  </head>
  <body>
    <p role="status">Completing sign in...</p>
    <noscript><a href="${escapedDestination}">Continue</a></noscript>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": contentSecurityPolicy,
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const transactionToken = await consumeOidcTransaction();
  const config = getAuthConfig();
  if (!config.oidcEnabled || !config.oidc) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const appOrigin = new URL(config.oidc.callbackUrl).origin;
  const rateLimit = oidcRequestRateLimit(
    "callback",
    clientAddress(request.headers),
  );
  if (!rateLimit.allowed)
    return errorRedirect(appOrigin, "login", "rate_limited");

  let intent: "login" | "link" | "reauth_local" = "login";
  try {
    if (!transactionToken) throw new Error("Missing OIDC transaction.");
    const transaction = await openOidcTransaction(
      config.oidc,
      transactionToken,
    );
    intent = transaction.intent;
    const states = request.nextUrl.searchParams.getAll("state");
    if (
      states.length !== 1 ||
      !constantTimeEqual(states[0], transaction.state)
    ) {
      throw new Error("Invalid OIDC callback parameters.");
    }
    if (request.nextUrl.searchParams.has("error")) {
      return errorRedirect(
        appOrigin,
        intent,
        intent === "login" ? "provider" : "provider_error",
      );
    }
    const codes = request.nextUrl.searchParams.getAll("code");
    if (codes.length !== 1) {
      throw new Error("Invalid OIDC callback parameters.");
    }

    const metadata = await discoverOidcProvider(config.oidc);
    const exchanged = await exchangeAuthorizationCode(config.oidc, metadata, {
      code: codes[0],
      verifier: transaction.verifier,
    });
    const verified = await verifyOidcIdToken(
      config.oidc,
      metadata,
      exchanged.idToken,
      transaction.nonce,
    );
    const authenticated =
      intent === "login"
        ? resolveOidcLogin(verified)
        : intent === "link"
          ? linkOidcIdentity(
              transaction.linkingUserId!,
              verified,
              transaction.linkingSessionVersion!,
            )
          : reauthenticateOidcIdentity(
              transaction.linkingUserId!,
              verified,
              transaction.linkingSessionVersion!,
            );
    if (!authenticated)
      return errorRedirect(appOrigin, intent, "access_denied");
    if (intent === "reauth_local") {
      await storeOidcReauthGrant(
        await sealOidcReauthGrant(config.oidc, authenticated.userId),
      );
    }
    await createSession(
      authenticated.userId,
      authenticated.sessionVersion,
      authenticated.sessionTimeoutMinutes,
    );
    return sessionHandoff(appOrigin, transaction.next);
  } catch (error) {
    console.error(
      "OIDC callback failed safely:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return errorRedirect(appOrigin, intent, "invalid_callback");
  }
}
