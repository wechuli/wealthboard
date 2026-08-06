import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";

const OIDC_PUBLIC_PATHS = new Set([
  "/api/auth/oidc/start",
  "/api/auth/oidc/callback",
]);

export async function proxy(request: NextRequest) {
  const authConfig = getAuthConfig();
  if (request.nextUrl.pathname === "/signup") {
    return authConfig.localEnabled
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/login", request.url));
  }
  if (OIDC_PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    if (!authConfig.oidcEnabled) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.next();
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySessionToken(token))) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|offline|shell|manifest\\.webmanifest|sw\\.js|icons/|apple-touch-icon\\.png|favicon\\.ico|_next/static|_next/image|api/health).*)",
  ],
};
