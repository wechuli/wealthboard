import { spawnSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const projectRoot = process.cwd();
const screenshotDirectory = path.join(
  projectRoot,
  "docs/public/images/screenshots",
);

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({
    content: `
      nextjs-portal { display: none !important; }
      [data-sonner-toaster] { display: none !important; }
      * { caret-color: transparent !important; }
    `,
  });
}

async function capturePage(page: Page, name: string) {
  await settle(page);
  await page.screenshot({
    path: path.join(screenshotDirectory, name),
    animations: "disabled",
  });
}

async function captureLocator(locator: Locator, name: string) {
  await expect(locator).toBeVisible();
  await locator.screenshot({
    path: path.join(screenshotDirectory, name),
    animations: "disabled",
  });
}

function cardForHeading(page: Page, name: string) {
  return page
    .getByRole("heading", { name, exact: true })
    .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
}

async function addBeneficiary(
  page: Page,
  input: {
    name: string;
    kind: "person" | "organization" | "trust";
    relationship?: string;
    contact?: string;
  },
) {
  const card = cardForHeading(page, "Add beneficiary");
  await card.getByLabel("Name").fill(input.name);
  await card.getByLabel("Type").selectOption(input.kind);
  if (input.relationship) {
    await card.getByLabel("Relationship").fill(input.relationship);
  }
  if (input.contact) {
    await card.getByLabel("Contact summary").fill(input.contact);
  }
  await card.getByRole("button", { name: "Add beneficiary" }).click();
  await expect(
    page.getByRole("heading", { name: input.name, exact: true }),
  ).toBeVisible();
}

test("capture the Wealthboard product guide", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/signup");
  await page.getByLabel("Username").fill("guide-user");
  await page.getByLabel("Display name").fill("Jordan Mwangi");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-guide-password-123");
  await page
    .getByLabel("Confirm password")
    .fill("fictional-guide-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  const seed = spawnSync("npm", ["run", "db:seed:demo"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_PATH: "./data/docs-capture.db",
      DEMO_DATA: "true",
      TARGET_USERNAME: "guide-user",
    },
  });
  expect(seed.status, seed.stderr || seed.stdout).toBe(0);

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Home renovation loan");
  await page.getByLabel("Category").selectOption({ label: "Liability" });
  await page.getByLabel("Opening value").fill("650000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Home renovation loan" }),
  ).toBeVisible();

  await page.goto("/");
  await capturePage(page, "dashboard-overview.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await capturePage(page, "dashboard-mobile.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/accounts");
  await capturePage(page, "accounts-workspace.png");

  await page.getByText("Southern Bypass Land", { exact: true }).first().click();
  await capturePage(page, "account-detail.png");

  await page.goto("/transactions");
  await capturePage(page, "transaction-workbench.png");

  await page.goto("/goals");
  await page.getByText("2028 Family Car", { exact: true }).click();
  await capturePage(page, "goal-planning.png");

  await page.goto("/reports");
  await capturePage(page, "reports-overview.png");

  await page.goto("/estate/beneficiaries");
  await addBeneficiary(page, {
    name: "Amina Mwangi",
    kind: "person",
    relationship: "Child",
    contact: "amina@example.test",
  });
  await addBeneficiary(page, {
    name: "Nia Mwangi",
    kind: "person",
    relationship: "Child",
  });
  await addBeneficiary(page, {
    name: "Mwangi Education Trust",
    kind: "trust",
  });
  await page.goto("/estate/beneficiaries");
  await capturePage(page, "estate-beneficiaries.png");

  const archive = (await (
    await page.request.get("/api/export/json")
  ).json()) as {
    accounts: Array<{ id: string; name: string; isLiability: boolean }>;
  };
  const land = archive.accounts.find(
    (account) => account.name === "Southern Bypass Land",
  );
  expect(land).toBeTruthy();

  await page.goto(`/estate/distribution?account=${land!.id}#asset-${land!.id}`);
  for (const account of archive.accounts.filter(
    (account) => !account.isLiability && account.id !== land!.id,
  )) {
    const card = page.locator(`#asset-${account.id}`);
    await card
      .getByLabel("Include this asset in the estate distribution plan")
      .uncheck();
    await card.getByRole("button", { name: "Save asset directive" }).click();
    await expect(card.getByRole("status")).toHaveText("Asset directive saved.");
  }

  let landCard = page.locator(`#asset-${land!.id}`);
  await landCard.getByLabel("Estate ownership share").fill("100");
  await landCard.getByLabel("Last checked").fill("2026-08-12");
  await landCard.getByLabel("How it passes").selectOption("estate");
  await landCard
    .getByLabel("Distribution method")
    .selectOption("sell_and_divide");
  await landCard
    .getByLabel("Document or location reference")
    .fill("Title deed in the family document safe");
  await landCard
    .getByLabel("Planning notes")
    .fill("Confirm title details with the estate adviser.");
  await landCard.getByRole("button", { name: "Save asset directive" }).click();
  await expect(landCard.getByRole("status")).toHaveText(
    "Asset directive saved.",
  );

  landCard = page.locator(`#asset-${land!.id}`);
  await landCard
    .getByLabel("Beneficiary")
    .selectOption({ label: "Amina Mwangi" });
  await landCard.getByLabel("Priority").selectOption("primary");
  await landCard.getByLabel("Percentage").fill("60");
  await landCard
    .getByRole("button", { name: "Add allocation to Southern Bypass Land" })
    .click();
  await expect(
    landCard.locator("p").filter({ hasText: /^Amina Mwangi$/ }),
  ).toBeVisible();

  landCard = page.locator(`#asset-${land!.id}`);
  await landCard
    .getByLabel("Beneficiary")
    .selectOption({ label: "Mwangi Education Trust" });
  await landCard.getByLabel("Priority").selectOption("primary");
  await landCard.getByLabel("Percentage").fill("40");
  await landCard
    .getByRole("button", { name: "Add allocation to Southern Bypass Land" })
    .click();
  await expect(
    landCard.locator("p").filter({ hasText: /^Mwangi Education Trust$/ }),
  ).toBeVisible();

  landCard = page.locator(`#asset-${land!.id}`);
  await landCard
    .getByLabel("Beneficiary")
    .selectOption({ label: "Nia Mwangi" });
  await landCard.getByLabel("Priority").selectOption("contingent");
  await landCard.getByLabel("Percentage").fill("100");
  await landCard
    .getByRole("button", { name: "Add allocation to Southern Bypass Land" })
    .click();
  await expect(
    landCard.locator("p").filter({ hasText: /^Nia Mwangi$/ }),
  ).toBeVisible();

  await page.goto(`/estate/distribution?account=${land!.id}#asset-${land!.id}`);
  landCard = page.locator(`#asset-${land!.id}`);
  await captureLocator(landCard, "estate-asset-allocation.png");

  await page.getByRole("link", { name: "Summary" }).click();
  await page.getByLabel("Plan title").fill("Mwangi family continuity plan");
  await page.getByLabel("Jurisdiction or residence").fill("Nairobi, Kenya");
  await page.getByLabel("Last reviewed").fill("2026-08-12");
  await page.getByLabel("Review again on").fill("2027-08-12");
  await page.getByRole("button", { name: "Save plan details" }).click();
  await expect(page.getByText("Allocation math complete")).toBeVisible();
  await capturePage(page, "estate-summary.png");

  await page.getByRole("button", { name: "Create summary" }).click();
  await expect(page).toHaveURL(/\/estate\/snapshots\/[a-f0-9-]+$/);
  await capturePage(page, "estate-print-preview.png");
});
