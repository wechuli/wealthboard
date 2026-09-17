import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 3100);
const appUrl = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  DATABASE_PATH: process.env.E2E_DATABASE_PATH || "./data/e2e.db",
  BACKUP_PATH: process.env.E2E_BACKUP_PATH || "./backups/e2e",
  SESSION_SECRET: "e2e-session-secret-that-is-longer-than-32-characters",
  APP_URL: appUrl,
  AUTH_METHODS: "local,oidc",
  OIDC_ISSUER: "http://localhost:4100/realms/wealthboard",
  OIDC_CLIENT_ID: "wealthboard-e2e",
  OIDC_CLIENT_SECRET: "wealthboard-e2e-client-secret",
  OIDC_PROVIDER_NAME: "E2E Keycloak",
  OIDC_TRANSACTION_SECRET: Buffer.alloc(32, 11).toString("base64"),
  TZ: "Africa/Nairobi",
  NEXT_DIST_DIR: process.env.E2E_DIST_DIR || ".next-e2e",
  AI_ALLOWED_ENDPOINTS: "http://127.0.0.1:4200/v1",
  AI_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
};

export default defineConfig({
  testDir: "./tests/e2e",
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
      command: `node tests/e2e/prepare.mjs && npm run db:migrate && exec ./node_modules/.bin/next dev -p ${port}`,
      url: `${appUrl}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: environment,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
