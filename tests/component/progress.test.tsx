import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("exposes an accessible label and clamps values", () => {
    render(<Progress value={125} label="Car goal progress" />);
    const progress = screen.getByRole("progressbar", { name: "Car goal progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "100");
  });
});
