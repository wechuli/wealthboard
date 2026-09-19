import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { APIKeysPanel } from "./settings-page";

describe("APIKeysPanel", () => {
  it("shows a created secret once and removes it when dismissed", async () => {
    const user = userEvent.setup();
    const token = "wbk_v1_created_one_time_secret";
    const operations = {
      load: vi.fn().mockResolvedValue({ keys: [] }),
      create: vi.fn().mockResolvedValue({ id: "key-1", name: "CLI", prefix: "wbk_v1_create", scopes: ["portfolio:read"], createdAt: "2026-09-20T00:00:00Z", token }),
      revoke: vi.fn(),
    };
    render(<APIKeysPanel csrfToken="csrf" operations={operations} />);

    await user.type(screen.getByLabelText("Key name"), "CLI");
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    expect(await screen.findByText(token)).toBeInTheDocument();
    expect(localStorage.getItem("api-key")).toBeNull();
    expect(sessionStorage.getItem("api-key")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Dismiss API key secret" }));
    expect(screen.queryByText(token)).not.toBeInTheDocument();
    expect(screen.getByText("wbk_v1_create", { exact: false })).toBeInTheDocument();
  });
});