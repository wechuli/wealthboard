import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MoneyValue } from "@/components/privacy";
import { AppShell, navigation } from "@/components/layout/app-shell";

const session = {
  user: { id: "user-1", username: "casey" },
  csrfToken: "csrf",
  expiresAt: "2030-01-01T00:00:00Z",
} as never;

afterEach(cleanup);

describe("AppShell navigation", () => {
  it("exposes every read-only destination", () => {
    render(
      <MemoryRouter>
        <AppShell
          session={session}
          appName="Wealthboard"
          displayName="Casey"
          onSignOut={vi.fn()}
        >
          <p>Page</p>
        </AppShell>
      </MemoryRouter>,
    );

    for (const item of navigation) {
      expect(
        screen
          .getAllByRole("link", { name: item.label })
          .some((link) => link.getAttribute("href") === item.to),
      ).toBe(true);
    }
  });

  it("supports collapse, quick add, and privacy controls", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell
          session={session}
          appName="Wealthboard"
          displayName="Casey"
          onSignOut={vi.fn()}
        >
          <MoneyValue amount="12345" currency="KES" />
        </AppShell>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Quick add" })[0]);
    expect(
      screen.getByRole("dialog", { name: "Quick add" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add deposit" })).toHaveAttribute(
      "href",
      "/transactions/new?type=deposit",
    );

    await user.click(screen.getByRole("button", { name: "Close quick add" }));
    await user.click(
      screen.getByRole("button", { name: "Hide financial values" }),
    );
    expect(screen.getByText("••••••")).toBeInTheDocument();
  });
});
