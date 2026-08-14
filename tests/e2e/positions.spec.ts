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

test("position accounts flow through net worth, import, privacy, and isolation", async ({
  page,
}) => {
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
  const accountId = accountUrl.pathname.split("/").at(-1)!;

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
  expect(exportedBeforeImport.version).toBe(7);
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
    page.getByText("Position Brokerage · 3 source records"),
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

  await page.goto("/");
  await expect(page.getByText(/2,060/).first()).toBeVisible();
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Investment instruments" }),
  ).toBeVisible();

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    for (const route of [
      `/accounts/${accountId}`,
      `/accounts/${accountId}/import`,
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

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Log out" }).click();
  await signUp(page, "position-other-e2e");
  await page.goto(`/accounts/${accountId}`);
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
});
