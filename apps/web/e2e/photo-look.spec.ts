// ENR-01, the photo part: "Here is a photo of this machine. Make this object look more like it."
// One existing object gets a new look from a reference photo, however the world was made: the
// same object, with its id, name, placement, recorded size and evidence, links, process and run.
// The vision model's answers are recorded live answers replayed offline (never a provider call):
// fixtures/assist/recorded/appearance-*.json, made by scripts/record_appearance.py.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { E2E_SOURCES_DIR } from "./paths";

const CHAT = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: CHAT });

const ROOT = new URL("../../../", import.meta.url).pathname;
/** A render made by this repository (synthetic): the industrial demo, several machines. */
const RENDER = `${ROOT}fixtures/photos/factory-walk.png`;
/** A real public-domain photograph (USDA): an office with a drawer unit on the right. */
const OFFICE = `${ROOT}fixtures/photos/office.jpg`;
const TEXTURED = `${ROOT}fixtures/models/textured.glb`;
const DEMO_PHOTO_SHA = createHash("sha256").update(readFileSync(OFFICE)).digest("hex");
const SAMPLE = JSON.parse(readFileSync(`${ROOT}fixtures/scenes/sample-factory.json`, "utf8")) as Saved;
const DEMO = JSON.parse(readFileSync(`${ROOT}fixtures/scenes/industrial-demo.json`, "utf8")) as Saved;
interface Obj { id: string; name: string; asset_id: string | null; dimensions: unknown; transform: unknown }
interface Source { id: string; kind: string; sha256: string | null; image: { uri: string } | null; reference: { object_ids: string[] } | null }
interface Asset { id: string; name: string; source: { kind: string }; generation: { method: string; language_model: { model: string } | null; reference: { photo_sha256: string; crop: unknown; visible: string[]; prompt: string | null } | null } | null; nominal_dimensions: { width: { origin: string; source_ref: string } } }
interface Saved { catalog: Asset[]; scene: { objects: Obj[]; edit_log: { type: string }[] }; process: unknown; sources: Source[] }

const card = (page: Page, kind: string) => page.getByTestId("chat").locator(`[data-kind="${kind}"]`).last();
const objectOf = (p: Saved, id: string) => p.scene.objects.find((o) => o.id === id)!;
const without = (o: Obj) => ({ ...o, asset_id: null });
const fingerprint = (page: Page) => page.getByTestId("run-bar").getAttribute("data-fingerprint");

async function save(page: Page): Promise<{ name: string; text: string; project: Saved }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, project: JSON.parse(text) as Saved };
}
async function select(page: Page, name: RegExp) {
  await page.getByTestId("view-toggle").click();
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name }).click();
  await page.getByTestId("view-toggle").click();
}
async function deselect(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-selected", "");
}
/** Drag a crop on the photo, in fractions of it (the app rounds to 0.01). */
async function crop(page: Page, box: [number, number, number, number]) {
  const stage = page.getByTestId("photo-look-crop");
  const r = (await stage.boundingBox())!;
  await page.mouse.move(r.x + box[0] * r.width, r.y + box[1] * r.height);
  await page.mouse.down();
  await page.mouse.move(r.x + ((box[0] + box[2]) / 2) * r.width, r.y + ((box[1] + box[3]) / 2) * r.height, { steps: 4 });
  await page.mouse.move(r.x + box[2] * r.width, r.y + box[3] * r.height, { steps: 4 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-crop", box.join(","));
}
async function proposed(page: Page) {
  const dialog = page.getByTestId("photo-look");
  await expect(dialog).toHaveAttribute("data-stage", "review", { timeout: 30_000 });
  await expect(dialog.getByTestId("photo-look-proposed")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(dialog.getByTestId("photo-look-current")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  return dialog;
}

test("photo look A: a reference for Machine B in the drawn factory; the run is unchanged, a move is not; undo, save and reopen", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("chat-suggest-run_example").click();
  await expect(card(page, "run")).toContainText("Whole-shift result: 102 batches");
  const before = await fingerprint(page);
  await select(page, /^Machine B/);

  // Attached in the conversation: the selection is offered first; a new world stays a choice.
  await page.getByTestId("chat-file-input").setInputFiles(RENDER);
  const ask = card(page, "question");
  await expect(ask).toContainText("Is factory-walk.png a photo of Machine B?");
  await expect(ask.getByTestId("photo-new-world")).toBeVisible();
  await ask.getByTestId("photo-for-obj-dxf-111").click();
  const dialog = page.getByTestId("photo-look");
  await expect(dialog.getByTestId("photo-look-target")).toContainText("Machine B (1.50 × 1.00 m, 1.60 m high, kept as recorded)");
  // Nothing is sent before Suggest: the photo is shown, the crop chosen, and what goes said.
  await crop(page, [0.4, 0.36, 0.57, 0.62]);
  await expect(dialog.getByTestId("photo-look-sends")).toContainText("this crop as a new JPEG without metadata, the name “Machine B”, its recorded size");
  await dialog.getByTestId("photo-look-suggest").click();
  await proposed(page);
  await expect(dialog.getByTestId("photo-look-summary")).toContainText("yellow frame");
  await expect(dialog.getByTestId("photo-look-summary")).toContainText(/kept the recorded size/i);
  await expect(dialog.getByTestId("photo-look-problems")).toContainText("frame post"); // what the checks found, beside Apply
  await dialog.getByTestId("photo-look-details").locator("summary").click();
  await expect(dialog.getByTestId("photo-look-details")).toContainText("recorded answer, offline");
  await dialog.getByTestId("photo-look-apply").click();
  await expect(card(page, "photo-look-applied")).toContainText("Machine B now looks more like its photo.");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });

  // The same object: only its look changed; the drawing source and the process are as they were.
  const looked = await save(page);
  const machine = objectOf(looked.project, "obj-dxf-111");
  expect(without(machine)).toEqual(without(objectOf(SAMPLE, "obj-dxf-111")));
  expect(looked.project.process).toEqual(SAMPLE.process);
  expect(looked.project.sources.slice(0, -1)).toEqual(SAMPLE.sources);
  const reference = looked.project.sources.at(-1)!;
  expect([reference.kind, reference.reference?.object_ids]).toEqual(["reference_photo", ["obj-dxf-111"]]);
  const asset = looked.project.catalog.find((a) => a.id === machine.asset_id)!;
  expect(asset.generation?.method).toBe("reference_photo");
  expect(asset.generation?.reference?.prompt).toBe("rws-appearance-prompt/3");
  expect(asset.generation?.reference?.crop).toEqual({ left: 0.4, top: 0.36, right: 0.57, bottom: 0.62 });
  expect(asset.nominal_dimensions.width.origin).toBe("inferred");
  expect(asset.nominal_dimensions.width.source_ref).toContain("not measured from the photo");
  expect(looked.project.scene.edit_log.at(-1)!.type).toBe("appearance_changed");
  // Appearance alone: the run stays current, with the same events.
  await expect(page.getByText("The layout changed since this run")).toHaveCount(0);
  expect(await fingerprint(page)).toBe(before);

  // A real layout change does change the run.
  await deselect(page);
  await page.getByTestId("chat-input").fill("Move Machine B 1 metre right, check its routes, and run the shift again.");
  await page.getByTestId("chat-send").click();
  await card(page, "proposal").getByTestId("chat-apply").click();
  await expect(card(page, "plan-done")).toContainText("Done: 3 of 3 steps.", { timeout: 60_000 });
  const moved = await fingerprint(page);
  expect(moved).not.toBe(before);

  // Undo the move and the look; redo both.
  await page.getByTestId("undo").click();
  await page.getByTestId("undo").click();
  const undone = (await save(page)).project;
  expect(objectOf(undone, "obj-dxf-111").asset_id).toBeNull();
  expect(undone.sources).toEqual(SAMPLE.sources); // the reference went with the step
  await page.getByTestId("redo").click();
  await page.getByTestId("redo").click();
  const again = await save(page);
  expect(objectOf(again.project, "obj-dxf-111").asset_id).toBe(asset.id);

  // Reopened: the same look, its model verified by its hash. (Whether the photo itself is
  // present is not checked here: photo.spec.ts removes this shared photo for its own test, and
  // a missing reference photo has its own test below, with a file only it uses.)
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: again.name, mimeType: "application/json", buffer: Buffer.from(again.text) });
  await expect(card(page, "done")).toContainText(`Opened ${again.name}: 12 objects.`);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });

});

test("photo look: a missing reference photo is reported, the look is still drawn, and only the same photo comes back", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  // A photo only this test uses (the render with bytes after its image data: a different file,
  // so deleting it from the shared library cannot disturb another test).
  const unique = { name: "machine-b-photo.png", mimeType: "image/png", buffer: Buffer.concat([readFileSync(RENDER), Buffer.from("rws-e2e-missing-photo")]) };
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await select(page, /^Machine B/);
  await page.getByTestId("chat-file-input").setInputFiles(unique);
  await card(page, "question").getByTestId("photo-for-obj-dxf-111").click();
  const dialog = page.getByTestId("photo-look");
  await dialog.getByTestId("photo-look-manual").click();
  await expect(dialog.getByTestId("photo-look-proposed")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await dialog.getByTestId("photo-look-edit").locator("summary").first().click();
  await dialog.getByTestId("photo-look-colour-paint_light_grey").selectOption("safety_yellow");
  await expect(dialog.getByTestId("photo-look-apply")).toBeEnabled({ timeout: 30_000 });
  await dialog.getByTestId("photo-look-apply").click();
  await expect(card(page, "photo-look-applied")).toBeVisible();
  const saved = await save(page);
  const reference = saved.project.sources.at(-1)!;
  const stored = join(E2E_SOURCES_DIR, reference.image!.uri);
  expect(existsSync(stored)).toBe(true);
  unlinkSync(stored);
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: saved.name, mimeType: "application/json", buffer: Buffer.from(saved.text) });
  const notice = page.getByTestId("reference-notice");
  await expect(notice).toContainText("machine-b-photo.png", { timeout: 30_000 });
  await expect(notice).toContainText("Every look stays as it is");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await notice.getByTestId(`reference-attach-${reference.id}`).click();
  await page.getByTestId("reference-same-input").setInputFiles(RENDER);
  await expect(page.getByTestId("reference-notice-message")).toContainText("is a different photo");
  await notice.getByTestId(`reference-attach-${reference.id}`).click();
  await page.getByTestId("reference-same-input").setInputFiles(unique);
  await expect(page.getByTestId("reference-notice")).toHaveCount(0);
  expect(existsSync(stored)).toBe(true);
});

test("photo look B: a world without a drawing: a GLB, then a photo of the real object; undo, redo, save and reopen", async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles(`${ROOT}fixtures/scenes/industrial-demo.json`);
  await expect(card(page, "done")).toContainText("Opened industrial-demo.json: 15 objects.");
  expect(DEMO.sources).toEqual([]);
  await select(page, /^Control cabinet 1/);

  // First an attached model, through Change look… (no drawing needed).
  await page.getByTestId("selection-look").click();
  await card(page, "appearance").getByTestId("look-upload-obj-cabinet-1").click();
  await page.getByTestId("model-file-input").setInputFiles(TEXTURED);
  const review = page.getByTestId("model-review");
  await expect(review).toHaveAttribute("data-busy", "false", { timeout: 30_000 });
  await card(page, "model-review").getByTestId("model-apply").click();
  await expect(card(page, "model-applied")).toBeVisible();
  const glb = (await save(page)).project;
  const glbAsset = objectOf(glb, "obj-cabinet-1").asset_id;

  // Then a photo: Change look… → Improve from photo… → the photo, cropped → Suggest.
  await page.getByTestId("selection-look").click();
  await card(page, "appearance").getByTestId("look-photo-obj-cabinet-1").click();
  const dialog = page.getByTestId("photo-look");
  await expect(dialog.getByTestId("photo-look-target")).toContainText("now drawn with the attached file textured.glb");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), dialog.getByTestId("photo-look-pick").click()]);
  await chooser.setFiles(OFFICE);
  await crop(page, [0.88, 0.68, 1, 1]);
  await dialog.getByTestId("photo-look-suggest").click();
  await proposed(page);
  await expect(dialog.getByTestId("photo-look-summary")).toContainText("drawers");
  await expect(dialog.getByTestId("photo-look-replaces")).toContainText("new, simplified look made of plain shapes; it does not edit the attached file textured.glb");
  // The proposal can be changed by hand before Apply.
  // The proposal can be changed by hand: the generator has no dark wood, so the person picks
  // a darker finish (recorded as their change).
  await dialog.getByTestId("photo-look-edit").locator("summary").first().click();
  await dialog.getByTestId("photo-look-colour-wood").selectOption("paint_anthracite");
  await expect(dialog.getByTestId("photo-look-summary")).toContainText("(then changed by you)");
  await expect(dialog.getByTestId("photo-look-proposed")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await dialog.getByTestId("photo-look-apply").click();
  await expect(card(page, "photo-look-applied")).toBeVisible();
  const looked = await save(page);
  const cabinet = objectOf(looked.project, "obj-cabinet-1");
  expect(without(cabinet)).toEqual(without(objectOf(DEMO, "obj-cabinet-1")));
  expect(looked.project.sources.map((s) => s.kind)).toEqual(["reference_photo"]);
  expect(looked.project.catalog.some((a) => a.id === glbAsset)).toBe(true); // the GLB stays in the catalog
  const made = looked.project.catalog.find((a) => a.id === cabinet.asset_id)!;
  expect(made.generation?.reference?.photo_sha256).toBe(DEMO_PHOTO_SHA);

  // Undo returns the attached model, redo the photo look; both are saved and reopened as such.
  await page.getByTestId("undo").click();
  expect(objectOf((await save(page)).project, "obj-cabinet-1").asset_id).toBe(glbAsset);
  await page.getByTestId("redo").click();
  const again = await save(page);
  expect(objectOf(again.project, "obj-cabinet-1").asset_id).toBe(cabinet.asset_id);
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: again.name, mimeType: "application/json", buffer: Buffer.from(again.text) });
  await expect(card(page, "done")).toContainText(`Opened ${again.name}: 15 objects.`);
  const reopened = (await save(page)).project;
  expect(reopened.scene.objects.map((o) => o.id)).toEqual(DEMO.scene.objects.map((o) => o.id));
  expect(objectOf(reopened, "obj-cabinet-1").dimensions).toEqual(objectOf(DEMO, "obj-cabinet-1").dimensions);
  expect(reopened.sources).toEqual(again.project.sources);
});

test("photo look: a cancelled suggestion, Keep the current look and a kept reference change nothing about the look", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await select(page, /^Machine B/);
  await page.getByTestId("chat-file-input").setInputFiles(RENDER);
  await card(page, "question").getByTestId("photo-for-obj-dxf-111").click();
  const dialog = page.getByTestId("photo-look");
  await crop(page, [0.4, 0.36, 0.57, 0.62]);
  await dialog.getByTestId("photo-look-suggest").click();
  await proposed(page);
  await dialog.getByTestId("photo-look-keep-current").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("undo")).toBeDisabled();

  // Keep the photo as a reference only: one undoable step; no look, size or evidence changes.
  await page.getByTestId("chat-file-input").setInputFiles(RENDER);
  await card(page, "question").getByTestId("photo-for-obj-dxf-111").click();
  await page.getByTestId("photo-look-keep-reference").click();
  await expect(page.getByTestId("photo-look")).toHaveCount(0);
  const kept = (await save(page)).project;
  expect(objectOf(kept, "obj-dxf-111")).toEqual(objectOf(SAMPLE, "obj-dxf-111"));
  expect(kept.sources.at(-1)!.kind).toBe("reference_photo");
  await expect(page.getByTestId("selection-reference").locator("img")).toBeVisible();
  await page.getByTestId("undo").click();
  expect((await save(page)).project.sources).toEqual(SAMPLE.sources);
});
