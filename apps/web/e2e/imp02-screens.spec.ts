// IMP-02 review screens on the simple screen, at 1440 × 900 and 1280 × 800, for a person to
// inspect.
//
//   SCREENS_OUT=../../docs/imp-02 pnpm exec playwright test e2e/imp02-screens.spec.ts
//
// Skipped unless SCREENS_OUT is set: it writes files and asserts little.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const OUT = process.env.SCREENS_OUT;
const WAREHOUSE = new URL("../../../fixtures/drawings/warehouse-cm.dxf", import.meta.url).pathname;

test.use({ storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] } });

async function clickPlan(page: Page, x: number, y: number) {
  const at = await page.getByTestId("review-plan").evaluate(
    (svg, p) => {
      const plan = svg as SVGSVGElement;
      const point = plan.createSVGPoint();
      point.x = p.x;
      point.y = -p.y;
      const screen = point.matrixTransform(plan.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    },
    { x, y },
  );
  await page.mouse.click(at.x, at.y);
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`review screens at ${width} x ${height}`, async ({ page }) => {
    test.skip(!OUT, "set SCREENS_OUT to write the screenshots");
    test.setTimeout(120_000);
    mkdirSync(OUT!, { recursive: true });
    await page.setViewportSize({ width, height });
    const shot = (name: string) => page.screenshot({ path: join(OUT!, `${width}-${name}.jpg`), type: "jpeg", quality: 80 });
    const outline = (id: string) => page.getByTestId("review-plan").locator(`[data-drawn="${id}"]`);

    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await page.getByTestId("journey-upload").click();
    await page.getByTestId("drawing-file-input").setInputFiles(WAREHOUSE);
    await page.getByTestId("drawing-open").click();
    await expect(page.getByTestId("drawing-review")).toBeVisible();
    await page.waitForTimeout(1500);
    await shot("1-review-start");

    await page.getByTestId("review-floor-pick").click();
    await outline("dxf-102").hover();
    await shot("2-floor-pick");
    await outline("dxf-102").click();

    await page.getByTestId("review-measure").click();
    await clickPlan(page, 1600, 2000);
    await clickPlan(page, 2200, 2000);
    await page.getByTestId("review-length").fill("6");
    await expect(page.getByTestId("review-preview")).toBeVisible();
    await shot("3-scale-conflict");
    await page.getByTestId("review-reference-use").click();
    await page.waitForTimeout(1200);
    await shot("4-scale-measured");

    await outline("dxf-10d").click();
    await page.getByTestId("review-kind-keep_clear").check();
    await page.waitForTimeout(600);
    await shot("5-object-card");
    await outline("dxf-115").click();
    await page.getByTestId("review-kind-none").check();
    await page.getByTestId("review-accept-remaining").click();
    await page.getByTestId("review-omissions-accept").click();
    await outline("dxf-108").click();
    await page.waitForTimeout(800);
    await shot("6-reviewed");

    await page.getByTestId("selection-details").click();
    const x = page.getByTestId("field-position-x");
    await x.fill(String(Number(await x.inputValue()) + 2));
    await x.press("Enter");
    await page.waitForTimeout(800);
    await shot("7-details");
    await page.getByTestId("details-toggle").click();
    await page.getByTestId("journey-compare").click();
    await page.waitForTimeout(1200);
    await shot("8-compare");
  });
}
