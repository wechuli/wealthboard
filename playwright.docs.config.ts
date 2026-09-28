import { defineConfig, devices } from "@playwright/test";

const environment = {
  ...process.env,
  E2E_COMPOSE_PROJECT: "wealthboard-docs-capture",
  E2E_POSTGRES_PORT: "55434",
  E2E_GO_PORT: "3300",
};

export default defineConfig({
  testDir: "./tests/docs",
  globalTeardown: "./tests/docs/teardown.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3300",
    colorScheme: "dark",
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
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
      url: "http://127.0.0.1:3300/api/health/ready",
      reuseExistingServer: false,
      timeout: 180_000,
      env: environment,
    },
  ],
  projects: [{ name: "documentation", use: { ...devices["Desktop Chrome"] } }],
});
