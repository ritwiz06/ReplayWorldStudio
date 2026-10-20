// GEO-01/02 Check layout screens on the simple screen, at 1440 × 900 and 1280 × 800, for a
// person to inspect: a conflict, a clear layout and route, a blocked route, and the comparison.
//
//   SCREENS_OUT=../../docs/geo-01 pnpm exec playwright test e2e/geo-screens.spec.ts
//
// Skipped unless SCREENS_OUT is set: it writes files and asserts little.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const OUT = process.env.SCREENS_OUT;
const LAYOUT = new URL("../../../fixtures/drawings/layout-checks-mm.dxf", import.meta.url).pathname;

test.use({ storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }, { name: "rws.view", value: "editor" }] }] } });

async function clickPlan(page: Page, x: number, y: number) {
  const at = await page.getByTestId("check-plan").evaluate(
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

async function setField(page: Page, objectId: string, fields: Record<string, string>) {
  await page.getByTestId(`check-plan-object-${objectId}`).click();
  await page.getByTestId("selection-card").getByTestId("selection-details").click();
  for (const [field, value] of Object.entries(fields)) {
    await page.getByTestId(field).fill(value);
    await page.getByTestId(field).press("Enter");
  }
  await page.getByTestId("details-toggle").click();
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`check layout screens at ${width} x ${height}`, async ({ page }) => {
    test.skip(!OUT, "set SCREENS_OUT to write the screenshots");
    test.setTimeout(120_000);
    mkdirSync(OUT!, { recursive: true });
    await page.setViewportSize({ width, height });
    const shot = async (name: string) => {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(OUT!, `${width}-${name}.jpg`), type: "jpeg", quality: 80 });
    };

    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await page.getByTestId("journey-upload").click();
    await page.getByTestId("drawing-file-input").setInputFiles(LAYOUT);
    await page.getByTestId("drawing-open").click();
    const review = page.getByTestId("drawing-review");
    await review.getByTestId("review-floor-accept").click();
    await review.getByTestId("review-scale-accept").click();
    await review.getByTestId("review-accept-remaining").click();
    await review.getByTestId("review-omissions-accept").click();

    await page.getByTestId("journey-check").click();
    await expect(page.getByTestId("layout-outcome")).toHaveAttribute("data-outcome", "conflict");
    await shot("1-conflict");

    await setField(page, "obj-dxf-10a", { "field-rotation-y": "0" });
    await page.getByTestId("route-pick-start").click();
    await clickPlan(page, 1000, 5000);
    await clickPlan(page, 16000, 5000);
    await page.getByTestId("route-width").fill("1.2");
    await page.getByTestId("route-allowance").fill("0.1");
    await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "fits");
    await shot("2-clear");

    await setField(page, "obj-dxf-111", { "field-position-z": "0", "field-position-x": "-1.5" });
    await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "conflict");
    await page.getByTestId("check-details").locator("summary").click();
    await shot("3-blocked");

    await page.getByTestId("check-details").locator("summary").click();
    await page.getByTestId("check-show-drawn").click();
    await shot("4-as-drawn");
    await page.getByTestId("drawing-tab-compare").click();
    await shot("5-compare");
  });
}
