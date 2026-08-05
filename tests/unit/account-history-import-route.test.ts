// @vitest-environment node

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/origin", () => ({ requireTrustedOrigin: vi.fn() }));
vi.mock("@/lib/services/account-history-import", () => ({
  ACCOUNT_HISTORY_MAX_BYTES: 5 * 1024 * 1024,
  AccountHistoryAccessError: class AccountHistoryAccessError extends Error {},
  AccountHistoryFileError: class AccountHistoryFileError extends Error {},
  previewAccountHistory: vi.fn(),
  commitAccountHistory: vi.fn(),
}));

import { POST as commitPost } from "@/app/api/accounts/[id]/history-import/commit/route";
import { POST as previewPost } from "@/app/api/accounts/[id]/history-import/preview/route";
import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import {
  commitAccountHistory,
  previewAccountHistory,
} from "@/lib/services/account-history-import";

const content =
  "external_id,type,amount,date,description,notes\nstable-1,deposit,1.00,2025-01-01,,";
const params = { params: Promise.resolve({ id: "account-1" }) };

function request(path: "preview" | "commit", hash?: string) {
  const body = new FormData();
  body.set("file", new File([content], "history.csv", { type: "text/csv" }));
  if (hash) body.set("hash", hash);
  return new Request(
    `https://wealthboard.example.com/api/accounts/account-1/history-import/${path}`,
    {
      method: "POST",
      headers: { Origin: "https://wealthboard.example.com" },
      body,
    },
  );
}

describe("account history import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      userId: "session-user",
      username: "alice",
      version: 1,
    });
    vi.mocked(requireTrustedOrigin).mockReturnValue(undefined);
    vi.mocked(previewAccountHistory).mockReturnValue({
      account: {
        id: "account-1",
        name: "History",
        institution: null,
        currency: "USD",
      },
      dateRange: { from: "2025-01-01", to: "2025-01-01" },
      currentBalanceMinor: 0,
      projectedBalanceMinor: 100,
      netChangeMinor: 100,
      summary: { ready: 1, skippedDuplicates: 0, failed: 0 },
      rows: [],
    });
    vi.mocked(commitAccountHistory).mockReturnValue({
      account: {
        id: "account-1",
        name: "History",
        institution: null,
        currency: "USD",
      },
      finalBalanceMinor: 100,
      summary: { imported: 1, skippedDuplicates: 0, failed: 0 },
      rows: [],
    });
  });

  test("requires authentication and trusted origin before parsing", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await previewPost(request("preview"), params)).status).toBe(401);
    expect(requireTrustedOrigin).not.toHaveBeenCalled();

    vi.mocked(requireTrustedOrigin).mockImplementationOnce(() => {
      throw new Error("untrusted");
    });
    expect((await previewPost(request("preview"), params)).status).toBe(403);
    expect(previewAccountHistory).not.toHaveBeenCalled();
  });

  test("uses only the session owner and returns a no-store SHA-256 preview", async () => {
    const response = await previewPost(request("preview"), params);
    const payload = (await response.json()) as { hash: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.hash).toBe(
      createHash("sha256").update(content, "utf8").digest("hex"),
    );
    expect(previewAccountHistory).toHaveBeenCalledWith(
      "session-user",
      "account-1",
      content,
      "csv",
    );
  });

  test("rejects changed files and commits the verified content", async () => {
    const changed = await commitPost(request("commit", "0".repeat(64)), params);
    expect(changed.status).toBe(409);
    expect(commitAccountHistory).not.toHaveBeenCalled();

    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    const response = await commitPost(request("commit", hash), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(commitAccountHistory).toHaveBeenCalledWith(
      "session-user",
      "account-1",
      content,
      "csv",
    );
  });

  test("does not expose unexpected database errors", async () => {
    vi.mocked(commitAccountHistory).mockImplementationOnce(() => {
      throw new Error("SQL secret row details");
    });
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    const response = await commitPost(request("commit", hash), params);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "No transactions were imported. Try again.",
    });
  });
});
