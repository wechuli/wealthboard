import { expect, test } from "@playwright/test";
import { dateInputForTimezone, formatDate } from "@/lib/dates";

test("manages rate history and distinguishes current, stale, and historical warnings", async ({
  page,
}, testInfo) => {
  const today = dateInputForTimezone("Africa/Nairobi");
  const todayLabel = formatDate(`${today}T12:00:00.000Z`, "UTC", "dd MMM yyyy");
  await page.goto("/signup");
  await page.getByLabel("Username").fill("exchange-rate-e2e");
  await page.getByLabel("Display name").fill("Exchange Rate Example");
  await page.getByLabel("Base currency").selectOption("KES");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-exchange-rate-password");
  await page
    .getByLabel("Confirm password")
    .fill("fictional-exchange-rate-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Archived position example");
  await page.getByLabel("Category").selectOption({ label: "Securities" });
  await page.getByLabel("Tracking method").selectOption("positions");
  await page.getByLabel("Opening cash").fill("50");
  await page.getByLabel("Opened or acquired").fill("2025-01-01");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Archived position example" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archive account" }).click();
  await expect(page.getByRole("heading", { name: "Accounts & assets" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Dollar savings example");
  await page.getByLabel("Category").selectOption({ label: "Savings" });
  await page.getByLabel("Currency", { exact: true }).selectOption("USD");
  await page.getByLabel("Opening value").fill("100");
  await page.getByLabel("Opened or acquired").fill("2025-01-01");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Dollar savings example" }),
  ).toBeVisible();

  await page.goto("/");
  await expect(
    page.getByText("Current total is incomplete.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Add USD/KES rate", exact: true })
    .click();
  const manager = page.getByRole("region", {
    name: "Exchange rates",
    exact: true,
  });
  await expect(manager.getByLabel("Base currency")).toHaveValue("USD");
  await expect(manager.getByLabel("Quote currency")).toHaveValue("KES");
  await expect(manager.getByLabel("Effective date")).toHaveValue(today);
  await manager.getByLabel("Rate (quote per base)").fill("130");
  await manager.getByRole("button", { name: "Save rate" }).click();
  await expect(manager.getByText("Exchange rate saved.")).toBeVisible();
  await expect(manager.getByText("Up to date", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(
    page.getByText("Current total is incomplete.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Your current total is complete/)).toBeVisible();
  await expect(
    page.getByText("Some historical totals are incomplete.", { exact: true }),
  ).toBeVisible();
  const monthlyChange = page.getByRole("group", {
    name: "1 month net worth change",
  });
  await expect(monthlyChange).toHaveText("1 monthIncomplete data");
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(monthlyChange).toBeVisible();
    await expect(async () => {
      const bounds = await monthlyChange.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }).toPass();
  }
  await page.goto("/accounts");
  const accountCard = page.getByRole("link", { name: /Dollar savings example/ });
  await expect(accountCard).not.toContainText("Exchange rate needed");
  await expect(accountCard).toContainText(/Ksh\s*13,000\.00/);
  await expect(accountCard).toContainText("30-day changeIncomplete data");
  await page.goto("/");
  await page.getByRole("link", { name: "Add earlier USD/KES rate" }).click();
  await expect(manager.getByLabel("Effective date")).toHaveValue("2025-01-01");
  await expect(manager.getByLabel("Rate (quote per base)")).toHaveValue("");
  await manager.getByLabel("Rate (quote per base)").fill("125");
  await manager.getByRole("button", { name: "Save rate" }).click();
  await expect(manager.getByText("Exchange rate saved.")).toBeVisible();
  await expect(manager.locator("[data-rate-pair]")).toHaveCount(1);
  await manager.locator("summary").click();
  await manager
    .getByRole("button", { name: "Edit USD/KES rate from 01 Jan 2025" })
    .click();
  await manager.getByLabel("Rate (quote per base)").fill("126");
  await manager.getByRole("button", { name: "Save rate" }).click();
  await expect(
    manager.getByText("USD/KES: 126", { exact: true }),
  ).toBeVisible();
  await manager
    .getByRole("button", { name: "Update USD/KES", exact: true })
    .click();
  await expect(manager.getByLabel("Effective date")).toHaveValue(today);
  await manager.getByLabel("Rate (quote per base)").fill("129.40");
  await manager.getByRole("button", { name: "Save rate" }).click();
  await expect(
    manager.getByText("USD/KES: 129.40", { exact: true }),
  ).toBeVisible();
  await expect(manager.locator("li")).toHaveCount(2);

  await page.goto("/");
  await expect(
    page.getByText("Some historical totals are incomplete.", { exact: true }),
  ).toHaveCount(0);
  await expect(monthlyChange).not.toContainText("Incomplete data");
  await expect(monthlyChange).toContainText(/Ksh\s*340/);
  await page.goto("/reports");
  await expect(
    page.getByText("Some historical totals are incomplete.", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/settings#exchange-rates");
  await manager.locator("summary").click();
  await manager
    .getByRole("button", { name: "Update USD/KES", exact: true })
    .click();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await manager.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      `overflow at ${width}px`,
    ).toBe(true);
    const fields = manager.locator("input:not([type=hidden]), select, button");
    for (const field of await fields.all()) {
      if (!(await field.isVisible())) continue;
      const bounds = await field.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }
    await manager.screenshot({
      path: testInfo.outputPath(`exchange-rates-${width}.png`),
    });
  }
  await manager.getByRole("button", { name: "Cancel", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await manager
    .getByRole("button", { name: `Delete USD/KES rate from ${todayLabel}` })
    .click();
  await expect(manager.locator("li")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await manager
    .getByRole("button", { name: `Delete USD/KES rate from ${todayLabel}` })
    .click();
  await expect(manager.locator("li")).toHaveCount(1);
  await expect(
    manager.getByText("Over a month old", { exact: true }),
  ).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByText("USD/KES rate is over a month old.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Current total is incomplete.", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Update USD/KES", exact: true }).click();
  await manager.getByRole("button", { name: "Cancel", exact: true }).click();
  await manager.locator("summary").click();
  page.once("dialog", (dialog) => dialog.accept());
  await manager
    .getByRole("button", { name: "Delete USD/KES rate from 01 Jan 2025" })
    .click();
  await expect(manager.getByText("No exchange rates saved.")).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByText("Current total is incomplete.", { exact: true }),
  ).toBeVisible();
});
