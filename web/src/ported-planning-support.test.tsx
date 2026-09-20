import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CategoryManager,
  GoalForm,
  InstitutionManager,
  InstrumentForm,
} from "./ported-planning-support";
import type { Account, Category, Institution, Session } from "./types";

vi.mock("./api", () => ({
  archiveCategory: vi.fn(),
  archiveInstitution: vi.fn(),
  createCategory: vi.fn(),
  createGoal: vi.fn(),
  createInstitution: vi.fn(),
  createInstrument: vi.fn(),
  reorderCategory: vi.fn(),
  updateCategory: vi.fn(),
  updateGoal: vi.fn(),
  updateInstitution: vi.fn(),
  updateInstrument: vi.fn(),
}));

const session = { csrfToken: "csrf" } as Session;

function expectNoLegacyClasses(container: HTMLElement) {
  for (const className of [
    "primary-button",
    "secondary-button",
    "icon-button",
    "progress-track",
    "auth-form",
    "form-grid",
    "settings-stack",
  ]) {
    expect(container.querySelector(`.${className}`)).toBeNull();
  }
}

afterEach(cleanup);

describe("ported planning support", () => {
  it("uses source controls for goal and instrument forms", () => {
    const account = {
      id: "account-1",
      name: "Savings",
      currency: "KES",
      isLiability: false,
      archivedAt: null,
    } as unknown as Account;
    const view = render(
      <>
        <GoalForm accounts={[account]} session={session} onChanged={vi.fn()} />
        <InstrumentForm session={session} onChanged={vi.fn()} />
      </>,
    );

    expect(screen.getByLabelText("Goal name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create goal" })).toBeTruthy();
    expect(screen.getByLabelText("Identifier type")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create instrument" }),
    ).toBeTruthy();
    expectNoLegacyClasses(view.container);
  });

  it("uses source cards and controls for metadata managers", () => {
    const category = {
      id: "category-1",
      name: "Investments",
      icon: "CircleDollarSign",
      assetOrLiability: "asset",
      description: "",
      isLiquid: false,
      isInvestible: true,
      isArchived: false,
      isSystem: false,
    } as Category;
    const institution = {
      id: "institution-1",
      name: "Example Bank",
      type: "bank",
    } as Institution;
    const view = render(
      <>
        <CategoryManager
          categories={[category]}
          csrfToken="csrf"
          onChanged={vi.fn()}
        />
        <InstitutionManager
          institutions={[institution]}
          csrfToken="csrf"
          onChanged={vi.fn()}
        />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: "Create custom category" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Add institution" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Move category up")).toBeTruthy();
    expect(screen.getByLabelText("Archive institution")).toBeTruthy();
    expectNoLegacyClasses(view.container);
  });
});
