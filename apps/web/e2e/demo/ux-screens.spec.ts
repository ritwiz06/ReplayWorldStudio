// UX-03 and UX-04 screenshots (local only): the same states at 1440 × 900 and 1280 × 800, written to
// docs/ux-03/<UX_SET>/. UX_SET=before was taken on the previous main screen; UX_SET=after uses
// the chat-first screen with recorded AI answers (DEMO_ASSIST=recorded), and UX_SET=nokey with
// no key at all. UX_SET=ux04 (recorded answers) and ux04-nokey write docs/ux-04/screens/: the
// start screen, an imported world, a plan, a running shift at two times and from two angles, a
// blocked result and an object placement. Repository-owned sample files only.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const SET = process.env.UX_SET ?? "after";
const OUT = SET.startsWith("enr01-photo") ? `${ROOT}docs/enr-01/photo-screens` : SET === "enr01" ? `${ROOT}docs/enr-01/screens` : SET.startsWith("ux05") ? `${ROOT}docs/ux-05/screens` : SET.startsWith("ux04") ? `${ROOT}docs/ux-04/screens` : `${ROOT}docs/ux-03/${SET}`;
const DXF = `${ROOT}fixtures/drawings/hall-mm.dxf`;

async function shot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(700);
  const prefix = SET.endsWith("-nokey") ? "nokey-" : "";
  await page.screenshot({ path: `${OUT}/${page.viewportSize()!.width}-${prefix}${name}.jpg`, type: "jpeg", quality: 82 });
}
async function ask(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
}
const card = (page: Page, kind: string) => page.getByTestId("chat").locator(`[data-kind="${kind}"]`).last();

for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
  test(`${SET} at ${width}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.evaluate((set) => {
      localStorage.clear();
      if (set === "before") localStorage.setItem("rws.view", "editor");
    }, SET);
    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded/);
    if (SET === "ux04" || SET === "ux04-nokey") return ux04(page);
    if (SET === "ux05" || SET === "ux05-nokey") return ux05(page);
    if (SET === "enr01") return enr01(page);
    if (SET === "enr01-photo" || SET === "enr01-photo-nokey") return enr01Photo(page);
    await shot(page, "1-first-visit");
    if (SET === "before") {
      await page.evaluate(() => localStorage.setItem("rws.start.seen", "1"));
      await page.goto("/");
      await page.getByTestId("journey-run").click();
      await expect(page.getByTestId("run-panel")).toHaveAttribute("data-outcome", "ready", { timeout: 30_000 });
      await page.waitForTimeout(2500);
      await shot(page, "2-sample-running");
      await page.getByTestId("example-start").click();
      for (let i = 0; i < 4; i++) await page.getByTestId("example-next").click();
      await shot(page, "3-comparison");
      await page.goto("/");
      await page.getByTestId("journey-upload").click();
      await page.getByTestId("drawing-file-input").setInputFiles(DXF);
      await expect(page.getByTestId("drawing-summary")).toBeVisible();
      await shot(page, "4-import");
      await page.getByTestId("drawing-open").click();
      await expect(page.getByTestId("drawing-review")).toBeVisible();
      await shot(page, "5-review");
      return;
    }
    if (SET === "nokey") {
      await page.getByTestId("chat-suggest-example").click();
      await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
      await shot(page, "2-example-nokey");
      return;
    }
    await ask(page, "Show me the example factory");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
    await shot(page, "2-example");
    await ask(page, "Move the rack 1 m back");
    await expect(card(page, "proposal").getByTestId("plan-need-0")).toBeVisible();
    await card(page, "proposal").getByTestId("chat-choice-obj-dxf-106").hover();
    await shot(page, "3-ambiguity");
    await card(page, "proposal").getByTestId("chat-cancel").click();
    await ask(page, "Move Machine B 3.5 m forward");
    await expect(card(page, "proposal").getByTestId("chat-apply")).toBeVisible();
    await shot(page, "4-proposal");
    await card(page, "proposal").getByTestId("chat-apply").click();
    await ask(page, "What happens during a shift?");
    await expect(card(page, "run")).toBeVisible();
    await page.getByTestId("run-speed").selectOption("120");
    await page.waitForTimeout(1500);
    await shot(page, "5-running-blocked");
    await ask(page, "Why did output change?");
    await expect(card(page, "why")).toBeVisible();
    await shot(page, "6-why");
    await page.getByTestId("chat-suggest-undo").click();
    await page.getByTestId("chat-suggest-run_again").click();
    await expect(card(page, "run-again")).toBeVisible();
    await page.waitForTimeout(2500);
    await shot(page, "7-running");
    await ask(page, "Paint the mixer red");
    await expect(card(page, "cannot")).toBeVisible();
    await shot(page, "8-cannot");
    // The conversation as text, with each card's details opened (the recorded run's evidence).
    if (width === 1440) {
      await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("[data-testid=chat] details").forEach((d) => (d.open = true)));
      const turns = await page.getByTestId("chat-list").evaluate((list) =>
        [...list.children].map((el) => {
          const who = (el as HTMLElement).dataset.testid === "chat-user" ? "You" : `Assistant [${(el as HTMLElement).dataset.kind ?? ""}]`;
          const lines = (el as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean);
          return `${who}: ${lines.join("\n    ")}`;
        }),
      );
      writeFileSync(`${OUT}/conversation.txt`, `${turns.join("\n\n")}\n`);
    }
    await page.getByTestId("view-toggle").click();
    await shot(page, "9-full-editor");
    await page.getByTestId("view-toggle").click();
    await page.getByTestId("chat-file-input").setInputFiles(DXF);
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByTestId("chat-review")).toBeVisible({ timeout: 30_000 });
    await shot(page, "10-import-review");
  });
}

/** UX-04: each state the request asked to inspect, at two playback times and camera angles. */
async function ux04(page: Page) {
  const chat = page.getByTestId("chat");
  await page.evaluate(() => localStorage.setItem("rws.start.seen", "1"));
  await page.goto("/");
  await expect(page.getByTestId("empty-start")).toBeVisible();
  await shot(page, "1-empty-start");
  if (SET === "ux04-nokey") {
    await page.getByTestId("empty-example").click();
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
    await chat.getByTestId("chat-suggest-move_any").click();
    await page.getByTestId("chat-move-object").selectOption("obj-dxf-111");
    await page.getByTestId("chat-move-distance").fill("3.5");
    await page.getByTestId("chat-move-forward").click();
    await expect(card(page, "proposal").getByTestId("chat-apply")).toBeVisible();
    await shot(page, "2-move-form-proposal");
    return;
  }
  // An imported plan, reviewed in the conversation.
  await page.getByTestId("chat-file-input").setInputFiles(DXF);
  await expect(page.getByTestId("chat-review")).toBeVisible({ timeout: 30_000 });
  await shot(page, "2-imported-review");
  await page.getByTestId("chat-floor-accept").click();
  await shot(page, "3-imported-next-correction");

  // The example: a plan of three steps, its proposed change shown in the world.
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await shot(page, "4-example");
  await ask(page, "Move Machine B 1 metre right, check its routes, and run the shift again.");
  await expect(card(page, "proposal").getByTestId("chat-apply")).toBeVisible();
  await shot(page, "5-plan-proposed");
  await card(page, "proposal").getByTestId("chat-apply").click();
  await expect(card(page, "plan-done")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("run-speed").selectOption("120");
  await page.waitForTimeout(1500);
  await shot(page, "6-running-early");
  await page.getByTestId("run-overview").click();
  await page.waitForTimeout(6000);
  await shot(page, "7-running-overview-later");
  await page.getByTestId("run-see-through").click();
  await shot(page, "8-running-see-through");
  await page.getByTestId("run-see-through").click();

  // A blocked result, from the top view.
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await ask(page, "Move Machine B 3.5 m forward");
  await card(page, "proposal").getByTestId("chat-apply").click();
  await ask(page, "What happens during a shift?");
  await expect(card(page, "run")).toContainText("Whole-shift result: 0 batches", { timeout: 30_000 });
  await page.keyboard.press("2");
  await page.waitForTimeout(1500);
  await shot(page, "9-blocked-top");
  await page.keyboard.press("1");

  // An object placed from the conversation: the suggestion, the side, the ghost.
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await ask(page, "Add a packing table, 1.5 metres wide and 0.8 metres deep, beside Machine B.");
  await expect(card(page, "proposal").getByTestId("chat-asset-use")).toBeVisible();
  await shot(page, "10-add-suggestion");
  await card(page, "proposal").getByTestId("chat-asset-use").click();
  await card(page, "proposal").getByTestId("chat-side-left").click();
  await expect(card(page, "proposal").getByTestId("chat-apply")).toBeVisible();
  await shot(page, "11-add-proposed");
  await card(page, "proposal").getByTestId("chat-apply").click();
  await page.getByTestId("appearance-toggle").click();
  await page.waitForTimeout(500);
  await shot(page, "12-added-uncertainty-view");
}

/** UX-05 (run with RWS_CHAT_DEADLINE_S=6): equipment appearance and the chat's wait. */
async function ux05(page: Page) {
  const chat = page.getByTestId("chat");
  await page.evaluate(() => localStorage.setItem("rws.start.seen", "1"));
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  if (SET === "ux05-nokey") {
    await page.getByTestId("view-toggle").click();
    await page.getByRole("button", { name: "Show the object list and details" }).click();
    await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Electrical cabinet/ }).click();
    await page.getByTestId("view-toggle").click();
    await page.getByTestId("selection-look").click();
    const row = chat.getByTestId("look-row-obj-dxf-10f");
    await row.getByTestId("look-other-obj-dxf-10f").click();
    await row.getByTestId("look-search-obj-dxf-10f").fill("cabinet");
    await row.getByTestId("look-option-obj-dxf-10f-asset-electrical-cabinet-800").hover();
    await page.waitForTimeout(1500);
    await shot(page, "1-manual-choice-preview");
    return;
  }
  await shot(page, "1-imported-before");
  await chat.getByTestId("chat-suggest-appearance").click();
  const look = card(page, "appearance");
  await expect(look.getByTestId("look-row-obj-dxf-10f")).toBeVisible();
  await look.getByTestId("look-row-obj-dxf-10f").hover();
  await page.waitForTimeout(1500);
  await shot(page, "2-suggestions-preview");
  await look.getByTestId("look-use-obj-dxf-10f").click();
  await look.getByTestId("look-use-obj-dxf-10c").click();
  await look.getByTestId("look-other-obj-dxf-111").click();
  await look.getByTestId("look-row-obj-dxf-111").scrollIntoViewIfNeeded();
  await shot(page, "3-ambiguous-choice");
  await look.getByTestId("look-keep-obj-dxf-111").click();
  await look.getByTestId("look-apply").click();
  await page.keyboard.press("h");
  await page.waitForTimeout(1500);
  await shot(page, "4-imported-after");
  await chat.getByTestId("chat-suggest-run_example").click();
  await expect(card(page, "run")).toBeVisible();
  await page.getByTestId("run-speed").selectOption("120");
  await page.waitForTimeout(3000);
  await shot(page, "5-running-with-models");
  await ask(page, "Run the shift slowly for the progress test");
  await expect(card(page, "progress")).toContainText(/[23] s \(stops/, { timeout: 10_000 });
  await shot(page, "6-slow-request");
  await expect(card(page, "progress")).toHaveCount(0, { timeout: 20_000 });
  await ask(page, "Run the shift, but the provider is too slow");
  await expect(card(page, "timeout")).toBeVisible({ timeout: 30_000 });
  await shot(page, "7-timed-out");
}

/** ENR-01: a better model of one machine, from before to the missing-file recovery (no key). */
async function enr01(page: Page) {
  const chat = page.getByTestId("chat");
  const cell = `${ROOT}assets/catalog/models/guarded-machine-cell.glb`;
  await page.evaluate(() => localStorage.setItem("rws.start.seen", "1"));
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("view-toggle").click();
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Machine B/ }).click();
  await page.getByTestId("view-toggle").click();
  await page.keyboard.press("f");
  await page.waitForTimeout(1500);
  await shot(page, "1-before");
  await chat.getByTestId("chat-file-input").setInputFiles(`${ROOT}fixtures/models/draco-required.glb`);
  await chat.getByTestId("model-for-obj-dxf-111").click();
  await expect(card(page, "model-rejected")).toBeVisible({ timeout: 30_000 });
  await shot(page, "2-rejected-file");
  await chat.getByTestId("chat-file-input").setInputFiles(cell);
  await chat.getByTestId("model-for-obj-dxf-111").click();
  const review = page.getByTestId("model-review");
  await expect(review).toHaveAttribute("data-busy", "false", { timeout: 30_000 });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, "3-review-fit-orientation");
  await card(page, "model-review").getByTestId("model-apply").click();
  await page.waitForTimeout(1000);
  await shot(page, "4-after");
  await page.keyboard.press("Escape");
  await page.keyboard.press("h");
  await chat.getByTestId("chat-suggest-run_example").click();
  await expect(card(page, "run")).toBeVisible();
  await page.getByTestId("run-speed").selectOption("120");
  await page.waitForTimeout(3000);
  await shot(page, "5-running-shift");
  // The attached file goes missing: the world still opens, and says how to recover.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const uri = (JSON.parse(text) as { catalog: { visual: { uri: string } }[] }).catalog[0]!.visual.uri;
  const stored = `${ROOT}assets/catalog/${uri}`;
  if (existsSync(stored)) unlinkSync(stored);
  await page.goto("/");
  await chat.getByTestId("chat-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByTestId("model-notice")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot(page, "6-missing-model-recovery");
}

/** ENR-01, the photo part: a reference photo for Machine B (the drawn sample; recorded answers),
 * a world without a drawing (the industrial demo) and, without a key, the manual path. */
async function enr01Photo(page: Page) {
  const chat = page.getByTestId("chat");
  const dialog = page.getByTestId("photo-look");
  const render = `${ROOT}fixtures/photos/factory-walk.png`;
  const office = `${ROOT}fixtures/photos/office.jpg`;
  const nokey = SET.endsWith("-nokey");
  const cropTo = async (box: [number, number, number, number]) => {
    const r = (await page.getByTestId("photo-look-crop").boundingBox())!;
    await page.mouse.move(r.x + box[0] * r.width, r.y + box[1] * r.height);
    await page.mouse.down();
    await page.mouse.move(r.x + box[2] * r.width, r.y + box[3] * r.height, { steps: 6 });
    await page.mouse.up();
  };
  const select = async (name: RegExp) => {
    await page.getByTestId("view-toggle").click();
    const list = page.getByRole("button", { name: "Show the object list and details" });
    if (await list.isVisible()) await list.click();
    await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name }).click();
    await page.getByTestId("view-toggle").click();
  };
  const reviewed = async () => {
    await expect(dialog).toHaveAttribute("data-stage", "review", { timeout: 30_000 });
    await expect(dialog.getByTestId("photo-look-proposed")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(dialog.getByTestId("photo-look-current")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await page.waitForTimeout(1200);
  };
  await page.evaluate(() => localStorage.setItem("rws.start.seen", "1"));
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await select(/^Machine B/);
  await page.keyboard.press("f");
  await page.waitForTimeout(1200);
  await chat.getByTestId("chat-file-input").setInputFiles(render);
  await card(page, "question").getByTestId("photo-for-obj-dxf-111").click();
  await cropTo([0.4, 0.36, 0.57, 0.62]);
  await shot(page, "1-photo-and-crop");
  if (nokey) {
    await dialog.getByTestId("photo-look-manual").click();
    await reviewed();
    await dialog.getByTestId("photo-look-edit").locator("summary").first().click();
    await dialog.getByTestId("photo-look-colour-paint_light_grey").selectOption("safety_yellow");
    await page.waitForTimeout(1500);
    await shot(page, "2-manual");
    await dialog.getByTestId("photo-look-apply").click();
    await page.keyboard.press("f");
    await page.waitForTimeout(1500);
    await shot(page, "3-after");
    return;
  }
  await dialog.getByTestId("photo-look-suggest").click();
  await reviewed();
  await shot(page, "2-review");
  await dialog.getByTestId("photo-look-apply").click();
  await expect(card(page, "photo-look-applied")).toBeVisible();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await page.keyboard.press("f");
  await page.waitForTimeout(1500);
  await shot(page, "3-after");
  await page.keyboard.press("Escape");
  await chat.getByTestId("chat-suggest-run_example").click();
  await expect(card(page, "run")).toBeVisible();
  await page.getByTestId("run-speed").selectOption("120");
  await page.waitForTimeout(3000);
  await shot(page, "4-running-shift");
  // The photo goes missing: the world opens, its look is drawn, and the photo can come back.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const sources = (JSON.parse(text) as { sources: { kind: string; image: { uri: string } | null }[] }).sources;
  const uri = sources.find((s) => s.kind === "reference_photo")!.image!.uri;
  const library = join(tmpdir(), "rws-demo-sources-8050"); // playwright.demo.config.ts
  if (existsSync(join(library, uri))) unlinkSync(join(library, uri));
  await page.goto("/");
  await chat.getByTestId("chat-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await expect(page.getByTestId("reference-notice")).toBeVisible({ timeout: 30_000 });
  await shot(page, "5-missing-photo");
  // A world without a drawing: the industrial demo's control cabinet, from a real photo.
  await page.goto("/");
  await chat.getByTestId("chat-file-input").setInputFiles(`${ROOT}fixtures/scenes/industrial-demo.json`);
  await expect(card(page, "done")).toContainText("15 objects");
  await select(/^Control cabinet 1/);
  await page.keyboard.press("f");
  await page.getByTestId("selection-look").click();
  await card(page, "appearance").getByTestId("look-photo-obj-cabinet-1").click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), dialog.getByTestId("photo-look-pick").click()]);
  await chooser.setFiles(office);
  await cropTo([0.88, 0.68, 1, 1]);
  await dialog.getByTestId("photo-look-suggest").click();
  await reviewed();
  await dialog.getByTestId("photo-look-edit").locator("summary").first().click();
  await dialog.getByTestId("photo-look-colour-wood").selectOption("paint_anthracite");
  await reviewed();
  await shot(page, "6-no-drawing-review");
  await dialog.getByTestId("photo-look-apply").click();
  await page.keyboard.press("f");
  await page.waitForTimeout(2000);
  await shot(page, "7-no-drawing-after");
}
