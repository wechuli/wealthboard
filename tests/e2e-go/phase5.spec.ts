import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import type { components } from "../../web/src/api/schema";
import { docxDocument, pdfDocument, xlsxWorkbook } from "./document-fixtures";

const origin = `http://127.0.0.1:${process.env.E2E_GO_PORT || 3200}`;

// Matches one rendered amount; the code and amount are separated by CSS spacing, not a text space.
function money(code: string, amount: string) {
  return new RegExp(
    `^[+\u2212-]?${code}\\s*${amount.replace(/[.,]/g, "\\$&")}$`,
  );
}

async function expectMoney(scope: Locator, code: string, amount: string) {
  await expect(scope.getByText(money(code, amount)).first()).toBeVisible();
}
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
  await expect(
    page.getByRole("heading", { level: 1, name: `Welcome, ${username}` }),
  ).toBeVisible();
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
  const netWorth = page.getByRole("region", { name: "Net worth" });
  await expectMoney(netWorth, "KES", "2,623.44");
  await expect(
    netWorth.getByRole("radio", { name: "All time", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expectMoney(
    netWorth.getByRole("listitem").filter({ hasText: "All time" }),
    "KES",
    "2,623.44",
  );
  await netWorth.getByRole("button", { name: "View as table" }).click();
  const historyTable = netWorth.getByRole("table", {
    name: /^Net worth history/,
  });
  await expectMoney(historyTable, "KES", "0.00");
  await expectMoney(historyTable, "KES", "2,623.44");
  await expect(historyTable).not.toContainText("Incomplete");
  await expect(netWorth.getByText(/^Incomplete/)).toHaveCount(0);
  await expect(page.getByText(/Incomplete:/)).toHaveCount(0);
  await expect(
    page.getByText("Dashed where values are incomplete"),
  ).toHaveCount(0);
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
  const holdingsCard = page.getByRole("region", { name: "Holdings" });
  await expect(holdingsCard.getByText("No holdings yet")).toBeVisible();
  await holdingsCard
    .getByRole("button", { name: "Add holding", exact: true })
    .click();
  const tradeSheet = page.getByRole("dialog", {
    name: "Record position activity",
  });
  await expect(tradeSheet).toBeVisible();
  await expect(
    tradeSheet.getByRole("radio", { name: "Opening", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await tradeSheet
    .getByLabel("Instrument", { exact: true })
    .selectOption(instrumentIds[0]);
  await expect(tradeSheet.getByLabel("Trade currency")).toHaveValue("USD");
  await tradeSheet.getByLabel("Quantity", { exact: true }).fill("1.25");
  await tradeSheet.getByLabel("Trade date", { exact: true }).fill("2026-01-05");
  const openingResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/position-events") &&
      response.request().method() === "POST",
  );
  await tradeSheet.getByRole("button", { name: "Record", exact: true }).click();
  const opening = await openingResponse;
  expect(opening.status()).toBe(201);
  const eventId = ((await opening.json()) as { id: string }).id;
  await expect(tradeSheet).toBeHidden();
  await expect(page).toHaveURL(`${origin}/accounts/${accountId}`);
  const holdings = page.getByRole("table", {
    name: /^Holdings in History brokerage/,
  });
  await expect(holdings).toBeVisible();
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
  const valueHero = page.getByRole("region", {
    name: "History brokerage value",
  });
  await expectMoney(valueHero, "USD", "145.15");
  await expectMoney(valueHero, "KES", "290.30");
  await expectMoney(valueHero, "USD", "45.15");
  await expectMoney(valueHero, "USD", "100.00");

  await holdings.getByRole("button", { name: "Actions for SINC" }).click();
  await page.getByRole("menuitem", { name: "Update price" }).click();
  const priceSheet = page.getByRole("dialog", { name: /Update a price/ });
  await expect(priceSheet).toBeVisible();
  await expect(
    priceSheet.getByLabel("Instrument", { exact: true }),
  ).toHaveValue(instrumentIds[1]);
  await priceSheet.getByLabel("Unit price").fill("12.345678901");
  await expect(priceSheet.getByLabel("Unit price")).toHaveValue("12.345678901");
  await priceSheet.getByLabel("Price date").fill("2026-09-20");
  const priceResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/security-prices") &&
      response.request().method() === "PUT",
  );
  await priceSheet.getByRole("button", { name: "Save price" }).click();
  expect((await priceResponse).ok()).toBeTruthy();
  await expect(priceSheet).toBeHidden();
  await page.reload();
  await expectMoney(
    holdings.getByRole("row", { name: /Second Income Fund/ }),
    "USD",
    "12.345678901",
  );
  await expectMoney(
    holdings.getByRole("row", { name: /Second Income Fund/ }),
    "USD",
    "24.69",
  );
  await expectMoney(valueHero, "KES", "299.68");

  const activityFeed = page.getByRole("region", {
    name: "Trades, prices, and cash",
  });
  await activityFeed
    .getByRole("button", {
      name: "Actions for opening position of EWLD on 2026-01-05",
    })
    .click();
  await page.getByRole("menuitem", { name: "Edit trade" }).click();
  const editSheet = page.getByRole("dialog", { name: "Edit trade" });
  await expect(editSheet.getByLabel("Quantity", { exact: true })).toHaveValue(
    "1.25",
  );
  await editSheet.getByLabel("Quantity", { exact: true }).fill("1.5");
  const editResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/position-events/${eventId}`) &&
      response.request().method() !== "GET",
  );
  await editSheet.getByRole("button", { name: "Save and replay" }).click();
  expect((await editResponse).ok()).toBeTruthy();
  await expect(editSheet).toBeHidden();
  await page.reload();
  await expectMoney(
    holdings.getByRole("row", { name: /Example World ETF/ }),
    "USD",
    "30.19",
  );
  await expectMoney(valueHero, "KES", "309.76");
  await expectMoney(valueHero, "USD", "154.88");

  await page.getByRole("button", { name: "Hide values" }).click();
  await expect(
    page.getByRole("button", { name: "Show values" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const exact of ["20.12345", "12.345678901", "30.19", "24.69"])
    await expect(holdings).not.toContainText(exact);
  for (const exact of ["154.88", "309.76", "54.88"])
    await expect(valueHero).not.toContainText(exact);
  await expect(activityFeed).not.toContainText("12.345678901");
  await expect(activityFeed).not.toContainText("20.12345");
  await expect(activityFeed).not.toContainText("100.00");
  await expect(holdings.getByLabel("Hidden value").first()).toBeVisible();
  await page.getByRole("button", { name: "Show values" }).click();
  await expectMoney(holdings, "USD", "30.19");
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
  expect(history.items).toHaveLength(33);
  await page.reload();
  const feedItems = activityFeed.getByRole("listitem");
  const openingBalance = activityFeed.getByText("Opening balance", {
    exact: true,
  });
  await expect(feedItems).toHaveCount(15);
  await expect(openingBalance).toHaveCount(0);
  await expect(
    activityFeed.getByText("Earlier cash entry", { exact: false }),
  ).toHaveCount(11);
  const loadMore = activityFeed.getByRole("button", { name: "Load more" });
  await loadMore.click();
  await expect(feedItems).toHaveCount(30);
  await expect(openingBalance).toHaveCount(0);
  await loadMore.click();
  await expect(feedItems).toHaveCount(33);
  await expect(openingBalance).toBeVisible();
  await expect(
    activityFeed.getByText("That's everything since the account was opened."),
  ).toBeVisible();
  await expect(loadMore).toHaveCount(0);

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
      `/accounts/${accountId}/extras`,
      `/instruments/${instrumentIds[0]}/holdings`,
      `/activity?accountId=${accountId}`,
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

test("rejects unsupported AI providers and server-side source extraction", async ({
  page,
}) => {
  const session = await signUp(page, "go-ai-owner");
  const settingsInput = {
    model: "fixture-import-model",
    includeExactAmounts: false,
    includeAccountNames: false,
    monthlyTokenLimit: 100000,
    maxOutputTokens: 4000,
  };
  const custom = await mutation(page, session, "PUT", "/ai/settings", {
    ...settingsInput,
    provider: "custom",
  });
  expect(custom.status()).toBe(422);
  expect(await custom.json()).toEqual(
    expect.objectContaining({
      detail: expect.stringContaining("choose OpenAI, Anthropic, or DeepSeek"),
    }),
  );
  const endpoint = await mutation(page, session, "PUT", "/ai/settings", {
    ...settingsInput,
    provider: "openai",
    baseUrl: "http://127.0.0.1:4200/v1",
  });
  expect(endpoint.status()).toBe(400);

  const extracted = await page.request.post("/api/v1/ai/import/extract", {
    headers: { Origin: origin, "X-CSRF-Token": session.csrfToken },
    multipart: {
      file: {
        name: "statement.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("id,amount\nfixture-1,24.00"),
      },
    },
  });
  expect(extracted.status()).toBe(404);
});

test("extracts PDF, protected PDF, XLSX, DOCX, and CSV sources in the browser", async ({
  page,
}) => {
  const session = await signUp(page, "go-ai-extract-owner");
  const accountId = await createAccount(page, session, "Browser extraction");
  const uploads: string[] = [];
  page.on("request", (request) => {
    const body = request.postDataBuffer();
    if (
      request.url().includes("/ai/import/extract") ||
      body?.includes("FIXTURE_SOURCE_TEXT") ||
      body?.includes("fictional-pdf-unlock")
    )
      uploads.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`/accounts/${accountId}/import`);
  await page.getByRole("tab", { name: "Convert with AI" }).click();
  await expect(page).toHaveURL(/[?&]tab=ai/);
  await expect(
    page.getByRole("heading", { name: "Convert a statement with AI" }),
  ).toBeVisible();

  const sourceFile = page.getByLabel("Source file");
  const extractButton = page.getByRole("button", { name: "Read file" });
  const firstUnit = page.getByLabel("Text to send for source-1");
  const discard = page.getByRole("button", { name: "Choose another file" });
  const extract = async (
    file: { name: string; mimeType: string; buffer: Buffer },
    expected: RegExp,
    documentPassword?: string,
  ) => {
    await sourceFile.setInputFiles(file);
    if (documentPassword !== undefined)
      await page
        .getByLabel("PDF password (if required)")
        .fill(documentPassword);
    await extractButton.click();
    await expect(firstUnit).toHaveValue(expected);
    await expect(page.getByText(file.name, { exact: true })).toBeVisible();
    await discard.click();
    await expect(firstUnit).toBeHidden();
    await expect(sourceFile).toBeVisible();
  };

  await extract(
    {
      name: "statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,description\nfixture-1,FIXTURE_SOURCE_TEXT csv"),
    },
    /\["id","description"\]/,
  );
  await extract(
    {
      name: "statement.pdf",
      mimeType: "application/pdf",
      buffer: pdfDocument(["FIXTURE_SOURCE_TEXT pdf deposit 24.00"]),
    },
    /FIXTURE_SOURCE_TEXT pdf deposit 24\.00/,
  );
  await extract(
    {
      name: "activity.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsxWorkbook([["FIXTURE_SOURCE_TEXT xlsx", "24.00"]]),
    },
    /Excel date system: 1900/,
  );
  await expect(page.getByLabel("Text to send for source-2")).toBeHidden();
  await extract(
    {
      name: "statement.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docxDocument(["FIXTURE_SOURCE_TEXT docx deposit 24.00"]),
    },
    /FIXTURE_SOURCE_TEXT docx deposit 24\.00/,
  );

  const protectedPdf = {
    name: "protected.pdf",
    mimeType: "application/pdf",
    buffer: pdfDocument(["FIXTURE_SOURCE_TEXT protected deposit 24.00"], {
      userPassword: "fictional-pdf-unlock",
      ownerPassword: "fictional-pdf-owner",
    }),
  };
  await sourceFile.setInputFiles(protectedPdf);
  await extractButton.click();
  await expect(page.getByRole("alert")).toContainText(
    "This PDF requires a password",
  );
  const passwordField = page.getByLabel("PDF password (if required)");
  await expect(passwordField).toBeFocused();
  await passwordField.fill("wrong-fixture-password");
  await extractButton.click();
  await expect(page.getByRole("alert")).toContainText(
    "The PDF password is incorrect",
  );
  await expect(passwordField).toHaveValue("");
  await passwordField.fill("fictional-pdf-unlock");
  await extractButton.click();
  await expect(firstUnit).toHaveValue(
    /FIXTURE_SOURCE_TEXT protected deposit 24\.00/,
  );

  expect(uploads).toEqual([]);
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
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { level: 1, name: "Import history" }),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => (await fetch("/api/v1/dashboard")).status),
  ).toBe(200);
  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls;
  });
  expect(cachedUrls.some((url) => url.endsWith("/offline.html"))).toBe(true);
  expect(
    cachedUrls.filter((url) => new URL(url).pathname.startsWith("/api")),
  ).toEqual([]);

  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("history-import/preview")) requests += 1;
  });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(
    page.getByRole("status").filter({ hasText: "You're offline." }),
  ).toBeVisible();
  await page.getByLabel(/Drop a CSV or JSON file here/).setInputFiles({
    name: "offline.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "external_id,type,amount,date,description,notes\noffline-1,deposit,10.00,2026-04-01,,",
    ),
  });
  await expect(page.getByRole("alert")).toContainText(
    "You're offline. Changes need a connection to the server.",
  );
  expect(requests).toBe(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("status").filter({ hasText: "You're offline." }),
  ).toHaveCount(0);
  const preview = page.waitForResponse((response) =>
    response.url().includes("history-import/preview"),
  );
  await page.getByLabel(/Drop a CSV or JSON file here/).setInputFiles({
    name: "online.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "external_id,type,amount,date,description,notes\nonline-1,deposit,10.00,2026-04-01,,",
    ),
  });
  const previewResponse = await preview;
  expect(previewResponse.ok(), `${previewResponse.status()} ${await previewResponse.text()}`).toBeTruthy();
  // The offline attempt must not be queued and replayed after reconnecting.
  expect(requests).toBe(1);
});

test("serves a service worker that never caches the API", async ({
  request,
}) => {
  const response = await request.get("/sw.js");
  expect(response.ok()).toBeTruthy();
  const source = await response.text();
  expect(source).toContain('if (event.request.method !== "GET") return;');
  expect(source).toMatch(
    /url\.origin !== self\.location\.origin \|\| url\.pathname\.startsWith\("\/api"\)\)\s*return;/,
  );
  expect(source).not.toMatch(/addEventListener\(\s*["'](periodic)?sync["']/);
  expect(source).not.toMatch(/\/api\//);
});

test("scopes the new read models to the signed-in user", async ({
  browser,
  page,
}) => {
  const owner = await signUp(page, "go-insights-owner");
  await enableCurrency(page, owner, "USD");
  const ownerAccountId = await createAccount(
    page,
    owner,
    "Owner Kilimanjaro brokerage",
    "positions",
  );
  const ownerUsdAccount = await mutation(page, owner, "POST", "/accounts", {
    idempotencyKey: randomUUID(),
    name: "Owner unrated dollars",
    categoryId: await firstCategoryId(page),
    currency: "USD",
    trackingMode: "balance",
    openingValueMinor: "5000",
    isIncludedInNetWorth: true,
    openedAt: "2026-01-01",
  });
  expect(ownerUsdAccount.status()).toBe(201);
  const ownerUsdAccountId = ((await ownerUsdAccount.json()) as { id: string })
    .id;
  const instrument = await mutation(page, owner, "POST", "/instruments", {
    name: "Owner Savannah Fund",
    symbol: "OSAV",
    identifierType: "custom",
    identifier: "OSAV-E2E",
    assetType: "fund",
    quoteCurrency: "KES",
  });
  expect(instrument.status()).toBe(201);
  const instrumentId = ((await instrument.json()) as { id: string }).id;
  expect(
    (
      await mutation(page, owner, "PUT", "/security-prices", {
        instrumentId,
        price: "12.5",
        effectiveDate: "2026-01-01",
        source: "fictional statement",
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await mutation(page, owner, "POST", "/position-events", {
        accountId: ownerAccountId,
        instrumentId,
        type: "opening_position",
        quantity: "4",
        tradeDate: "2026-01-02",
        idempotencyKey: randomUUID(),
      })
    ).status(),
  ).toBe(201);
  const ownerAccounts = [ownerAccountId, ownerUsdAccountId];
  const ownerSecrets = [
    ownerAccountId,
    ownerUsdAccountId,
    instrumentId,
    "Owner Kilimanjaro brokerage",
    "Owner unrated dollars",
    "Owner Savannah Fund",
  ];

  const extras = await page.request.get(
    `/api/v1/accounts/${ownerAccountId}/extras`,
  );
  expect(extras.status()).toBe(200);
  expect(await extras.json()).toEqual(
    expect.objectContaining({
      accountId: ownerAccountId,
      weights: [expect.objectContaining({ instrumentId, symbol: "OSAV" })],
    }),
  );
  const holdings = await page.request.get(
    `/api/v1/instruments/${instrumentId}/holdings`,
  );
  expect(holdings.status()).toBe(200);
  expect(await holdings.json()).toEqual(
    expect.objectContaining({
      instrumentId,
      holdings: [
        expect.objectContaining({
          accountId: ownerAccountId,
          accountName: "Owner Kilimanjaro brokerage",
          quantity: "4",
          valueMinor: "5000",
        }),
      ],
    }),
  );
  const ownerSummaries = (await (
    await page.request.get("/api/v1/accounts/summaries")
  ).json()) as components["schemas"]["AccountSummary"][];
  expect(ownerSummaries.map((summary) => summary.accountId).sort()).toEqual(
    [...ownerAccounts].sort(),
  );
  const ownerActivity = (await (
    await page.request.get("/api/v1/activity?limit=100")
  ).json()) as components["schemas"]["ActivityPage"];
  expect(ownerActivity.items.length).toBeGreaterThan(0);
  for (const item of ownerActivity.items)
    expect(ownerAccounts).toContain(item.accountId);
  const ownerAttention = (await (
    await page.request.get("/api/v1/attention")
  ).json()) as components["schemas"]["AttentionSummary"];
  expect(ownerAttention.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "missing_rate",
        accountIds: [ownerUsdAccountId],
      }),
    ]),
  );

  const foreignContext = await browser.newContext();
  try {
    const foreign = await signUpInContext(
      foreignContext,
      "go-insights-foreign",
    );
    const foreignAccountId = await createAccount(
      foreign.page,
      foreign.session,
      "Foreign Baobab savings",
    );
    for (const path of [
      `/accounts/${ownerAccountId}/extras`,
      `/accounts/${ownerUsdAccountId}/extras`,
      `/instruments/${instrumentId}/holdings`,
      `/activity?accountId=${ownerAccountId}`,
    ]) {
      const denied = await foreign.page.request.get(`/api/v1${path}`);
      expect(denied.status(), path).toBe(404);
      const body = await denied.text();
      for (const secret of ownerSecrets.slice(3))
        expect(body, path).not.toContain(secret);
    }

    const foreignSummaries = await foreign.page.request.get(
      "/api/v1/accounts/summaries",
    );
    expect(foreignSummaries.ok()).toBeTruthy();
    expect(
      (
        (await foreignSummaries.json()) as components["schemas"]["AccountSummary"][]
      ).map((summary) => summary.accountId),
    ).toEqual([foreignAccountId]);
    const foreignActivity = await foreign.page.request.get(
      "/api/v1/activity?limit=100",
    );
    expect(foreignActivity.ok()).toBeTruthy();
    const foreignItems = (
      (await foreignActivity.json()) as components["schemas"]["ActivityPage"]
    ).items;
    expect(foreignItems.length).toBeGreaterThan(0);
    for (const item of foreignItems)
      expect(item.accountId).toBe(foreignAccountId);
    const foreignAttention =
      await foreign.page.request.get("/api/v1/attention");
    expect(foreignAttention.ok()).toBeTruthy();
    for (const item of (
      (await foreignAttention.json()) as components["schemas"]["AttentionSummary"]
    ).items)
      for (const accountId of item.accountIds)
        expect(accountId).toBe(foreignAccountId);

    for (const path of [
      "/accounts/summaries",
      "/activity?limit=100",
      "/activity?q=Owner",
      "/attention",
      "/reports/flows?range=all",
      "/reports/income?range=all",
      "/reports/net-worth-stats",
      "/reports/account-comparison?range=all",
    ]) {
      const response = await foreign.page.request.get(`/api/v1${path}`);
      expect(response.ok(), path).toBeTruthy();
      const body = await response.text();
      for (const secret of ownerSecrets)
        expect(body, path).not.toContain(secret);
    }
  } finally {
    await foreignContext.close();
  }
});

test("shows no stale data after signing out and signing in as another user", async ({
  browser,
  page,
}) => {
  const first = await signUp(page, "go-switch-first");
  await createAccount(page, first, "Zanzibar spice reserve");
  const secondContext = await browser.newContext();
  try {
    const second = await signUpInContext(secondContext, "go-switch-second");
    await createAccount(second.page, second.session, "Baobab savings");
  } finally {
    await secondContext.close();
  }

  const main = page.getByRole("navigation", { name: "Main" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /go-switch-first$/ }),
  ).toBeVisible();
  await main.getByRole("link", { name: "Accounts" }).click();
  await expect(
    page.getByText("Zanzibar spice reserve", { exact: true }).first(),
  ).toBeVisible();
  await main.getByRole("link", { name: "Activity" }).click();
  await expect(
    page
      .getByRole("region", { name: "Ledger" })
      .getByText("Zanzibar spice reserve")
      .first(),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Profile menu for go-switch-first" })
    .click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in(\?|$)/);
  expect((await page.request.get("/api/v1/accounts")).status()).toBe(401);

  await page
    .getByRole("textbox", { name: "Username" })
    .fill("go-switch-second");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Profile menu for go-switch-second" }),
  ).toBeVisible();
  await expect(page.getByText("Zanzibar spice reserve")).toHaveCount(0);
  await main.getByRole("link", { name: "Home" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /go-switch-second$/ }),
  ).toBeVisible();
  await expect(page.getByText("Zanzibar spice reserve")).toHaveCount(0);
  await main.getByRole("link", { name: "Accounts" }).click();
  await expect(
    page.getByText("Baobab savings", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Zanzibar spice reserve")).toHaveCount(0);
  await main.getByRole("link", { name: "Activity" }).click();
  await expect(
    page
      .getByRole("region", { name: "Ledger" })
      .getByText("Baobab savings")
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Zanzibar spice reserve")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  await page.keyboard.type("savings");
  await expect(palette.getByText("Baobab savings")).toBeVisible();
  await expect(palette.getByText("Zanzibar spice reserve")).toHaveCount(0);
});

test("redirects legacy URLs to the redesigned routes", async ({
  browser,
  page,
}) => {
  const anonymous = await browser.newContext();
  try {
    const signedOut = await anonymous.newPage();
    await signedOut.goto("/login?next=%2Faccounts");
    await expect(signedOut).toHaveURL(`${origin}/sign-in?next=%2Faccounts`);
    await expect(
      signedOut.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await signedOut.goto("/signup");
    await expect(signedOut).toHaveURL(`${origin}/sign-up`);
    await signedOut.goto("/transactions");
    await expect(signedOut).toHaveURL(/\/sign-in\?next=/);
  } finally {
    await anonymous.close();
  }

  const session = await signUp(page, "go-legacy-owner");
  const accountId = await createAccount(page, session, "Legacy cash");
  expect(
    (
      await mutation(page, session, "POST", `/accounts/${accountId}/archive`, {
        archived: true,
      })
    ).ok(),
  ).toBeTruthy();

  await page.goto("/transactions");
  await expect(page).toHaveURL(`${origin}/activity`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Activity" }),
  ).toBeVisible();

  await page.goto("/reports");
  await expect(page).toHaveURL(`${origin}/insights/net-worth`);

  await page.goto("/accounts/archived");
  await expect(page).toHaveURL(`${origin}/accounts?show=archived`);
  await expect(
    page.getByText("Legacy cash", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/goals/new");
  await expect(page).toHaveURL(`${origin}/goals`);
  const quickAdd = page.getByRole("dialog", { name: /Create a goal/ });
  await expect(quickAdd).toBeVisible();
  await expect(quickAdd.getByLabel("Goal name")).toBeVisible();
  await expect(quickAdd.getByLabel("Target amount")).toBeVisible();
  await expect(
    quickAdd.getByRole("button", { name: "Create goal" }),
  ).toBeVisible();
});
