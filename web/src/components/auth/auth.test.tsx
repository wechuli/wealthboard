import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginScreen, SignupScreen } from "./auth";

const session = {
  user: { id: "user-1", username: "casey" },
  csrfToken: "csrf",
  expiresAt: "2030-01-01T00:00:00Z",
} as never;

afterEach(cleanup);

describe("ported authentication UI", () => {
  it("renders the source login frame and authenticates through its callback", async () => {
    const user = userEvent.setup();
    const authenticate = vi.fn().mockResolvedValue(session);
    const onAuthenticated = vi.fn();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginScreen
          config={{ localEnabled: true, oidcEnabled: false, providerName: "" }}
          authenticate={authenticate}
          onAuthenticated={onAuthenticated}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Your wealth, in focus." }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Username"), "casey");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(authenticate).toHaveBeenCalledWith({
      username: "casey",
      password: "correct horse",
    });
    expect(onAuthenticated).toHaveBeenCalledWith(session);
  });

  it("preserves signup fields, currency choices, and client validation", async () => {
    const user = userEvent.setup();
    const authenticate = vi.fn().mockResolvedValue(session);
    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <SignupScreen authenticate={authenticate} onAuthenticated={vi.fn()} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Create your private portfolio." }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Base currency")).toHaveValue("KES");
    expect(
      screen.getByRole("option", { name: "USD - US Dollar" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Enter a valid username.")).toBeInTheDocument();
    expect(authenticate).not.toHaveBeenCalled();
  });
});
