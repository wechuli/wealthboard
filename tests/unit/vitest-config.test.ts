// @vitest-environment node

import path from "node:path";
import { describe, expect, it } from "vitest";

import { rootTestExclude, rootTestInclude } from "../vitest-boundaries";

function matchesAny(file: string, patterns: string[]) {
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
}

describe("root Vitest discovery boundaries", () => {
  it.each(["tests/unit/money.test.ts", "tests/component/privacy.test.tsx"])(
    "includes the legacy root suite file %s",
    (file) => {
      expect(matchesAny(file, rootTestInclude)).toBe(true);
      expect(matchesAny(file, rootTestExclude)).toBe(false);
    },
  );

  it.each([
    "web/src/api/client.test.ts",
    "web/node_modules/example/index.test.js",
    "packages/tool/node_modules/example/index.spec.ts",
    "tests/e2e/acceptance.spec.ts",
    "tests/docs/capture.spec.ts",
  ])("does not discover the nested or separately-run test %s", (file) => {
    expect(
      matchesAny(file, rootTestInclude) && !matchesAny(file, rootTestExclude),
    ).toBe(false);
  });
});
