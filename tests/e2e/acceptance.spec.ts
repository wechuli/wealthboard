import { expect, test } from "@playwright/test";

test("complete Wealthboard acceptance journey", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill("unknown-user");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup/);
  await page.getByLabel("Username").fill("alice");
  await page.getByLabel("Display name").fill("Alice Example");
  await expect(page.getByLabel("Base currency")).toHaveValue("KES");
  await expect(
    page.getByLabel("Base currency").getByRole("option", { name: /TZS/ }),
  ).toHaveCount(1);
  await page
    .getByLabel("Password", { exact: true })
    .fill("wealthboard-e2e-password");
  await page.getByLabel("Confirm password").fill("different-e2e-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveValue("alice");
  await expect(page.getByLabel("Display name")).toHaveValue("Alice Example");
  await expect(page.getByLabel("Base currency")).toHaveValue("KES");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "wealthboard-e2e-password",
  );
  await expect(page.getByLabel("Confirm password")).toHaveValue(
    "different-e2e-password",
  );
  await page.getByLabel("Confirm password").fill("wealthboard-e2e-password");
  const createAccount = page.getByRole("button", { name: "Create account" });
  await expect(createAccount).toBeEnabled();
  await createAccount.click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Add your first account" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Accounts" }).first().click();
  await page.getByRole("link", { name: "Add account" }).click();
  await page.getByLabel("Account or asset name").fill("KCB Car Fund");
  await page
    .getByLabel("Category")
    .selectOption({ label: "Money Market Fund" });
  await page.getByLabel("Opening value").fill("100000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "KCB Car Fund" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Deposit" }).click();
  await page.getByLabel(/Amount/).fill("20000");
  await page.getByLabel("Date").fill("2025-06-15");
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(
    page.getByRole("heading", { name: "KCB Car Fund" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Interest" }).click();
  await page.getByLabel(/Amount/).fill("500");
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(
    page.getByRole("heading", { name: "KCB Car Fund" }),
  ).toBeVisible();

  await page.goto("/transactions");
  await page.getByLabel("Edit transaction").first().click();
  await page.getByLabel(/Amount/).fill("600");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByRole("heading", { name: "KCB Car Fund" }),
  ).toBeVisible();
  await page.goto("/transactions");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Delete transaction").first().click();
  await expect(page.getByText("Transaction deleted.")).toBeVisible();

  await page.getByLabel("Search transactions").fill("KCB");
  await page
    .getByLabel("Filter by account")
    .selectOption({ label: "KCB Car Fund" });
  await page.getByLabel("Filter by transaction type").selectOption("deposit");
  await page.getByLabel("Filter by amount direction").selectOption("inflow");
  await page.getByLabel("Sort transactions").selectOption("oldest");
  await page.getByLabel("From date").fill("2025-06-15");
  await page.getByLabel("To date").fill("2025-06-15");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=KCB/);
  await expect(page).toHaveURL(/type=deposit/);
  await expect(
    page.locator("p").filter({ hasText: /^Deposit$/ }),
  ).toBeVisible();
  await expect(
    page.locator("p").filter({ hasText: /^Opening balance$/ }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("Search transactions")).toHaveValue("KCB");
  await expect(page.getByLabel("Filter by transaction type")).toHaveValue(
    "deposit",
  );
  await expect(page.getByLabel("From date")).toHaveValue("2025-06-15");
  const filteredQuery = new URL(page.url()).search;
  const transactionExport = await page.request.get(
    `/api/export/transactions.csv${filteredQuery}`,
  );
  expect(transactionExport.ok()).toBeTruthy();
  const transactionCsv = await transactionExport.text();
  expect(transactionCsv).toContain("KCB Car Fund");
  expect(transactionCsv).toContain("deposit");
  expect(transactionCsv).not.toContain("opening_balance");

  await page.goto("/accounts");
  await page.getByText("KCB Car Fund", { exact: true }).first().click();
  await page.getByRole("link", { name: "Value" }).click();
  await page.getByLabel(/New value/).fill("125000");
  await page.getByRole("button", { name: "Update value" }).click();
  await expect(
    page.getByRole("heading", { name: "KCB Car Fund" }),
  ).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Cash Savings");
  await page.getByLabel("Category").selectOption({ label: "Savings" });
  await page.getByLabel("Opening value").fill("50000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Cash Savings" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Import" }).click();
  await page.getByLabel("CSV or JSON file").setInputFiles({
    name: "cash-history.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "external_id,type,amount,date,description,notes\ncash-history-1,interest,125.50,2025-02-01,Imported interest,",
    ),
  });
  await page.getByRole("button", { name: "Preview file" }).click();
  await expect(page.getByText(/1 ready · 0 existing duplicates/)).toBeVisible();
  await expect(page.getByText("Cash Savings · No institution · KES")).toBeVisible();
  await page.getByRole("button", { name: "Hide financial values" }).click();
  await expect(page.getByText("••••••").first()).toBeVisible();
  await page.getByRole("button", { name: "Reveal financial values" }).click();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(
    page.getByText("1 imported, 0 duplicates skipped, 0 failed."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download CSV report" }),
  ).toBeVisible();

  await page.goto("/transactions/new?type=transfer");
  await page
    .getByLabel("From account")
    .selectOption({ label: "Cash Savings · KES" });
  await page
    .getByLabel("To account")
    .selectOption({ label: "KCB Car Fund · KES" });
  await page.getByLabel(/Amount/).fill("10000");
  await page.getByRole("button", { name: "Transfer funds" }).click();
  await expect(
    page
      .locator("p")
      .filter({ hasText: /^Transfer$/ })
      .first(),
  ).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Car Loan");
  await page.getByLabel("Category").selectOption({ label: "Liability" });
  await page.getByLabel("Opening value").fill("25000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Amount owed")).toBeVisible();

  await page.goto("/goals/new");
  await page.getByLabel("Goal name").fill("July 2028 Family Car");
  await page.getByLabel(/Target amount/).fill("3250000");
  await page.getByLabel("Target date").fill("2028-07-01");
  await page
    .getByLabel("Linked account")
    .selectOption({ label: "KCB Car Fund · KES" });
  await page.getByLabel(/Planned contribution/).fill("120000");
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(
    page.getByRole("heading", { name: "July 2028 Family Car" }),
  ).toBeVisible();
  await expect(page.getByText("Required monthly (8% return)")).toBeVisible();
  await expect(page.getByText(/ahead|on track|behind/).first()).toBeVisible();
  await expect(page.getByText("KCB Car Fund")).toBeVisible();
  await expect(page.getByText("Saved plan", { exact: true })).toBeVisible();
  await expect(page.getByText("Required pace", { exact: true })).toBeVisible();
  await expect(page.getByText("Lower return", { exact: true })).toBeVisible();
  await page.getByLabel("Lower return monthly contribution").fill("200000");
  await page.getByLabel("Lower return annual return").fill("5");
  await expect(page.getByLabel("Saved plan monthly contribution")).toHaveValue(
    "120000.00",
  );
  await expect(page.getByLabel("Saved plan annual return")).toHaveValue("8");
  await page.reload();
  await expect(
    page.getByLabel("Lower return monthly contribution"),
  ).toHaveValue("120000.00");
  await expect(page.getByLabel("Lower return annual return")).toHaveValue("6");

  await page.getByLabel("Milestone name").fill("Halfway funded");
  await page
    .getByLabel(/Target amount \(KES\)/)
    .last()
    .fill("1500000");
  await page
    .getByLabel("Target date", { exact: true })
    .last()
    .fill("2027-12-31");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByText("Milestone added.")).toBeVisible();
  await expect(page.getByText("Halfway funded", { exact: true })).toBeVisible();
  await expect(page.getByText("upcoming", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(
    page.getByText("July 2028 Family Car needs attention"),
  ).toBeVisible();
  await page
    .getByLabel("Dismiss July 2028 Family Car reminder for this month")
    .click();
  await expect(
    page.getByText("July 2028 Family Car needs attention"),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("July 2028 Family Car needs attention"),
  ).toHaveCount(0);

  await page.goto("/settings");
  await expect(
    page.getByRole("checkbox", { name: /TZS.*Tanzanian Shilling/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /UGX.*Ugandan Shilling/ }),
  ).toBeChecked();
  await page.getByLabel("Base currency").selectOption("USD");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.getByLabel("Provider").selectOption("deepseek");
  await expect(page.getByLabel("API endpoint")).toHaveValue(
    "https://api.deepseek.com",
  );
  await page.getByLabel("Model identifier").fill("deepseek-review-model");
  await page.getByLabel("Maximum output tokens").fill("25000");
  const saveAiSettings = page.getByRole("button", { name: "Save AI settings" });
  const invalidAiSettings = await saveAiSettings.evaluate((button) => {
    const form = button.closest("form");
    if (!form) return [{ name: "form", message: "Form not found." }];
    return Array.from(form.elements)
      .filter(
        (element): element is HTMLInputElement | HTMLSelectElement =>
          (element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement) &&
          !element.checkValidity(),
      )
      .map((element) => ({
        name: element.name,
        value: element.value,
        message: element.validationMessage,
      }));
  });
  expect(invalidAiSettings).toEqual([]);
  await saveAiSettings.click();
  await expect(page.getByText("AI provider settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Maximum output tokens")).toHaveValue("25000");
  await page.goto("/review");
  await expect(
    page.getByRole("heading", { name: "Portfolio review" }),
  ).toBeVisible();
  await expect(page.getByText("Data sent to the provider")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate review" }),
  ).toBeDisabled();
  await page.getByLabel("Session-only API key").fill("sk-e2e-session-only");
  await expect(
    page.getByRole("button", { name: "Generate review" }),
  ).toBeEnabled();

  await page.goto("/");
  await expect(
    page.getByText(/Current or historical totals are incomplete/),
  ).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Base", { exact: true }).selectOption("USD");
  await page.getByLabel("Quote", { exact: true }).selectOption("KES");
  await page.getByLabel("Rate").fill("130");
  await page.getByLabel("Effective date").fill("2025-01-01");
  await page.getByRole("button", { name: "Save rate" }).click();
  await expect(page.getByText("Exchange rate saved.")).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByText(/Current or historical totals are incomplete/),
  ).toHaveCount(0);

  const exportResponse = await page.request.get("/api/export/json");
  expect(exportResponse.ok()).toBeTruthy();
  const userExport = await exportResponse.body();
  const exportedPortfolio = JSON.parse(userExport.toString()) as {
    version: number;
    institutions: Array<{ name: string }>;
    goalMilestones: Array<{ name: string }>;
    goalAlertDismissals: unknown[];
  };
  expect(exportedPortfolio.version).toBe(5);
  expect(exportedPortfolio.institutions).toEqual([]);
  expect(exportedPortfolio.goalMilestones).toContainEqual(
    expect.objectContaining({ name: "Halfway funded" }),
  );
  expect(exportedPortfolio.goalAlertDismissals).toHaveLength(1);
  expect(JSON.stringify(exportedPortfolio)).not.toContain(
    "deepseek-review-model",
  );
  expect(JSON.stringify(exportedPortfolio)).not.toContain("sk-e2e");
  const restoreResponse = await page.request.post("/api/restore/user", {
    headers: { Origin: "http://127.0.0.1:3100" },
    multipart: {
      file: {
        name: "wealthboard-user.json",
        mimeType: "application/json",
        buffer: userExport,
      },
    },
  });

  expect(restoreResponse.ok()).toBeTruthy();
  await page.goto("/settings");
  await expect(page.getByLabel("Base currency")).toHaveValue("USD");
  await expect(
    page.getByRole("checkbox", { name: /TZS.*Tanzanian Shilling/ }),
  ).toBeChecked();
  await page.goto("/accounts/new");
  await expect(page.getByLabel("Currency")).toHaveValue("USD");
  await expect(
    page.getByLabel("Currency").getByRole("option", { name: /UGX/ }),
  ).toHaveCount(1);
  await page.goto("/goals/new");
  await expect(page.getByLabel("Currency")).toHaveValue("USD");
  await page.goto("/goals");
  await page.getByText("July 2028 Family Car", { exact: true }).click();
  await expect(page.getByText("Halfway funded", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByText("July 2028 Family Car needs attention"),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  await page.getByRole("button", { name: "More navigation" }).click();
  await page.getByRole("link", { name: "Portfolio review" }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByLabel("Session-only API key")).toBeVisible();

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  await expect
    .poll(async () => (await manifest.json()).display)
    .toBe("standalone");
  expect((await page.request.get("/sw.js")).ok()).toBeTruthy();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("responsive layouts fit required viewports", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("alice");
  await page.getByLabel("Password").fill("wealthboard-e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/goals");
  const goalHref = await page
    .locator('a[href^="/goals/"]')
    .filter({ hasText: "July 2028 Family Car" })
    .getAttribute("href");
  expect(goalHref).toBeTruthy();
  const responsiveExport = (await (
    await page.request.get("/api/export/json")
  ).json()) as { accounts: Array<{ id: string; name: string }> };
  const responsiveAccount = responsiveExport.accounts.find(
    (account) => account.name === "Cash Savings",
  );
  expect(responsiveAccount).toBeTruthy();
  const importHref = `/accounts/${responsiveAccount!.id}/import`;

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    for (const route of [
      "/",
      "/accounts",
      "/transactions",
      "/goals",
      "/reports",
      "/review",
      "/settings",
      importHref!,
      goalHref!,
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
    if (width < 768) {
      const links = page
        .getByRole("navigation", { name: "Mobile navigation" })
        .getByRole("link");
      for (let index = 0; index < (await links.count()); index += 1) {
        expect(
          (await links.nth(index).boundingBox())?.height,
        ).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
