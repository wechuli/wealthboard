import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "wealthboard_session";

function sessionSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

export type SessionPayload = {
  sub: string;
  version: number;
};

export async function signSession(payload: SessionPayload, expiresAt: Date) {
  return new SignJWT({ version: payload.version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(sessionSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.version !== "number")
      return null;
    return { sub: payload.sub, version: payload.version };
  } catch {
    return null;
  }
}
