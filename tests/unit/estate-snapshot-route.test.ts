// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/services/estate-planning", () => ({
  EstatePlanningError: class EstatePlanningError extends Error {},
  getEstatePlanSnapshot: vi.fn(),
}));

import { GET } from "@/app/api/estate/snapshots/[id]/route";
import { getSession } from "@/lib/auth/session";
import {
  EstatePlanningError,
  getEstatePlanSnapshot,
} from "@/lib/services/estate-planning";

const params = {
  params: Promise.resolve({ id: "snapshot-1" }),
};

describe("estate snapshot download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      userId: "session-owner",
      username: "estate-owner",
      version: 1,
    });
    vi.mocked(getEstatePlanSnapshot).mockReturnValue({
      id: "snapshot-1",
      userId: "session-owner",
      estatePlanId: "plan-1",
      version: 1,
      title: "Family estate plan",
      valueAsOfDate: "2026-08-11",
      baseCurrency: "KES",
      contentHash: "a".repeat(64),
      generatedAt: "2026-08-11T10:00:00.000Z",
      content: {
        format: "wealthboard-estate-summary",
        version: 1,
      },
    } as never);
  });

  test("requires authentication without caching the response", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    const response = await GET(new Request("https://example.test"), params);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getEstatePlanSnapshot).not.toHaveBeenCalled();
  });

  test("uses only the session owner and downloads a no-store JSON document", async () => {
    const response = await GET(new Request("https://example.test"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toContain(
      "wealthboard-estate-summary-2026-08-11.json",
    );
    expect(getEstatePlanSnapshot).toHaveBeenCalledWith(
      "session-owner",
      "snapshot-1",
    );
    expect(await response.json()).toMatchObject({
      id: "snapshot-1",
      contentHash: "a".repeat(64),
      content: { format: "wealthboard-estate-summary", version: 1 },
    });
  });

  test("returns not found for an unavailable or foreign snapshot", async () => {
    vi.mocked(getEstatePlanSnapshot).mockReturnValueOnce(undefined);
    const response = await GET(new Request("https://example.test"), params);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Estate summary not found.",
    });
  });

  test("does not expose snapshot integrity or database details", async () => {
    vi.mocked(getEstatePlanSnapshot).mockImplementationOnce(() => {
      throw new EstatePlanningError("Internal hash or SQL details");
    });
    const response = await GET(new Request("https://example.test"), params);
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "The estate summary could not be downloaded.",
    });
  });
});
