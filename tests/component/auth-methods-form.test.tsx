import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/actions", () => ({
  enableLocalCredentialAction: vi.fn(),
  removeLocalCredentialAction: vi.fn(),
  startOidcLinkAction: vi.fn(),
  startOidcReauthenticationAction: vi.fn(),
  unlinkOidcIdentityAction: vi.fn(),
}));

import { AuthenticationMethodsForm } from "@/components/auth-methods-form";

describe("authentication method management", () => {
  afterEach(cleanup);

  it("reports local-only policy without provider controls", () => {
    render(
      <AuthenticationMethodsForm
        localEnabled
        oidcEnabled={false}
        hasPassword
        oidcLinked={false}
        reauthenticated={false}
      />,
    );

    expect(screen.getByText("Local password").parentElement).toHaveTextContent(
      "Enabled",
    );
    expect(screen.getByText("OIDC provider").parentElement).toHaveTextContent(
      "Disabled by deployment policy",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reports OIDC-only policy without local credential controls", () => {
    render(
      <AuthenticationMethodsForm
        localEnabled={false}
        oidcEnabled
        providerName="Example Identity"
        hasPassword={false}
        oidcLinked
        reauthenticated={false}
      />,
    );

    expect(screen.getByText("Local password").parentElement).toHaveTextContent(
      "Disabled by deployment policy",
    );
    expect(
      screen.getByText("Example Identity").parentElement,
    ).toHaveTextContent("Linked");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("requires a local password before beginning an explicit provider link", () => {
    render(
      <AuthenticationMethodsForm
        localEnabled
        oidcEnabled
        providerName="Example Identity"
        hasPassword
        oidcLinked={false}
        reauthenticated={false}
      />,
    );

    expect(screen.getByLabelText("Current password")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Link Example Identity" }),
    ).toBeVisible();
  });

  it("offers unlink and provider reauthentication when both methods exist", () => {
    render(
      <AuthenticationMethodsForm
        localEnabled
        oidcEnabled
        providerName="Example Identity"
        hasPassword
        oidcLinked
        reauthenticated={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Unlink Example Identity" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Verify with Example Identity" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Remove local sign-in" }),
    ).not.toBeInTheDocument();
  });

  it("reveals local removal only after provider reauthentication", () => {
    render(
      <AuthenticationMethodsForm
        localEnabled
        oidcEnabled
        providerName="Example Identity"
        hasPassword
        oidcLinked
        reauthenticated
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove local sign-in" }),
    ).toBeVisible();
  });

  it("reveals local credential creation after provider reauthentication", () => {
    render(
      <AuthenticationMethodsForm
        localEnabled
        oidcEnabled
        providerName="Example Identity"
        hasPassword={false}
        oidcLinked
        reauthenticated
      />,
    );

    expect(screen.getByLabelText("Local username")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(screen.getByLabelText("Confirm password")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Enable local sign-in" }),
    ).toBeVisible();
  });

  it("shows bounded callback feedback without identity details", () => {
    render(
      <AuthenticationMethodsForm
        localEnabled
        oidcEnabled
        providerName="Example Identity"
        hasPassword
        oidcLinked={false}
        reauthenticated={false}
        feedback="The provider response could not be verified. Try again."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The provider response could not be verified.",
    );
  });
});
