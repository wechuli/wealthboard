import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export default function teardown() {
  const composeFile = path.join(root, "tests/e2e-go/docker-compose.yml");
  const project = process.env.E2E_COMPOSE_PROJECT || "wealthboard-go-e2e";
  spawnSync(
    "docker",
    [
      "compose",
      "-p",
      project,
      "-f",
      composeFile,
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  fs.rmSync(path.join(root, "test-results/wealthboard-go-e2e"), {
    force: true,
  });
}
