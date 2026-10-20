// IMP-03: upload a floor-plan PDF or picture on the simple screen. The plan appears at once;
// one known length gives the scale; the vision model's draft (recorded live answers, replayed)
// or the person's own marking gives the objects; the review traces outlines precisely; Check
// layout answers only as far as the outlines and scale were traced. The plans are synthetic,
// with known geometry (fixtures/plans/plans.truth.json).
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const PLANS = new URL("../../../fixtures/plans/", import.meta.url);
const HALL = new URL("packing-hall.pdf", PLANS).pathname;
const SKETCH = new URL("rough-cell.png", PLANS).pathname;
const TRUTH = JSON.parse(readFileSync(new URL("plans.truth.json", PLANS), "utf8"));
const PX: number = TRUTH["packing-hall.pdf"].px_per_m;
const SIMPLE = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }, { name: "rws.view", value: "editor" }] }] };

test.use({ storageState: SIMPLE });

/** Metres on the hall plan (from the hall's outer south-west corner) -> page pixels. */
const hall = (x: number, y: number): [number, number] => [302.38 + x * PX, 579.56 + y * PX];
/** Metres on the sketch (from the room's south-west inner corner) -> picture pixels; it is turned 1.5 degrees. */
function sketch(x: number, y: number): [number, number] {
  const a = (1.5 * Math.PI) / 180;
  const px = 180 + x * 100 - 800;
  const py = 190 + y * 100 - 550;
  return [800 + px * Math.cos(a) - py * Math.sin(a), 550 + px * Math.sin(a) + py * Math.cos(a)];
}

/** Click a point (plan units) on a plan, first scrolling a zoomed plan so the point is in view. */
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

const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);
const outline = (page: Page, name: string) => page.getByTestId("review-plan").locator("[data-drawn]", { has: page.locator(`title:text-is("${name}")`) });

/** Trace a rectangle by three corners after selecting its outline on the review plan. */
async function trace(page: Page, name: string, corners: [number, number][]) {
  await outline(page, name).first().click();
  await page.getByTestId("review-object").getByTestId("review-trace").click();
  for (const c of corners) await clickPlan(page, "review-plan", c);
  await expect(page.getByTestId("review-object")).toContainText("traced to within");
}

async function askRoute(page: Page, a: [number, number], b: [number, number], width: string, allowance: string) {
  await page.getByTestId("route-pick-start").click();
  await clickPlan(page, "check-plan", a);
  await clickPlan(page, "check-plan", b);
  await page.getByTestId("route-width").fill(width);
  await page.getByTestId("route-allowance").fill(allowance);
}

async function timings(page: Page) {
  return page.getByTestId("drawing-import").evaluate((d) => ({ plan: Number(d.dataset.planMs), model: Number(d.dataset.modelMs ?? NaN), draft: Number(d.dataset.draftMs) }));
}

test("a clean two-page PDF becomes a walkable draft whose aisle check is honest about tracing", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 120_000);
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(HALL);

  // Two pages: choose the plan. The page appears at once, with nothing sized yet.
  await expect(page.getByTestId("plan-pages")).toContainText("packing-hall.pdf has 2 pages.");
  await page.getByTestId("plan-page-2").click();
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.locator("image.plan-raster")).toBeVisible();
  await expect(dialog).toHaveAttribute("data-plan-ms", /\d+/);
  await expect(page.getByTestId("drawing-open")).toHaveText("Mark a length you know first");
  await expect(dialog.getByTestId("drawing-warnings")).toContainText("That is the sheet's size, not the room's");

  // One known length: the dimension line's ends, 24 000 mm apart.
  await clickPlan(page, "drawing-plan", hall(0, 15));
  await clickPlan(page, "drawing-plan", hall(24, 15));
  await page.getByTestId("plan-length").fill("24");
  await expect(page.getByTestId("plan-scale")).toContainText("1 px = 1.4 cm");
  await expect(page.getByTestId("drawing-open")).toHaveText("Propose the layout, or mark it yourself");

  // The model's draft (a recorded live answer): six objects and the floor, dashed.
  await page.getByTestId("plan-propose").click();
  await expect(page.getByTestId("plan-proposed")).toContainText("Proposed 6 objects and the floor outline");
  await expect(page.getByTestId("plan-proposed")).toContainText("(A recorded answer, not live.)");
  await expect(page.getByTestId("drawing-open")).toHaveText("Open the 3D draft");
  const timed = await timings(page);
  expect(timed.plan).toBeGreaterThan(0);
  expect(timed.draft).toBeGreaterThan(timed.plan);
  await page.getByTestId("drawing-open").click();
  await objects(page, 7);

  // The review is beside the 3D view, not over it.
  const review = page.getByTestId("drawing-review");
  await expect(review).toBeVisible();
  await expect(page.locator("aside.panel-drawing")).toBeVisible();
  await expect(review.getByTestId("review-scale")).toContainText("Scale from your known length 1 px = 1.4 cm (from your known length of 24.00 m)");
  await review.getByTestId("review-floor-accept").click();
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();
  await expect(review.getByTestId("review-ready")).toContainText("6 outlines are only proposed: trace the ones a check depends on.");

  // Check layout on proposals alone: never "fits", and it says what to trace.
  await page.getByTestId("journey-check").click();
  await askRoute(page, hall(1.5, 8.1), hall(16, 8.1), "1.2", "0.1");
  const route = page.getByTestId("route-outcome");
  await expect(route).toHaveAttribute("data-outcome", "cannot_determine");
  await expect(route).toContainText(/the floor's outline is only proposed from the picture: trace the floor in the review/i);

  // Trace the floor and the two racks, zoomed in.
  await page.getByTestId("drawing-tab-review").click();
  await page.getByTestId("review-zoom-4").click();
  await review.getByTestId("review-floor-trace").click();
  for (const corner of [hall(0.2, 0.2), hall(23.8, 0.2), hall(23.8, 13.8), hall(0.2, 13.8)]) await clickPlan(page, "review-plan", corner);
  await review.getByTestId("review-floor-finish").click();
  await expect(review.getByTestId("review-floor")).toContainText("Floor corrected Floor (traced) (an outline you traced on page 2), 23.6 m × 13.6 m");
  await page.getByTestId("drawing-tab-check").click();
  await expect(route).toHaveAttribute("data-outcome", "cannot_determine");
  await expect(route).toContainText("outline was only proposed from the plan picture");
  await page.getByTestId("drawing-tab-review").click();
  await trace(page, "Rack 1", [hall(0.5, 9.0), hall(12.5, 9.0), hall(12.5, 10.2)]);
  await trace(page, "Rack 2", [hall(0.5, 6.0), hall(12.5, 6.0), hall(12.5, 7.2)]);
  await trace(page, "Packing table", [hall(17, 9), hall(19, 9), hall(19, 10)]);
  await page.getByTestId("drawing-tab-check").click();
  await expect(route).toHaveAttribute("data-outcome", "fits");
  // 1.80 m drawn; traced by clicks that land on whole screen pixels, within a few centimetres.
  await expect(route).toContainText(/its narrowest passage is 1\.(7[6-9]|8[0-4]) m \(Rack 1 and Rack 2\)/);
  await page.getByTestId("check-details").locator("summary").click();
  await expect(page.getByTestId("check-details")).toContainText("traced outlines widened by up to");
  await expect(page.getByTestId("check-details")).toContainText("outlines only proposed from the picture kept 0.50 m farther away");

  // Walk through it.
  await page.getByTestId("journey-compare").click();
  await page.getByTestId("compare-walk").click();
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  await page.keyboard.press("Escape");

  // Move the packing table into the aisle's mouth: blocked now, still fits as drawn.
  await page.getByTestId("journey-check").click();
  await page.getByTestId("check-plan").locator("[data-drawn]", { has: page.locator('title:text-is("Packing table")') }).click();
  await page.getByTestId("selection-card").getByTestId("selection-details").click();
  for (const [axis, delta] of [
    ["x", -7.0],
    ["z", 1.4],
  ] as const) {
    const field = page.getByTestId(`field-position-${axis}`);
    await field.fill((Number(await field.inputValue()) + delta).toFixed(3));
    await field.press("Enter");
  }
  await page.getByTestId("details-toggle").click();
  await page.getByTestId("journey-check").click();
  await expect(route).toHaveAttribute("data-outcome", "conflict");
  await expect(route).toContainText("Packing table");
  await expect(page.getByTestId("check-drawn-route")).toHaveAttribute("data-outcome", "fits");
  await expect(page.getByTestId("check-now-route")).toHaveAttribute("data-outcome", "conflict");

  // Save and reopen: the page, the scale with its precision and each traced outline come back.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const saved = JSON.parse(text);
  const source = saved.sources[0];
  expect([saved.schema_version, source.kind, source.drawing.reader, source.drawing.raster.page]).toEqual(["0.14.0", "pdf", "rws-plan-image/1", 2]);
  expect(source.drawing.review.scale.reference.tolerance).toBeGreaterThan(0);
  const traced = source.drawing.objects.filter((o: { refs: { entity: string }[] }) => o.refs[0]!.entity === "TRACE");
  expect(traced.map((o: { label: string }) => o.label).sort()).toEqual(["Floor (traced)", "Packing table", "Rack 1", "Rack 2"]);
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await objects(page, 7);
  await expect(page.getByTestId("review-plan").locator("image.plan-raster")).toBeVisible();
  await page.getByTestId("journey-check").click();
  await askRoute(page, hall(1.5, 8.1), hall(16, 8.1), "1.2", "0.1");
  await expect(page.getByTestId("route-outcome")).toHaveAttribute("data-outcome", "conflict");
  await expect(page.getByTestId("check-drawn-route")).toHaveAttribute("data-outcome", "fits");

  // A later plan is kept with this world instead of replacing it (aligning it is ENR-01).
  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(SKETCH);
  await page.getByTestId("drawing-attach").click();
  await objects(page, 7);
  await expect(page.getByTestId("drawing-kept")).toContainText("Also kept with this world: rough-cell.png. Not aligned with this plan yet");
  await expect(page.getByTestId("route-pick-start")).toHaveCount(0); // the Drawing tab is shown; the world is unchanged
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("drawing-kept")).toHaveCount(0);
});

test("a rough sketch: a wrong proposal is removed, and the route fits only once its boundaries are traced", async ({ page }) => {
  test.setTimeout(process.env.CI ? 150_000 : 90_000);
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(SKETCH);
  await expect(page.getByTestId("drawing-import").locator("image.plan-raster")).toBeVisible(); // no page to choose
  await clickPlan(page, "drawing-plan", sketch(0, 8));
  await clickPlan(page, "drawing-plan", sketch(12, 8));
  await page.getByTestId("plan-length").fill("12");
  await expect(page.getByTestId("plan-scale")).toContainText(/1 px = 1(\.00\d)? cm/); // clicks land on whole screen pixels
  await page.getByTestId("plan-propose").click();
  await expect(page.getByTestId("plan-proposed")).toContainText("Proposed 6 objects and the floor outline");
  await page.getByTestId("drawing-open").click();
  await objects(page, 7);

  // "future cart?" is an idea drawn dashed, not an object: one click removes it, undoably.
  const review = page.getByTestId("drawing-review");
  await outline(page, "future cart?").first().click();
  await review.getByTestId("review-kind-none").check();
  await objects(page, 6);
  await page.getByTestId("undo").click();
  await objects(page, 7);
  await page.getByTestId("redo").click();
  await objects(page, 6);

  await page.getByTestId("review-zoom-4").click();
  await review.getByTestId("review-floor-trace").click();
  for (const corner of [sketch(0, 0), sketch(12, 0), sketch(12, 8), sketch(0, 8)]) await clickPlan(page, "review-plan", corner);
  await review.getByTestId("review-floor-finish").click();
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();

  // From inside the door to in front of the bench, a 1.40 m item with 0.10 m each side.
  await page.getByTestId("journey-check").click();
  await askRoute(page, sketch(5.6, 1.2), sketch(9.5, 5.4), "1.4", "0.1");
  const route = page.getByTestId("route-outcome");
  await expect(route).toHaveAttribute("data-outcome", "cannot_determine");
  await expect(route).toContainText("The only routes found pass Robot cell (Robot cell's outline was only proposed from the plan picture: trace it in the review to check it)");
  await expect(page.getByTestId("check-plan-route")).toHaveAttribute("data-outcome", "cannot_determine");

  await page.getByTestId("drawing-tab-review").click();
  await trace(page, "CNC 2", [sketch(4, 5.5), sketch(6, 5.5), sketch(6, 7)]);
  await trace(page, "Robot cell", [sketch(7.5, 1), sketch(10.5, 1), sketch(10.5, 4)]);
  await page.getByTestId("drawing-tab-check").click();
  await expect(route).toHaveAttribute("data-outcome", "fits");
  await expect(route).toContainText("Width-only route; turning not evaluated.");
});

test("with the model unavailable: cancel, retry, then mark the plan by hand", async ({ page }) => {
  test.setTimeout(process.env.CI ? 150_000 : 90_000);
  let calls = 0;
  await page.route("**/api/v1/assist/plan-proposals", async (r) => {
    calls += 1;
    if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 4000)); // slow: cancelled first
    await r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "The vision model is not available right now." }) });
  });
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(SKETCH);
  await clickPlan(page, "drawing-plan", sketch(0, 8));
  await clickPlan(page, "drawing-plan", sketch(12, 8));
  await page.getByTestId("plan-length").fill("12");

  await page.getByTestId("plan-propose").click();
  await expect(page.getByTestId("plan-proposing")).toBeVisible();
  await page.getByTestId("plan-cancel").click();
  await expect(page.getByTestId("plan-proposal")).toHaveAttribute("data-status", "idle");
  await page.getByTestId("plan-propose").click();
  await expect(page.getByTestId("plan-proposal-failed")).toContainText("The vision model is not available right now.");
  await page.getByTestId("plan-retry").click();
  await expect(page.getByTestId("plan-proposal-failed")).toBeVisible();
  await page.getByTestId("plan-proposal-failed").getByTestId("plan-manual").click();
  await expect(page.getByTestId("drawing-open")).toHaveText("Open the 3D draft");
  await page.getByTestId("drawing-open").click();
  await objects(page, 1); // the floor only: the picture's edge stands in until it is traced

  const review = page.getByTestId("drawing-review");
  await expect(review.getByTestId("review-floor")).toContainText("Edge of the picture (not a floor outline)");
  await page.getByTestId("review-zoom-4").click();
  await review.getByTestId("review-floor-trace").click();
  for (const corner of [sketch(0, 0), sketch(12, 0), sketch(12, 8), sketch(0, 8)]) await clickPlan(page, "review-plan", corner);
  await review.getByTestId("review-floor-finish").click();
  await review.getByTestId("review-add-object").click();
  for (const corner of [sketch(1, 5.5), sketch(3, 5.5), sketch(3, 7)]) await clickPlan(page, "review-plan", corner);
  await objects(page, 2);
  const card = review.getByTestId("review-object");
  await expect(card).toContainText("Added object 1 · added by you");
  await card.getByTestId("review-name").fill("CNC 1");
  await card.getByTestId("review-name").press("Enter");
  await review.getByTestId("review-omissions-accept").click();
  await page.getByTestId("journey-check").click();
  await expect(page.getByTestId("layout-outcome")).toHaveAttribute("data-outcome", "fits");
  await expect(page.getByTestId("layout-outcome")).toContainText("No overlaps, no object in a keep-clear zone and nothing past the floor's edge.");
});
