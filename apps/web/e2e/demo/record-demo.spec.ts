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

// UX-04: one request progressing, on the chat-first screen with a recorded live answer (DEMO_ASSIST=
// recorded; the app labels it "Recorded answers (test)"). Run with -g "UX-04"; frames go to
// test-results/demo-frames-ux04 for scripts/demo/frames-to-mp4.swift.
test("record the UX-04 request", async ({ page }) => {
  test.skip(process.env.DEMO_ASSIST !== "recorded", "needs DEMO_ASSIST=recorded");
  test.setTimeout(180_000);
  const dir = `${ROOT}apps/web/test-results/demo-frames-ux04`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("rws.view", "chat"));
  await page.goto("/");
  await expect(page.getByTestId("empty-start")).toBeVisible();
  await page.evaluate(() => {
    const style = document.createElement("style");
    // Over the 3D view (x 0-1060 at 1440 × 900), under its toolbar, clear of the run bar.
    style.textContent = `#demo-caption { position: fixed; top: 206px; left: 530px; transform: translateX(-50%); z-index: 99999; pointer-events: none;
      width: 660px; box-sizing: border-box; background: rgba(13,17,23,.92); color: #fff; font: 500 18px/1.35 system-ui, sans-serif;
      padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25); text-align: center; }
      #demo-caption:empty { display: none; }`;
    document.head.append(style);
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    document.body.append(caption);
  });
  const frames: { file: string; t: number }[] = [];
  const session = await page.context().newCDPSession(page);
  session.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = `${String(frames.length).padStart(5, "0")}.jpg`;
    writeFileSync(`${dir}/${file}`, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    await session.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  const hold = (ms: number) => page.waitForTimeout(ms);

  await say(page, "Synthetic example. The AI's reading of the request is a recorded live answer, replayed.");
  await hold(3000);
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await hold(2000);
  const request = "Move Machine B 1 metre right, check its routes, and run the shift again.";
  await page.getByTestId("chat-input").pressSequentially(request, { delay: 25 });
  await page.getByTestId("chat-send").click();
  const plan = page.getByTestId("chat").locator('[data-kind="proposal"]').last();
  await expect(plan.getByTestId("chat-apply")).toBeVisible();
  await say(page, "One message, three steps. The proposed position is shown in the world; nothing changes until Apply.");
  await hold(6000);
  await plan.getByTestId("chat-apply").click();
  await say(page, "Applied once, step by step: the move, the route check, then the shift.");
  await expect(page.getByTestId("chat").locator('[data-kind="plan-done"]').last()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("run-speed").selectOption("120");
  await hold(4000);
  await say(page, "“Completed so far” follows the playback clock; the whole shift completes 102 batches.");
  await hold(6000);
  await page.getByTestId("chat").locator('[data-kind="plan-done"]').last().getByTestId("chat-undo-request").click();
  await say(page, "Undo this request: the layout is back as it was.");
  await hold(4000);
  await session.send("Page.stopScreencast");
  writeFileSync(`${dir}/frames.json`, JSON.stringify({ frames }, null, 1));
  console.log(JSON.stringify({ frames: frames.length, seconds: frames.at(-1)!.t - frames[0]!.t }));
});

// UX-05: upload and review a plan, improve its equipment's look from the catalog, then one
// connected request on the example factory's shift. Recorded answers (DEMO_ASSIST=recorded),
// synthetic files only. Run with -g "UX-05"; frames go to test-results/demo-frames-ux05.
test("record the UX-05 journey", async ({ page }) => {
  test.skip(process.env.DEMO_ASSIST !== "recorded", "needs DEMO_ASSIST=recorded");
  test.setTimeout(240_000);
  const dir = `${ROOT}apps/web/test-results/demo-frames-ux05`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames: { file: string; t: number }[] = [];
  const caption = async () =>
    page.evaluate(() => {
      if (document.getElementById("demo-caption")) return;
      const style = document.createElement("style");
      style.textContent = `#demo-caption { position: fixed; top: 206px; left: 530px; transform: translateX(-50%); z-index: 99999; pointer-events: none;
        width: 660px; box-sizing: border-box; background: rgba(13,17,23,.92); color: #fff; font: 500 18px/1.35 system-ui, sans-serif;
        padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25); text-align: center; }
        #demo-caption:empty { display: none; }`;
      document.head.append(style);
      const el = document.createElement("div");
      el.id = "demo-caption";
      document.body.append(el);
    });
  const record = async () => {
    const session = await page.context().newCDPSession(page);
    session.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
      const file = `${String(frames.length).padStart(5, "0")}.jpg`;
      writeFileSync(`${dir}/${file}`, Buffer.from(data, "base64"));
      frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
      await session.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    });
    await session.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
    return session;
  };
  const hold = (ms: number) => page.waitForTimeout(ms);
  const chat = page.getByTestId("chat");

  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("rws.view", "chat"));
  await page.goto("/");
  await caption();
  let session = await record();
  await say(page, "A synthetic plan (DXF) is attached: read on this computer, then reviewed one question at a time.");
  await chat.getByTestId("chat-file-input").setInputFiles(`${ROOT}fixtures/drawings/hall-mm.dxf`);
  const review = chat.getByTestId("chat-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await hold(3000);
  for (let i = 0; i < 8 && (await review.count()); i++) {
    const next = review.locator('[data-testid^="chat-"][data-testid$="-accept"], [data-testid="chat-symbols-none"]').first();
    if (!(await next.count())) break;
    await next.click();
    await hold(900);
  }
  await chat.getByTestId("chat-suggest-appearance").click();
  const look = chat.locator('[data-kind="appearance"]').last();
  await expect(look).toBeVisible();
  await say(page, "Improve equipment appearance: catalog models are suggested only where the names agree. Nothing changes until Apply.");
  const suggested = look.locator('[data-status="suggested"]').first();
  await suggested.hover();
  await hold(4500);
  await suggested.locator('[data-testid^="look-use-"]').click();
  await hold(1200);
  await look.getByTestId("look-apply").click();
  await say(page, "Applied as one undoable step: ids, sizes, evidence and links unchanged.");
  await hold(4000);
  await session.send("Page.stopScreencast");

  await page.goto("/");
  await caption();
  session = await record();
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await say(page, "The example factory, with its example shift. Its cabinets get the catalog model the same way.");
  await chat.getByTestId("chat-suggest-appearance").click();
  const sample = chat.locator('[data-kind="appearance"]').last();
  await sample.getByTestId("look-use-obj-dxf-10f").click();
  await sample.getByTestId("look-use-obj-dxf-10c").click();
  await sample.getByTestId("look-apply").click();
  await hold(2500);
  await say(page, "One connected request (a recorded AI answer, replayed).");
  await page.getByTestId("chat-input").pressSequentially("Move Machine B 1 metre right, check its routes, and run the shift again.", { delay: 20 });
  await page.getByTestId("chat-send").click();
  const plan = chat.locator('[data-kind="proposal"]').last();
  await expect(plan.getByTestId("chat-apply")).toBeVisible();
  await hold(4500);
  await plan.getByTestId("chat-apply").click();
  await expect(chat.locator('[data-kind="plan-done"]').last()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("run-speed").selectOption("120");
  await say(page, "Applied step by step: the move, its routes, then the shift.");
  await hold(5000);
  await page.getByTestId("chat-input").fill("Why did output change?");
  await page.getByTestId("chat-send").click();
  await expect(chat.locator('[data-kind="why"]').last()).toBeVisible();
  await say(page, "Why: from the comparison of the two runs, not from the AI.");
  await hold(5000);
  await session.send("Page.stopScreencast");
  writeFileSync(`${dir}/frames.json`, JSON.stringify({ frames }, null, 1));
  console.log(JSON.stringify({ frames: frames.length }));
});
