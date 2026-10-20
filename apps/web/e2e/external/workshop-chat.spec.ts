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
  await click(page, "chat-symbol-WALLS");
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
  await expect(first).toContainText("Ran the shift: 66 kits completed by 14:00");
  const original = await fingerprintOf(page, "run");
  phase("set up and run the shift");
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
  await expect(card(page, "run-again")).toContainText("Ran the same shift again: 0 kits completed by 14:00");
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
