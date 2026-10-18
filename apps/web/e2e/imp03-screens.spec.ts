// IMP-03 screens on the simple screen, at 1440 × 900 and 1280 × 800, for a person to inspect:
// the page choice, the plan with its known length and the model's draft, the draft beside the
// 3D view, a wrong proposal, an uncertain boundary, a traced fit, the unavailable model, and
// Check layout no longer covering the scene.
//
//   SCREENS_OUT=../../docs/imp-03 pnpm exec playwright test e2e/imp03-screens.spec.ts
//
// Skipped unless SCREENS_OUT is set: it writes files and asserts little.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const OUT = process.env.SCREENS_OUT;
const PLANS = new URL("../../../fixtures/plans/", import.meta.url);
const HALL = new URL("packing-hall.pdf", PLANS).pathname;
const SKETCH = new URL("rough-cell.png", PLANS).pathname;
const LAYOUT = new URL("../../../fixtures/drawings/layout-checks-mm.dxf", import.meta.url).pathname;
const PX = 71.4285714;

test.use({ storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] } });

const hall = (x: number, y: number): [number, number] => [302.38 + x * PX, 579.56 + y * PX];
function sketch(x: number, y: number): [number, number] {
  const a = (1.5 * Math.PI) / 180;
  const px = 180 + x * 100 - 800;
  const py = 190 + y * 100 - 550;
  return [800 + px * Math.cos(a) - py * Math.sin(a), 550 + px * Math.sin(a) + py * Math.cos(a)];
}

async function clickPlan(page: Page, testId: string, [x, y]: [number, number]) {
  const at = await page.getByTestId(testId).evaluate(
    (svg, p) => {
      const plan = svg as SVGSVGElement;
      const frame = plan.closest(".drawing-plan-frame") as HTMLElement | null;
      frame?.scrollIntoView({ block: "nearest" });
      const screen = () => {
        const point = plan.createSVGPoint();
        point.x = p.x;
        point.y = -p.y;
        return point.matrixTransform(plan.getScreenCTM()!);
      };
      let s = screen();
      if (frame) {
        const r = frame.getBoundingClientRect();
        if (s.x < r.left + 6 || s.x > r.right - 6 || s.y < r.top + 6 || s.y > r.bottom - 6) {
          frame.scrollLeft += s.x - (r.left + r.width / 2);
          frame.scrollTop += s.y - (r.top + r.height / 2);
          s = screen();
        }
      }
      return { x: s.x, y: s.y };
    },
    { x, y },
  );
  await page.mouse.click(at.x, at.y);
}

const outline = (page: Page, name: string) => page.getByTestId("review-plan").locator("[data-drawn]", { has: page.locator(`title:text-is("${name}")`) }).first();

async function trace(page: Page, name: string, corners: [number, number][]) {
  await outline(page, name).click();
  await page.getByTestId("review-object").getByTestId("review-trace").click();
  for (const c of corners) await clickPlan(page, "review-plan", c);
}

async function askRoute(page: Page, a: [number, number], b: [number, number], width: string, allowance: string) {
  await page.getByTestId("route-pick-start").click();
  await clickPlan(page, "check-plan", a);
  await clickPlan(page, "check-plan", b);
  await page.getByTestId("route-width").fill(width);
  await page.getByTestId("route-allowance").fill(allowance);
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`plan picture screens at ${width} x ${height}`, async ({ page }) => {
    test.skip(!OUT, "set SCREENS_OUT to write the screenshots");
    test.setTimeout(240_000);
    mkdirSync(OUT!, { recursive: true });
    await page.setViewportSize({ width, height });
    const shot = async (name: string) => {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(OUT!, `${width}-${name}.jpg`), type: "jpeg", quality: 80 });
    };

    // The clean PDF.
    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await page.getByTestId("journey-upload").click();
    await page.getByTestId("drawing-file-input").setInputFiles(HALL);
    await expect(page.getByTestId("plan-pages")).toBeVisible();
    await shot("01-pages");
    await page.getByTestId("plan-page-2").click();
    await clickPlan(page, "drawing-plan", hall(0, 15));
    await clickPlan(page, "drawing-plan", hall(24, 15));
    await page.getByTestId("plan-length").fill("24");
    await page.getByTestId("plan-propose").click();
    await expect(page.getByTestId("plan-proposed")).toBeVisible();
    await shot("02-plan-proposed");
    await page.getByTestId("drawing-open").click();
    await expect(page.getByTestId("drawing-review")).toBeVisible();
    await shot("03-draft-review");
    const review = page.getByTestId("drawing-review");
    await review.getByTestId("review-floor-accept").click();
    await review.getByTestId("review-accept-remaining").click();
    await review.getByTestId("review-omissions-accept").click();
    await page.getByTestId("journey-check").click();
    await askRoute(page, hall(1.5, 8.1), hall(16, 8.1), "1.2", "0.1");
    await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "cannot_determine");
    await shot("04-hall-uncertain");
    await page.getByTestId("drawing-tab-review").click();
    await page.getByTestId("review-zoom-4").click();
    await review.getByTestId("review-floor-trace").click();
    for (const c of [hall(0.2, 0.2), hall(23.8, 0.2), hall(23.8, 13.8), hall(0.2, 13.8)]) await clickPlan(page, "review-plan", c);
    await review.getByTestId("review-floor-finish").click();
    await trace(page, "Rack 1", [hall(0.5, 9), hall(12.5, 9), hall(12.5, 10.2)]);
    await trace(page, "Rack 2", [hall(0.5, 6), hall(12.5, 6), hall(12.5, 7.2)]);
    await trace(page, "Packing table", [hall(17, 9), hall(19, 9), hall(19, 10)]);
    await shot("05-traced-zoomed");
    await page.getByTestId("drawing-tab-check").click();
    await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "fits");
    await shot("06-hall-fits");

    // The rough sketch: a wrong proposal, then an uncertain boundary.
    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await page.getByTestId("journey-upload").click();
    await page.getByTestId("drawing-file-input").setInputFiles(SKETCH);
    await clickPlan(page, "drawing-plan", sketch(0, 8));
    await clickPlan(page, "drawing-plan", sketch(12, 8));
    await page.getByTestId("plan-length").fill("12");
    await page.getByTestId("plan-propose").click();
    await expect(page.getByTestId("plan-proposed")).toBeVisible();
    await shot("07-sketch-proposed");
    await page.getByTestId("drawing-open").click();
    await outline(page, "future cart?").click();
    await shot("08-wrong-proposal");
    await page.getByTestId("review-kind-none").check();
    await page.getByTestId("review-zoom-4").click();
    await page.getByTestId("review-floor-trace").click();
    for (const c of [sketch(0, 0), sketch(12, 0), sketch(12, 8), sketch(0, 8)]) await clickPlan(page, "review-plan", c);
    await page.getByTestId("review-floor-finish").click();
    await page.getByTestId("review-accept-remaining").click();
    await page.getByTestId("review-omissions-accept").click();
    await page.getByTestId("journey-check").click();
    await askRoute(page, sketch(5.6, 1.2), sketch(9.5, 5.4), "1.4", "0.1");
    await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "cannot_determine");
    await shot("09-sketch-uncertain");

    // The model unavailable: the manual path.
    await page.route("**/api/v1/assist/plan-proposals", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "The vision model is not available right now." }) }));
    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await page.getByTestId("journey-upload").click();
    await page.getByTestId("drawing-file-input").setInputFiles(SKETCH);
    await page.getByTestId("plan-propose").click();
    await expect(page.getByTestId("plan-proposal-failed")).toBeVisible();
    await shot("10-model-unavailable");
    await page.unroute("**/api/v1/assist/plan-proposals");

    // Check layout beside the 3D view on the DXF of GEO-01/02 (it used to cover the scene).
    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await page.getByTestId("journey-upload").click();
    await page.getByTestId("drawing-file-input").setInputFiles(LAYOUT);
    await page.getByTestId("drawing-open").click();
    await page.getByTestId("review-floor-accept").click();
    await page.getByTestId("review-scale-accept").click();
    await page.getByTestId("review-accept-remaining").click();
    await page.getByTestId("review-omissions-accept").click();
    await page.getByTestId("journey-check").click();
    await expect(page.getByTestId("layout-outcome")).toHaveAttribute("data-outcome", "conflict");
    await shot("11-check-beside-3d");
  });
}
