import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "worthboard_session";

function sessionSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

export type SessionPayload = {
  sub: "single-user";
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

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.sub !== "single-user" || typeof payload.version !== "number") return null;
    return { sub: "single-user", version: payload.version };
  } catch {
    return null;
  }
}
