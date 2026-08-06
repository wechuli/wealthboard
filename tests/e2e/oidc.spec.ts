import { expect, test, type Page } from "@playwright/test";

const localPassword = "oidc-local-password-12345";

async function continueWithProvider(page: Page, identity: string) {
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4100\//);
  await expect(
    page.getByRole("heading", { name: "E2E Keycloak" }),
  ).toBeVisible();
  await page.getByRole("link", { name: identity }).click();
}

async function providerLogin(page: Page, identity: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Continue with E2E Keycloak" }).click();
  await continueWithProvider(page, identity);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function localLogin(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function createAccount(page: Page, name: string, openingValue: string) {
  await page.goto("/accounts/new");
  await page.getByLabel("Account or asset name").fill(name);
  await page.getByLabel("Category").selectOption({ label: "Savings" });
  await page.getByLabel("Opening value").fill(openingValue);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test.describe.serial("configurable OIDC authentication", () => {
  test("JIT login is isolated from a colliding local username and repeat login returns to one portfolio", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByLabel("Username").fill("oidc-collision");
    await page.getByLabel("Display name").fill("Local Collision User");
    await page.getByLabel("Password", { exact: true }).fill(localPassword);
    await page.getByLabel("Confirm password").fill(localPassword);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await createAccount(page, "Local Collision Asset", "111");
    await logout(page);

    await providerLogin(page, "Continue as OIDC Alice");
    const firstArchiveResponse = await page.request.get("/api/export/json");
    expect(firstArchiveResponse.ok()).toBeTruthy();
    const firstArchive = (await firstArchiveResponse.json()) as {
      accounts: unknown[];
      goals: unknown[];
      exchangeRates: unknown[];
    };
    expect(firstArchive.accounts).toEqual([]);
    expect(firstArchive.goals).toEqual([]);
    expect(firstArchive.exchangeRates).toEqual([]);
    await page.goto("/accounts");
    await expect(page.getByText("Local Collision Asset")).toHaveCount(0);
    await createAccount(page, "OIDC Private Asset", "222");
    await logout(page);

    await localLogin(page, "oidc-collision", localPassword);
    await page.goto("/accounts");
    await expect(
      page.getByText("Local Collision Asset", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("OIDC Private Asset")).toHaveCount(0);
    await logout(page);

    await providerLogin(page, "Continue as OIDC Alice");
    await page.goto("/accounts");
    await expect(
      page.getByText("OIDC Private Asset", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Local Collision Asset")).toHaveCount(0);
    await logout(page);
  });

  test("a local user explicitly links and unlinks one provider identity", async ({
    page,
  }) => {
    const username = "hybrid-owner";
    const password = "hybrid-owner-password-12345";
    await page.goto("/signup");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Display name").fill("Hybrid Owner");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await createAccount(page, "Hybrid Linked Asset", "333");

    await page.goto("/settings");
    const linkButton = page.getByRole("button", {
      name: "Link E2E Keycloak",
    });
    const linkForm = linkButton.locator("xpath=ancestor::form");
    await linkForm.getByLabel("Current password").fill(password);
    await linkButton.click();
    await continueWithProvider(page, "Continue as Link User");
    await expect(page).toHaveURL(/\/settings\?auth=linked/);
    await expect(
      page.getByText("E2E Keycloak").locator("..").getByText("Linked"),
    ).toBeVisible();
    await logout(page);

    await providerLogin(page, "Continue as Link User");
    await page.goto("/accounts");
    await expect(
      page.getByText("Hybrid Linked Asset", { exact: true }),
    ).toBeVisible();
    await logout(page);

    await localLogin(page, username, password);
    await page.goto("/settings");
    const unlinkButton = page.getByRole("button", {
      name: "Unlink E2E Keycloak",
    });
    const unlinkForm = unlinkButton.locator("xpath=ancestor::form");
    await unlinkForm.getByLabel("Current password").fill(password);
    await unlinkButton.click();
    await expect(
      page.getByText("E2E Keycloak").locator("..").getByText("Not linked"),
    ).toBeVisible();

    const relinkButton = page.getByRole("button", {
      name: "Link E2E Keycloak",
    });
    const relinkForm = relinkButton.locator("xpath=ancestor::form");
    await relinkForm.getByLabel("Current password").fill(password);
    await relinkButton.click();
    await continueWithProvider(page, "Continue as OIDC Alice");
    await expect(page).toHaveURL(/\/settings\?auth=invalid_callback/);
    await expect(
      page.getByText("The provider response could not be verified. Try again."),
    ).toBeVisible();
  });

  test("an OIDC user enables and removes local login only after provider reauthentication", async ({
    page,
  }) => {
    const username = "oidc-bob-local";
    const password = "oidc-bob-local-password-12345";
    await providerLogin(page, "Continue as OIDC Bob");
    await page.goto("/settings");
    await page
      .getByRole("button", { name: "Verify with E2E Keycloak" })
      .click();
    await continueWithProvider(page, "Continue as OIDC Bob");
    await expect(page).toHaveURL(/\/settings\?auth=reauthenticated/);
    await page.getByLabel("Local username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Enable local sign-in" }).click();
    await expect(
      page.getByText("Local password").locator("..").getByText("Enabled"),
    ).toBeVisible();
    await logout(page);

    await localLogin(page, username, password);
    await page.goto("/settings");
    await page
      .getByRole("button", { name: "Verify with E2E Keycloak" })
      .click();
    await continueWithProvider(page, "Continue as OIDC Bob");
    await page.getByRole("button", { name: "Remove local sign-in" }).click();
    await expect(
      page.getByText("Local password").locator("..").getByText("Not enabled"),
    ).toBeVisible();
    await logout(page);

    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid username or password.")).toBeVisible();
    await providerLogin(page, "Continue as OIDC Bob");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await logout(page);
  });

  test("provider cancellation is safe and login fits every supported viewport", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .getByRole("link", { name: "Continue with E2E Keycloak" })
      .click();
    await continueWithProvider(page, "Cancel sign in");
    await expect(page).toHaveURL(/\/login\?oidc_error=provider/);
    await expect(
      page.getByText("E2E Keycloak sign-in was cancelled or rejected."),
    ).toBeVisible();

    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await page.goto("/login");
      await expect(page.getByLabel("Username")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Continue with E2E Keycloak" }),
      ).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `login overflows at ${width}px`,
      ).toBeLessThanOrEqual(dimensions.clientWidth);
    }
  });
});
