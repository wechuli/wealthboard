import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composeFile = path.join(root, "tests/e2e-go/docker-compose.yml");
const project = process.env.E2E_COMPOSE_PROJECT || "wealthboard-go-e2e";
const postgresPort = process.env.E2E_POSTGRES_PORT || "55432";
const appPort = process.env.E2E_GO_PORT || "3200";
const appUrl = `http://127.0.0.1:${appPort}`;
const databaseUrl = `postgres://wealthboard_e2e:wealthboard_e2e@127.0.0.1:${postgresPort}/wealthboard_e2e?sslmode=disable`;
const compose = ["compose", "-p", project, "-f", composeFile];
let server;
let stopping = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

function cleanup(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (server && !server.killed) server.kill("SIGTERM");
  spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => cleanup(0));
}
process.on("uncaughtException", (error) => {
  console.error(error);
  cleanup(1);
});

run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
run("docker", [...compose, "up", "--detach", "--wait"]);
run("npm", ["--prefix", "web", "run", "build"]);
run("go", ["build", "-trimpath", "-o", "bin/wealthboard-e2e", "./cmd/wealthboard"]);

server = spawn(path.join(root, "bin/wealthboard-e2e"), ["serve"], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: appPort,
    APP_URL: appUrl,
    WEB_DIST_PATH: path.join(root, "web/dist"),
    AUTH_METHODS: "local,oidc",
    SESSION_SECRET: "go-e2e-session-secret-that-is-longer-than-32-characters",
    OIDC_ISSUER: "http://localhost:4100/realms/wealthboard",
    OIDC_CLIENT_ID: "wealthboard-go-e2e",
    OIDC_CLIENT_SECRET: "wealthboard-go-e2e-client-secret",
    OIDC_PROVIDER_NAME: "E2E Keycloak",
    OIDC_TRANSACTION_SECRET: Buffer.alloc(32, 23).toString("base64"),
    AI_ALLOWED_ENDPOINTS: "http://127.0.0.1:4200/v1",
    AI_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString("base64"),
    TZ: "Africa/Nairobi",
  },
  stdio: "inherit",
});
server.on("exit", (code, signal) => {
  if (!stopping) {
    console.error(`Go E2E server exited (${signal || code}).`);
    cleanup(code || 1);
  }
});
