import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary";

let shouldThrow = true;

function Draft({ issues }: { issues: string[] | null }) {
  if (shouldThrow) {
    // Mirrors the crash from a conversion draft whose issues were null.
    return (
      <ul>
        {issues!.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    );
  }
  return <p>Draft ready</p>;
}

beforeEach(() => {
  shouldThrow = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("replaces a crashed view with a recoverable message instead of a blank page", async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Draft issues={null} />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).not.toHaveTextContent(/Cannot read|null|map/);
    expect(console.error).toHaveBeenCalled();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Draft ready")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the error when the reset key changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/accounts/1/import">
        <Draft issues={null} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeVisible();
    shouldThrow = false;
    rerender(
      <ErrorBoundary resetKey="/accounts">
        <Draft issues={null} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Draft ready")).toBeVisible();
  });

  it("offers a full page reload", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    });
    render(
      <ErrorBoundary fullScreen>
        <Draft issues={null} />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
