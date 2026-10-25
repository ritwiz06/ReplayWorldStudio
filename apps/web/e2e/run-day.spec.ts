// Run a day (SIM-01..04) in the browser: one click from the first screen opens the sample hall's
// example shift and plays it; the 3D view shows workers, items, machine states and queues from
// the run's events; pausing, changing speed and switching camera never change the result; moving
// Machine B into the aisle and running again blocks the material route honestly; the comparison
// with the original layout says why; and the process survives save and reopen, giving the same
// events again. Software WebGL: this checks behaviour, never frame rate.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const SIMPLE = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }, { name: "rws.view", value: "editor" }] }] };
test.use({ storageState: SIMPLE });

/** Show one moment of the shift (ms from its start), as dragging the timeline does. */
async function seek(page: Page, ms: number) {
  await page.getByTestId("run-timeline").evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(ms));
}

test("run a day: play the example shift, edit the layout, run again, compare, save and reopen", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");

  // One click from the first screen: the sample hall opens and its example shift plays.
  await page.getByTestId("journey-run").click();
  const bar = page.getByTestId("run-bar");
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-playing", "true");
  const panel = page.getByTestId("run-panel");
  await expect(panel).toHaveAttribute("data-outcome", "ready");
  await expect(page.getByTestId("run-name")).toHaveText("Example shift: mixing, forming and packing");
  await expect(panel).toContainText("Example shift · assumptions");
  await expect(page.getByTestId("run-scope")).toContainText("does not verify real productivity, worker safety, forces, structural strength or chemistry");
  const fingerprint = await panel.getAttribute("data-fingerprint");
  expect(fingerprint).toMatch(/^[0-9a-f]{14}$/);
  const completed = Number(await page.getByTestId("run-completed").textContent());
  expect(completed).toBeGreaterThan(80);

  // The scene shows the run: at the start Worker 1 walks to fetch the first batch.
  await page.getByTestId("run-pause").click();
  await seek(page, 5_000);
  await expect(page.getByTestId("run-worker-worker-1")).toHaveAttribute("data-activity", "walking");
  // A batch carried, a machine cycling, a queue and completed batches, at moments of the shift.
  let carried = false;
  for (let ms = 30_000; ms < 600_000 && !carried; ms += 15_000) {
    await seek(page, ms);
    carried = (await page.locator('[data-testid^="run-worker-"][data-carrying="true"]').count()) > 0;
  }
  expect(carried).toBe(true);
  await seek(page, 2 * 3600_000);
  await expect(page.getByTestId("run-bar-clock")).toHaveText("08:00");
  await expect(page.locator('[data-testid^="run-station-"][data-state="running"], [data-testid^="run-station-"][data-state="loading"]').first()).toBeVisible();
  await expect(page.getByTestId("run-station-packing")).toContainText(/queue [1-4]\/4/);
  expect(Number(await page.getByTestId("run-bar-completed").getAttribute("data-completed"))).toBeGreaterThan(10);
  // The morning break: every worker rests.
  await seek(page, 3 * 3600_000 + 600_000);
  await expect(page.getByTestId("run-now-worker-3")).toHaveAttribute("data-activity", "break");

  // Playing, changing speed and switching camera choose what is shown, never what happened.
  await page.getByTestId("run-speed").selectOption("600");
  await page.getByTestId("run-play").click();
  await page.waitForTimeout(500);
  const before = Number(await bar.getAttribute("data-t"));
  for (const mode of ["mode-top", "mode-walk", "mode-orbit"]) {
    await page.getByTestId(mode).click();
    await expect(bar).toBeVisible();
  }
  await page.waitForTimeout(300);
  expect(Number(await bar.getAttribute("data-t"))).toBeGreaterThan(before);
  await page.getByTestId("run-pause").click();
  await expect(panel).toHaveAttribute("data-fingerprint", fingerprint!);
  await page.getByTestId("run-restart").click();
  await expect(page.getByTestId("run-bar-clock")).toHaveText("06:00");
  await expect(panel).toHaveAttribute("data-fingerprint", fingerprint!);

  // Edit the layout: Machine B into the aisle. The run is for the old layout until run again.
  await page.getByTestId("sample-move").click();
  await expect(page.getByTestId("run-stale-notice")).toBeVisible();
  await page.getByTestId("run-again-bar").click();
  await expect(panel).toHaveAttribute("data-outcome", "blocked");
  await expect(page.getByTestId("run-problem")).toContainText("Rack A (material) ↔ Mixer is blocked");
  await expect(page.getByTestId("run-problem")).toContainText("narrows to 0.50 m between Rack A and Machine B");
  await expect(page.getByTestId("run-completed")).toHaveText("0");
  const blockedFingerprint = await panel.getAttribute("data-fingerprint");

  // Compare with the original layout: same process, seed and engine; only the layout differs.
  await page.getByTestId("drawing-tab-run").click();
  await page.getByTestId("run-compare-button").click();
  const explanation = page.getByTestId("run-explanation");
  await expect(explanation).toContainText("Rack A (material) ↔ Mixer is blocked in the edited layout");
  await expect(explanation).toContainText(`Output goes from ${completed} to 0 completed batches`);
  await expect(page.getByTestId("run-compare-table").locator("tr", { hasText: "Completed batches" })).toContainText(`${completed}0−${completed}`);

  // Save, reopen: the process is kept, and running it again gives the same events.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const saved = JSON.parse(text) as { schema_version: string; process: { name: string; seed: number } | null };
  expect(saved.schema_version).toBe("0.15.0");
  expect(saved.process).toMatchObject({ name: "Example shift: mixing, forming and packing", seed: 1 });
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("journey-run").click();
  await expect(panel).toHaveAttribute("data-outcome", "blocked");
  await expect(panel).toHaveAttribute("data-fingerprint", blockedFingerprint!);
});

test("guided set up a day on an uploaded plan: suggested stations reviewed, one typed pace, examples accepted, undo", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(new URL("../../../fixtures/drawings/layout-checks-mm.dxf", import.meta.url).pathname);
  await page.getByTestId("drawing-open").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  const review = page.getByTestId("drawing-review");
  await review.getByTestId("review-floor-accept").click();
  await review.getByTestId("review-scale-accept").click();
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();

  await page.getByTestId("journey-run").click();
  const guided = page.getByTestId("guided-setup");
  await expect(guided.getByTestId("guided-needs")).toContainText("Choose the stations in process order");
  await expect(guided.getByTestId("guided-run")).toBeDisabled();

  // Suggest setup (a recorded live answer): stations and order only, reviewed before use.
  await guided.getByTestId("guided-suggest").locator("summary").click();
  await guided.getByTestId("guided-suggest-text").fill("Material is taken from Rack A, mixed in the Mixer, formed on Machine B and packed at the packing table.");
  await guided.getByTestId("guided-suggest-button").click();
  const suggestion = guided.getByTestId("guided-suggestion");
  await expect(suggestion).toContainText("a recorded answer, not live");
  await expect(suggestion).toContainText("Rack A → Mixer → Machine B → Packing table");
  await expect(guided.getByTestId("guided-questions")).toContainText("How long does mixing take in the Mixer?");
  await expect(guided.getByTestId("guided-stations").locator("li")).toHaveCount(0); // nothing applied yet
  await guided.getByTestId("guided-use-suggestion").click();
  await expect(guided.getByTestId("guided-stations").locator("li")).toHaveCount(4);

  // Reorder, remove, and a duplicate name, each said plainly.
  await guided.getByTestId("guided-station-3-remove").click();
  await guided.getByTestId("guided-station-2-up").click();
  await expect(guided.getByTestId("guided-station-1-name")).toHaveValue("Machine B");
  await guided.getByTestId("guided-station-1-down").click();
  await guided.getByTestId("guided-station-2-name").fill("Mixer");
  await expect(guided.getByTestId("guided-needs")).toContainText("Two stations are called “Mixer”: give each its own name");
  await guided.getByTestId("guided-station-2-name").fill("Former");

  // One typed value; everything else is an example to accept.
  await guided.getByTestId("guided-item").fill("batch");
  const mixerPace = guided.locator('[data-testid^="guided-pace-"]').first();
  await mixerPace.fill("4");
  await expect(guided.getByTestId("guided-pending")).toContainText("to accept or change before Run");
  await expect(guided.locator('[data-basis="example"][data-accepted="false"]').first()).toContainText("Example assumption — please accept or change");
  await expect(guided.getByTestId("guided-run")).toBeDisabled();
  await guided.getByTestId("guided-accept-all").click();
  await expect(guided.getByTestId("guided-routes-clear")).toContainText("Routes checked on the layout");
  await expect(guided.getByTestId("guided-run")).toBeEnabled();
  await guided.getByTestId("guided-run").click();

  // The run: the panel separates typed values from accepted illustrative ones.
  const panel = page.getByTestId("run-panel");
  await expect(panel).toHaveAttribute("data-outcome", "ready");
  await expect(page.getByTestId("run-value-counts")).toContainText(/you entered 1 value · illustrative, accepted \d+ assumptions/);
  await page.getByTestId("run-assumptions").locator("summary").click();
  await expect(page.getByTestId("run-assumptions").locator(".basis-entered").first()).toHaveText("you entered");
  await expect(page.getByTestId("run-assumptions").locator(".basis-example").first()).toHaveText("illustrative, accepted");
  expect(Number(await page.getByTestId("run-completed").textContent())).toBeGreaterThan(50);
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");

  // One undo removes the process again; redo restores it.
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("guided-setup")).toBeVisible();
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("run-change-setup")).toBeVisible();
});
