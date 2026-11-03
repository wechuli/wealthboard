import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const projectRoot = process.cwd();
const origin = "http://127.0.0.1:3300";
const screenshotDirectory = path.join(
  projectRoot,
  "docs/public/images/screenshots",
);

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({
    content: `
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
  await settle(locator.page());
  await locator.screenshot({
    path: path.join(screenshotDirectory, name),
    animations: "disabled",
  });
}

async function api(
  page: Page,
  method: string,
  route: string,
  data?: unknown,
): Promise<unknown> {
  const session = (await (
    await page.request.get("/api/v1/session")
  ).json()) as {
    csrfToken: string;
  };
  const response = await page.request.fetch(`/api/v1${route}`, {
    method,
    data,
    headers: {
      Origin: origin,
      "X-CSRF-Token": session.csrfToken,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
  expect(response.ok(), `${method} ${route}: ${await response.text()}`).toBe(
    true,
  );
  return response.status() === 204 ? undefined : response.json();
}

async function accountByName(page: Page, name: string) {
  const { items } = (await (
    await page.request.get("/api/v1/accounts")
  ).json()) as {
    items: Array<{ id: string; name: string }>;
  };
  const account = items.find((candidate) => candidate.name === name);
  expect(account, name).toBeTruthy();
  return account!.id;
}

test("capture the Wealthboard product guide", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Username" }).fill("guide-user");
  await page.getByLabel("Display name").fill("Jordan Mwangi");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-guide-password-123");
  await page
    .getByLabel("Confirm password")
    .fill("fictional-guide-password-123");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome, Jordan Mwangi" }),
  ).toBeVisible();

  const seed = spawnSync(
    "make",
    ["seed-demo", "DEMO_DATA=true", "TARGET_USERNAME=guide-user"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgres://wealthboard_e2e:wealthboard_e2e@127.0.0.1:55434/wealthboard_e2e?sslmode=disable",
      },
    },
  );
  expect(seed.status, seed.stderr || seed.stdout).toBe(0);

  const categories = (await (
    await page.request.get("/api/v1/categories")
  ).json()) as { items: Array<{ id: string; name: string }> };
  const liabilityCategory = categories.items.find(
    (category) => category.name === "Liability",
  );
  expect(liabilityCategory).toBeTruthy();
  await api(page, "POST", "/accounts", {
    idempotencyKey: randomUUID(),
    name: "Home renovation loan",
    categoryId: liabilityCategory!.id,
    currency: "KES",
    trackingMode: "balance",
    openingValueMinor: "65000000",
    isIncludedInNetWorth: true,
    openedAt: "2026-08-01",
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Jordan Mwangi$/ }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Net worth" })).toBeVisible();
  await capturePage(page, "dashboard-overview.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Net worth" })).toBeVisible();
  await capturePage(page, "dashboard-mobile.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/accounts");
  await expect(
    page.getByText("Home renovation loan", { exact: true }).first(),
  ).toBeVisible();
  await capturePage(page, "accounts-workspace.png");

  await page
    .getByRole("link", { name: /Southern Bypass Land/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Southern Bypass Land" }),
  ).toBeVisible();
  await capturePage(page, "account-detail.png");

  await page.goto("/activity");
  await expect(
    page.getByRole("heading", { level: 1, name: "Activity" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Ledger" })).toBeVisible();
  await capturePage(page, "transaction-workbench.png");

  await page.goto("/goals");
  await page
    .getByRole("link", { name: /2028 Family Car/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "2028 Family Car" }),
  ).toBeVisible();
  await capturePage(page, "goal-planning.png");

  const brokerageId = await accountByName(page, "Interactive Brokers VWRA");
  const vwra = (await api(page, "POST", "/instruments", {
    name: "Vanguard FTSE All-World UCITS ETF",
    symbol: "VWRA",
    identifierType: "ticker_exchange",
    identifier: "VWRA",
    exchangeMic: "XLON",
    assetType: "etf",
    quoteCurrency: "USD",
  })) as { id: string };

  await page.goto(`/accounts/${brokerageId}?action=convert`);
  const convert = page.getByRole("dialog", {
    name: "Convert to position tracking",
  });
  await convert
    .getByLabel("Account name")
    .fill("Interactive Brokers Positions");
  await convert.getByLabel("Conversion date").fill("2026-08-12");
  await convert.getByLabel("Opening cash").fill("1111");
  await convert.getByLabel("Instrument", { exact: true }).selectOption(vwra.id);
  await convert.getByLabel("Quantity", { exact: true }).fill("15");
  await convert.getByLabel("Unit price", { exact: true }).fill("200");
  await convert.getByLabel("Opening cost basis").fill("2800");
  await convert.getByRole("button", { name: "Preview conversion" }).click();
  const conversionPreview = convert.getByRole("region", { name: "Preview" });
  await expect(conversionPreview).toBeVisible();
  const differenceConfirmation = convert.getByRole("checkbox", {
    name: /convert anyway/,
  });
  if (await differenceConfirmation.isVisible()) {
    await differenceConfirmation.check();
  }
  await conversionPreview.scrollIntoViewIfNeeded();
  await capturePage(page, "account-conversion-preview.png");
  await convert.getByRole("button", { name: "Convert account" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Interactive Brokers Positions",
    }),
  ).toBeVisible();
  const positionAccountId = new URL(page.url()).pathname.split("/").at(-1)!;

  await page.goto(
    `/accounts/${positionAccountId}?action=trade&trade=buy&instrument=${vwra.id}`,
  );
  const trade = page.getByRole("dialog", { name: "Record position activity" });
  await expect(
    trade.getByRole("radio", { name: "Buy", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await trade.getByLabel("Quantity", { exact: true }).fill("1");
  await trade.getByLabel("Unit price", { exact: true }).fill("205");
  await trade.getByRole("textbox", { name: /^Fee/ }).fill("1");
  await trade.getByLabel("Trade date").fill("2026-08-13");
  await trade.getByLabel("Settlement date").fill("2026-08-14");
  await trade.getByLabel("Description").fill("Fictional recurring investment");
  await captureLocator(trade, "position-trade-entry.png");
  await trade.getByRole("button", { name: "Record", exact: true }).click();
  await expect(trade).toBeHidden();

  await page.goto(
    `/accounts/${positionAccountId}?record=price&instrumentId=${vwra.id}`,
  );
  const price = page.getByRole("dialog", { name: /Update a price/ });
  await price.getByLabel("Unit price").fill("212");
  await price.getByLabel("Price date").fill("2026-08-14");
  await price.getByLabel("Source").fill("Fictional 14 August 2026 statement");
  await capturePage(page, "security-price-entry.png");
  await price.getByRole("button", { name: "Save price" }).click();
  await expect(price).toBeHidden();

  await page.goto(`/accounts/${positionAccountId}?action=drip`);
  const reinvest = page.getByRole("dialog", { name: "Dividend reinvestment" });
  await reinvest
    .getByLabel("Instrument", { exact: true })
    .selectOption(vwra.id);
  await reinvest.getByLabel("Dividend amount").fill("106");
  await reinvest.getByLabel("Unit price", { exact: true }).fill("212");
  await reinvest.getByLabel("Quantity", { exact: true }).fill("0.5");
  await reinvest.getByLabel("Effective date").fill("2026-08-14");
  await reinvest.getByLabel("Notes").fill("Fictional reinvestment");
  await captureLocator(reinvest, "investment-actions.png");
  await reinvest
    .getByRole("button", { name: "Record dividend reinvestment" })
    .click();
  await expect(reinvest).toBeHidden();

  await page.goto(`/accounts/${positionAccountId}?action=reconcile`);
  const reconcile = page.getByRole("dialog", {
    name: "Reconcile to statement",
  });
  await reconcile.getByLabel("Statement date").fill("2026-08-14");
  await reconcile.getByLabel("Reported cash").fill("905");
  await reconcile.getByLabel("Reported total").fill("4405");
  await reconcile
    .getByLabel("Notes")
    .fill("Fictional broker statement comparison");
  await reconcile.getByRole("button", { name: "Save reconciliation" }).click();
  await expect(
    reconcile.getByText("Fictional broker statement comparison"),
  ).toBeVisible();

  await page.goto(`/accounts/${positionAccountId}`);
  await expect(
    page.getByRole("table", {
      name: /^Holdings in Interactive Brokers Positions/,
    }),
  ).toBeVisible();
  await capturePage(page, "position-account-detail.png");

  await page.goto(`/accounts/${positionAccountId}/import?tab=ai`);
  const aiConvert = page.getByRole("region", {
    name: "Convert a statement with AI",
  });
  await captureLocator(aiConvert, "investment-ai-prompt.png");

  await page.getByRole("tab", { name: "Direct import" }).click();
  const previewResponse = page.waitForResponse((response) =>
    response.url().includes("/investment-import/preview"),
  );
  await page.getByLabel(/Drop an investment history file here/).setInputFiles({
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
  expect((await previewResponse).ok()).toBe(true);
  const investmentPreview = page.getByRole("region", {
    name: "Review before importing",
  });
  await expect(
    investmentPreview.getByText("Fictional Emerging Markets ETF").first(),
  ).toBeVisible();
  await captureLocator(investmentPreview, "investment-import-preview.png");

  await page.goto("/reports");
  await expect(page).toHaveURL(/\/insights\/net-worth$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Insights" }),
  ).toBeVisible();
  await capturePage(page, "reports-overview.png");

  const beneficiaries: Record<string, string> = {};
  for (const beneficiary of [
    {
      kind: "person",
      name: "Amina Mwangi",
      relationship: "Child",
      contactSummary: "amina@example.test",
    },
    { kind: "person", name: "Nia Mwangi", relationship: "Child" },
    { kind: "trust", name: "Mwangi Education Trust" },
  ]) {
    const created = (await api(
      page,
      "POST",
      "/estate/beneficiaries",
      beneficiary,
    )) as { id: string };
    beneficiaries[beneficiary.name] = created.id;
  }
  await page.goto("/estate/beneficiaries");
  await expect(page.getByText("Mwangi Education Trust").first()).toBeVisible();
  await capturePage(page, "estate-beneficiaries.png");

  const landId = await accountByName(page, "Southern Bypass Land");
  const directive = (await api(page, "PUT", `/estate/directives/${landId}`, {
    isIncluded: true,
    ownershipShareBps: 10000,
    transferContext: "estate",
    distributionMethod: "sell_and_divide",
    documentReference: "Title deed in the family document safe",
    notes: "Confirm title details with the estate adviser.",
    reviewedAt: "2026-08-12",
  })) as { id: string };
  for (const [name, tier, allocationBps] of [
    ["Amina Mwangi", "primary", 6000],
    ["Mwangi Education Trust", "primary", 4000],
    ["Nia Mwangi", "contingent", 10000],
  ] as const) {
    await api(page, "PUT", `/estate/allocations/${directive.id}`, {
      beneficiaryId: beneficiaries[name],
      tier,
      allocationBps,
    });
  }
  await page.goto(`/estate/distribution?account=${landId}`);
  const landSheet = page.getByRole("dialog", { name: "Southern Bypass Land" });
  const primaryShares = landSheet.getByRole("heading", {
    name: "Primary beneficiaries",
  });
  await expect(primaryShares).toBeVisible();
  await expect(
    landSheet.getByLabel("Primary beneficiaries allocations"),
  ).toContainText("Mwangi Education Trust");
  await expect(
    landSheet.getByLabel("Contingent beneficiaries allocations"),
  ).toContainText("Nia Mwangi");
  await primaryShares.evaluate((heading) =>
    heading.scrollIntoView({ block: "start" }),
  );
  await captureLocator(landSheet, "estate-asset-allocation.png");
  await landSheet.press("Escape");
  await expect(landSheet).toBeHidden();

  await page.goto("/estate");
  await page.getByRole("button", { name: "Edit details" }).click();
  const planDetails = page.getByRole("form", { name: "Plan details" });
  await planDetails
    .getByLabel("Plan title")
    .fill("Mwangi family continuity plan");
  await planDetails
    .getByLabel("Jurisdiction or residence")
    .fill("Nairobi, Kenya");
  await planDetails.getByLabel("Last reviewed").fill("2026-08-12");
  await planDetails.getByLabel("Review again on").fill("2027-08-12");
  const planSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/estate/plan") &&
      response.request().method() === "PUT",
  );
  await planDetails.getByRole("button", { name: "Save plan details" }).click();
  expect((await planSaved).ok()).toBe(true);

  await page
    .getByRole("navigation", { name: "Estate planning sections" })
    .getByRole("link", { name: "Summary" })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Completion review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Beneficiary overview" }),
  ).toBeVisible();
  await capturePage(page, "estate-summary.png");

  await page.getByRole("button", { name: "Create summary" }).first().click();
  await expect(page).toHaveURL(/\/estate\/snapshots\/[a-f0-9-]+$/);
  await expect(
    page.getByRole("article", { name: "Estate Planning Summary" }),
  ).toBeVisible();
  await capturePage(page, "estate-print-preview.png");
});
