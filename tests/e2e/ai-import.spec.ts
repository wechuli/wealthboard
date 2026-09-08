import { expect, test, type Page } from "@playwright/test";
import {
  encryptedPdfFixture,
  pdfFixture,
  spreadsheetFixture,
  wordFixture,
} from "../fixtures/import-documents";

async function signUp(page: Page, username: string) {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Display name").fill("Import Example");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-import-password");
  await page.getByLabel("Confirm password").fill("fictional-import-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

test("converts text sources with a saved key, then previews and confirms each account mode", async ({
  page,
  browser,
}, testInfo) => {
  await signUp(page, "ai-import-alice");
  await page.goto("/settings");
  await page.getByLabel("Provider", { exact: true }).selectOption("custom");
  await page.getByLabel("Model identifier").fill("fixture-import-model");
  await page.getByLabel("API endpoint").fill("http://127.0.0.1:4200/v1");
  await page.getByLabel("API key", { exact: true }).fill("fixture-import-key");
  await page.getByLabel("Encrypt and remember this key").check();
  const monthlyTokenLimit = page.getByLabel("Monthly token limit");
  await expect(monthlyTokenLimit).toHaveAttribute("max", "100000000");
  await monthlyTokenLimit.fill("100000001");
  expect(
    await monthlyTokenLimit.evaluate(
      (element: HTMLInputElement) => element.validity.rangeOverflow,
    ),
  ).toBe(true);
  await monthlyTokenLimit.fill("100000000");
  expect(
    await monthlyTokenLimit.evaluate((element: HTMLInputElement) =>
      element.checkValidity(),
    ),
  ).toBe(true);
  await page.getByLabel("Maximum output tokens").fill("4000");
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await expect(page.getByLabel(/Keep encrypted credential/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Keep encrypted credential/)).toBeChecked();
  await expect(monthlyTokenLimit).toHaveValue("100000000");

  let balanceId = "";
  for (const mode of ["balance", "positions"]) {
    await page.goto("/accounts/new");
    await page.getByLabel("Account or asset name").fill(`AI import ${mode}`);
    await page
      .getByLabel("Category")
      .selectOption({ label: mode === "positions" ? "Securities" : "Savings" });
    if (mode === "positions")
      await page.getByLabel("Tracking method").selectOption("positions");
    await page
      .getByLabel(mode === "positions" ? "Opening cash" : "Opening value")
      .fill("100");
    await page.getByLabel("Opened or acquired").fill("2025-01-01");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByRole("heading", { name: `AI import ${mode}` }),
    ).toBeVisible();
    const accountId = new URL(page.url()).pathname.split("/").at(-1)!;
    if (mode === "balance") balanceId = accountId;
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await page.getByRole("radio", { name: "Convert with AI" }).check();
    if (mode === "balance") {
      await page.getByLabel("Source file").setInputFiles({
        name: "protected-statement.pdf",
        mimeType: "application/pdf",
        buffer: await encryptedPdfFixture(" fictional PDF unlock secret ", {
          text: "fixture-deposit-1 deposit 24.00 2025-01-02 KES PRIVATE_REFERENCE",
        }),
      });
      const password = page.getByLabel("PDF password (if required)");
      await expect(password).toHaveAttribute("type", "password");
      await page.getByRole("button", { name: "Extract locally" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "requires a password" }),
      ).toBeVisible();
      await expect(password).toBeFocused();
      await password.fill("incorrect-fictional-password");
      await page.getByRole("button", { name: "Extract locally" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "password is incorrect" }),
      ).toBeVisible();
      await expect(password).toHaveValue("");
      for (const width of [360, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator("main").locator("..")).toHaveCSS(
          "padding-left",
          width < 768 ? "0px" : "256px",
        );
        await expect(password).toBeVisible();
        const bounds = (await password.boundingBox())!;
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.width).toBeGreaterThan(250);
      }
      await page.screenshot({
        path: testInfo.outputPath("pdf-password-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator("main").locator("..")).toHaveCSS(
        "padding-left",
        "0px",
      );
      await page.screenshot({
        path: testInfo.outputPath("pdf-password-mobile.png"),
        fullPage: true,
      });
      await password.fill(" fictional PDF unlock secret ");
      await page.getByRole("button", { name: "Extract locally" }).click();
      await expect(page.getByLabel("Approved text for source-1")).toBeVisible();
      await expect(password).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }),
        ),
      ).not.toContain("fictional PDF unlock secret");
    } else {
      await page.getByLabel("Source file").setInputFiles({
        name: "statement.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "id,type,amount,date,currency,reference\nfixture-deposit-1,deposit,24.00,2025-01-02,KES,PRIVATE_REFERENCE",
        ),
      });
      await expect(page.getByLabel("PDF password (if required)")).toHaveCount(
        0,
      );
      await page.getByRole("button", { name: "Extract locally" }).click();
    }
    const sourceText = page.getByLabel(
      `Approved text for ${mode === "balance" ? "source-1" : "source-2"}`,
    );
    await expect(sourceText).toContainText("PRIVATE_REFERENCE");
    await expect(
      page.getByRole("button", { name: "Convert selected text" }),
    ).toBeDisabled();
    await sourceText.fill(
      '["fixture-deposit-1","deposit","24.00","2025-01-02","KES",""]',
    );
    await page.getByRole("checkbox", { name: /I approve sending/ }).check();
    await page.getByRole("button", { name: "Convert selected text" }).click();
    await expect(page.getByLabel("Canonical JSON draft")).toHaveValue(
      /fixture-deposit-1/,
    );
    const beforeCommit = await page.request
      .get("/api/export/json")
      .then((response) => response.json());
    expect(
      beforeCommit.transactions.filter(
        (transaction: { accountId: string }) =>
          transaction.accountId === accountId,
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ externalId: "fixture-deposit-1" }),
      ]),
    );

    if (mode === "balance") {
      for (const width of [360, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator("main").locator("..")).toHaveCSS(
          "padding-left",
          width < 768 ? "0px" : "256px",
        );
        expect(
          (await page.locator("main").boundingBox())!.width,
        ).toBeGreaterThan(width < 768 ? width - 32 : width - 288);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
      await page.screenshot({
        path: testInfo.outputPath("import-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator("main").locator("..")).toHaveCSS(
        "padding-left",
        "0px",
      );
      await page.screenshot({
        path: testInfo.outputPath("import-mobile.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Hide financial values" }).click();
      await expect(page.getByLabel("Canonical JSON draft")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Reveal financial values" })
        .click();
    }

    await page
      .getByRole("checkbox", { name: /I reviewed the source coverage/ })
      .check();
    await page.getByRole("button", { name: "Use draft for preview" }).click();
    await page.getByRole("button", { name: "Preview file" }).click();
    await page
      .getByRole("button", {
        name: mode === "positions" ? "Confirm atomic import" : "Confirm import",
      })
      .click();
    await expect(
      page.getByText("Import complete.", { exact: false }),
    ).toBeVisible();
    const portfolio = await page.request
      .get("/api/export/json")
      .then((response) => response.json());
    expect(
      portfolio.accounts.find(
        (account: { id: string }) => account.id === accountId,
      ).currentValueMinor,
    ).toBe(12400);

    for (const [name, mimeType, buffer] of [
      ["text.pdf", "application/pdf", pdfFixture()],
      [
        "word.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        await wordFixture(),
      ],
      [
        "table.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        await spreadsheetFixture(),
      ],
    ] as const) {
      const response = await page.request.post(
        `/api/accounts/${accountId}/import/extract`,
        {
          headers: { origin: "http://127.0.0.1:3100" },
          multipart: { file: { name, mimeType, buffer } },
        },
      );
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
  }

  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await signUp(other, "ai-import-bob");
    for (const phase of ["extract", "convert"]) {
      const response = await other.request.post(
        `/api/accounts/${balanceId}/import/${phase}`,
        { headers: { origin: "http://127.0.0.1:3100" }, data: {} },
      );
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain("fixture-import-key");
    }
  } finally {
    await otherContext.close();
  }
});
