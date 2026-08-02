import { describe, expect, it } from "vitest";

import {
  MissingExchangeRateError,
  convertMinor,
  minorToDecimalString,
  parseMoney,
  percentage,
} from "@/lib/money";

describe("decimal-safe money", () => {
  it("parses values into integer minor units without floating point arithmetic", () => {
    expect(parseMoney("4,576,918.25", "KES")).toBe(457_691_825);
    expect(parseMoney("4111.99", "USD")).toBe(411_199);
    expect(minorToDecimalString(411_199, "USD")).toBe("4111.99");
  });

  it("rejects excess precision and invalid values", () => {
    expect(() => parseMoney("1.001", "KES")).toThrow(/at most 2/);
    expect(() => parseMoney("not money", "KES")).toThrow(/valid monetary/);
  });

  it("converts direct and inverse rates with deterministic rounding", () => {
    const rates = [
      {
        baseCurrency: "USD",
        quoteCurrency: "KES",
        rate: "130.125",
        effectiveDate: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(convertMinor(10_000, "USD", "KES", rates)).toBe(1_301_250n);
    expect(convertMinor(1_301_250, "KES", "USD", rates)).toBe(10_000n);
  });

  it("uses the latest rate effective on the requested date", () => {
    const rates = [
      { baseCurrency: "USD", quoteCurrency: "KES", rate: "100", effectiveDate: "2025-01-01" },
      { baseCurrency: "USD", quoteCurrency: "KES", rate: "130", effectiveDate: "2026-01-01" },
    ];
    expect(convertMinor(100, "USD", "KES", rates, "2025-06-01")).toBe(10_000n);
    expect(convertMinor(100, "USD", "KES", rates, "2026-06-01")).toBe(13_000n);
  });

  it("chooses the newest rate even when its orientation is inverse", () => {
    const rates = [
      { baseCurrency: "USD", quoteCurrency: "KES", rate: "100", effectiveDate: "2025-01-01" },
      { baseCurrency: "KES", quoteCurrency: "USD", rate: "0.005", effectiveDate: "2026-01-01" },
    ];
    expect(convertMinor(100, "USD", "KES", rates, "2026-06-01")).toBe(20_000n);
  });

  it("requires a configured rate", () => {
    expect(() => convertMinor(100, "EUR", "KES", [])).toThrow(MissingExchangeRateError);
  });

  it("calculates allocation percentages with decimal precision", () => {
    expect(percentage(1n, 3n)).toBe("33.3");
    expect(percentage(100n, 0n)).toBe("0");
  });
});
