import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import type { components } from "../../web/src/api/schema";

const origin = `http://127.0.0.1:${process.env.E2E_GO_PORT || 3200}`;
const password = "fictional-go-e2e-password";

type Session = { csrfToken: string };

async function signUp(page: Page, username: string): Promise<Session> {
  await page.goto("/signup");
  const response = await page.request.post("/api/v1/auth/signup", {
    headers: { Origin: origin },
    data: {
      username,
      displayName: username,
      baseCurrency: "KES",
      password,
      confirmPassword: password,
    },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  return response.json();
}

async function mutation(
  page: Page,
  session: Session,
  method: string,
  path: string,
  data?: unknown,
) {
  return page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: {
      Origin: origin,
      "X-CSRF-Token": session.csrfToken,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
}

async function firstCategoryId(page: Page) {
  const response = await page.request.get("/api/v1/categories");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items: Array<{ id: string }> };
  return body.items[0].id;
}

async function enableCurrency(page: Page, session: Session, currency: string) {
  const response = await page.request.get("/api/v1/settings");
  expect(response.ok()).toBeTruthy();
  const { settings } =
    (await response.json()) as components["schemas"]["SettingsRead"];
  const input: components["schemas"]["SettingsMutationRequest"] = {
    displayName: settings.displayName,
    appName: settings.appName,
    baseCurrency: settings.baseCurrency,
    supportedCurrencies: [
      ...new Set([...settings.supportedCurrencies, currency]),
    ],
    timezone: settings.timezone,
    preferredDateFormat: settings.preferredDateFormat,
    defaultDashboardPeriod: settings.defaultDashboardPeriod,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    defaultGoalReturnBps: settings.defaultGoalReturnBps,
    positionStaleDaysStock: settings.positionStaleDaysStock,
    positionStaleDaysEtf: settings.positionStaleDaysEtf,
    positionStaleDaysFund: settings.positionStaleDaysFund,
  };
  expect(
    (await mutation(page, session, "PUT", "/settings", input)).ok(),
  ).toBeTruthy();
}

async function createAccount(
  page: Page,
  session: Session,
  name: string,
  trackingMode: "balance" | "positions" = "balance",
) {
  const response = await mutation(page, session, "POST", "/accounts", {
    idempotencyKey: randomUUID(),
    name,
    categoryId: await firstCategoryId(page),
    currency: "KES",
    trackingMode,
    openingValueMinor: "0",
    isIncludedInNetWorth: true,
    openedAt: "2026-01-01",
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function signUpInContext(context: BrowserContext, username: string) {
  const page = await context.newPage();
  const session = await signUp(page, username);
  return { page, session };
}

test("records an exact corporate split through Go and replays the position", async ({
  page,
}) => {
  const session = await signUp(page, "go-split-owner");
  const accountId = await createAccount(
    page,
    session,
    "Split brokerage",
    "positions",
  );
  const instrumentResponse = await mutation(
    page,
    session,
    "POST",
    "/instruments",
    {
      name: "Example World ETF",
      symbol: "EWLD",
      identifierType: "custom",
      identifier: "EWLD-E2E",
      assetType: "etf",
      quoteCurrency: "KES",
    },
  );
  expect(instrumentResponse.status()).toBe(201);
  const instrumentId = ((await instrumentResponse.json()) as { id: string }).id;
  expect(
    (
      await mutation(page, session, "POST", "/position-events", {
        accountId,
        instrumentId,
        type: "opening_position",
        quantity: "10",
        tradeDate: "2026-01-01",
        idempotencyKey: randomUUID(),
      })
    ).status(),
  ).toBe(201);

  const split = await mutation(
    page,
    session,
    "POST",
    "/corporate-actions/stock-splits",
    {
      accountId,
      instrumentId,
      numerator: "2",
      denominator: "1",
      actionDate: "2026-02-01",
      idempotencyKey: randomUUID(),
    },
  );
  expect(split.status()).toBe(201);
  const events = await page.request.get(
    `/api/v1/accounts/${accountId}/position-events?limit=100`,
  );
  expect(await events.json()).toEqual(
    expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          type: "split",
          actionRatioNumerator: "2",
          actionRatioDenominator: "1",
        }),
      ]),
    }),
  );
});

test("previews and commits account and investment imports", async ({
  page,
}) => {
  const session = await signUp(page, "go-import-owner");
  const balanceId = await createAccount(page, session, "Imported cash");
  const positionsId = await createAccount(
    page,
    session,
    "Imported positions",
    "positions",
  );
  const history = Buffer.from(
    '{"format":"wealthboard-account-history","version":1,"transactions":[{"external_id":"go-history-1","type":"deposit","amount":"24.00","date":"2026-03-01","description":"Fixture deposit"}]}',
  );
  const investment = Buffer.from(
    '{"format":"wealthboard-investment-history","version":1,"instruments":[{"external_id":"go-inst-1","name":"Fixture Fund","symbol":"FIX","identifier_type":"custom","identifier":"FIX","exchange_mic":null,"asset_type":"fund","quote_currency":"KES"}],"position_events":[{"external_id":"go-event-1","instrument_external_id":"go-inst-1","type":"opening_position","quantity":"2","unit_price":null,"trade_currency":"KES","trade_date":"2026-03-01"}],"cash_transactions":[],"prices":[{"external_id":"go-price-1","instrument_external_id":"go-inst-1","price":"10.00","effective_date":"2026-03-01","source":"e2e"}]}',
  );

  for (const input of [
    {
      accountId: balanceId,
      segment: "history-import",
      file: history,
      imported: 1,
    },
    {
      accountId: positionsId,
      segment: "investment-import",
      file: investment,
      imported: 3,
    },
  ]) {
    const headers = { Origin: origin, "X-CSRF-Token": session.csrfToken };
    const preview = await page.request.post(
      `/api/v1/accounts/${input.accountId}/${input.segment}/preview`,
      {
        headers,
        multipart: {
          file: {
            name: "fixture.json",
            mimeType: "application/json",
            buffer: input.file,
          },
        },
      },
    );
    expect(preview.ok()).toBeTruthy();
    const previewBody = (await preview.json()) as {
      hash: string;
      summary: { failed: number };
    };
    expect(previewBody.summary.failed).toBe(0);
    const commit = await page.request.post(
      `/api/v1/accounts/${input.accountId}/${input.segment}/commit`,
      {
        headers,
        multipart: {
          file: {
            name: "fixture.json",
            mimeType: "application/json",
            buffer: input.file,
          },
          hash: previewBody.hash,
        },
      },
    );
    expect(commit.ok()).toBeTruthy();
    expect((await commit.json()).summary.imported).toBe(input.imported);
  }
});

test("mutates estate data, snapshots it, and denies a foreign user", async ({
  browser,
  page,
}) => {
  const session = await signUp(page, "go-estate-owner");
  const accountId = await createAccount(page, session, "Family land");
  expect(
    (
      await mutation(page, session, "PUT", "/estate/plan", {
        title: "Family continuity plan",
        jurisdiction: "Example jurisdiction",
        lastReviewedDate: "2026-08-11",
        reviewReminderDate: "2027-08-11",
      })
    ).ok(),
  ).toBeTruthy();
  const beneficiary = await mutation(
    page,
    session,
    "POST",
    "/estate/beneficiaries",
    {
      kind: "person",
      name: "Amina Example",
      relationship: "Child",
      contactSummary: "amina@example.test",
    },
  );
  expect(beneficiary.status()).toBe(201);
  const beneficiaryId = ((await beneficiary.json()) as { id: string }).id;
  const directive = await mutation(
    page,
    session,
    "PUT",
    `/estate/directives/${accountId}`,
    {
      isIncluded: true,
      ownershipShareBps: 10000,
      transferContext: "estate",
      distributionMethod: "sell_and_divide",
      reviewedAt: "2026-08-11",
    },
  );
  expect(directive.ok()).toBeTruthy();
  const directiveId = ((await directive.json()) as { id: string }).id;
  expect(
    (
      await mutation(
        page,
        session,
        "PUT",
        `/estate/allocations/${directiveId}`,
        {
          beneficiaryId,
          tier: "primary",
          allocationBps: 10000,
        },
      )
    ).ok(),
  ).toBeTruthy();
  const snapshot = await mutation(page, session, "POST", "/estate/snapshots");
  expect(snapshot.status()).toBe(201);
  const snapshotBody = (await snapshot.json()) as {
    id: string;
    contentHash: string;
  };
  expect(snapshotBody.contentHash).toMatch(/^[a-f0-9]{64}$/);

  const foreignContext = await browser.newContext();
  const foreign = await signUpInContext(foreignContext, "go-estate-foreign");
  const denied = await foreign.page.request.get(
    `/api/v1/estate/snapshots/${snapshotBody.id}`,
  );
  expect(denied.status()).toBe(404);
  await foreignContext.close();
});

test("exports a v8 archive and restores it through Go", async ({ page }) => {
  const session = await signUp(page, "go-portability-owner");
  await createAccount(page, session, "Portable savings");
  await enableCurrency(page, session, "USD");
  expect(
    (
      await mutation(page, session, "POST", "/exchange-rates", {
        baseCurrency: "USD",
        quoteCurrency: "KES",
        rate: "2.125",
        effectiveDate: "2026-06-01",
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await mutation(page, session, "POST", "/accounts", {
        idempotencyKey: randomUUID(),
        name: "Later foreign brokerage",
        categoryId: await firstCategoryId(page),
        currency: "USD",
        trackingMode: "positions",
        openingValueMinor: "123456",
        isIncludedInNetWorth: true,
        openedAt: "2026-06-01",
      })
    ).status(),
  ).toBe(201);
  const exported = await page.request.get("/api/v1/exports/user");
  expect(exported.ok()).toBeTruthy();
  expect(exported.headers()["cache-control"]).toContain("no-store");
  const archive = await exported.json();
  expect(archive).toEqual(
    expect.objectContaining({ format: "wealthboard-user-json", version: 8 }),
  );
  const restored = await mutation(
    page,
    session,
    "POST",
    "/restore/user",
    archive,
  );
  expect(restored.ok()).toBeTruthy();
  expect((await restored.json()).accounts).toBe(2);

  const dashboardResponse = await page.request.get(
    "/api/v1/dashboard?range=all",
  );
  expect(dashboardResponse.ok()).toBeTruthy();
  const dashboard =
    (await dashboardResponse.json()) as components["schemas"]["Dashboard"];
  expect(dashboard.currentComplete).toBe(true);
  expect(dashboard.historicalComplete).toBe(true);
  expect(dashboard.totals.netWorth).toBe("262344");
  expect(dashboard.periodChanges.allTime).toBe("262344");
  expect(dashboard.history[0]).toEqual(
    expect.objectContaining({
      date: "2026-01-01T23:59:59Z",
      netWorthMinor: "0",
      complete: true,
      missingCurrencies: [],
    }),
  );

  await page.goto("/?range=all");
  await expect(
    page.getByRole("group", { name: "All time net worth change" }),
  ).toContainText("KES 2,623.44");
  await expect(page.getByText("Incomplete data", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Incomplete history:/)).toHaveCount(0);
});

test("restores position management, base-currency value, and private account history", async ({
  page,
  browser,
}, testInfo) => {
  const session = await signUp(page, "go-positions-owner");
  await enableCurrency(page, session, "USD");
  expect(
    (
      await mutation(page, session, "POST", "/exchange-rates", {
        baseCurrency: "USD",
        quoteCurrency: "KES",
        rate: "2",
        effectiveDate: "2026-01-01",
      })
    ).status(),
  ).toBe(201);
  const createdAccount = await mutation(page, session, "POST", "/accounts", {
    idempotencyKey: randomUUID(),
    name: "History brokerage",
    categoryId: await firstCategoryId(page),
    currency: "USD",
    trackingMode: "positions",
    openingValueMinor: "10000",
    isIncludedInNetWorth: true,
    openedAt: "2026-01-01",
  });
  expect(createdAccount.status()).toBe(201);
  const accountId = ((await createdAccount.json()) as { id: string }).id;
  const instrumentIds: string[] = [];
  for (const [name, symbol, price] of [
    ["Example World ETF", "EWLD", "20.12345"],
    ["Second Income Fund", "SINC", "10"],
  ]) {
    const created = await mutation(page, session, "POST", "/instruments", {
      name,
      symbol,
      identifierType: "custom",
      identifier: symbol,
      assetType: "etf",
      quoteCurrency: "USD",
    });
    expect(created.status()).toBe(201);
    const instrumentId = ((await created.json()) as { id: string }).id;
    instrumentIds.push(instrumentId);
    expect(
      (
        await mutation(page, session, "PUT", "/security-prices", {
          instrumentId,
          price,
          effectiveDate: "2026-01-01",
          source: "fictional statement",
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.goto(`/accounts/${accountId}`);
  await expect(page.getByText(/No positions recorded/)).toBeVisible();
  await page.getByRole("link", { name: "Add holding", exact: true }).click();
  await expect(page.getByLabel("Event type")).toHaveValue("opening_position");
  await page
    .getByLabel("Instrument", { exact: true })
    .selectOption(instrumentIds[0]);
  await expect(page.getByLabel("Trade currency")).toHaveValue("USD");
  await page.getByLabel("Quantity", { exact: true }).fill("1.25");
  await page.getByLabel("Trade date", { exact: true }).fill("2026-01-05");
  const openingResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/position-events") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Record position event" }).click();
  const opening = await openingResponse;
  expect(opening.status()).toBe(201);
  const eventId = ((await opening.json()) as { id: string }).id;
  await expect(page).toHaveURL(`${origin}/accounts/${accountId}`);
  await expect(
    page.getByRole("table", { name: "Current positions" }),
  ).toBeVisible();
  expect(
    (
      await mutation(page, session, "POST", "/position-events", {
        accountId,
        instrumentId: instrumentIds[1],
        type: "opening_position",
        quantity: "2",
        tradeDate: "2026-01-06",
        idempotencyKey: randomUUID(),
      })
    ).status(),
  ).toBe(201);
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Current value metric" }),
  ).toContainText("USD 145.15");
  await expect(
    page.getByRole("group", { name: "Base-currency value metric" }),
  ).toContainText("KES 290.30");
  await expect(
    page.getByRole("group", { name: "Positions metric" }),
  ).toHaveCount(0);

  await page
    .getByRole("link", { name: "Update Second Income Fund price" })
    .click();
  await expect(page).toHaveURL(new RegExp(`instrumentId=${instrumentIds[1]}`));
  await page.getByLabel("Price (USD)").fill("12.345678901");
  await page.getByLabel("Effective date", { exact: true }).fill("2026-09-20");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page).toHaveURL(`${origin}/accounts/${accountId}`);
  await page.reload();
  await expect(
    page.getByRole("row", { name: /Second Income Fund/ }),
  ).toContainText("USD 12.345678901");
  await expect(
    page.getByRole("row", { name: /Second Income Fund/ }),
  ).toContainText("USD 24.69");
  await expect(
    page.getByRole("group", { name: "Base-currency value metric" }),
  ).toContainText("KES 299.68");
  await page
    .getByRole("link", { name: /^Edit Opening Position for Example World ETF/ })
    .click();
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue(
    "1.25",
  );
  await page.getByLabel("Quantity", { exact: true }).fill("1.5");
  await page.getByRole("button", { name: "Update position event" }).click();
  await expect(page).toHaveURL(`${origin}/accounts/${accountId}`);
  await page.reload();
  await expect(
    page.getByRole("row", { name: /Example World ETF/ }),
  ).toContainText("USD 30.19");
  await expect(
    page.getByRole("group", { name: "Base-currency value metric" }),
  ).toContainText("KES 309.76");

  await page.getByRole("button", { name: "Hide financial values" }).click();
  const positions = page.getByRole("table", { name: "Current positions" });
  await expect(positions).not.toContainText("20.12345");
  await expect(positions).not.toContainText("12.345678901");
  await expect(
    page.getByRole("list", { name: "Investment activity history" }),
  ).not.toContainText("12.345678901");
  await page.getByRole("button", { name: "Show financial values" }).click();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    if (width === 360 || width === 1440) {
      await page.screenshot({
        path: testInfo.outputPath(`positions-${width}.png`),
        fullPage: true,
      });
    }
  }

  expect(
    (
      await mutation(page, session, "POST", "/position-events", {
        accountId,
        instrumentId: instrumentIds[0],
        type: "buy",
        quantity: "0.25",
        unitPrice: "20.12345",
        tradeCurrency: "USD",
        tradeDate: "2026-01-07",
        idempotencyKey: randomUUID(),
      })
    ).status(),
  ).toBe(201);
  for (let index = 0; index < 26; index += 1) {
    expect(
      (
        await mutation(page, session, "POST", "/transactions", {
          idempotencyKey: randomUUID(),
          accountId,
          type: "deposit",
          amountMinor: "1",
          transactionDate: "2026-01-02",
          description: `Earlier cash entry ${index + 1}`,
        })
      ).status(),
    ).toBe(201);
  }
  const historyResponse = await page.request.get(
    `/api/v1/accounts/${accountId}/activity?limit=100`,
  );
  expect(historyResponse.ok()).toBeTruthy();
  const history =
    (await historyResponse.json()) as components["schemas"]["ActivityPage"];
  expect(history.items.filter((item) => item.kind === "price")).toHaveLength(3);
  expect(history.items.filter((item) => item.kind === "position")).toHaveLength(
    3,
  );
  await page.reload();
  const pagination = page.getByRole("navigation", {
    name: "Investment activity pagination",
  });
  await pagination.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/activityPage=2/);
  await expect(
    page
      .getByRole("list", { name: "Investment activity history" })
      .getByText("Opening Balance", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(pagination).toContainText("Page 2");

  const foreignContext = await browser.newContext();
  try {
    const foreign = await signUpInContext(
      foreignContext,
      "go-positions-foreign",
    );
    const foreignAccountId = await createAccount(
      foreign.page,
      foreign.session,
      "Foreign savings",
    );
    for (const path of [
      `/accounts/${accountId}/analytics`,
      `/accounts/${accountId}/activity`,
      `/accounts/${accountId}/position-events/${eventId}`,
      `/accounts/${foreignAccountId}/position-events/${eventId}`,
    ]) {
      expect((await foreign.page.request.get(`/api/v1${path}`)).status()).toBe(
        404,
      );
    }
  } finally {
    await foreignContext.close();
  }
});

test("extracts redacted text and rejects unsafe AI provider endpoints", async ({
  page,
}) => {
  const session = await signUp(page, "go-ai-owner");
  const settingsInput = {
    provider: "custom",
    baseUrl: "http://127.0.0.1:4200/v1",
    model: "fixture-import-model",
    includeExactAmounts: false,
    includeAccountNames: false,
    monthlyTokenLimit: 100000,
    maxOutputTokens: 4000,
  };
  const settingsResponse = await mutation(
    page,
    session,
    "PUT",
    "/ai/settings",
    settingsInput,
  );
  expect(settingsResponse.status()).toBe(422);
  expect(await settingsResponse.json()).toEqual(
    expect.objectContaining({
      detail: expect.stringContaining("private or local address"),
    }),
  );

  const extracted = await page.request.post("/api/v1/ai/import/extract", {
    headers: { Origin: origin, "X-CSRF-Token": session.csrfToken },
    multipart: {
      file: {
        name: "statement.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "id,type,amount,date,currency,reference\nfixture-deposit-1,deposit,24.00,2025-01-02,KES,PRIVATE_REFERENCE",
        ),
      },
    },
  });
  expect(extracted.ok()).toBeTruthy();
  const source = (await extracted.json()).source;
  expect(JSON.stringify(source)).toContain("PRIVATE_REFERENCE");
  source.units = source.units.map((unit: { text: string }) => ({
    ...unit,
    text: unit.text.replaceAll("PRIVATE_REFERENCE", ""),
  }));
  expect(JSON.stringify(source)).not.toContain("PRIVATE_REFERENCE");
});

test("registers the built service worker and blocks offline financial mutations", async ({
  context,
  page,
}) => {
  const session = await signUp(page, "go-pwa-owner");
  const accountId = await createAccount(page, session, "Offline import");
  await page.goto(`/accounts/${accountId}/import`);
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    )
    .toBeGreaterThan(0);
  await page
    .getByLabel("Import file")
    .first()
    .setInputFiles({
      name: "offline.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "external_id,type,amount,date\noffline-1,deposit,10.00,2026-04-01",
      ),
    });
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("history-import/preview")) requests += 1;
  });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(
    page.getByText(/Offline.*financial changes are unavailable/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).first().click();
  expect(requests).toBe(0);
  await context.setOffline(false);
});
