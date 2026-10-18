// The public preview (ADR-054) on the production build, as anonymous visitors: the sample's
// move-and-check moment, a DXF reviewed and saved, a PDF/image marked by hand and saved,
// reopening in a fresh browser, one visitor unable to read another's upload, and the app with
// its API unreachable. Every test starts with no cookies and no stored state.
import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";

const FIXTURES = new URL("../../../../fixtures/", import.meta.url);
const LAYOUT_DXF = readFileSync(new URL("drawings/layout-checks-mm.dxf", FIXTURES));
const SKETCH = readFileSync(new URL("plans/rough-cell.png", FIXTURES));

/** A visitor's own copy of a file: different bytes, so it is not one of the shared samples. */
const privateDxf = Buffer.concat([Buffer.from("999\nA private copy for this test\n"), LAYOUT_DXF]);
function privatePng(): Buffer {
  // A PNG with one extra text chunk before IEND: still a valid image, different bytes.
  const crc = (data: Buffer) => {
    let c = ~0;
    for (const byte of data) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c >>> 0) & 0xffffffff;
  };
  const body = Buffer.concat([Buffer.from("tEXt"), Buffer.from("Comment\0private copy")]);
  const chunk = Buffer.alloc(12 + body.length - 4);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc(body), 4 + body.length);
  const iend = SKETCH.length - 12;
  return Buffer.concat([SKETCH.subarray(0, iend), chunk, SKETCH.subarray(iend)]);
}

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

const loaded = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);

/** Save the project (a download) and return its text. */
async function save(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  return { name: download.suggestedFilename(), text: readFileSync((await download.path())!, "utf8") };
}

/** Reopen a saved project in a brand-new browser context: a different, cookie-less visitor. */
async function reopenElsewhere(browser: Browser, saved: { name: string; text: string }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  await loaded(page, 12);
  await page.getByTestId("scene-file-input").setInputFiles({ name: saved.name, mimeType: "application/json", buffer: Buffer.from(saved.text) });
  return { context, page };
}

test("the first screen is the sample: move Machine B and the aisle route goes from clear to blocked", { tag: "@public" }, async ({ page }) => {
  const started = Date.now();
  await page.goto("/");
  await loaded(page, 12);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-renderer", "ready");
  const ready = Date.now() - started;
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), bytes: performance.getEntriesByType("resource").reduce((n, r) => n + ((r as PerformanceResourceTiming).transferSize || 0), 0) };
  });
  console.log(`PUBLIC first screen: DOMContentLoaded ${timing.domContentLoaded} ms, load ${timing.load} ms, sample drawn ${ready} ms, ${Math.round(timing.bytes / 1024)} KB transferred`);
  await expect(page.getByTestId("start-panel")).toHaveCount(0); // no start dialog in front of the sample
  await expect(page.getByTestId("preview-badge")).toContainText("Early preview");

  const guide = page.getByTestId("sample-guide");
  await expect(guide).toContainText("Machine B is selected");
  await expect(page.getByTestId("selection-card")).toContainText("Machine B");
  const route = page.getByTestId("route-outcome");
  await expect(route).toHaveAttribute("data-outcome", "fits");
  await expect(page.getByTestId("route-scope")).toHaveText("Width-only route; turning not evaluated.");
  await expect(guide.getByTestId("sample-route")).toContainText("it is clear");

  await guide.getByTestId("sample-move").click();
  await expect(route).toHaveAttribute("data-outcome", "conflict");
  await expect(page.getByTestId("check-drawn-route")).toHaveAttribute("data-outcome", "fits");
  await expect(page.getByTestId("check-now-route")).toHaveAttribute("data-outcome", "conflict");
  await expect(page.getByTestId("sample-blocked")).toContainText("Blocked.");
  await page.getByTestId("undo").click();
  await expect(route).toHaveAttribute("data-outcome", "fits");
});

test("no AI anywhere in the preview, and the about panel says where files go", { tag: "@public" }, async ({ page }) => {
  await page.goto("/");
  await loaded(page, 12);
  const status = await page.evaluate(async () => (await fetch("/api/v1/assist/status")).json());
  expect(status.available).toBe(false); // although the server's environment holds a key
  await page.getByTestId("open-start").click();
  await expect(page.getByTestId("start-sample")).toBeVisible();
  await expect(page.getByTestId("start-describe")).toHaveCount(0);
  await expect(page.getByTestId("start-image")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("preview-badge").click();
  const about = page.getByTestId("about-preview");
  await expect(about.getByTestId("about-storage")).toContainText("deleted 24 hours after you upload them");
  await expect(about.getByTestId("about-feedback")).toHaveAttribute("href", "https://github.com/ritwiz06/ReplayWorldStudio/issues/new");
  await expect(about).toContainText("please do not post private drawings");
  // No secret reaches the browser: the built scripts hold no key value.
  const scripts = await page.evaluate(async () => {
    const urls = [...document.querySelectorAll("script[src]")].map((s) => (s as HTMLScriptElement).src);
    return (await Promise.all(urls.map(async (u) => (await fetch(u)).text()))).join("\n");
  });
  expect(scripts).not.toContain("public-build-test-placeholder");
});

test("a DXF is reviewed, saved and reopened by another visitor; that visitor cannot read the upload", { tag: "@public" }, async ({ page, browser }) => {
  await page.goto("/");
  await loaded(page, 12);
  await page.getByTestId("sample-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles({ name: "my-hall.dxf", mimeType: "application/dxf", buffer: privateDxf });
  await page.getByTestId("drawing-open").click();
  await loaded(page, 12);
  const review = page.getByTestId("drawing-review");
  await review.getByTestId("review-floor-accept").click();
  await review.getByTestId("review-scale-accept").click();
  await review.getByTestId("review-accept-remaining").click();
  await review.getByTestId("review-omissions-accept").click();
  await expect(review.getByTestId("review-ready")).toContainText("Reviewed");
  const saved = await save(page);
  const project = JSON.parse(saved.text);
  const uri: string = project.sources[0].drawing.file.uri;
  // This visitor can check their file; another cannot, even knowing its exact name (the hash).
  const own = await page.evaluate(async (body) => (await fetch("/api/v1/projects/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body })).json(), saved.text);
  expect(own.missing_source_files).toEqual([]);

  const other = await reopenElsewhere(browser, saved);
  await loaded(other.page, 12); // the layout opens from the project file itself
  const theirs = await other.page.evaluate(async (body) => (await fetch("/api/v1/projects/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body })).json(), saved.text);
  expect(theirs.missing_source_files).toEqual([uri]);
  await other.page.getByTestId("drawing-tab-drawing").click();
  await expect(other.page.getByTestId("source-drawing")).toContainText("the original file is not in this computer's source library");
  await other.context.close();
});

test("a plan picture is marked by hand, saved and reopened; its picture stays private to its visitor", { tag: "@public" }, async ({ page, browser }) => {
  await page.goto("/");
  await loaded(page, 12);
  await page.getByTestId("sample-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles({ name: "my-cell.png", mimeType: "image/png", buffer: privatePng() });
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.locator("image.plan-raster")).toBeVisible();
  await expect(dialog.getByTestId("plan-propose")).toHaveCount(0); // no AI in the preview
  await expect(dialog.getByTestId("plan-no-ai")).toContainText("AI proposals are off here");
  await clickPlan(page, "drawing-plan", sketch(0, 8));
  await clickPlan(page, "drawing-plan", sketch(12, 8));
  await page.getByTestId("plan-length").fill("12");
  await dialog.getByTestId("plan-manual").click();
  await page.getByTestId("drawing-open").click();
  await loaded(page, 1);
  const review = page.getByTestId("drawing-review");
  await page.getByTestId("review-zoom-4").click();
  await review.getByTestId("review-floor-trace").click();
  for (const corner of [sketch(0, 0), sketch(12, 0), sketch(12, 8), sketch(0, 8)]) await clickPlan(page, "review-plan", corner);
  await review.getByTestId("review-floor-finish").click();
  await review.getByTestId("review-add-object").click();
  for (const corner of [sketch(7.5, 1), sketch(10.5, 1), sketch(10.5, 4)]) await clickPlan(page, "review-plan", corner);
  await loaded(page, 2);
  const saved = await save(page);
  const raster: string = JSON.parse(saved.text).sources[0].drawing.raster.uri;
  expect((await page.request.get(`/api/v1/sources/files/${raster}`)).status()).toBe(200);

  const other = await reopenElsewhere(browser, saved);
  await loaded(other.page, 2); // the traced layout reopens; the picture is this visitor's to re-upload
  expect((await other.page.request.get(`/api/v1/sources/files/${raster}`)).status()).toBe(404);
  await other.context.close();

  // "Delete my uploaded files now" removes them at once.
  await page.getByTestId("preview-badge").click();
  await page.getByTestId("about-clear").click();
  await expect(page.getByTestId("about-cleared")).toBeVisible();
  expect((await page.request.get(`/api/v1/sources/files/${raster}`)).status()).toBe(404);
});

test("with the API unreachable, the page says so and offers to try again", { tag: "@public" }, async ({ page }) => {
  await page.route("**/api/v1/**", (r) => r.abort("connectionrefused"));
  await page.route("**/health", (r) => r.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page.unroute("**/api/v1/**");
  await page.unroute("**/health");
  await page.getByTestId("load-error").getByRole("button", { name: /try again|retry/i }).click();
  await loaded(page, 12);
});
