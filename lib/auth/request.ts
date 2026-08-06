import "server-only";

import { isIP } from "node:net";

export function clientAddress(headers: Headers) {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "direct-client";
  const value = headers.get("x-forwarded-for") || headers.get("x-real-ip");
  if (!value || value.includes(",")) return "untrusted-forwarding-chain";
  const address = value.trim();
  return isIP(address) ? address : "invalid-forwarded-address";
}
