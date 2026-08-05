import { expect, test } from "@playwright/test";

test("two users remain isolated across URLs, portability, imports, and browser switching", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Username").fill("isolation-alice");
  await page.getByLabel("Display name").fill("Isolation Alice");
  await page.getByLabel("Password", { exact: true }).fill("isolation-alice-password");
  await page.getByLabel("Confirm password").fill("isolation-alice-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Alice Private Savings");
  await page.getByLabel("Category").selectOption({ label: "Savings" });
  await page.getByLabel("Opening value").fill("500");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto("/goals/new");
  await page.getByLabel("Goal name").fill("Alice Private Goal");
  await page.getByLabel(/Target amount/).fill("5000");
  await page.getByLabel("Target date").fill("2028-07-01");
  await page.getByLabel("Linked account").selectOption({
    label: "Alice Private Savings · KES",
  });
  await page.getByLabel(/Planned contribution/).fill("100");
  await page.getByRole("button", { name: "Create goal" }).click();

  const aliceExportResponse = await page.request.get("/api/export/json");
  expect(aliceExportResponse.ok()).toBeTruthy();
  const aliceExport = (await aliceExportResponse.json()) as {
    accounts: Array<{ id: string; name: string }>;
    transactions: Array<{ id: string }>;
    goals: Array<{ id: string }>;
  };
  const aliceAccount = aliceExport.accounts.find(
    (account) => account.name === "Alice Private Savings",
  );
  expect(aliceAccount).toBeTruthy();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/signup");
  await page.getByLabel("Username").fill("bob");
  await page.getByLabel("Display name").fill("Bob Example");
  await page.getByLabel("Password", { exact: true }).fill("bob-e2e-password-123");
  await page.getByLabel("Confirm password").fill("bob-e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Alice Private Savings")).toHaveCount(0);

  await page.goto(`/accounts/${aliceAccount!.id}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto(`/transactions/${aliceExport.transactions[0].id}/edit`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto(`/goals/${aliceExport.goals[0].id}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  const importResponse = await page.request.post(
    `/api/accounts/${aliceAccount!.id}/history-import/preview`,
    {
      headers: { Origin: "http://127.0.0.1:3100" },
      multipart: {
        file: {
          name: "foreign.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            "external_id,type,amount,date,description,notes\nforeign-1,deposit,10,2025-02-01,,",
          ),
        },
      },
    },
  );
  expect(importResponse.status()).toBe(404);
  expect(await importResponse.text()).not.toContain("Alice Private Savings");

  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill("Bob Private Savings");
  await page.getByLabel("Category").selectOption({ label: "Savings" });
  await page.getByLabel("Opening value").fill("700");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Bob Private Savings" })).toBeVisible();

  const bobExportResponse = await page.request.get("/api/export/json");
  const bobExport = await bobExportResponse.json();
  expect(JSON.stringify(bobExport)).toContain("Bob Private Savings");
  expect(JSON.stringify(bobExport)).not.toContain("Alice Private Savings");
  bobExport.accounts[0].userId = "foreign-user-id";
  const rejectedRestore = await page.request.post("/api/restore/user", {
    headers: { Origin: "http://127.0.0.1:3100" },
    multipart: {
      file: {
        name: "malicious.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(bobExport)),
      },
    },
  });
  expect(rejectedRestore.status()).toBe(400);
  await page.goto("/accounts");
  await expect(page.getByText("Bob Private Savings", { exact: true })).toBeVisible();

  expect((await page.request.get("/api/backup")).status()).toBe(404);
  expect(
    (
      await page.request.post("/api/restore", {
        headers: { Origin: "http://127.0.0.1:3100" },
      })
    ).status(),
  ).toBe(404);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill("isolation-alice");
  await page.getByLabel("Password").fill("isolation-alice-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByText("Alice Private Savings", { exact: true })).toBeVisible();
  await expect(page.getByText("Bob Private Savings")).toHaveCount(0);
});
