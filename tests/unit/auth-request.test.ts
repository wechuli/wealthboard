// @vitest-environment node

import { afterEach, describe, expect, test } from "vitest";

import { clientAddress } from "@/lib/auth/request";

describe("authentication client address policy", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HEADERS;
  });

  test("ignores spoofable forwarding headers by default", () => {
    const headers = new Headers({
      "X-Forwarded-For": "203.0.113.10",
      "X-Real-IP": "203.0.113.11",
    });

    expect(clientAddress(headers)).toBe("direct-client");
  });

  test.each(["203.0.113.10", "2001:db8::10"])(
    "accepts one validated address from an explicitly trusted ingress: %s",
    (address) => {
      process.env.TRUST_PROXY_HEADERS = "true";
      expect(clientAddress(new Headers({ "X-Forwarded-For": address }))).toBe(
        address,
      );
    },
  );

  test.each([
    ["203.0.113.10, 10.0.0.1", "untrusted-forwarding-chain"],
    ["chosen-by-client", "invalid-forwarded-address"],
    [undefined, "untrusted-forwarding-chain"],
  ] as const)("fails closed for forwarding value %j", (value, expected) => {
    process.env.TRUST_PROXY_HEADERS = "true";
    const headers = new Headers();
    if (value) headers.set("X-Forwarded-For", value);
    expect(clientAddress(headers)).toBe(expected);
  });
});
