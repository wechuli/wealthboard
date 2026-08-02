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
  await page.getByLabel("Password", { exact: true }).fill("wealthboard-e2e-password");
  await page.getByLabel("Confirm password").fill("wealthboard-e2e-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add your first account" })).toBeVisible();

  await page.getByRole("link", { name: "Accounts" }).first().click();
  await page.getByRole("link", { name: "Add account" }).click();
  await page.getByLabel("Account or asset name").fill("KCB Car Fund");
  await page.getByLabel("Category").selectOption({ label: "Money Market Fund" });
  await page.getByLabel("Institution").fill("KCB");
  await page.getByLabel("Opening value").fill("100000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "KCB Car Fund" })).toBeVisible();

  await page.getByRole("link", { name: "Deposit" }).click();
  await page.getByLabel(/Amount/).fill("20000");
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(page.getByRole("heading", { name: "KCB Car Fund" })).toBeVisible();

  await page.getByRole("link", { name: "Interest" }).click();
  await page.getByLabel(/Amount/).fill("500");
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(page.getByRole("heading", { name: "KCB Car Fund" })).toBeVisible();

  await page.goto("/transactions");
  await page.getByLabel("Edit transaction").first().click();
  await page.getByLabel(/Amount/).fill("600");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByRole("heading", { name: "KCB Car Fund" })).toBeVisible();
  await page.goto("/transactions");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Delete transaction").first().click();
  await expect(page.getByText("Transaction deleted.")).toBeVisible();

  await page.goto("/accounts");
  await page.getByText("KCB Car Fund", { exact: true }).first().click();
  await page.getByRole("link", { name: "Value" }).click();
  await page.getByLabel(/New value/).fill("125000");
  await page.getByRole("button", { name: "Update value" }).click();
  await expect(page.getByRole("heading", { name: "KCB Car Fund" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Cash Savings");
  await page.getByLabel("Category").selectOption({ label: "Savings" });
  await page.getByLabel("Opening value").fill("50000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Cash Savings" })).toBeVisible();

  await page.goto("/transactions/new?type=transfer");
  await page.getByLabel("From account").selectOption({ label: "Cash Savings · KES" });
  await page.getByLabel("To account").selectOption({ label: "KCB Car Fund · KES" });
  await page.getByLabel(/Amount/).fill("10000");
  await page.getByRole("button", { name: "Transfer funds" }).click();
  await expect(page.getByText("Transfer", { exact: true }).first()).toBeVisible();

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
  await page.getByLabel("Linked account").selectOption({ label: "KCB Car Fund · KES" });
  await page.getByLabel(/Planned contribution/).fill("120000");
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByRole("heading", { name: "July 2028 Family Car" })).toBeVisible();
  await expect(page.getByText(/ahead|on track|behind/).first()).toBeVisible();
  await expect(page.getByText("KCB Car Fund")).toBeVisible();

  const exportResponse = await page.request.get("/api/export/json");
  expect(exportResponse.ok()).toBeTruthy();
  const userExport = await exportResponse.body();
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  await expect.poll(async () => (await manifest.json()).display).toBe("standalone");
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

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    for (const route of ["/", "/accounts", "/goals", "/reports"]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(dimensions.scrollWidth, `${route} overflows at ${width}px`).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );
    }
    if (width < 768) {
      const links = page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link");
      for (let index = 0; index < (await links.count()); index += 1) {
        expect((await links.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
