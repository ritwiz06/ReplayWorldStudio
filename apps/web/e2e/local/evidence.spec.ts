// REL-01 on the app as `pnpm start` serves it (no .env, no key): the committed sample bundle
// (docs/demo/*.zip) opens and both layouts run again with the recorded events; playback speed,
// pausing, scrubbing and the camera never change them; the project saved and reopened exports a
// bundle with the same runs; and the sample's before/after and its export are timed, as a
// scripted measurement (not a user study).
import { readdirSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const BUNDLE = readdirSync(`${ROOT}docs/demo`).find((f) => /^sample-factory-hall-synthetic-run-[0-9a-f]{14}\.zip$/.test(f))!;

async function fresh(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded · \d+ objects/);
}

async function rows(page: Page) {
  return Object.fromEntries(
    await page
      .getByTestId("bundle-rows")
      .locator("tbody tr")
      .evaluateAll((trs) => trs.map((tr) => [`${tr.children[0]!.textContent} ${tr.children[1]!.textContent}`, (tr.children[2] as HTMLElement).title])),
  ) as Record<string, string>;
}

// The first screen's start panel has its own journey (local.spec.ts); these open the editor.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("rws.start.seen", "1"));
});

test("the committed sample bundle reruns with the recorded events; playback never changes them; save, reopen and export again", async ({ page }) => {
  test.setTimeout(240_000);
  await fresh(page);
  await page.getByTestId("scene-file-input").setInputFiles(`${ROOT}docs/demo/${BUNDLE}`);
  const check = page.getByTestId("bundle-check");
  await expect(check).toContainText("8 files checked against its manifest");
  await check.getByTestId("bundle-rerun").click();
  await expect(check).toHaveAttribute("data-same", "true");
  const recorded = await rows(page);
  expect(recorded["original completed batches"]).toBe("102");
  expect(recorded["edited completed batches"]).toBe("0");
  expect(recorded["edited blocked or undetermined routes"]).toContain("Rack A (material) ↔ Mixer is blocked");
  expect(recorded["both explanation"]).toContain("narrows to 0.50 m between Rack A and Machine B");
  const panel = page.getByTestId("run-panel");
  const edited = await panel.getAttribute("data-fingerprint");
  expect(BUNDLE).toContain(edited!);

  // Speed, pausing, scrubbing and the camera choose what is shown, never what happened.
  await page.getByTestId("run-speed").selectOption("600");
  await page.waitForTimeout(1500);
  await page.getByTestId("run-pause").click();
  await page.getByTestId("run-timeline").evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "7200000");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const mode of ["mode-top", "mode-walk", "mode-orbit"]) await page.getByTestId(mode).click();
  await expect(panel).toHaveAttribute("data-fingerprint", edited!);
  await page.getByTestId("drawing-tab-run").click();
  await expect(page.getByTestId("run-explanation")).toContainText("Rack A (material) ↔ Mixer is blocked in the edited layout");

  // Save, reopen the project file, run and compare again, and export: the same runs.
  const [saved] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await saved.path())!, "utf8");
  await fresh(page);
  await page.getByTestId("scene-file-input").setInputFiles({ name: saved.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("journey-run").click();
  await expect(panel).toHaveAttribute("data-fingerprint", edited!);
  await page.getByTestId("run-compare-button").click();
  await page.getByTestId("run-export").click();
  const [again] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-save").click()]);
  expect(again.suggestedFilename()).toBe(BUNDLE);
  const zip = readFileSync((await again.path())!);
  await page.getByTestId("export-close").click();
  await fresh(page);
  await page.getByTestId("scene-file-input").setInputFiles({ name: "after-reopen.zip", mimeType: "application/zip", buffer: zip });
  await page.getByTestId("bundle-rerun").click();
  await expect(page.getByTestId("bundle-check")).toHaveAttribute("data-same", "true");
  const afterReopen = await rows(page);
  for (const key of Object.keys(recorded)) expect.soft(afterReopen[key], key).toBe(recorded[key]);
});

test("timed: the sample's before and after, and its export (scripted, not a user study)", async ({ page }) => {
  test.setTimeout(180_000);
  await fresh(page);
  let clicks = 0;
  const started = Date.now();
  await page.getByTestId("journey-run").click();
  clicks++;
  await expect(page.getByTestId("run-panel")).toHaveAttribute("data-outcome", "ready", { timeout: 30_000 });
  await page.getByTestId("example-start").click();
  clicks++;
  for (let step = 0; step < 5; step++) {
    await page.getByTestId("example-next").click();
    clicks++;
    await expect(page.getByTestId("show-example")).toHaveAttribute("data-step", String(step + 1));
    if (step === 3) {
      // Export between compare and undo, timed on its own.
      const exportStarted = Date.now();
      await page.getByTestId("run-export").click();
      await expect(page.getByTestId("export-replay")).toHaveAttribute("data-replay", "full");
      await Promise.all([page.waitForEvent("download"), page.getByTestId("export-save").click()]);
      await expect(page.getByTestId("export-done")).toBeVisible();
      const exportMs = Date.now() - exportStarted;
      await page.getByTestId("export-close").click();
      test.info().annotations.push({ type: "export", description: `3 clicks, ${exportMs} ms` });
    }
  }
  await expect(page.getByTestId("example-result")).toContainText("the same events as the first run");
  const total = Date.now() - started;
  test.info().annotations.push({ type: "replay", description: `${clicks} clicks, ${total} ms including the export` });
  console.log(JSON.stringify(test.info().annotations));
});
