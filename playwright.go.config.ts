import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_GO_PORT || 3200);
const appUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e-go",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/mock-import-provider.mjs",
      url: "http://127.0.0.1:4200/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node tests/e2e/mock-oidc-provider.mjs",
      url: "http://localhost:4100/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node tests/e2e-go/start.mjs",
      url: `${appUrl}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
