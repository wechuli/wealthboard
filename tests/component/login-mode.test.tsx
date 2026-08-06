import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import LoginPage from "@/app/login/page";
import { getAuthConfig, type AuthConfig } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";

const oidc = {
  issuer: "https://identity.example.test/realm",
  clientId: "wealthboard",
  clientSecret: "provider-secret",
  transactionSecret: new Uint8Array(32),
  providerName: "Example Identity",
  callbackUrl: "https://wealth.example.test/api/auth/oidc/callback",
  scopes: ["openid", "profile", "email"],
  algorithms: ["RS256"],
} as const;

function config(methods: "local" | "oidc" | "local,oidc"): AuthConfig {
  const values = methods.split(",") as Array<"local" | "oidc">;
  const oidcEnabled = values.includes("oidc");
  return {
    methods: values,
    localEnabled: values.includes("local"),
    oidcEnabled,
    ...(oidcEnabled
      ? {
          appUrl: "https://wealth.example.test",
          oidc,
        }
      : {}),
  };
}

async function renderMode(methods: "local" | "oidc" | "local,oidc") {
  vi.mocked(getAuthConfig).mockReturnValue(config(methods));
  render(
    await LoginPage({
      searchParams: Promise.resolve({ next: "/reports" }),
    }),
  );
}

describe("login method matrix", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders only local login and signup in local mode", async () => {
    await renderMode("local");

    expect(screen.getByLabelText("Username")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Continue with/ }),
    ).not.toBeInTheDocument();
  });

  it("renders only provider login in OIDC-only mode", async () => {
    await renderMode("oidc");

    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create an account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Continue with Example Identity",
      }),
    ).toHaveAttribute("href", "/api/auth/oidc/start?next=%2Freports");
  });

  it("renders local and provider login with a separator in hybrid mode", async () => {
    await renderMode("local,oidc");

    expect(screen.getByLabelText("Username")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(screen.getByText("or")).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Continue with Example Identity",
      }),
    ).toBeVisible();
  });

  it("shows only bounded callback feedback and a safe retry", async () => {
    vi.mocked(getAuthConfig).mockReturnValue(config("oidc"));
    render(
      await LoginPage({
        searchParams: Promise.resolve({
          oidc_error: "invalid_callback",
          next: "//attacker.example",
        }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The provider response could not be verified.",
    );
    expect(
      screen.getByRole("link", { name: "Continue with Example Identity" }),
    ).toHaveAttribute(
      "href",
      "/api/auth/oidc/start?next=%2F%2Fattacker.example",
    );
  });
});
