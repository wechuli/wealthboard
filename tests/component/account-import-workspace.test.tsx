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
  it("supports password retries and never includes the document password in AI conversion", async () => {
    const user = userEvent.setup();
    const submissions: Array<{
      url: string;
      password: FormDataEntryValue | null;
      json?: string;
    }> = [];
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      submissions.push({
        url,
        password:
          options.body instanceof FormData
            ? options.body.get("documentPassword")
            : null,
        json: typeof options.body === "string" ? options.body : undefined,
      });
      if (submissions.length < 3)
        return new Response(
          JSON.stringify({
            error: "Enter the PDF password again.",
            code:
              submissions.length === 1
                ? "password_required"
                : "incorrect_password",
          }),
          { status: 400 },
        );
      if (submissions.length === 3)
        return response({
          source: {
            units: [
              { id: "source-1", location: "Page 1", text: "Deposit 12.30" },
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
        });
      return response({
        content: "{}",
        references: [],
        exclusions: [],
        issues: [],
      });
    });
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
    await user.click(screen.getByRole("radio", { name: "Convert with AI" }));
    const file = new File(["encrypted fixture"], "statement.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText("Source file"), file);
    const password = screen.getByLabelText("PDF password (if required)");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Extract locally" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the PDF password again.",
    );
    expect(password).toHaveFocus();
    await user.type(password, "wrong-fixture-password");
    await user.click(screen.getByRole("button", { name: "Extract locally" }));
    expect(password).toHaveValue("");
    await user.type(password, " exact fictional password ");
    await user.click(screen.getByRole("button", { name: "Extract locally" }));
    expect(
      await screen.findByLabelText("Approved text for source-1"),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("PDF password (if required)"),
    ).not.toBeInTheDocument();
    expect(submissions.map((entry) => entry.password)).toEqual([
      null,
      "wrong-fixture-password",
      " exact fictional password ",
    ]);
    await user.click(
      screen.getByRole("checkbox", { name: /I approve sending/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Convert selected text" }),
    );
    expect(await screen.findByLabelText("Canonical JSON draft")).toBeVisible();
    expect(submissions[3].json).not.toMatch(
      /documentPassword|fictional password/,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.upload(screen.getByLabelText("Source file"), file);
    expect(screen.getByLabelText("PDF password (if required)")).toHaveValue("");
    await user.type(
      screen.getByLabelText("PDF password (if required)"),
      "unused-fixture-password",
    );
    await user.upload(
      screen.getByLabelText("Source file"),
      new File(["text"], "other.txt", { type: "text/plain" }),
    );
    expect(
      screen.queryByLabelText("PDF password (if required)"),
    ).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText("Source file"), file);
    expect(screen.getByLabelText("PDF password (if required)")).toHaveValue("");
  });

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
