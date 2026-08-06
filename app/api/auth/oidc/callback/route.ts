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
  return NextResponse.redirect(url);
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
    return NextResponse.redirect(new URL(transaction.next, appOrigin));
  } catch (error) {
    console.error(
      "OIDC callback failed safely:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return errorRedirect(appOrigin, intent, "invalid_callback");
  }
}
