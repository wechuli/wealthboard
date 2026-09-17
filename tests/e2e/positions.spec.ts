import { expect, test } from "@playwright/test";

async function signUp(
  page: Parameters<typeof test>[0] extends never
    ? never
    : import("@playwright/test").Page,
  username: string,
) {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Display name").fill(`${username} Example`);
  await page.getByLabel("Base currency").selectOption("KES");
  await page
    .getByLabel("Password", { exact: true })
    .fill("position-e2e-password");
  await page.getByLabel("Confirm password").fill("position-e2e-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("position-e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

let accountId = "";
let convertedAccountId = "";
let convertedSourceAccountId = "";
let responsiveConversionSourceId = "";

test("archives accounts out of tracking and permanently deletes them with confirmation", async ({
  page,
  browser,
}, testInfo) => {
  await signUp(page, "archive-lifecycle-e2e");
  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Lifecycle Brokerage");
  await page.getByLabel("Category").selectOption({ label: "Securities" });
  await page.getByLabel("Tracking method").selectOption("positions");
  await page.getByLabel("Opening cash").fill("1000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Lifecycle Brokerage" }),
  ).toBeVisible();
  const createdAccountId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("link", { name: "Add holding" }).click();
  await page.getByRole("link", { name: "Create instrument" }).click();
  await page.getByLabel("Instrument name").fill("Lifecycle ETF");
  await page.getByLabel("Symbol").fill("LIFE");
  await page.getByLabel("Identifier", { exact: true }).fill("LIFE");
  await page.getByLabel("Exchange MIC").fill("XNAS");
  await page.getByLabel("Quote currency").selectOption("KES");
  await page.getByRole("button", { name: "Create instrument" }).click();
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Trade date").fill("2026-01-01");
  await page.getByRole("button", { name: "Save position activity" }).click();
  await page.getByLabel("Update Lifecycle ETF price").click();
  await page.getByLabel("Unit price").fill("10");
  await page.getByLabel("Price date").fill("2026-01-01");
  await page.getByRole("button", { name: "Save price" }).click();
  await page.goto("/instruments");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Lifecycle ETF" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "still linked to account history" }),
  ).toContainText("still linked to account history");
  await expect(page.getByText("Lifecycle ETF", { exact: true })).toBeVisible();
  await page.goto(`/accounts/${createdAccountId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archive account" }).click();
  await expect(
    page.getByRole("heading", { name: "Accounts & assets" }),
  ).toBeVisible();
  await expect(page.getByText("Lifecycle Brokerage")).toHaveCount(0);
  await expect(page.getByLabel("Filter by status")).toHaveCount(0);
  await page.goto("/transactions");
  await expect(
    page.getByText("Lifecycle Brokerage", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/reports");
  await expect(
    page.getByText("Lifecycle Brokerage", { exact: true }),
  ).toHaveCount(0);
  await page.goto(`/accounts/${createdAccountId}`);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  const archivedExport = await (
    await page.request.get("/api/export/json")
  ).json();
  expect(archivedExport.accounts).toContainEqual(
    expect.objectContaining({
      id: createdAccountId,
      archivedAt: expect.any(String),
    }),
  );
  expect(
    await (await page.request.get("/api/export/accounts.csv")).text(),
  ).not.toContain("Lifecycle Brokerage");

  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const otherPage = await otherContext.newPage();
    await signUp(otherPage, "archive-other-e2e");
    await otherPage.goto("/accounts/archived");
    await expect(otherPage.getByText("No archived accounts.")).toBeVisible();
    await expect(otherPage.getByText("Lifecycle Brokerage")).toHaveCount(0);
  } finally {
    await otherContext.close();
  }

  await page.goto("/settings");
  await page.getByRole("link", { name: "Archived accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Lifecycle Brokerage" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lifecycle Brokerage" }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/accounts/${createdAccountId}$`));
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archive account" }).click();
  await expect(
    page.getByRole("heading", { name: "Accounts & assets" }),
  ).toBeVisible();
  await page.goto("/accounts/archived");
  await page
    .getByRole("button", { name: "Delete Lifecycle Brokerage" })
    .click();
  const deletionDialog = page.getByRole("dialog", {
    name: "Permanently delete account",
  });
  const deleteButton = deletionDialog.getByRole("button", {
    name: "Permanently delete",
    exact: true,
  });
  await expect(deleteButton).toBeDisabled();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await deletionDialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await deletionDialog.screenshot({
      path: testInfo.outputPath(`delete-account-${width}.png`),
    });
  }
  await deletionDialog
    .getByLabel("Account name confirmation")
    .fill("Lifecycle Brokerage");
  await deleteButton.click();
  await expect(page.getByText("No archived accounts.")).toBeVisible();
  const deletedExport = await (
    await page.request.get("/api/export/json")
  ).json();
  expect(deletedExport.accounts).toEqual([]);
  expect(deletedExport.transactions).toEqual([]);
  expect(deletedExport.investmentInstruments).toContainEqual(
    expect.objectContaining({ name: "Lifecycle ETF" }),
  );
  expect(deletedExport.securityPrices).toHaveLength(1);

  await page.goto("/instruments");
  const removeInstrument = page.getByRole("button", {
    name: "Delete Lifecycle ETF",
  });
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(async () => {
      const edit = await page
        .getByRole("link", { name: "Edit Lifecycle ETF" })
        .boundingBox();
      const archive = await page
        .getByRole("button", { name: "Archive instrument", exact: true })
        .boundingBox();
      const remove = await removeInstrument.boundingBox();
      expect(edit!.x).toBeGreaterThanOrEqual(0);
      expect(edit!.x + edit!.width).toBeLessThanOrEqual(archive!.x);
      expect(archive!.x + archive!.width).toBeLessThanOrEqual(remove!.x);
      expect(remove!.x + remove!.width).toBeLessThanOrEqual(width + 1);
    }).toPass();
    await page.screenshot({
      path: testInfo.outputPath(`instrument-directory-${width}.png`),
      fullPage: true,
    });
  }
  page.once("dialog", (dialog) => dialog.dismiss());
  await removeInstrument.click();
  await expect(page.getByText("Lifecycle ETF", { exact: true })).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(
      "Lifecycle ETF and all its saved prices",
    );
    await dialog.accept();
  });
  await removeInstrument.click();
  await expect(page.getByText("Instrument permanently deleted.")).toBeVisible();
  await expect(page.getByText("Lifecycle ETF", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Delete Lifecycle ETF" }),
  ).toHaveCount(0);
  const cleanedExport = await (
    await page.request.get("/api/export/json")
  ).json();
  expect(cleanedExport.investmentInstruments).toEqual([]);
  expect(cleanedExport.securityPrices).toEqual([]);
});

test.describe.serial("position accounts", () => {
  test("flow through net worth, import, and privacy", async ({ page }) => {
    await signUp(page, "position-e2e");
    await page.goto("/accounts/new");
    await page.getByLabel("Account or asset name").fill("Position Brokerage");
    await page.getByLabel("Category").selectOption({ label: "Securities" });
    await page.getByLabel("Tracking method").selectOption("positions");
    await page.getByLabel("Opening cash").fill("1000");
    await page.getByLabel("Opened or acquired").fill("2026-01-01");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByRole("heading", { name: "Position Brokerage" }),
    ).toBeVisible();
    const accountUrl = new URL(page.url());
    accountId = accountUrl.pathname.split("/").at(-1)!;

    await page.getByRole("link", { name: "Add holding" }).click();
    await page.getByRole("link", { name: "Create instrument" }).click();
    await page.getByLabel("Instrument name").fill("Example World ETF");
    await page.getByLabel("Symbol").fill("EWLD");
    await page.getByLabel("Identifier", { exact: true }).fill("EWLD");
    await page.getByLabel("Exchange MIC").fill("XNAS");
    await page.getByLabel("Quote currency").selectOption("KES");
    await page.getByRole("button", { name: "Create instrument" }).click();
    await page.getByLabel("Quantity").fill("10");
    await page.getByLabel("Trade date").fill("2026-01-01");
    await page.getByRole("button", { name: "Save position activity" }).click();
    await expect(page.getByText("Missing", { exact: true })).toBeVisible();

    await page.getByLabel("Update Example World ETF price").click();
    await page.getByLabel("Unit price").fill("100");
    await page.getByLabel("Price date").fill("2026-01-01");
    await page.getByLabel("Provenance").fill("Opening statement");
    await page.getByRole("button", { name: "Save price" }).click();
    await expect(page.getByText("10", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Buy", exact: true }).click();
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Execution price per unit").fill("90");
    await page.getByLabel("Fee amount").fill("10");
    await page.getByLabel("Trade date").fill("2026-02-01");
    await page.getByLabel("Settlement date").fill("2026-02-03");
    await page.getByRole("button", { name: "Save position activity" }).click();

    const exportedBeforeImport = (await (
      await page.request.get("/api/export/json")
    ).json()) as {
      version: number;
      accounts: Array<{
        id: string;
        currentValueMinor: number;
        trackingMode: string;
      }>;
      positionEvents: Array<{ type: string; quantity: string }>;
    };
    expect(exportedBeforeImport.version).toBe(8);
    expect(
      exportedBeforeImport.accounts.find((account) => account.id === accountId),
    ).toMatchObject({
      trackingMode: "positions",
      currentValueMinor: 201_000,
    });
    expect(exportedBeforeImport.positionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "opening_position", quantity: "10" }),
        expect.objectContaining({ type: "buy", quantity: "2" }),
      ]),
    );

    await page.getByRole("link", { name: "Reconcile" }).click();
    await page.getByLabel("Statement date").fill("2026-02-28");
    await page.getByLabel(/Reported cash/).fill("810");
    await page.getByLabel(/Reported total/).fill("2050");
    await page.getByRole("button", { name: "Save reconciliation" }).click();
    await expect(
      page.getByRole("heading", { name: "Statement reconciliations" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Import" }).click();
    await expect(
      page.getByRole("heading", { name: "Investment History v1" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Prepare your investment file with AI",
      }),
    ).toBeVisible();
    await page.getByLabel("CSV or JSON file").setInputFiles({
      name: "second-position.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "wealthboard-investment-history",
          version: 1,
          instruments: [
            {
              external_id: "instrument:second",
              name: "Second Fund",
              symbol: "SECD",
              identifier_type: "custom",
              identifier: "SECD",
              exchange_mic: null,
              asset_type: "fund",
              quote_currency: "KES",
            },
          ],
          position_events: [
            {
              external_id: "event:second:opening",
              instrument_external_id: "instrument:second",
              type: "opening_position",
              quantity: "1",
              unit_price: null,
              trade_currency: "KES",
              fee_amount: null,
              fee_currency: null,
              cash_effect: null,
              applied_exchange_rate: null,
              opening_cost_basis: "50",
              trade_date: "2026-02-01",
              settlement_date: null,
              description: null,
              notes: null,
            },
          ],
          cash_transactions: [],
          prices: [
            {
              external_id: "price:second:2026-02-01",
              instrument_external_id: "instrument:second",
              price: "50",
              effective_date: "2026-02-01",
              source: "statement",
              provenance: null,
            },
          ],
        }),
      ),
    });
    await page.getByRole("button", { name: "Preview file" }).click();
    await expect(
      page.getByText(/Position Brokerage · 3 source records/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm atomic import" }).click();
    await expect(
      page.getByText("3 records imported; 0 duplicates skipped."),
    ).toBeVisible();

    await page.goto(`/accounts/${accountId}`);
    await expect(page.getByText("Second Fund")).toBeVisible();
    await page.getByRole("button", { name: "Hide financial values" }).click();
    await expect(page.getByText("••••••").first()).toBeVisible();
    await page.getByRole("button", { name: "Reveal financial values" }).click();

    await page.getByRole("link", { name: "Reinvest" }).click();
    await page.getByLabel(/Dividend amount/).fill("100");
    await page.getByLabel("Execution price per unit").fill("50");
    await page.getByLabel("Purchased quantity").fill("2");
    await page.getByLabel("Effective date").fill("2026-03-01");
    await page
      .getByRole("button", { name: "Save dividend reinvestment" })
      .click();
    await expect(
      page.getByText("Dividend reinvestment purchase"),
    ).toBeVisible();

    const beforeSplit = (await (
      await page.request.get("/api/export/json")
    ).json()) as typeof exportedBeforeImport;
    await page.getByRole("link", { name: "Corp action" }).click();
    await page.getByLabel("Action").selectOption("split");
    await page.getByLabel("Instrument").selectOption({ label: "EWLD · KES" });
    await page.getByLabel("New or resulting shares").fill("2");
    await page.getByLabel("Existing or source shares").fill("1");
    await page.getByLabel("Effective date").fill("2026-04-01");
    await page.getByRole("button", { name: "Save stock split" }).click();
    await expect(page.getByText(/Stock split · EWLD/)).toBeVisible();
    await expect(page.getByText("Missing", { exact: true })).toBeVisible();

    await page.getByLabel("Update Example World ETF price").click();
    await page.getByLabel("Unit price").fill("50");
    await page.getByLabel("Price date").fill("2026-04-01");
    await page.getByLabel("Provenance").fill("Post-split statement");
    await page.getByRole("button", { name: "Save price" }).click();
    await expect(page.getByText("Missing", { exact: true })).toHaveCount(0);
    const afterSplit = (await (
      await page.request.get("/api/export/json")
    ).json()) as typeof exportedBeforeImport;
    expect(
      afterSplit.accounts.find((account) => account.id === accountId)
        ?.currentValueMinor,
    ).toBe(
      beforeSplit.accounts.find((account) => account.id === accountId)
        ?.currentValueMinor,
    );

    await page.goto("/accounts/new");
    await page.getByLabel("Account or asset name").fill("Legacy Investment");
    await page.getByLabel("Category").selectOption({ label: "Securities" });
    await page.getByLabel("Opening value").fill("1000");
    await page.getByLabel("Opened or acquired").fill("2026-01-01");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByRole("heading", { name: "Legacy Investment" }),
    ).toBeVisible();
    convertedSourceAccountId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("link", { name: "Convert" }).click();
    await page
      .getByLabel("Replacement account name")
      .fill("Converted Positions");
    await page.getByLabel("Conversion date").fill("2026-06-01");
    await page.getByLabel("Quantity").fill("10");
    await page.getByLabel("Unit price").fill("100");
    await page.getByRole("button", { name: "Preview conversion" }).click();
    await expect(page.getByText("Projected total")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Convert account" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Convert account" }).click();
    await expect(
      page.getByRole("heading", { name: "Converted Positions" }),
    ).toBeVisible();
    convertedAccountId = new URL(page.url()).pathname.split("/").at(-1)!;

    await page.goto(`/accounts/${accountId}`);
    await page.getByRole("link", { name: "Move units" }).click();
    await page
      .getByLabel("Destination account")
      .selectOption(convertedAccountId);
    await page.getByLabel("Instrument").selectOption({ label: "EWLD · KES" });
    await page.getByLabel("Transferred quantity").fill("1");
    await page.getByLabel("Effective date").fill("2026-07-01");
    await page.getByRole("button", { name: "Save in-kind transfer" }).click();
    await expect(page.getByText(/Transfer out · EWLD/)).toBeVisible();
    await page.goto(`/accounts/${convertedAccountId}`);
    await expect(page.getByText(/Transfer in · EWLD/)).toBeVisible();

    const completedArchive = (await (
      await page.request.get("/api/export/json")
    ).json()) as {
      version: number;
      accountConversions: Array<{
        sourceAccountId: string;
        targetAccountId: string;
      }>;
      transactions: Array<{ eventGroupId: string | null }>;
      positionEvents: Array<{ eventGroupId: string | null; type: string }>;
    };
    expect(completedArchive.version).toBe(8);
    expect(completedArchive.accountConversions).toContainEqual(
      expect.objectContaining({
        sourceAccountId: convertedSourceAccountId,
        targetAccountId: convertedAccountId,
      }),
    );
    const groupedCashIds = new Set(
      completedArchive.transactions
        .map((row) => row.eventGroupId)
        .filter((value): value is string => Boolean(value)),
    );
    expect(
      completedArchive.positionEvents.some(
        (row) =>
          row.type === "buy" &&
          row.eventGroupId &&
          groupedCashIds.has(row.eventGroupId),
      ),
    ).toBe(true);

    await page.goto("/accounts/new");
    await page
      .getByLabel("Account or asset name")
      .fill("Responsive Conversion Source");
    await page.getByLabel("Category").selectOption({ label: "Securities" });
    await page.getByLabel("Opening value").fill("100");
    await page.getByLabel("Opened or acquired").fill("2026-01-01");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByRole("heading", { name: "Responsive Conversion Source" }),
    ).toBeVisible();
    responsiveConversionSourceId = new URL(page.url()).pathname
      .split("/")
      .at(-1)!;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: "Investment instruments" }),
    ).toBeVisible();
  });

  test("fit position workflows at every supported viewport", async ({
    page,
  }) => {
    await signIn(page, "position-e2e");
    expect(accountId).toBeTruthy();
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      for (const route of [
        `/accounts/${accountId}`,
        `/accounts/${accountId}/import`,
        `/accounts/${accountId}/investment-actions`,
        `/accounts/${responsiveConversionSourceId}/convert`,
        "/instruments",
        "/reports",
      ]) {
        await page.goto(route);
        await expect(page.locator("main")).toBeVisible();
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
  });

  test("returns not found for another user's direct account URL", async ({
    page,
  }) => {
    expect(accountId).toBeTruthy();
    await signUp(page, "position-other-e2e");
    await page.goto(`/accounts/${accountId}`);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await page.goto(`/accounts/${accountId}/investment-actions`);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await page.goto(`/accounts/${responsiveConversionSourceId}/convert`);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
  });
});
