import { defineConfig, devices } from "@playwright/test";

const environment = {
  ...process.env,
  DATABASE_PATH: "./data/e2e.db",
  BACKUP_PATH: "./backups/e2e",
  SESSION_SECRET: "e2e-session-secret-that-is-longer-than-32-characters",
  APP_URL: "http://127.0.0.1:3100",
  AUTH_METHODS: "local,oidc",
  OIDC_ISSUER: "http://localhost:4100/realms/wealthboard",
  OIDC_CLIENT_ID: "wealthboard-e2e",
  OIDC_CLIENT_SECRET: "wealthboard-e2e-client-secret",
  OIDC_PROVIDER_NAME: "E2E Keycloak",
  OIDC_TRANSACTION_SECRET: Buffer.alloc(32, 11).toString("base64"),
  TZ: "Africa/Nairobi",
  NEXT_DIST_DIR: ".next-e2e",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/mock-oidc-provider.mjs",
      url: "http://localhost:4100/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "node tests/e2e/prepare.mjs && npm run db:migrate && exec ./node_modules/.bin/next dev -p 3100",
      url: "http://127.0.0.1:3100/api/health/ready",
      reuseExistingServer: false,
      timeout: 120_000,
      env: environment,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
