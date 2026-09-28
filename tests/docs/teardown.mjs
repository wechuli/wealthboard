import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export default function teardown() {
  spawnSync(
    "docker",
    [
      "compose",
      "-p",
      "wealthboard-docs-capture",
      "-f",
      path.resolve("tests/e2e-go/docker-compose.yml"),
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  fs.rmSync(path.resolve("test-results/wealthboard-go-e2e"), { force: true });
}
