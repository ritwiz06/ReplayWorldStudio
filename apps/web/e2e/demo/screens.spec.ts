// REL-01 presentation check (local only): the example, the comparison, the export review and an
// opened bundle at 1440 × 900 and 1280 × 800, saved to test-results/rel01-screens.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const OUT = new URL("../../test-results/rel01-screens/", import.meta.url).pathname;

for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
  test(`screens at ${width} × ${height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await page.getByTestId("journey-run").click();
    await expect(page.getByTestId("run-panel")).toHaveAttribute("data-outcome", "ready", { timeout: 30_000 });
    await page.getByTestId("example-start").click();
    for (let i = 0; i < 4; i++) await page.getByTestId("example-next").click();
    await page.screenshot({ path: `${OUT}${width}-1-example.png` });
    await page.getByTestId("run-compare").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${OUT}${width}-2-compare.png` });
    await page.getByTestId("run-export").click();
    await expect(page.getByTestId("export-replay")).toBeVisible();
    await page.screenshot({ path: `${OUT}${width}-3-export.png` });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-save").click()]);
    const file = await download.path();
    await page.getByTestId("export-close").click();
    await page.goto("/");
    await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/zip", buffer: readFileSync(file!) });
    await page.getByTestId("bundle-rerun").click();
    await expect(page.getByTestId("bundle-check")).toHaveAttribute("data-same", "true");
    await page.screenshot({ path: `${OUT}${width}-4-bundle.png` });
  });
}
