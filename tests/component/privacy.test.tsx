import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  MoneyValue,
  PrivacyProvider,
  PrivacyToggle,
} from "@/components/privacy-provider";

describe("financial privacy", () => {
  it("hides and reveals formatted values", async () => {
    const user = userEvent.setup();
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <MoneyValue amount={100_000} currency="KES" />
      </PrivacyProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Hide financial values" }));
    expect(screen.getByText("••••••")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reveal financial values" }));
    expect(screen.queryByText("••••••")).not.toBeInTheDocument();
  });
});
