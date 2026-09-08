import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountImportWorkspace } from "@/components/account-import-workspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const response = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

describe("AI source import workspace", () => {
  it("keeps direct import provider-free and requires consent after redaction", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          source: {
            units: [
              {
                id: "source-1",
                location: "Row 1",
                text: "Private reference; Deposit 12.30",
              },
            ],
            warnings: [],
          },
          provider: {
            provider: "openai",
            host: "api.openai.com",
            model: "fixture-model",
            hasStoredApiKey: true,
            maxOutputTokens: 2000,
            configurationHash: "a".repeat(64),
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          content:
            '{"format":"wealthboard-account-history","version":1,"transactions":[]}',
          references: [],
          exclusions: [],
          issues: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AccountImportWorkspace
        accountId="account-1"
        trackingMode="balance"
        currency="USD"
      >
        <p>Direct import</p>
      </AccountImportWorkspace>,
    );
    expect(screen.getByText("Direct import")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "Convert with AI" }));
    await user.upload(
      screen.getByLabelText("Source file"),
      new File(["content"], "statement.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Extract locally" }));
    const send = await screen.findByRole("button", {
      name: "Convert selected text",
    });
    expect(send).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: /I approve sending/ }),
    );
    expect(send).toBeEnabled();
    await user.clear(screen.getByLabelText("Approved text for source-1"));
    await user.type(
      screen.getByLabelText("Approved text for source-1"),
      "Deposit 12.30",
    );
    expect(send).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: /I approve sending/ }),
    );
    await user.click(send);
    expect(await screen.findByLabelText("Canonical JSON draft")).toBeVisible();
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.source.units[0].text).toBe("Deposit 12.30");
    expect(JSON.stringify(sent)).not.toContain("Private reference");
    expect(sent.apiKey).toBeUndefined();
    expect(
      screen.getByRole("button", { name: "Use draft for preview" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: /I reviewed the source coverage/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Use draft for preview" }),
    );
    expect(screen.getByRole("button", { name: "Preview file" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Edit draft" }));
    expect(
      screen.getByRole("button", { name: "Use draft for preview" }),
    ).toBeDisabled();
  });
});
