// @vitest-environment node

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/origin", () => ({ requireTrustedOrigin: vi.fn() }));
vi.mock("@/lib/services/investment-history-import", () => ({
  INVESTMENT_HISTORY_MAX_BYTES: 5 * 1024 * 1024,
  InvestmentHistoryAccessError: class InvestmentHistoryAccessError extends Error {},
  InvestmentHistoryFileError: class InvestmentHistoryFileError extends Error {},
  previewInvestmentHistory: vi.fn(),
  commitInvestmentHistory: vi.fn(),
}));

import { POST as commitPost } from "@/app/api/accounts/[id]/investment-import/commit/route";
import { POST as previewPost } from "@/app/api/accounts/[id]/investment-import/preview/route";
import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import {
  InvestmentHistoryAccessError,
  InvestmentHistoryFileError,
  commitInvestmentHistory,
  previewInvestmentHistory,
} from "@/lib/services/investment-history-import";

const content = JSON.stringify({
  format: "wealthboard-investment-history",
  version: 1,
  instruments: [],
  position_events: [],
  cash_transactions: [],
  prices: [],
});
const params = { params: Promise.resolve({ id: "account-1" }) };

function request(path: "preview" | "commit", hash?: string) {
  const body = new FormData();
  body.set(
    "file",
    new File([content], "investment.json", { type: "application/json" }),
  );
  if (hash) body.set("hash", hash);
  return new Request(
    `https://wealthboard.example.com/api/accounts/account-1/investment-import/${path}`,
    {
      method: "POST",
      headers: { Origin: "https://wealthboard.example.com" },
      body,
    },
  );
}

describe("investment history import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      userId: "session-user",
      username: "alice",
      version: 1,
    });
    vi.mocked(requireTrustedOrigin).mockReturnValue(undefined);
    vi.mocked(previewInvestmentHistory).mockReturnValue({
      account: { id: "account-1", name: "Brokerage", currency: "USD" },
      current: {
        cashMinor: 0,
        positionsMinor: 0,
        totalMinor: 0,
        complete: true,
      },
      projected: {
        cashMinor: 100,
        positionsMinor: 200,
        totalMinor: 300,
        complete: true,
        missingPrices: [],
        missingCurrencies: [],
      },
      summary: { records: 2, ready: 2, skippedDuplicates: 0, failed: 0 },
      canCommit: true,
      errors: [],
    });
    vi.mocked(commitInvestmentHistory).mockReturnValue({
      account: { id: "account-1", name: "Brokerage", currency: "USD" },
      finalBalanceMinor: 300,
      summary: { imported: 2, skippedDuplicates: 0 },
    });
  });

  test("requires session and trusted origin", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await previewPost(request("preview"), params)).status).toBe(401);
    expect(requireTrustedOrigin).not.toHaveBeenCalled();

    vi.mocked(requireTrustedOrigin).mockImplementationOnce(() => {
      throw new Error("untrusted");
    });
    expect((await previewPost(request("preview"), params)).status).toBe(403);
    expect(previewInvestmentHistory).not.toHaveBeenCalled();
  });

  test("uses session ownership and returns a no-store hash", async () => {
    const response = await previewPost(request("preview"), params);
    const payload = (await response.json()) as { hash: string };
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.hash).toBe(
      createHash("sha256").update(content, "utf8").digest("hex"),
    );
    expect(previewInvestmentHistory).toHaveBeenCalledWith(
      "session-user",
      "account-1",
      content,
      "json",
    );
  });

  test("rejects a changed file and commits only verified content", async () => {
    expect(
      (await commitPost(request("commit", "0".repeat(64)), params)).status,
    ).toBe(409);
    expect(commitInvestmentHistory).not.toHaveBeenCalled();

    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    const response = await commitPost(request("commit", hash), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(commitInvestmentHistory).toHaveBeenCalledWith(
      "session-user",
      "account-1",
      content,
      "json",
    );
  });

  test("maps expected failures and hides database details", async () => {
    vi.mocked(previewInvestmentHistory).mockImplementationOnce(() => {
      throw new InvestmentHistoryAccessError("Position account not found.");
    });
    expect((await previewPost(request("preview"), params)).status).toBe(404);

    vi.mocked(previewInvestmentHistory).mockImplementationOnce(() => {
      throw new InvestmentHistoryFileError("Invalid sequence.");
    });
    const invalid = await previewPost(request("preview"), params);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid sequence." });

    vi.mocked(commitInvestmentHistory).mockImplementationOnce(() => {
      throw new Error("SQL secret row");
    });
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    const failed = await commitPost(request("commit", hash), params);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "No investment history was imported. Try again.",
    });
  });
});
