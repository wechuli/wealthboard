// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowDirectory = path.resolve(".github/workflows");
const validationWorkflow = fs.readFileSync(
  path.join(workflowDirectory, "validation.yml"),
  "utf8",
);
const publishWorkflow = fs.readFileSync(
  path.join(workflowDirectory, "publish-container.yml"),
  "utf8",
);

describe("validation workflows", () => {
  it.each([
    "make generate",
    "git diff --exit-code",
    "make lint",
    "make typecheck",
    "make test",
    "make migrate-check",
    "make security",
    "make test-e2e-go",
  ])("runs %s", (command) => {
    expect(validationWorkflow).toContain(command);
  });

  it("uses PostgreSQL for migration and browser validation", () => {
    expect(validationWorkflow.match(/image: postgres:17-alpine/g)).toHaveLength(
      2,
    );
    expect(validationWorkflow).toContain("TEST_DATABASE_URL:");
  });

  it("gates container publishing on the reusable validation workflow", () => {
    expect(publishWorkflow).toContain(
      "uses: ./.github/workflows/validation.yml",
    );
    expect(publishWorkflow).toMatch(/publish:\n(?:.|\n)*?needs: validation/);
  });

  it("pins every third-party action to an immutable commit", () => {
    const workflowFiles = fs
      .readdirSync(workflowDirectory)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));

    for (const workflowFile of workflowFiles) {
      const contents = fs.readFileSync(
        path.join(workflowDirectory, workflowFile),
        "utf8",
      );
      for (const match of contents.matchAll(/^\s*uses:\s+([^\s#]+).*$/gm)) {
        const reference = match[1];
        if (
          reference.startsWith("./") ||
          reference.startsWith("actions/") ||
          reference.startsWith("github/")
        ) {
          continue;
        }
        expect(reference, workflowFile).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
