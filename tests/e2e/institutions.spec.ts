import { expect, test } from "@playwright/test";

test("institutions can be created, linked, filtered, and renamed", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Username").fill("institution-e2e");
  await page.getByLabel("Display name").fill("Institution E2E");
  await page
    .getByLabel("Password", { exact: true })
    .fill("institution-e2e-password");
  await page.getByLabel("Confirm password").fill("institution-e2e-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Provider-linked fund");
  await page
    .getByLabel("Category")
    .selectOption({ label: "Money Market Fund" });
  await page.getByLabel("Institution", { exact: true }).click();
  const chooseDialog = page.getByRole("dialog", {
    name: "Choose institution",
  });
  const dialogZIndex = await chooseDialog.evaluate((element) =>
    Number.parseInt(getComputedStyle(element).zIndex, 10),
  );
  const overlayZIndex = await page
    .locator('[data-state="open"].fixed.inset-0')
    .evaluate((element) =>
      Number.parseInt(getComputedStyle(element).zIndex, 10),
    );
  expect(dialogZIndex).toBeGreaterThan(overlayZIndex);
  await chooseDialog.getByRole("button", { name: "Add institution" }).click();

  const addDialog = page.getByRole("dialog", { name: "Add institution" });
  await addDialog.getByLabel("Name").fill("KCB");
  await addDialog.getByLabel("Type").selectOption("bank");
  await addDialog.getByLabel("Country code").fill("KE");
  await addDialog.getByLabel("Website").fill("ftp://invalid.example.com");
  await addDialog.getByRole("button", { name: "Add institution" }).click();
  await expect(
    addDialog.getByText("Enter a valid HTTP or HTTPS website."),
  ).toBeVisible();
  await addDialog.getByLabel("Website").fill("https://ke.kcbgroup.com");
  await addDialog.getByRole("button", { name: "Add institution" }).click();
  await expect(addDialog).toBeHidden();
  await expect(page.getByLabel("Institution", { exact: true })).toHaveText(
    "KCB",
  );

  await page.getByLabel("Opening value").fill("100000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Provider-linked fund" }),
  ).toBeVisible();
  await expect(page.getByText("KCB · Money Market Fund")).toBeVisible();

  await page.getByRole("link", { name: "Interest" }).click();
  await page.getByLabel(/Amount/).fill("100");
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(
    page.getByRole("heading", { name: "Provider-linked fund" }),
  ).toBeVisible();
  await page.goto("/transactions");
  await page.getByLabel("Edit transaction").click();
  await expect(
    page.getByRole("heading", { name: "Edit transaction" }),
  ).toBeVisible();

  await page.goto("/institutions");
  await expect(page.getByRole("heading", { name: "KCB" })).toBeVisible();
  await expect(page.getByText("1 account", { exact: true })).toBeVisible();
  const institutionCard = page
    .getByRole("heading", { name: "KCB" })
    .locator("xpath=ancestor::div[contains(@class, 'rounded')][1]");
  await institutionCard.getByLabel("Name").fill("KCB Group");
  await institutionCard
    .getByRole("button", { name: "Save institution" })
    .click();
  await expect(institutionCard.getByRole("status")).toHaveText(
    "Institution updated.",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await institutionCard
    .getByRole("button", { name: "Archive institution" })
    .click();
  await expect(page.getByText("Institution archived.")).toBeVisible();

  await page.goto("/accounts");
  await page
    .getByLabel("Filter by institution")
    .selectOption({ label: "KCB Group (archived)" });
  await expect(
    page.getByText("Provider-linked fund", { exact: true }),
  ).toBeVisible();
  await page.getByText("Provider-linked fund", { exact: true }).first().click();
  await expect(
    page.getByText("KCB Group (archived) · Money Market Fund"),
  ).toBeVisible();

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    for (const route of ["/accounts", "/institutions", "/accounts/new"]) {
      await page.goto(route);
      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `${route} overflows at ${width}px`,
      ).toBeLessThanOrEqual(dimensions.clientWidth);
      if (route === "/accounts") {
        for (const label of ["Sort accounts", "Table view"]) {
          const control = page.getByLabel(label);
          await expect(
            control,
            `${label} is missing at ${width}px`,
          ).toBeVisible();
          const box = await control.boundingBox();
          expect(box, `${label} is missing at ${width}px`).not.toBeNull();
          expect(
            box!.x,
            `${label} starts outside ${width}px`,
          ).toBeGreaterThanOrEqual(0);
          expect(
            box!.x + box!.width,
            `${label} ends outside ${width}px`,
          ).toBeLessThanOrEqual(width);
        }
      }
    }
  }

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/accounts/new");
  const institutionTrigger = page.getByLabel("Institution", { exact: true });
  const institutionDialog = page.getByRole("dialog", {
    name: "Choose institution",
  });
  await institutionTrigger.click();
  await expect(institutionDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(institutionDialog).toBeHidden();

  await institutionTrigger.focus();
  await expect(institutionTrigger).toBeFocused();
  await institutionTrigger.press("Enter");
  await expect(institutionDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(institutionDialog).toBeHidden();
});
