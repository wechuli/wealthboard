import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

import { rootTestExclude, rootTestInclude } from "./tests/vitest-boundaries";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "tests/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: rootTestInclude,
    exclude: rootTestExclude,
    coverage: {
      include: ["lib/finance.ts", "lib/money.ts"],
    },
  },
});
