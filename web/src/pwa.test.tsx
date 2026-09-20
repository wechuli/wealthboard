import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { OfflinePage, PwaManager } from "./pwa";

describe("PWA safeguards", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-offline");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("marks the document offline and blocks marked mutation submissions", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    render(<PwaManager />);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event("offline")));

    const form = document.createElement("form");
    form.dataset.financialMutation = "true";
    document.body.append(form);
    const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(document.documentElement.dataset.offline).toBe("true");
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText(/Changes are blocked/)).toBeInTheDocument();
    form.remove();
  });

  it("renders a read-only offline route", () => {
    render(<MemoryRouter><OfflinePage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "You are offline" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to dashboard" })).toHaveAttribute("href", "/");
  });
});