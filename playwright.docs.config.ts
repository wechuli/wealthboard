import { defineConfig, devices } from "@playwright/test";

const environment = {
  ...process.env,
  DATABASE_PATH: "./data/docs-capture.db",
  SESSION_SECRET: "docs-capture-session-secret-longer-than-32-characters",
  APP_URL: "http://127.0.0.1:3100",
  AUTH_METHODS: "local",
  TZ: "Africa/Nairobi",
  NEXT_DIST_DIR: ".next-e2e",
};

export default defineConfig({
  testDir: "./tests/docs",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3100",
    colorScheme: "dark",
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command:
      "rm -f data/docs-capture.db data/docs-capture.db-wal data/docs-capture.db-shm && npm run db:migrate && exec ./node_modules/.bin/next dev -p 3100",
    url: "http://127.0.0.1:3100/api/health/ready",
    reuseExistingServer: false,
    timeout: 120_000,
    env: environment,
  },
  projects: [{ name: "documentation", use: { ...devices["Desktop Chrome"] } }],
});
