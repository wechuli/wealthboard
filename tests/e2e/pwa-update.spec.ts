import { expect, test } from "@playwright/test";

test("development clears stale PWA state before hydrating", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/offline");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    )
    .toBe(0);

  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    await caches.open("wealthboard-shell-v1");
    await caches.open("unrelated-origin-cache");
  });

  await page.reload({ waitUntil: "networkidle" });

  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await caches.keys()).filter((key) => key.startsWith("wealthboard-")),
      ),
    )
    .toEqual([]);
  expect(
    await page.evaluate(async () =>
      (await caches.keys()).includes("unrelated-origin-cache"),
    ),
  ).toBe(true);
  expect(
    browserErrors.filter((message) => message.includes("Hydration failed")),
  ).toEqual([]);

  await page.evaluate(() => caches.delete("unrelated-origin-cache"));
});
