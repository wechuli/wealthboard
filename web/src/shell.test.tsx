import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell, navigation } from "./shell";

const session = {
  user: { id: "user-1", username: "casey" },
  csrfToken: "csrf",
  expiresAt: "2030-01-01T00:00:00Z",
} as never;

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

    for (const item of navigation)
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.to,
      );
  });
});
