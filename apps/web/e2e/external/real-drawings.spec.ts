// External-drawing evaluation (local only; docs/external-drawings.md). Real drawings downloaded
// into the git-ignored data/external/: what the app does with them, recorded as it happens.
// Each test is skipped when its file is not there, so none runs in CI, and nothing here is
// committed from the sources. Screens and results go to data/external/results/ (git-ignored):
// the Hilti plans are CC BY-NC-SA 3.0 and are not to be published.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const EXT = `${ROOT}data/external`;
const OUT = `${EXT}/results`;
const SIMPLE = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: SIMPLE, viewport: { width: 1440, height: 900 } });

const save = (name: string, data: unknown) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 2));
  console.log(name, JSON.stringify(data, null, 2));
};

async function upload(page: Page, file: string) {
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("journey-upload").click();
  const started = Date.now();
  await page.getByTestId("drawing-file-input").setInputFiles(file);
  return started;
}

/** Click a pixel of the plan picture shown in `container`, wherever it is drawn on screen. */
async function clickPixel(page: Page, container: string, px: number, py: number, size: { w: number; h: number }) {
  const image = page.getByTestId(container).locator("image.plan-raster");
  const box = (await image.boundingBox())!;
  await page.mouse.click(box.x + (px / size.w) * box.width, box.y + (py / size.h) * box.height);
}

test("external: Hilti floor_UG1.dxf (real construction site, CC BY-NC-SA 3.0) imports and is reviewed", async ({ page }) => {
  const file = `${EXT}/hilti/floor_UG1.dxf`;
  test.skip(!existsSync(file), "not downloaded");
  test.setTimeout(180_000);
  const started = await upload(page, file);
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.getByTestId("drawing-summary")).toBeVisible({ timeout: 60_000 });
  const readMs = Date.now() - started;
  const summary = await dialog.getByTestId("drawing-summary").textContent();
  const units = await dialog.getByTestId("drawing-units").textContent();
  const skipped = (await dialog.getByTestId("drawing-skipped").count()) ? await dialog.getByTestId("drawing-skipped").textContent() : null;
  await page.screenshot({ path: `${OUT}/hilti-dxf-1-read-1440.png` });
  await dialog.getByTestId("drawing-open").click();
  await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded · \d+ objects/, { timeout: 60_000 });
  const objects = await page.getByTestId("scene-status").textContent();
  const review = page.getByTestId("drawing-review");
  const floor = await review.getByTestId("review-floor").textContent();
  await review.getByTestId("review-floor-accept").click();
  await review.getByTestId("review-scale-accept").click();
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();
  const ready = await review.getByTestId("review-ready").textContent();
  await page.screenshot({ path: `${OUT}/hilti-dxf-2-reviewed-1440.png` });
  await page.getByTestId("journey-run").click();
  const guided = await page.getByTestId("guided-setup").textContent();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${OUT}/hilti-dxf-3-run-tab-1280.png` });
  save("hilti-dxf", { readMs, summary, units, skipped, objects, floor, ready, runTab: guided?.slice(0, 600) });
});

test("external: pictures over 50 megapixels are refused with an instruction, and the open project kept", async ({ page }) => {
  const files = [`${EXT}/hilti/floor_UG1.png`, `${EXT}/loc/houston-white-sheet-00002a.png`].filter((f) => existsSync(f));
  test.skip(files.length === 0, "not downloaded");
  const refused: Record<string, string | null> = {};
  for (const file of files) {
    await upload(page, file);
    const error = page.getByTestId("drawing-error");
    await expect(error).toContainText("the limit is 50,000,000", { timeout: 90_000 });
    refused[file.split("/").pop()!] = await error.textContent();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  }
  save("large-pictures", refused);
});

test("external: Hilti floor_UG1 as an 8000 px copy is shown with no scale until a length is marked", async ({ page }) => {
  const file = `${EXT}/hilti/floor_UG1-8000.png`;
  test.skip(!existsSync(file), "no copy made");
  test.setTimeout(180_000);
  const started = await upload(page, file);
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.locator("image.plan-raster")).toBeVisible({ timeout: 90_000 });
  const shownMs = Date.now() - started;
  const open = await dialog.getByTestId("drawing-open").textContent();
  const warnings = (await dialog.getByTestId("drawing-warnings").count()) ? await dialog.getByTestId("drawing-warnings").textContent() : null;
  await page.screenshot({ path: `${OUT}/hilti-png-1-no-scale-1440.png` });
  expect(open).toContain("Mark a length you know first");
  save("hilti-png", { shownMs, openButton: open, warnings });
});

test("external: InnerScene studio DWG is refused with the export-to-DXF instruction and the open project kept", async ({ page }) => {
  const file = `${EXT}/innerscene/innerscene-studio-floor-plan.dwg`;
  test.skip(!existsSync(file), "not downloaded");
  await upload(page, file);
  const error = page.getByTestId("drawing-error");
  await expect(error).toContainText("DWG is not supported yet");
  const message = await error.textContent();
  await page.screenshot({ path: `${OUT}/dwg-1-refused-1440.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects"); // the open project is kept
  save("dwg", { message, projectKept: await page.getByTestId("scene-status").textContent() });
});

test("external: Houston-White Mill first floor (LOC HAER DE-6, 1975 measured drawing), 8000 px copy, scaled from its metric scale bar", async ({ page }) => {
  // The app's limit is 50 megapixels: this is the 8000 px copy (uniformly scaled, so the drawing's
  // proportions and its scale bar are unchanged). Pixel positions below are in the full image.
  const file = `${EXT}/loc/houston-white-sheet-00002a-8000.png`;
  test.skip(!existsSync(file), "no copy made");
  test.setTimeout(240_000);
  const size = { w: 14432, h: 9632 };
  const started = await upload(page, file);
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.locator("image.plan-raster")).toBeVisible({ timeout: 90_000 });
  const shownMs = Date.now() - started;
  await page.screenshot({ path: `${OUT}/loc-1-no-scale-1440.png` });
  const before = await dialog.getByTestId("drawing-open").textContent();
  // The 0 and 10 m ends of the drawing's "SCALE IN METERS" bar (located in the full-resolution
  // image): a scale printed on the sheet, not a guess.
  await clickPixel(page, "drawing-import", 11592, 8330, size);
  await clickPixel(page, "drawing-import", 12857, 8330, size);
  await page.getByTestId("plan-length").fill("10");
  const scale = await page.getByTestId("plan-scale").textContent();
  await page.screenshot({ path: `${OUT}/loc-2-scaled-1440.png` });
  await dialog.getByTestId("plan-manual").click();
  await dialog.getByTestId("drawing-open").click();
  await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded · \d+ objects/, { timeout: 60_000 });
  const review = page.getByTestId("drawing-review");
  const reviewScale = await review.getByTestId("review-scale").textContent();
  // Trace the Machine Shop (a rectangular room, lower left) as one object, by three corners.
  await review.getByTestId("review-add-object").click();
  for (const [x, y] of [[3305, 6905], [4455, 6905], [4455, 8205]] as const) await clickPixel(page, "drawing-review", x, y, size);
  await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded · \d+ objects/);
  const traced = await page.getByTestId("scene-status").textContent();
  const ready = await review.getByTestId("review-ready").textContent();
  await page.screenshot({ path: `${OUT}/loc-3-traced-1440.png` });
  save("loc", { shownMs, before, scale, reviewScale, traced, ready });
});
