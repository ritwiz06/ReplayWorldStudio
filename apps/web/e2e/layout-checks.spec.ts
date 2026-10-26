// GEO-01/02 on the simple screen: open a reviewed drawing, ask whether the layout fits, turn a
// machine, ask whether a 1.20 m item can get along the aisle, move a machine into it, compare
// before and after, undo and redo, save and reopen. The fixture's outcomes are worked out by
// hand in scripts/build_dxf_fixtures.py (layout-checks-mm.dxf).
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const LAYOUT = new URL("../../../fixtures/drawings/layout-checks-mm.dxf", import.meta.url).pathname;
const SIMPLE = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }, { name: "rws.view", value: "editor" }] }] };

test.use({ storageState: SIMPLE });

const MIXER = "obj-dxf-10a";
const MACHINE_B = "obj-dxf-111";

/** Click a point given in drawing units on one of the plans. */
async function clickPlan(page: Page, testId: string, x: number, y: number) {
  const at = await page.getByTestId(testId).evaluate(
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

/** Set one inspector field of the selected object (behind Details), then return to the simple screen. */
async function setField(page: Page, objectId: string, fields: Record<string, string>) {
  await page.getByTestId(`check-plan-object-${objectId}`).click();
  await page.getByTestId("selection-card").getByTestId("selection-details").click();
  for (const [field, value] of Object.entries(fields)) {
    const input = page.getByTestId(field);
    await input.fill(value);
    await input.press("Enter");
  }
  await page.getByTestId("details-toggle").click();
  await expect(page.getByTestId("object-inspector")).toHaveCount(0);
}

async function askRoute(page: Page, a: [number, number], b: [number, number], width: string, allowance: string) {
  await page.getByTestId("route-pick-start").click();
  await clickPlan(page, "check-plan", ...a);
  await clickPlan(page, "check-plan", ...b); // picking B follows A
  await page.getByTestId("route-width").fill(width);
  await page.getByTestId("route-allowance").fill(allowance);
}

test("does this layout fit? overlaps, a keep-clear zone and a width-only route, before and after a move", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 150_000 : 90_000);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(LAYOUT);
  await page.getByTestId("drawing-open").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");

  // Before the review: no answer at all, and the reason.
  await page.getByTestId("journey-check").click();
  const layout = page.getByTestId("layout-outcome");
  await expect(layout).toHaveAttribute("data-outcome", "cannot_determine");
  await expect(layout).toContainText("Footprints and keep-clear zones: Cannot determine yet. The scale is not checked yet; the floor is only proposed;");

  // The review, on the simple screen.
  await page.getByTestId("drawing-tab-review").click();
  const review = page.getByTestId("drawing-review");
  await review.getByTestId("review-floor-accept").click();
  await review.getByTestId("review-scale-accept").click();
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();
  await expect(review.getByTestId("review-ready")).toContainText("Reviewed");

  // GEO-01: the mixer's 45° turn makes its corner overlap the control panel by 0.23 m.
  await page.getByTestId("journey-check").click();
  await expect(layout).toHaveAttribute("data-outcome", "conflict");
  await expect(layout).toHaveText("Footprints and keep-clear zones: Conflict found. 1 conflict: Mixer and Control panel overlap by 0.23 m.");
  await expect(page.getByTestId(`check-plan-object-${MIXER}`)).toHaveAttribute("data-flag", "conflict");
  await expect(page.getByTestId("check-plan-object-obj-dxf-10c")).toHaveAttribute("data-flag", "conflict");
  const finding = page.getByTestId("layout-finding");
  await expect(finding).toHaveCount(1);
  await finding.getByTestId("finding-select-obj-dxf-10c").click();
  await expect(page.getByTestId("selection-card")).toContainText("Control panel");
  await page.getByTestId("check-details").locator("summary").click();
  await expect(page.getByTestId("check-details")).toContainText("Overlap: 0.231 m (Mixer, Control panel).");
  await expect(page.getByTestId("check-overhead-limit")).toContainText("Overhead clearance: height needed.");

  // Turn the mixer square: it fits, 0.10 m from the panel.
  await setField(page, MIXER, { "field-rotation-y": "0" });
  await expect(layout).toHaveAttribute("data-outcome", "fits");
  await expect(layout).toHaveText("Footprints and keep-clear zones: Fits in the reviewed design. No overlaps, no object in a keep-clear zone and nothing past the floor's edge. Closest: Mixer and Control panel, 0.10 m apart.");
  await expect(page.getByTestId("check-drawn-layout")).toHaveAttribute("data-outcome", "conflict");
  await expect(page.getByTestId("check-now-layout")).toHaveAttribute("data-outcome", "fits");

  // GEO-02: a 1.20 m item with 0.10 m each side along the 2.00 m aisle.
  await askRoute(page, [1000, 5000], [16000, 5000], "1.2", "0.1");
  const route = page.getByTestId("route-outcome");
  await expect(route).toHaveAttribute("data-outcome", "fits");
  await expect(route).toContainText("Route A to B: Fits in the reviewed design. A 1.40 m corridor runs from start to destination; its narrowest passage is 2.00 m");
  await expect(page.getByTestId("route-scope")).toHaveText("Width-only route; turning not evaluated.");
  await expect(page.getByTestId("check-plan-route")).toHaveAttribute("data-outcome", "fits");
  await expect(page.getByTestId("check-details")).toContainText("Route: an item 1.20 m wide with 0.10 m kept clear on each side: a 1.40 m corridor.");

  // Move Machine B into the aisle: 0.50 m each side, the route is blocked; as drawn it fits.
  await setField(page, MACHINE_B, { "field-position-z": "0", "field-position-x": "-1.5" });
  await expect(route).toHaveAttribute("data-outcome", "conflict");
  await expect(route).toContainText(/^Route A to B: Blockage found\. The best way through narrows to 0\.50 m between (Rack [AB] and Machine B|Machine B and Rack [AB]), and the item needs 1\.40 m\./);
  await expect(page.getByTestId("check-plan-passage")).toContainText("0.50 m");
  await expect(page.getByTestId(`check-plan-object-${MACHINE_B}`)).toHaveAttribute("data-flag", "conflict");
  await expect(page.getByTestId("check-drawn-route")).toHaveAttribute("data-outcome", "fits");
  await expect(page.getByTestId("check-now-route")).toHaveAttribute("data-outcome", "conflict");
  await page.getByTestId("check-show-drawn").click();
  await expect(page.getByTestId("check-plan-route")).toHaveAttribute("data-outcome", "fits");
  await expect(route).toHaveAttribute("data-outcome", "fits");
  await page.getByTestId("check-show-now").click();
  await expect(route).toHaveAttribute("data-outcome", "conflict");

  // Undo the two moves and the route is clear again; redo blocks it again.
  await page.getByTestId("undo").click();
  await page.getByTestId("undo").click();
  await expect(route).toHaveAttribute("data-outcome", "fits");
  await page.getByTestId("redo").click();
  await page.getByTestId("redo").click();
  await expect(route).toHaveAttribute("data-outcome", "conflict");

  // The Compare tab shows each arrangement with its own results.
  await page.getByTestId("drawing-tab-compare").click();
  await expect(page.getByTestId("compare-before-result")).toHaveText(" · conflict found, route fits");
  await expect(page.getByTestId("compare-after-result")).toHaveText(" · fits, route blocked");

  // Save and reopen in a fresh page: the same answers come back from the saved layout.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  expect((JSON.parse(text) as { schema_version: string }).schema_version).toBe("0.16.0");
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("journey-check").click();
  await expect(layout).toHaveAttribute("data-outcome", "fits");
  await askRoute(page, [1000, 5000], [16000, 5000], "1.2", "0.1");
  await expect(route).toHaveAttribute("data-outcome", "conflict");
  await expect(page.getByTestId("check-drawn-route")).toHaveAttribute("data-outcome", "fits");

  // A narrower item through the 0.80 m doorway: a shape the drawing left out lies just past it.
  await page.getByTestId("route-pick-end").click();
  await clickPlan(page, "check-plan", 18500, 5000);
  await page.getByTestId("route-width").fill("0.6");
  await page.getByTestId("route-allowance").fill("");
  await page.getByTestId("check-show-drawn").click();
  await expect(route).toHaveAttribute("data-outcome", "cannot_determine");
  await expect(route).toContainText("an omitted SPLINE 117 on layer EQUIPMENT");
});
