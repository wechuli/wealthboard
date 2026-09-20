import assert from "node:assert/strict";
import fs from "node:fs";

const [legacyPath, goPath] = process.argv.slice(2);
if (!legacyPath || !goPath) {
  throw new Error("Usage: node scripts/compare-phase6-parity.mjs <legacy.json> <go.json>");
}

const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
const replacement = JSON.parse(fs.readFileSync(goPath, "utf8"));

assert.deepStrictEqual(
  replacement,
  legacy,
  "Go/PostgreSQL outcomes differ from legacy SQLite/TypeScript outcomes",
);

console.log(
  "Phase 6 parity passed: exports, balances, positions, goals, reports, and estate snapshots match.",
);