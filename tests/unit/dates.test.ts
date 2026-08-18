import { describe, expect, it } from "vitest";

import {
  addUtcMonths,
  dateInputForTimezone,
  dateInputToUtc,
  formatDate,
  isValidTimezone,
  monthsBetween,
} from "@/lib/dates";

describe("date handling", () => {
  it("rejects impossible calendar dates", () => {
    expect(() => dateInputToUtc("2026-02-30")).toThrow(/calendar date/);
  });

  it("clamps month-end arithmetic instead of skipping a month", () => {
    expect(
      addUtcMonths(new Date("2026-01-31T12:00:00Z"), 1).toISOString(),
    ).toBe("2026-02-28T12:00:00.000Z");
  });

  it("counts only monthly anniversaries on or before the end date", () => {
    expect(
      monthsBetween(
        new Date("2026-08-18T12:00:00Z"),
        new Date("2028-07-01T12:00:00Z"),
      ),
    ).toBe(22);
    expect(
      monthsBetween(
        new Date("2026-01-31T12:00:00Z"),
        new Date("2026-02-28T12:00:00Z"),
      ),
    ).toBe(1);
  });

  it("formats defaults in the configured timezone", () => {
    expect(
      dateInputForTimezone(
        "Africa/Nairobi",
        new Date("2026-01-01T22:30:00.000Z"),
      ),
    ).toBe("2026-01-02");
  });

  it("validates IANA timezone identifiers", () => {
    expect(isValidTimezone("Africa/Nairobi")).toBe(true);
    expect(isValidTimezone("Not/A_Real_Zone")).toBe(false);
  });

  it("displays canonical financial calendar dates without timezone drift", () => {
    expect(
      formatDate("2026-01-01T12:00:00.000Z", "Pacific/Auckland", "dd MMM yyyy"),
    ).toBe("01 Jan 2026");
  });
});
