// External-drawing evaluation (local only): the CC0 "Garage and workshop - 72 m2" DXF from
// innerscene.com, downloaded into the git-ignored data/external/ (docs/external-drawings.md).
// The whole guided journey on a real third-party drawing: upload, review (trace the floor, mark
// the title block as not objects and the door/window/hatch layers as drawing symbols), guided
// setup with one typed pace and accepted examples, play, move the workbench, run again, compare,
// undo, save, reopen, and the same events again. Skipped when the file is not downloaded, so it
// never runs in CI (run with test:e2e:external). Counts clicks, characters typed and the time of each phase: a scripted
// measurement, not a user study.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const DXF = `${ROOT}data/external/innerscene/garage-and-workshop-72-m2.dxf`;
const OUT = `${ROOT}data/external/results`;
/** How far the workbench is moved east (m): 1.5 by default, MOVE_M to try another distance. */
const MOVE_M = Number(process.env.MOVE_M ?? "1.5");
const SIMPLE = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: SIMPLE, viewport: { width: 1440, height: 900 } });

const tally = { clicks: 0, typed: 0 };
const click = async (page: Page, testId: string) => {
  tally.clicks++;
  await page.getByTestId(testId).click();
};
const type = async (page: Page, testId: string, text: string) => {
  tally.typed += text.length;
  await page.getByTestId(testId).fill(text);
};

/** Click a point given in drawing units on a plan. */
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
  tally.clicks++;
  await page.mouse.click(at.x, at.y);
}

test("external: the CC0 workshop DXF through the whole guided Run a day journey", async ({ page }) => {
  test.skip(!existsSync(DXF), "data/external/innerscene/garage-and-workshop-72-m2.dxf is not downloaded");
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const phases: Record<string, number> = {};
  let started = Date.now();
  const phase = (name: string) => {
    phases[name] = Date.now() - started;
    started = Date.now();
  };

  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  phase("open the app");

  // Upload.
  await click(page, "journey-upload");
  tally.clicks++;
  await page.getByTestId("drawing-file-input").setInputFiles(DXF);
  await expect(page.getByTestId("drawing-import").getByTestId("drawing-summary")).toBeVisible();
  const summary = await page.getByTestId("drawing-import").getByTestId("drawing-summary").textContent();
  await click(page, "drawing-open");
  await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded · \d+ objects/);
  phase("upload and open the draft");

  // Review: trace the floor on the outside corners of the walls (the drawing has no floor
  // outline), mark the title block's shapes as not objects, accept the rest, and mark the
  // layers that only hold drawing symbols.
  const review = page.getByTestId("drawing-review");
  await click(page, "review-floor-trace");
  for (const [x, y] of [[0, 0], [9000, 0], [9000, 8000], [0, 8000]] as const) await clickPlan(page, "review-plan", x, y);
  await click(page, "review-floor-finish");
  await expect(review.getByTestId("review-floor")).toContainText("Floor (traced)");
  await click(page, "review-scale-accept");
  for (const id of ["obj-dxf-84", "obj-dxf-88"]) {
    tally.clicks++;
    await page.getByTestId(`review-plan-object-${id}`).click({ force: true });
    await click(page, "review-kind-none");
  }
  await click(page, "review-accept-remaining");
  await click(page, "review-omissions-accept");
  for (const layer of ["DOORS", "WINDOWS", "WALLS", "DIMENSIONS", "TITLE_BLOCK"]) await click(page, `review-symbols-${layer}`);
  await expect(review.getByTestId("review-ready")).toContainText("Reviewed");
  phase("review");
  await page.screenshot({ path: `${OUT}/workshop-1-reviewed-1440.png` });

  // Guided setup: three stations from the layout, renamed (the drawing calls them all
  // "Fixtures n"), one typed pace, examples accepted.
  await click(page, "journey-run");
  const guided = page.getByTestId("guided-setup");
  for (const name of ["Fixtures 7", "Fixtures 5", "Fixtures 6"]) {
    tally.clicks += 2;
    await guided.getByTestId("guided-add").selectOption({ label: name });
  }
  await expect(guided.getByTestId("guided-needs")).toContainText("Rename station 1 (“Fixtures 7”): several objects are called “Fixtures …”");
  await page.screenshot({ path: `${OUT}/workshop-2-ambiguous-names-1440.png` });
  await type(page, "guided-station-0-name", "Store shelving");
  await type(page, "guided-station-1-name", "Workbench");
  await type(page, "guided-station-2-name", "Kit cabinet");
  await type(page, "guided-item", "kit");
  await type(page, "guided-pace-obj-dxf-70", "6");
  await expect(guided.getByTestId("guided-pending")).toBeVisible();
  await expect(guided.getByTestId("guided-run")).toBeDisabled();
  await click(page, "guided-accept-all");
  await expect(guided.getByTestId("guided-routes-clear")).toContainText("Routes checked on the layout");
  const routes = await guided.getByTestId("guided-routes-clear").textContent();
  await page.screenshot({ path: `${OUT}/workshop-3-guided-1440.png` });
  await click(page, "guided-run");
  phase("guided setup");

  // Play.
  const panel = page.getByTestId("run-panel");
  await expect(panel).toHaveAttribute("data-outcome", "ready");
  await expect(page.getByTestId("run-bar")).toBeVisible();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/workshop-4-playing-1440.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/workshop-4-playing-1280.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  const original = { fingerprint: await panel.getAttribute("data-fingerprint"), completed: Number(await page.getByTestId("run-completed").textContent()) };
  phase("watch");

  // Move the workbench east (closer to the workshop door), run the same shift again, compare.
  await click(page, "run-pause");
  tally.clicks++;
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  tally.clicks++;
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Fixtures 5/ }).click();
  await click(page, "journey-change");
  const x = page.getByTestId("field-position-x");
  const before = Number(await x.inputValue());
  await type(page, "field-position-x", (before + MOVE_M).toFixed(3));
  await x.press("Enter");
  await click(page, "run-again-bar");
  await expect(panel).not.toHaveAttribute("data-fingerprint", original.fingerprint!);
  const edited = { fingerprint: await panel.getAttribute("data-fingerprint"), completed: Number(await page.getByTestId("run-completed").textContent()), outcome: await panel.getAttribute("data-outcome") };
  await click(page, "drawing-tab-run");
  await click(page, "run-compare-button");
  const explanation = (await page.getByTestId("run-explanation").locator("li").allTextContents()).map((t) => t.trim());
  const table = (await page.getByTestId("run-compare-table").locator("tbody tr").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  await page.screenshot({ path: `${OUT}/workshop-5-compare-${MOVE_M}-1440.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/workshop-5-compare-${MOVE_M}-1280.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  phase("move, run again, compare");

  // Undo the move: the same shift on the original layout gives the original events again.
  await click(page, "undo");
  await click(page, "run-again-bar");
  await expect(panel).toHaveAttribute("data-fingerprint", original.fingerprint!);
  // Save, reopen in a fresh page, run: identical again.
  tally.clicks++;
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  writeFileSync(`${OUT}/workshop-project.json`, text);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  tally.clicks++;
  await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded · \d+ objects/);
  await click(page, "journey-run");
  await expect(panel).toHaveAttribute("data-fingerprint", original.fingerprint!);
  phase("undo, save, reopen, replay");

  const report = { summary, routes, original, edited, explanation, table, phases, clicks: tally.clicks, typed: tally.typed };
  writeFileSync(`${OUT}/workshop-journey-move-${MOVE_M}.json`, JSON.stringify({ moveM: MOVE_M, ...report }, null, 2));
  console.log(JSON.stringify(report, null, 2));
  expect(edited.fingerprint).not.toBe(original.fingerprint);
});
