import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ThemeControl,
  ThemeProvider,
} from "@/components/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";

describe("appearance control", () => {
  let prefersDark = false;
  let listeners: Set<() => void>;

  beforeEach(() => {
    listeners = new Set();
    document.documentElement.dataset.themePreference = "system";
    document.documentElement.dataset.theme = "light";
    localStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-color-scheme") && prefersDark,
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          listeners.delete(listener),
        dispatchEvent: () => true,
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    prefersDark = false;
  });

  it("shows and persists the selected preference", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeControl variant="settings" />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("follows live system changes only when System is selected", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeControl variant="settings" />
      </ThemeProvider>,
    );

    prefersDark = true;
    listeners.forEach((listener) => listener());
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(screen.getByRole("button", { name: "Light" }));
    prefersDark = false;
    listeners.forEach((listener) => listener());
    prefersDark = true;
    listeners.forEach((listener) => listener());
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("still applies a preference when storage is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked");
    });
    render(
      <ThemeProvider>
        <ThemeControl variant="settings" />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
