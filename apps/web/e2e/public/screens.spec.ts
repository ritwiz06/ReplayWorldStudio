// Public preview screens (ADR-054) from the production build, at 1440 × 900 and 1280 × 800.
//   SCREENS_OUT=../../docs/release-0.1 pnpm --filter @replay-world/web test:e2e:public screens
// Skipped unless SCREENS_OUT is set.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const OUT = process.env.SCREENS_OUT;
const SKETCH = readFileSync(new URL("../../../../fixtures/plans/rough-cell.png", import.meta.url));

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`preview screens at ${width} x ${height}`, async ({ page }) => {
    test.skip(!OUT, "set SCREENS_OUT to write the screenshots");
    mkdirSync(OUT!, { recursive: true });
    await page.setViewportSize({ width, height });
    const shot = async (name: string) => {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(OUT!, `${width}-${name}.jpg`), type: "jpeg", quality: 80 });
    };
    await page.goto("/");
    await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "fits");
    await shot("1-first-screen");
    await page.getByTestId("sample-move").click();
    await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "conflict");
    await shot("2-route-blocked");
    await page.getByTestId("preview-badge").click();
    await shot("3-about-privacy");
    await page.getByTestId("about-preview").getByRole("button", { name: "Close" }).click();
    await page.getByTestId("sample-upload").click();
    await page.getByTestId("drawing-file-input").setInputFiles({ name: "cell.png", mimeType: "image/png", buffer: SKETCH });
    await expect(page.getByTestId("plan-no-ai")).toBeVisible();
    await shot("4-plan-upload-no-ai");
  });
}
