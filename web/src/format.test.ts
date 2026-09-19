import { describe, expect, it } from "vitest";

import { formatMinorUnits } from "./format";

describe("formatMinorUnits", () => {
  it("formats values without converting through JavaScript numbers", () => {
    expect(formatMinorUnits("9007199254740993", "KES")).toBe(
      "KES 90,071,992,547,409.93",
    );
    expect(formatMinorUnits("-25", "USD")).toBe("-USD 0.25");
  });
});
