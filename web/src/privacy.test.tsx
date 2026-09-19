import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoneyValue, PrivacyBoundary } from "./privacy";

describe("MoneyValue", () => {
  it("masks the complete amount and currency when privacy mode is enabled", () => {
    render(
      <PrivacyBoundary hidden>
        <MoneyValue amount="123456" currency="KES" />
      </PrivacyBoundary>,
    );

    expect(screen.getByText("••••••")).toBeInTheDocument();
    expect(screen.queryByText(/KES|1,234\.56/)).not.toBeInTheDocument();
  });

  it("formats the amount when privacy mode is disabled", () => {
    render(
      <PrivacyBoundary hidden={false}>
        <MoneyValue amount="123456" currency="KES" />
      </PrivacyBoundary>,
    );

    expect(screen.getByText("KES 1,234.56")).toBeInTheDocument();
  });
});