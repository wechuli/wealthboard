import { describe, expect, it } from "vitest";

import {
  decimalToMinorUnits,
  formatMinorUnits,
  minorUnitsToDecimal,
} from "@/lib/format";

describe("formatMinorUnits", () => {
  it("formats values without converting through JavaScript numbers", () => {
    expect(formatMinorUnits("9007199254740993", "KES")).toBe(
      "KES 90,071,992,547,409.93",
    );
    expect(formatMinorUnits("-25", "USD")).toBe("-USD 0.25");
  });
});

describe("decimalToMinorUnits", () => {
  it("converts a major-unit input without floating-point arithmetic", () => {
    expect(decimalToMinorUnits("130000.00")).toBe("13000000");
    expect(decimalToMinorUnits("12.3")).toBe("1230");
    expect(decimalToMinorUnits("12.345")).toBeNull();
  });
});

describe("minorUnitsToDecimal", () => {
  it("converts exact minor-unit strings without floating point", () => {
    expect(minorUnitsToDecimal("9007199254740993")).toBe("90071992547409.93");
    expect(minorUnitsToDecimal("-5")).toBe("-0.05");
  });
});
