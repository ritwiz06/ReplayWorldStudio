// The start screen's picture of the example world (UX-04), made from the app itself (local
// only): the sample hall in the default draft appearance, written to public/example-preview.jpg.
// Run with: pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts preview
import { expect, test } from "@playwright/test";

const OUT = new URL("../../public/example-preview.jpg", import.meta.url).pathname;

test("make the example preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("rws.view", "chat"));
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("chat-collapse").click();
  await page.waitForTimeout(1500);
  const box = (await page.getByTestId("viewport").boundingBox())!;
  // A 16:9 crop around the middle of the world.
  const width = Math.min(box.width - 80, 1100);
  const height = (width * 9) / 16;
  await page.screenshot({ path: OUT, type: "jpeg", quality: 80, clip: { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2 + 20, width, height } });
});

// Stills of the shipped catalog models (UX-05), for the equipment-appearance card: each model
// framed in the industrial demo by the app itself, written to public/catalog-previews/.
const STILLS: [string, RegExp][] = [
  ["asset-belt-conveyor-3m", /^Transfer conveyor/],
  ["asset-guarded-machine-cell", /^Filling cell/],
  ["asset-electrical-cabinet-800", /^Control cabinet 1/],
  ["asset-pallet-cartons", /^Staged pallet/],
];

test("make the catalog stills", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("rws.view", "editor"));
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded · \d+ objects/);
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  for (const [asset, name] of STILLS) {
    await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name }).click();
    await page.keyboard.press("f");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); // no selection outline in the still
    await page.waitForTimeout(600);
    const box = (await page.getByTestId("viewport").boundingBox())!;
    const height = Math.min(box.height * 0.62, 420);
    const width = (height * 4) / 3;
    await page.screenshot({
      path: new URL(`../../public/catalog-previews/${asset}.jpg`, import.meta.url).pathname,
      type: "jpeg",
      quality: 72,
      clip: { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height },
      scale: "css",
    });
  }
});
