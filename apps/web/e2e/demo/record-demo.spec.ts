// REL-01 demo recording (local only; never in CI). Drives the real app as `pnpm start` serves it
// (no .env, no key) through the synthetic sample's before/after with "Show the example", exports
// the run, and opens the ZIP again to rerun it. Frames come from the browser's own screencast;
// captions are a fixed overlay added to the page (pointer-events none), so every number on screen
// is the app's own. scripts/demo/frames-to-mp4.swift turns the frames into an H.264 MP4.
// Run with: pnpm --filter @replay-world/web exec playwright test -c playwright.demo.config.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const FRAMES = `${ROOT}apps/web/test-results/demo-frames`;
const OUT = `${ROOT}docs/demo`;

/** The caption bar and the standing label, added once per page load, over the 3D view only:
 * clear of the toolbar, the playback bar and the side panels. */
async function captions(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById("demo-caption")) return;
    // The 3D view at 1440 × 900 (measured from the app's layout): x 272-893, the playback bar
    // from y 768. The caption sits just above it and the label under the demonstration banner.
    const view = { left: 272, width: 621 };
    const centre = view.left + view.width / 2;
    const style = document.createElement("style");
    style.textContent = `
      #demo-label { position: fixed; top: 202px; left: ${centre}px; transform: translateX(-50%); z-index: 99999; pointer-events: none;
        background: rgba(240,180,41,.95); color: #111; font: 600 15px/1.2 system-ui, sans-serif; padding: 6px 14px; border-radius: 6px; white-space: nowrap; }
      #demo-caption { position: fixed; bottom: ${window.innerHeight - 760}px; left: ${centre}px; transform: translateX(-50%); z-index: 99999; pointer-events: none;
        width: ${view.width - 32}px; box-sizing: border-box; background: rgba(13,17,23,.92); color: #fff; font: 500 18px/1.35 system-ui, sans-serif;
        padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25); text-align: center; }
      #demo-caption:empty { display: none; }`;
    document.head.append(style);
    const label = document.createElement("div");
    label.id = "demo-label";
    label.textContent = "Synthetic example · results under stated assumptions";
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    document.body.append(label, caption);
  });
}

const say = (page: Page, text: string) => page.evaluate((t) => (document.getElementById("demo-caption")!.textContent = t), text);

test("record the REL-01 demo", async ({ page }) => {
  test.setTimeout(300_000);
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const frames: { file: string; t: number }[] = [];
  const marks: { label: string; t: number }[] = [];
  const clicks = { replay: 0, export: 0 };
  let session = await page.context().newCDPSession(page);
  const capture = async () => {
    session.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
      const file = `${String(frames.length).padStart(5, "0")}.jpg`;
      writeFileSync(`${FRAMES}/${file}`, Buffer.from(data, "base64"));
      frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
      await session.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    });
    await session.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  };
  const hold = (ms: number) => page.waitForTimeout(ms);
  const mark = (label: string) => marks.push({ label, t: Date.now() / 1000 });
  const click = async (testId: string, kind: keyof typeof clicks) => {
    clicks[kind]++;
    await page.getByTestId(testId).click();
  };

  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await captions(page);
  await capture();
  const started = Date.now();
  mark("start");
  await say(page, "Replay World Studio, running on this computer. The sample is a made-up hall drawn as a DXF, with an example shift.");
  await hold(5000);

  // The line running on the hall as drawn.
  await click("journey-run", "replay");
  await expect(page.getByTestId("run-panel")).toHaveAttribute("data-outcome", "ready", { timeout: 30_000 });
  await page.getByTestId("run-speed").selectOption("120");
  await say(page, "Run a day: workers carry batches from Rack A through the mixer and Machine B to packing. Every value is an example assumption.");
  mark("running");
  await hold(9000);

  // Show the example, step by step: real runs, made now.
  await click("example-start", "replay");
  await click("example-next", "replay");
  await expect(page.getByTestId("run-completed")).toHaveText("102");
  await page.getByTestId("run-speed").selectOption("120");
  await say(page, "Show the example: the shift on the hall as drawn completes 102 batches by 14:00.");
  await page.getByTestId("run-total").scrollIntoViewIfNeeded();
  mark("original");
  await hold(7000);

  await click("example-next", "replay");
  await say(page, "Machine B is moved into the aisle: one undoable edit. The run is now marked as made for the old layout.");
  mark("moved");
  await hold(7000);

  await click("example-next", "replay");
  await expect(page.getByTestId("run-panel")).toHaveAttribute("data-outcome", "blocked");
  await page.getByTestId("run-speed").selectOption("120");
  await say(page, "The same process and seed, run again on the edited layout: a route is blocked, so no material reaches the mixer.");
  await page.getByTestId("run-problem").scrollIntoViewIfNeeded();
  mark("blocked");
  await hold(8000);

  await click("example-next", "replay");
  const explanation = page.getByTestId("run-explanation");
  await expect(explanation).toContainText("narrows to 0.50 m between Rack A and Machine B");
  await page.getByTestId("run-compare").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await say(page, "The comparison names the cause: Rack A ↔ Mixer narrows to 0.50 m beside Machine B, and the path needs 0.80 m. Output 102 → 0.");
  mark("compare");
  await hold(12000);

  // Export this run.
  const exportStarted = Date.now();
  await click("run-export", "export");
  const dialog = page.getByTestId("export-run");
  await expect(dialog.getByTestId("export-replay")).toHaveAttribute("data-replay", "full");
  await say(page, "Export this run: one ZIP with a README, the summary, the project, both event logs and metrics, and a manifest of sha256 hashes.");
  mark("export");
  await hold(5000);
  clicks.export++;
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("export-save").click()]);
  await expect(dialog.getByTestId("export-done")).toBeVisible();
  const exportMs = Date.now() - exportStarted - 5000;
  const bundle = `${OUT}/${download.suggestedFilename()}`;
  await download.saveAs(bundle);
  await say(page, "Saved on this computer. Exporting does not change the project.");
  await hold(4000);
  await click("export-close", "export");

  await click("example-next", "replay");
  await expect(page.getByTestId("example-result")).toContainText("the same events as the first run");
  await page.getByTestId("show-example").scrollIntoViewIfNeeded();
  await say(page, "Undo the move and run again: 102 batches, with exactly the same events as the first run.");
  mark("undo");
  await hold(8000);
  const replayMs = Date.now() - started;

  // A fresh session opens the ZIP and reruns both layouts.
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await captions(page);
  session = await page.context().newCDPSession(page);
  await capture();
  await say(page, "A fresh session opens the ZIP: every file is checked against the manifest, then both layouts are run again.");
  await page.getByTestId("scene-file-input").setInputFiles(bundle);
  await expect(page.getByTestId("bundle-check")).toBeVisible({ timeout: 30_000 });
  await hold(3000);
  await page.getByTestId("bundle-rerun").click();
  await expect(page.getByTestId("bundle-check")).toHaveAttribute("data-same", "true");
  await page.getByTestId("bundle-verdict").scrollIntoViewIfNeeded();
  await say(page, "Reproduced: the same events in the same order, the same fingerprints, counts, blocked route and explanation.");
  mark("reproduced");
  await hold(8000);
  await session.send("Page.stopScreencast");
  mark("end");

  writeFileSync(`${FRAMES}/frames.json`, JSON.stringify({ frames, marks }, null, 1));
  const report = { frames: frames.length, seconds: frames.at(-1)!.t - frames[0]!.t, clicks, replayMs, exportMs, bundle: download.suggestedFilename() };
  writeFileSync(`${ROOT}apps/web/test-results/demo-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
