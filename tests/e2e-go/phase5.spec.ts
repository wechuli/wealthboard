import { createHash, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
          type: "quantity_adjustment",
          quantity: "10",
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
  const exported = await page.request.get("/api/v1/exports/user");
  expect(exported.ok()).toBeTruthy();
  expect(exported.headers()["cache-control"]).toContain("no-store");
  const archive = await exported.json();
  expect(archive).toEqual(
    expect.objectContaining({ format: "wealthboard-user-export", version: 8 }),
  );
  const restored = await mutation(
    page,
    session,
    "POST",
    "/restore/user",
    archive,
  );
  expect(restored.ok()).toBeTruthy();
  expect((await restored.json()).accounts).toBe(1);
});

test("stores only AI credential metadata and converts redacted extracted text", async ({
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
  expect(settingsResponse.ok()).toBeTruthy();
  const settings = (await settingsResponse.json()) as typeof settingsInput & {
    updatedAt: string;
  };
  const credential = await mutation(page, session, "POST", "/ai/credential", {
    apiKey: "fixture-import-key",
  });
  expect(credential.ok()).toBeTruthy();
  const credentialMetadata = (await credential.json()) as {
    hasStoredApiKey: boolean;
    updatedAt: string;
  };
  expect(credentialMetadata).toEqual(
    expect.objectContaining({ hasStoredApiKey: true }),
  );
  expect(JSON.stringify(credentialMetadata)).not.toContain(
    "fixture-import-key",
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
  const configurationHash = createHash("sha256")
    .update(
      JSON.stringify([
        settings.provider,
        settings.baseUrl,
        settings.model,
        settings.maxOutputTokens,
        credentialMetadata.updatedAt,
        "balance",
        "KES",
      ]),
    )
    .digest("hex");
  const converted = await mutation(
    page,
    session,
    "POST",
    "/ai/import/convert",
    {
      source,
      configurationHash,
      consent: true,
      trackingMode: "balance",
      currency: "KES",
    },
  );
  expect(converted.ok()).toBeTruthy();
  const draft = await converted.json();
  expect(draft.content).toContain("fixture-deposit-1");
  expect(JSON.stringify(draft)).not.toContain("PRIVATE_REFERENCE");
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
  await expect(page.getByText(/Offline\. Changes are blocked/)).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).first().click();
  expect(requests).toBe(0);
  await context.setOffline(false);
});
