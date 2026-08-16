import { expect, test } from "@playwright/test";

test("applies and persists appearance without a wrong-theme first render", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("wealthboard-theme", "light");
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-preference",
    "light",
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("appearance works beside privacy controls at mobile width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/signup");
  await page.getByLabel("Username").fill("theme-user");
  await page.getByLabel("Display name").fill("Theme User");
  await page
    .getByLabel("Password", { exact: true })
    .fill("wealthboard-theme-password");
  await page
    .getByLabel("Confirm password")
    .fill("wealthboard-theme-password");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByRole("button", { name: /appearance, resolved/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide financial values" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /appearance, resolved/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("wealthboard-theme")))
    .toBe("light");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
