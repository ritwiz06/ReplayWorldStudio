// UX-03 on a real third-party drawing (local only): the CC0 "Garage and workshop - 72 m2" DXF from
// innerscene.com, in the git-ignored data/external/. The same journey as workshop.spec.ts (the
// full editor), but through the conversation: attach, the corrections the review needs, set up
// and run the shift, ask to move the workbench, preview and apply, check the routes, run again,
// ask why it changed, undo, save and reopen. Counts clicks, characters typed and time per phase:
// a scripted measurement, not a user study. Typed requests use answers recorded live and kept in
// data/external/recorded (git-ignored); without them the test stops at the first typed request
// after writing the state to record from (scripts/record_chat.py --workshop).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const DXF = `${ROOT}data/external/innerscene/garage-and-workshop-72-m2.dxf`;
const OUT = `${ROOT}data/external/results`;
const CHAT = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: CHAT, viewport: { width: 1440, height: 900 } });

const tally = { clicks: 0, typed: 0 };
const click = async (page: Page, testId: string) => {
  tally.clicks++;
  await page.getByTestId(testId).click();
};
const type = async (page: Page, testId: string, text: string) => {
  tally.typed += text.length;
  await page.getByTestId(testId).fill(text);
};
const ask = async (page: Page, text: string) => {
  await type(page, "chat-input", text);
  await click(page, "chat-send");
};
const card = (page: Page, kind: string) => page.getByTestId("chat").locator(`[data-kind="${kind}"]`).last();
const RECORDED = `${ROOT}data/external/recorded/chat-workshop-move.json`;
const RECORDED_PLAN = `${ROOT}data/external/recorded/chat-workshop-plan.json`;
/** The event fingerprint a run card records (in its details). */
const fingerprintOf = async (page: Page, kind: string) => /fingerprint ([0-9a-f]{14})/.exec((await card(page, kind).textContent()) ?? "")?.[1] ?? null;

async function clickPlan(page: Page, x: number, y: number) {
  const at = await page.getByTestId("review-plan").evaluate(
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

/** Attach the workshop DXF, answer the review, set up the illustrative process and run it once;
 * the run's fingerprint. */
async function reviewAndRun(page: Page, phase: (name: string) => void) {
  // Attach: read on this computer, built at once (the header gives the unit).
  tally.clicks++;
  await page.getByTestId("chat-file-input").setInputFiles(DXF);
  const review = page.getByTestId("chat-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  phase("attach and see the draft");
  await page.screenshot({ path: `${OUT}/chat-workshop-1-review-1440.png` });

  // Only what the review needs: the floor (no outline), the scale, the objects, the left-out
  // shapes, and which layers are drawing symbols.
  await expect(review.getByTestId("chat-review-floor")).toContainText("no closed floor outline");
  await click(page, "chat-floor-trace");
  for (const [x, y] of [[0, 0], [9000, 0], [9000, 8000], [0, 8000]] as const) await clickPlan(page, x, y);
  await click(page, "review-floor-finish");
  await expect(review.getByTestId("chat-review-floor")).toHaveCount(0);
  await click(page, "chat-scale-accept");
  await click(page, "chat-objects-accept");
  await click(page, "chat-omissions-accept");
  await expect(review.getByTestId("chat-symbol-DOORS")).toBeChecked();
  // WALLS is never ticked by its name: ticking it says what that removes (UX-04). Here its loose
  // lines are the wall fill between closed wall outlines, which stay obstacles.
  await expect(review.getByTestId("chat-symbol-WALLS")).not.toBeChecked();
  await click(page, "chat-symbol-WALLS");
  await expect(review.getByTestId("chat-symbols-warning")).toContainText("its loose lines would stop blocking routes");
  await click(page, "chat-symbols-apply");
  await expect(page.getByTestId("chat-review")).toHaveCount(0);
  phase("review");

  // Run a day: no process yet, so the guided setup opens in the conversation.
  await click(page, "chat-suggest-run");
  const guided = page.getByTestId("guided-setup");
  await expect(guided).toBeVisible();
  for (const name of ["Fixtures 7", "Fixtures 5", "Fixtures 6"]) {
    tally.clicks += 2;
    await guided.getByTestId("guided-add").selectOption({ label: name });
  }
  await type(page, "guided-station-0-name", "Store shelving");
  await type(page, "guided-station-1-name", "Workbench");
  await type(page, "guided-station-2-name", "Kit cabinet");
  await type(page, "guided-item", "kit");
  await type(page, "guided-pace-obj-dxf-70", "6");
  await expect(guided.getByTestId("guided-run")).toBeDisabled(); // examples not accepted yet
  await click(page, "guided-accept-all");
  await click(page, "guided-run");
  const first = card(page, "run");
  await expect(first).toContainText("Ran the shift. Whole-shift result: 66 kits completed by 14:00");
  const original = await fingerprintOf(page, "run");
  phase("set up and run the shift");
  return original;
}

test("external: the CC0 workshop through the conversation, measured", async ({ page }) => {
  test.skip(!existsSync(DXF), "data/external/innerscene/garage-and-workshop-72-m2.dxf is not downloaded");
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const phases: Record<string, number> = {};
  let started = Date.now();
  const phase = (name: string) => {
    phases[name] = Date.now() - started;
    started = Date.now();
  };
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 0 objects");
  phase("open the app");

  const original = await reviewAndRun(page, phase);
  await page.screenshot({ path: `${OUT}/chat-workshop-2-running-1440.png` });

  // Ask to move the workbench: a recorded live answer, previewed, then applied.
  if (!existsSync(RECORDED)) {
    // First pass: keep the state to record the answers from (scripts/record_chat.py --workshop).
    const selected = await page.getByTestId("viewport").getAttribute("data-selected");
    const [saved] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
    writeFileSync(`${OUT}/chat-workshop-before-move.json`, readFileSync((await saved.path())!, "utf8"));
    writeFileSync(`${OUT}/chat-workshop-selected.txt`, selected ?? "");
    test.skip(true, "Record the workshop answers first: scripts/record_chat.py --workshop data/external/results/chat-workshop-before-move.json");
  }
  await ask(page, "Move the workbench 1.5 m right");
  const proposal = card(page, "proposal");
  await expect(proposal).toContainText("Move Workbench (Fixtures 5) 1.5 m right?", { timeout: 30_000 });
  await expect(proposal).toContainText("Workbench ↔ Kit cabinet would be blocked");
  await page.screenshot({ path: `${OUT}/chat-workshop-3-proposal-1440.png` });
  await click(page, "chat-apply");
  phase("ask to move, preview, apply");

  await click(page, "chat-suggest-route");
  await expect(card(page, "route")).toContainText("No: Workbench ↔ Kit cabinet is blocked");
  phase("check the routes");
  await click(page, "chat-suggest-run_again");
  await expect(card(page, "run-again")).toContainText("Ran the same shift again. Whole-shift result: 0 kits completed by 14:00");
  await click(page, "chat-suggest-why");
  const why = card(page, "why");
  await expect(why).toContainText("Output goes from 66 to 0 completed kits (−66).");
  await expect(why).toContainText("Because Workbench ↔ Kit cabinet is blocked in the edited layout");
  phase("run again and ask why");
  await page.screenshot({ path: `${OUT}/chat-workshop-4-why-1440.png` });

  await click(page, "chat-suggest-undo");
  await click(page, "chat-suggest-run_again");
  await expect(card(page, "run-again")).toContainText("66 kits completed");
  expect(await fingerprintOf(page, "run-again")).toBe(original);
  tally.clicks++;
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  writeFileSync(`${OUT}/chat-workshop-project.json`, text);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 0 objects");
  tally.clicks++;
  await page.getByTestId("chat-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(card(page, "done")).toContainText(`Opened ${download.suggestedFilename()}`);
  await click(page, "chat-suggest-run");
  await expect(card(page, "run")).toContainText("66 kits completed");
  expect(await fingerprintOf(page, "run")).toBe(original);
  phase("undo, save, reopen, run");

  const report = { phases, clicks: tally.clicks, typed: tally.typed, original, total: Object.values(phases).reduce((a, b) => a + b, 0) };
  writeFileSync(`${OUT}/chat-workshop-journey.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});

test("external: the workshop's move, rerun and explanation as one request (UX-04), saved and reopened", async ({ page }) => {
  test.skip(!existsSync(DXF), "data/external/innerscene/garage-and-workshop-72-m2.dxf is not downloaded");
  test.skip(!existsSync(RECORDED_PLAN), "Record it first: scripts/record_chat.py --workshop data/external/results/chat-workshop-before-move.json --only workshop-plan");
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  tally.clicks = 0;
  tally.typed = 0;
  const phases: Record<string, number> = {};
  let started = Date.now();
  const phase = (name: string) => {
    phases[name] = Date.now() - started;
    started = Date.now();
  };
  await page.goto("/");
  await expect(page.getByTestId("empty-start")).toBeVisible();
  phase("open the app");
  const original = await reviewAndRun(page, phase);

  await ask(page, "Move the workbench 1 metre right, run the same shift, and explain the difference.");
  const plan = card(page, "proposal");
  await expect(plan.getByTestId("plan-rows").locator(".plan-label")).toHaveText(["Move Workbench (Fixtures 5) 1 m right", "Run the same shift again", "Explain the difference"], { timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/chat-workshop-plan-1-review-1440.png` });
  await click(page, "chat-apply");
  const done = card(page, "plan-done");
  await expect(done).toContainText("Done: 3 of 3 steps.", { timeout: 60_000 });
  const again = await fingerprintOf(page, "run-again");
  expect(again).not.toBeNull();
  expect(again).not.toBe(original); // the moved workbench changes the walks, so the events
  await expect(card(page, "why").or(card(page, "compare"))).toContainText("before this request");
  phase("one request: move, run again, explain");
  await page.screenshot({ path: `${OUT}/chat-workshop-plan-2-done-1440.png` });

  // Undo the request: the original run again, identical.
  await done.getByTestId("chat-undo-request").click();
  tally.clicks++;
  await click(page, "chat-suggest-run_again");
  await expect(card(page, "run-again")).toContainText("66 kits completed");
  expect(await fingerprintOf(page, "run-again")).toBe(original);
  phase("undo the request and rerun");

  // Redo it, save, reopen: the edited run's events again.
  tally.clicks++;
  await page.getByTestId("redo").click();
  tally.clicks++;
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  await page.goto("/");
  tally.clicks++;
  await page.getByTestId("chat-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(card(page, "done")).toContainText(`Opened ${download.suggestedFilename()}`);
  await click(page, "chat-suggest-run");
  await expect(card(page, "run")).toContainText("Ran the shift.");
  expect(await fingerprintOf(page, "run")).toBe(again);
  phase("redo, save, reopen, run");

  const report = { phases, clicks: tally.clicks, typed: tally.typed, original, edited: again, total: Object.values(phases).reduce((a, b) => a + b, 0) };
  writeFileSync(`${OUT}/chat-workshop-plan-journey.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});

test("external: the workshop's cabinet and workbench drawn with reviewed models; the operating model is untouched (UX-05)", async ({ page }) => {
  test.skip(!existsSync(DXF), "data/external/innerscene/garage-and-workshop-72-m2.dxf is not downloaded");
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto("/");
  const original = await reviewAndRun(page, () => undefined);
  const save = async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
    const text = readFileSync((await download.path())!, "utf8");
    return { name: download.suggestedFilename(), text, project: JSON.parse(text) as { process: unknown; sources: unknown; scene: { objects: { id: string; asset_id: string | null }[] } } };
  };
  const before = await save();

  // The request's own words: matched here from the catalog, with no model call.
  await ask(page, "Make this equipment easier to recognise");
  const look = card(page, "appearance");
  // The right kind of thing, but a poor fit: asked, with the stretch said, not suggested.
  const cabinet = look.getByTestId("look-row-obj-dxf-71");
  await expect(cabinet).toHaveAttribute("data-status", "ask");
  await expect(cabinet).toContainText("are both a cabinet, but the model would be stretched to 287 %");
  await page.screenshot({ path: `${OUT}/ux05-workshop-suggestions-1440.png` });
  await cabinet.getByTestId("look-other-obj-dxf-71").click();
  await expect(cabinet.getByTestId("look-browse-obj-dxf-71")).toContainText("generic model");
  await cabinet.getByTestId("look-option-obj-dxf-71-asset-electrical-cabinet-800").click();
  await look.getByTestId("look-apply").click();
  await expect(card(page, "appearance-applied")).toContainText("Changed the look of 1 object.");

  await ask(page, "Make this equipment easier to recognise");
  const again = card(page, "appearance");
  await again.getByTestId("look-rest").locator("summary").click();
  const bench = again.getByTestId("look-row-obj-dxf-70");
  await expect(bench).toHaveAttribute("data-status", "none");
  await bench.getByTestId("look-describe-obj-dxf-70").click();
  const dialog = page.getByTestId("create-object");
  await dialog.getByRole("textbox").first().fill("a workbench 1.8 m wide with a monitor and a drawer unit");
  await dialog.getByRole("button", { name: /Draft|Propose|Describe/ }).first().click();
  const use = dialog.getByRole("button", { name: "Use for Workbench" });
  await expect(use).toBeVisible({ timeout: 30_000 });
  await use.click();
  await expect(bench).toContainText("Now drawn with");
  await page.screenshot({ path: `${OUT}/ux05-workshop-after-1440.png` });

  // Same ids, process and drawing links; only two objects reference models.
  const after = await save();
  expect(after.project.scene.objects.map((o) => o.id)).toEqual(before.project.scene.objects.map((o) => o.id));
  expect(after.project.process).toEqual(before.project.process);
  expect(after.project.sources).toEqual(before.project.sources);
  expect(after.project.scene.objects.filter((o) => o.asset_id).map((o) => o.id)).toEqual(["obj-dxf-70", "obj-dxf-71"]);
  // A change of look is not a change of what the run reads: the run stays current.
  await expect(page.getByTestId("run-bar")).toHaveAttribute("data-fingerprint", original!);
  await expect(page.getByText("The layout changed since this run")).toHaveCount(0);
  // Saved, reopened and run afresh with the models: identical events and counts.
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: after.name, mimeType: "application/json", buffer: Buffer.from(after.text) });
  await expect(card(page, "done")).toContainText(`Opened ${after.name}`);
  await click(page, "chat-suggest-run");
  await expect(card(page, "run")).toContainText("66 kits completed");
  expect(await fingerprintOf(page, "run")).toBe(original);
  writeFileSync(`${OUT}/ux05-workshop-appearance.json`, JSON.stringify({ original, models: after.project.scene.objects.filter((o) => o.asset_id) }, null, 2));
});
