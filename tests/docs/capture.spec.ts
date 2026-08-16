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

  const portfolioBeforeConversion = (await (
    await page.request.get("/api/export/json")
  ).json()) as {
    accounts: Array<{ id: string; name: string }>;
  };
  const brokerage = portfolioBeforeConversion.accounts.find(
    (account) => account.name === "Interactive Brokers VWRA",
  );
  expect(brokerage).toBeTruthy();

  await page.goto(`/accounts/${brokerage!.id}/convert`);
  await page.getByRole("link", { name: "Add instrument" }).click();
  await page
    .getByLabel("Instrument name")
    .fill("Vanguard FTSE All-World UCITS ETF");
  await page.getByLabel("Symbol").fill("VWRA");
  await page.getByLabel("Identifier", { exact: true }).fill("VWRA");
  await page.getByLabel("Exchange MIC").fill("XLON");
  await page.getByLabel("Quote currency").selectOption("USD");
  await page.getByRole("button", { name: "Create instrument" }).click();
  await page
    .getByLabel("Replacement account name")
    .fill("Interactive Brokers Positions");
  await page.getByLabel("Conversion date").fill("2026-08-12");
  await page.getByLabel(/Opening cash/).fill("1111");
  await page.getByLabel("Quantity").fill("15");
  await page.getByLabel("Unit price").fill("200");
  await page.getByLabel("Reference basis").fill("2800");
  await page.getByLabel("Price source").fill("broker statement");
  await page
    .getByLabel("Price provenance")
    .fill("Fictional 12 August 2026 statement");
  await page.getByRole("button", { name: "Preview conversion" }).click();
  await expect(page.getByText("Projected total")).toBeVisible();
  await page.getByText("Projected total").scrollIntoViewIfNeeded();
  await capturePage(page, "account-conversion-preview.png");
  await page.getByRole("button", { name: "Convert account" }).click();
  await expect(
    page.getByRole("heading", { name: "Interactive Brokers Positions" }),
  ).toBeVisible();
  const positionAccountId = new URL(page.url()).pathname.split("/").at(-1)!;

  await page.getByRole("link", { name: "Buy", exact: true }).click();
  await page.getByLabel("Quantity").fill("1");
  await page.getByLabel("Execution price per unit").fill("205");
  await page.getByLabel("Fee amount").fill("1");
  await page.getByLabel("Trade date").fill("2026-08-13");
  await page.getByLabel("Settlement date").fill("2026-08-14");
  await page.getByLabel("Description").fill("Fictional recurring investment");
  await captureLocator(
    cardForHeading(page, "Position activity"),
    "position-trade-entry.png",
  );
  await page.getByRole("button", { name: "Save position activity" }).click();

  await page
    .getByLabel("Update Vanguard FTSE All-World UCITS ETF price")
    .click();
  await page.getByLabel("Unit price").fill("212");
  await page.getByLabel("Price date").fill("2026-08-14");
  await page.getByLabel("Source").fill("broker statement");
  await page
    .getByLabel("Provenance")
    .fill("Fictional 14 August 2026 statement");
  await capturePage(page, "security-price-entry.png");
  await page.getByRole("button", { name: "Save price" }).click();

  await page.getByRole("link", { name: "Reinvest" }).click();
  await page.getByLabel(/Dividend amount/).fill("106");
  await page.getByLabel("Execution price per unit").fill("212");
  await page.getByLabel("Purchased quantity").fill("0.5");
  await page.getByLabel("Effective date").fill("2026-08-14");
  await page.getByLabel("Private notes").fill("Fictional reinvestment");
  await captureLocator(
    cardForHeading(page, "Authoritative source activity"),
    "investment-actions.png",
  );
  await page
    .getByRole("button", { name: "Save dividend reinvestment" })
    .click();

  await page.getByRole("link", { name: "Reconcile" }).click();
  await page.getByLabel("Statement date").fill("2026-08-14");
  await page.getByLabel(/Reported cash/).fill("905");
  await page.getByLabel(/Reported total/).fill("4405");
  await page.getByLabel("Notes").fill("Fictional broker statement comparison");
  await page.getByRole("button", { name: "Save reconciliation" }).click();
  await expect(
    page.getByRole("heading", { name: "Statement reconciliations" }),
  ).toBeVisible();
  await capturePage(page, "position-account-detail.png");

  await page.goto(`/accounts/${positionAccountId}/import`);
  await expect(
    page.getByRole("heading", {
      name: "Prepare your investment file with AI",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show prompt" }).click();
  await captureLocator(
    cardForHeading(page, "Prepare your investment file with AI"),
    "investment-ai-prompt.png",
  );
  await page.getByRole("button", { name: "Hide prompt" }).click();
  await page.getByLabel("CSV or JSON file").setInputFiles({
    name: "fictional-investment-history.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "wealthboard-investment-history",
        version: 1,
        instruments: [
          {
            external_id: "instrument:fictional-emerging-markets",
            name: "Fictional Emerging Markets ETF",
            symbol: "FEME",
            identifier_type: "ticker_exchange",
            identifier: "FEME",
            exchange_mic: "XLON",
            asset_type: "etf",
            quote_currency: "USD",
          },
        ],
        position_events: [
          {
            external_id: "event:fictional-emerging-markets:opening",
            instrument_external_id: "instrument:fictional-emerging-markets",
            type: "opening_position",
            quantity: "3",
            unit_price: null,
            trade_currency: "USD",
            fee_amount: null,
            fee_currency: null,
            cash_effect: null,
            applied_exchange_rate: null,
            opening_cost_basis: "180",
            event_group_id: null,
            trade_date: "2026-08-14",
            settlement_date: null,
            description: "Fictional opening holding",
            notes: null,
          },
        ],
        cash_transactions: [],
        prices: [
          {
            external_id: "price:fictional-emerging-markets:2026-08-14",
            instrument_external_id: "instrument:fictional-emerging-markets",
            price: "62",
            effective_date: "2026-08-14",
            source: "broker statement",
            provenance: "Fictional 14 August 2026 statement",
          },
        ],
      }),
    ),
  });
  await page.getByRole("button", { name: "Preview file" }).click();
  await expect(
    page.getByText(/Interactive Brokers Positions · 3 source records/),
  ).toBeVisible();
  await page
    .getByRole("columnheader", { name: "Instrument" })
    .first()
    .scrollIntoViewIfNeeded();
  await captureLocator(
    cardForHeading(page, "Confirm projected account"),
    "investment-import-preview.png",
  );

  await page.goto("/reports");
  await capturePage(page, "reports-overview.png");
  await captureLocator(
    cardForHeading(page, "Position movement attribution"),
    "position-movement-attribution.png",
  );

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
    accounts: Array<{
      id: string;
      name: string;
      isLiability: boolean;
      archivedAt: string | null;
    }>;
  };
  const land = archive.accounts.find(
    (account) => account.name === "Southern Bypass Land",
  );
  expect(land).toBeTruthy();

  await page.goto(`/estate/distribution?account=${land!.id}#asset-${land!.id}`);
  for (const account of archive.accounts.filter(
    (account) =>
      !account.isLiability && !account.archivedAt && account.id !== land!.id,
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
