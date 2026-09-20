import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CategoryManager } from "./metadata-forms";

const category = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Property",
  slug: "property",
  icon: "Building",
  assetOrLiability: "asset" as const,
  description: "Homes",
  isLiquid: false,
  isInvestible: true,
  isSystem: false,
  isArchived: false,
  displayOrder: 1,
};

describe("CategoryManager", () => {
  it("supports create, update, and confirmed archive", async () => {
    const user = userEvent.setup();
    const operations = {
      create: vi.fn().mockResolvedValue(category),
      update: vi.fn().mockResolvedValue({ status: "updated" }),
      archive: vi.fn().mockResolvedValue({ status: "updated" }),
      reorder: vi.fn(),
    };
    const onChanged = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <CategoryManager
        categories={[category]}
        csrfToken="csrf"
        onChanged={onChanged}
        operations={operations}
      />,
    );

    await user.type(
      screen.getByLabelText("Name", { selector: "#category-name-new" }),
      "Collectibles",
    );
    await user.click(screen.getByRole("button", { name: "Add category" }));
    expect(operations.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Collectibles" }),
      "csrf",
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editName = screen.getByLabelText("Name", {
      selector: `#category-name-${category.id}`,
    });
    await user.clear(editName);
    await user.type(editName, "Real property");
    await user.click(screen.getByRole("button", { name: "Save category" }));
    expect(operations.update).toHaveBeenCalledWith(
      category.id,
      expect.objectContaining({ name: "Real property" }),
      "csrf",
    );

    await user.click(screen.getByRole("button", { name: "Archive Property" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(operations.archive).toHaveBeenCalledWith(category.id, true, "csrf");
    expect(onChanged).toHaveBeenCalledTimes(3);
  });
});
