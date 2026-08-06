import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { storeOidcTransaction } from "@/lib/auth/oidc-cookie";
import {
  createAuthorizationRequest,
  discoverOidcProvider,
  safeRelativePath,
  sealOidcTransaction,
} from "@/lib/auth/oidc";
import { oidcRequestRateLimit } from "@/lib/auth/rate-limit";
import { clientAddress } from "@/lib/auth/request";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function loginRedirect(appOrigin: string, error: string) {
  const url = new URL("/login", appOrigin);
  url.searchParams.set("oidc_error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  if (!config.oidcEnabled || !config.oidc) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const appOrigin = new URL(config.oidc.callbackUrl).origin;
  const rateLimit = oidcRequestRateLimit(
    "start",
    clientAddress(request.headers),
  );
  if (!rateLimit.allowed) return loginRedirect(appOrigin, "rate_limited");

  const next = request.nextUrl.searchParams.get("next");
  if (await getSession()) {
    return NextResponse.redirect(new URL(safeRelativePath(next), appOrigin));
  }

  try {
    const metadata = await discoverOidcProvider(config.oidc);
    const authorization = createAuthorizationRequest(config.oidc, metadata, {
      next,
    });
    const transaction = await sealOidcTransaction(
      config.oidc,
      authorization.transaction,
    );
    await storeOidcTransaction(transaction);
    return NextResponse.redirect(authorization.authorizationUrl);
  } catch (error) {
    console.error(
      "OIDC initiation failed safely:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return loginRedirect(appOrigin, "unavailable");
  }
}
