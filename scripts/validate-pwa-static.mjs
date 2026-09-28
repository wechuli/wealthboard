import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const publicDirectory = path.resolve("web/public");
const serviceWorker = await readFile(
  path.join(publicDirectory, "sw.js"),
  "utf8",
);
const index = await readFile(path.resolve("web/index.html"), "utf8");
const manifest = JSON.parse(
  await readFile(path.join(publicDirectory, "manifest.webmanifest"), "utf8"),
);

assert.match(serviceWorker, /pathname\.startsWith\("\/api"\)/);
assert.doesNotMatch(serviceWorker, /addEventListener\(\s*["']sync["']/);
assert.doesNotMatch(serviceWorker, /addEventListener\(\s*["']periodicsync["']/);
assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(index, /import\.meta\.env\.PROD/);
assert.match(index, /serviceWorker\.register\("\/sw\.js"\)/);
assert.equal(manifest.start_url, "/");
assert.equal(manifest.display, "standalone");
assert.ok(manifest.icons.length >= 3);

await access(path.join(publicDirectory, "offline.html"));
for (const icon of manifest.icons) {
  await access(path.join(publicDirectory, icon.src.replace(/^\//, "")));
}

console.log("Vite PWA static policy checks passed.");
