import { expect, test } from "@playwright/test";

function cardForHeading(page: import("@playwright/test").Page, name: string) {
  return page
    .getByRole("heading", { name, exact: true })
    .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
}

async function addBeneficiary(
  page: import("@playwright/test").Page,
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
  await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible();
}

test("estate planning allocates assets, prints a private summary, and stays isolated", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Username").fill("estate-e2e-owner");
  await page.getByLabel("Display name").fill("Estate E2E Owner");
  await page
    .getByLabel("Password", { exact: true })
    .fill("estate-e2e-owner-password");
  await page
    .getByLabel("Confirm password")
    .fill("estate-e2e-owner-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Family land");
  await page
    .getByLabel("Category")
    .selectOption({ label: "Land and Real Estate" });
  await page.getByLabel("Account reference").fill("TITLE-E2E-001");
  await page.getByLabel("Opening value").fill("1000000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Family land" })).toBeVisible();

  await page.getByRole("link", { name: "Estate plan" }).click();
  await expect(page.getByRole("heading", { name: "Estate distribution" })).toBeVisible();
  await expect(cardForHeading(page, "Family land")).toHaveClass(/ring-2/);
  await page.getByRole("link", { name: "Beneficiaries" }).click();

  await addBeneficiary(page, {
    name: "Amina Example",
    kind: "person",
    relationship: "Child",
    contact: "amina@example.test",
  });
  await addBeneficiary(page, {
    name: "Future Education Trust",
    kind: "trust",
  });

  await page.getByRole("link", { name: "Distribution" }).click();
  let assetCard = cardForHeading(page, "Family land");
  await assetCard.getByLabel("Estate ownership share").fill("100");
  await assetCard.getByLabel("Last checked").fill("2026-08-11");
  await assetCard.getByLabel("How it passes").selectOption("estate");
  await assetCard
    .getByLabel("Distribution method")
    .selectOption("sell_and_divide");
  await assetCard
    .getByLabel("Document or location reference")
    .fill("Title deed in the home safe");
  await assetCard
    .getByLabel("Planning notes")
    .fill("Obtain a current independent valuation.");
  await assetCard.getByRole("button", { name: "Save asset directive" }).click();
  await expect(assetCard.getByRole("status")).toHaveText(
    "Asset directive saved.",
  );

  assetCard = cardForHeading(page, "Family land");
  await assetCard.getByLabel("Beneficiary").selectOption({ label: "Amina Example" });
  await assetCard.getByLabel("Priority").selectOption("primary");
  await assetCard.getByLabel("Percentage").fill("60");
  await assetCard
    .getByRole("button", { name: "Add allocation to Family land" })
    .click();
  await expect(assetCard.getByText("60%", { exact: true })).toBeVisible();

  assetCard = cardForHeading(page, "Family land");
  await assetCard
    .getByLabel("Beneficiary")
    .selectOption({ label: "Future Education Trust" });
  await assetCard.getByLabel("Priority").selectOption("primary");
  await assetCard.getByLabel("Percentage").fill("40");
  await assetCard
    .getByRole("button", { name: "Add allocation to Family land" })
    .click();
  await expect(assetCard.getByText("Fully allocated")).toBeVisible();

  await page.getByRole("link", { name: "Summary" }).click();
  await page.getByLabel("Plan title").fill("Family continuity plan");
  await page.getByLabel("Jurisdiction or residence").fill("Example jurisdiction");
  await page.getByLabel("Last reviewed").fill("2026-08-11");
  await page.getByLabel("Review again on").fill("2027-08-11");
  await page.getByRole("button", { name: "Save plan details" }).click();
  await expect(page.getByText("Allocation math complete")).toBeVisible();
  await expect(page.getByText("Amina Example")).toBeVisible();

  await page.getByRole("button", { name: "Create summary" }).click();
  await expect(page).toHaveURL(/\/estate\/snapshots\/[a-f0-9-]+$/);
  const snapshotUrl = new URL(page.url()).pathname;
  const snapshotId = snapshotUrl.split("/").at(-1)!;
  await expect(page.getByText("Value excluded").first()).toBeVisible();
  await expect(page.getByText("amina@example.test")).toHaveCount(0);
  await expect(page.getByText(/TITLE-E2E-001/)).toHaveCount(0);
  await expect(page.getByText("Obtain a current independent valuation.")).toHaveCount(0);

  await page.getByLabel("Include exact values").check();
  await expect(page.getByText(/1,000,000\.00/).first()).toBeVisible();
  await page.getByLabel("Include contacts").check();
  await page.getByLabel("Include account references").check();
  await page.getByLabel("Include private notes").check();
  await expect(page.getByText("amina@example.test")).toBeVisible();
  await expect(page.getByText(/TITLE-E2E-001/)).toBeVisible();
  await expect(page.getByText("Obtain a current independent valuation.")).toBeVisible();

  const snapshotResponse = await page.request.get(
    `/api/estate/snapshots/${snapshotId}`,
  );
  expect(snapshotResponse.status()).toBe(200);
  expect(snapshotResponse.headers()["cache-control"]).toBe("no-store");
  const snapshotDownload = (await snapshotResponse.json()) as {
    contentHash: string;
    content: { plan: { title: string } };
  };
  expect(snapshotDownload.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshotDownload.content.plan.title).toBe("Family continuity plan");

  const exportResponse = await page.request.get("/api/export/json");
  expect(exportResponse.ok()).toBeTruthy();
  const archive = (await exportResponse.json()) as {
    version: number;
    beneficiaries: Array<{ name: string }>;
    estateAccountDirectives: unknown[];
    estateAllocations: unknown[];
    estatePlanSnapshots: Array<{ content: string }>;
  };
  expect(archive.version).toBe(6);
  expect(archive.beneficiaries.map((row) => row.name)).toEqual([
    "Amina Example",
    "Future Education Trust",
  ]);
  expect(archive.estateAccountDirectives).toHaveLength(1);
  expect(archive.estateAllocations).toHaveLength(2);
  expect(archive.estatePlanSnapshots).toHaveLength(1);
  expect(archive.estatePlanSnapshots[0].content).not.toContain('"userId"');

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 820 : 900 });
    for (const route of [
      "/estate/beneficiaries",
      "/estate/distribution",
      "/estate/summary",
      snapshotUrl,
    ]) {
      await page.goto(route);
      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `${route} overflows at ${width}px`,
      ).toBeLessThanOrEqual(dimensions.clientWidth);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto("/signup");
  await page.getByLabel("Username").fill("estate-e2e-other");
  await page.getByLabel("Display name").fill("Other Estate User");
  await page
    .getByLabel("Password", { exact: true })
    .fill("estate-e2e-other-password");
  await page
    .getByLabel("Confirm password")
    .fill("estate-e2e-other-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto(snapshotUrl);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  const deniedDownload = await page.request.get(
    `/api/estate/snapshots/${snapshotId}`,
  );
  expect(deniedDownload.status()).toBe(404);
  await page.goto("/estate/beneficiaries");
  await expect(page.getByText("Amina Example")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add beneficiary" })).toBeVisible();
});