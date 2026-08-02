import "server-only";

export function requireTrustedOrigin(request: Request) {
  const configured = process.env.APP_URL;
  if (!configured) throw new Error("APP_URL is required for state-changing API requests.");
  const expected = new URL(configured).origin;
  const actual = request.headers.get("origin");
  if (actual !== expected) {
    throw new Error("The request origin is not trusted.");
  }
}
