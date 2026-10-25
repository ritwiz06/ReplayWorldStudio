// ENR-01 (the GLB part) in the browser: a better 3D model of one machine, used for that same
// object. The plan still makes the world; the attached file improves one object's look, as one
// undoable step that keeps its id, name, placement, recorded dimensions and evidence, links and
// the run. No AI is involved: the file is read and stored by the local API only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { E2E_CATALOG_DIR } from "./paths";

const CHAT = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: CHAT });

const ROOT = new URL("../../../", import.meta.url).pathname;
const CELL = `${ROOT}assets/catalog/models/guarded-machine-cell.glb`;
const MODELS = `${ROOT}fixtures/models`;
const SAMPLE = JSON.parse(readFileSync(`${ROOT}fixtures/scenes/sample-factory.json`, "utf8")) as Saved;
interface Obj { id: string; name: string; asset_id: string | null; transform: unknown; dimensions: unknown; parameters: unknown; kind: string }
interface Saved {
  catalog: { id: string; source: { kind: string }; upload: unknown; visual: { uri: string; sha256: string; fit: string; correction: { turns: number } | null }; rights: { license: string } }[];
  scene: { objects: Obj[]; revision: number };
  process: unknown;
  sources: unknown;
}

const card = (page: Page, kind: string) => page.getByTestId("chat").locator(`[data-kind="${kind}"]`).last();
const machine = (p: Saved) => p.scene.objects.find((o) => o.id === "obj-dxf-111")!;
const without = (o: Obj) => ({ ...o, asset_id: null });

async function openExample(page: Page) {
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
}
async function selectMachineB(page: Page) {
  await page.getByTestId("view-toggle").click();
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Machine B/ }).click();
  await page.getByTestId("view-toggle").click();
}
async function save(page: Page): Promise<{ name: string; text: string; project: Saved }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, project: JSON.parse(text) as Saved };
}
async function attachForMachineB(page: Page, file: string) {
  await page.getByTestId("chat-file-input").setInputFiles(file);
  await page.getByTestId("model-for-obj-dxf-111").click();
}
async function reviewed(page: Page) {
  const review = page.getByTestId("model-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review).toHaveAttribute("data-busy", "false", { timeout: 30_000 });
  return review;
}
const fingerprint = (page: Page) => page.getByTestId("run-bar").getAttribute("data-fingerprint");
/** Clear the selection (Escape on the page), as the recorded chat answers were made with none. */
async function deselect(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-selected", "");
}

test("enrich: a detailed model for Machine B, reviewed and applied to that object; the run, a move, why, undo/redo, save and reopen", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await openExample(page);
  await page.getByTestId("chat-suggest-run_example").click();
  await expect(card(page, "run")).toContainText("Whole-shift result: 102 batches");
  const before = await fingerprint(page);
  await selectMachineB(page);

  // The selection is offered first; the file goes to the local API, never the AI.
  await page.getByTestId("chat-file-input").setInputFiles(CELL);
  const ask = card(page, "question");
  await expect(ask).toContainText("Is guarded-machine-cell.glb a better model of Machine B?");
  await expect(ask.getByTestId("model-for-obj-dxf-111")).toHaveText("Use for Machine B");
  await ask.getByTestId("model-for-obj-dxf-111").click();
  const review = await reviewed(page);
  await expect(page.getByTestId("model-target")).toHaveText("Machine B");
  const sizes = review.getByTestId("model-sizes");
  await expect(sizes).toContainText("Recorded object1.50 × 1.00 m, 1.60 m high (drawn / assumed / drawn; unchanged)");
  await expect(sizes).toContainText("Model file2.01 × 1.89 m, 2.47 m high");
  await expect(sizes).toContainText("Drawn as1.06 × 1.00 m, 1.31 m high"); // kept in proportion, inside
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  // A quarter turn: the model's width and depth swap; the object does not turn.
  await review.getByTestId("model-turn-right").click();
  await expect(sizes).toContainText("Model file1.89 × 2.01 m, 2.47 m high", { timeout: 30_000 });
  await review.getByTestId("model-turn-left").click();
  await expect(sizes).toContainText("Model file2.01 × 1.89 m, 2.47 m high", { timeout: 30_000 });
  // Stretching is explicit, and its distortion is said beside Apply.
  await review.getByTestId("model-fit-stretch").click();
  await expect(review.getByTestId("model-warnings")).toContainText("Stretched to fill", { timeout: 30_000 });
  await review.getByTestId("model-fit-contain").click();
  await expect(review).toHaveAttribute("data-busy", "false", { timeout: 30_000 });
  await review.getByTestId("model-details").locator("summary").click();
  await expect(review.getByTestId("model-details")).toContainText("not a measurement of the machine");
  await expect(review.getByTestId("model-details")).toContainText("No licence is assumed");
  await card(page, "model-review").getByTestId("model-apply").click();
  await expect(card(page, "model-applied")).toContainText("Machine B now uses guarded-machine-cell.glb.");
  await expect(card(page, "model-applied").getByTestId("model-apply")).toHaveCount(0); // once

  // The same object: only its model changed. The run stays current, with the same events.
  const enriched = await save(page);
  expect(without(machine(enriched.project))).toEqual(without(machine(SAMPLE)));
  expect(enriched.project.process).toEqual(SAMPLE.process);
  expect(enriched.project.sources).toEqual(SAMPLE.sources);
  expect(enriched.project.scene.objects.map((o) => o.id)).toEqual(SAMPLE.scene.objects.map((o) => o.id));
  const asset = enriched.project.catalog[0]!;
  expect(machine(enriched.project).asset_id).toBe(asset.id);
  expect(asset.source.kind).toBe("uploaded");
  expect(asset.rights.license).toBe("NOASSERTION");
  expect(asset.visual.fit).toBe("contain");
  expect(asset.visual.sha256).toBe(createHash("sha256").update(readFileSync(CELL)).digest("hex"));
  await expect(page.getByText("The layout changed since this run")).toHaveCount(0);
  expect(await fingerprint(page)).toBe(before);

  // A real layout change through the conversation: the run follows it.
  await deselect(page);
  await page.getByTestId("chat-input").fill("Move Machine B 1 metre right, check its routes, and run the shift again.");
  await page.getByTestId("chat-send").click();
  await card(page, "proposal").getByTestId("chat-apply").click();
  await expect(card(page, "plan-done")).toContainText("Done: 3 of 3 steps.", { timeout: 60_000 });
  const moved = await fingerprint(page);
  expect(moved).not.toBe(before);
  await page.getByTestId("chat-input").fill("Why did output change?");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat").locator('[data-kind="why"]').last()).toContainText("102");

  // Undo the move, then the enrichment; redo both.
  await page.getByTestId("undo").click();
  await page.getByTestId("undo").click();
  expect(machine((await save(page)).project).asset_id).toBeNull();
  await page.getByTestId("redo").click();
  await page.getByTestId("redo").click();
  const again = await save(page);
  expect(machine(again.project).asset_id).toBe(asset.id);

  // Saved and reopened: the same model, verified by its hash, and the same run.
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: again.name, mimeType: "application/json", buffer: Buffer.from(again.text) });
  await expect(card(page, "done")).toContainText(`Opened ${again.name}: 12 objects.`);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await page.getByTestId("chat-suggest-run_example").click();
  await expect(card(page, "run")).toContainText("Whole-shift result:");
  expect(await fingerprint(page)).toBe(moved);
});

test("enrich: files outside the supported subset are refused with the reason, and nothing changes", async ({ page }) => {
  await openExample(page);
  for (const [file, words] of [
    ["draco-required.glb", "Draco-compressed geometry"],
    ["external-buffer.glb", "refers to an external file ('machine.bin')"],
    ["malformed.glb", "runs outside its buffer view"],
    ["skinned.glb", "skinned"],
  ] as const) {
    await attachForMachineB(page, `${MODELS}/${file}`);
    await expect(card(page, "model-rejected")).toContainText(`${file} can't be used`, { timeout: 30_000 });
    await expect(card(page, "model-rejected")).toContainText(words);
    await expect(card(page, "model-rejected")).toContainText("Nothing was changed");
  }
  // Content decides, not the name.
  await page.getByTestId("chat-file-input").setInputFiles({ name: "machine.glb", mimeType: "model/gltf-binary", buffer: readFileSync(`${ROOT}fixtures/drawings/hall-mm.dxf`) });
  await page.getByTestId("model-for-obj-dxf-111").click();
  await expect(card(page, "model-rejected")).toContainText("not a binary glTF");
  await expect(page.getByTestId("undo")).toBeDisabled();
});

test("enrich: a cancelled review and one the world moved past change nothing; Change look… offers the upload", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await openExample(page);
  await attachForMachineB(page, `${MODELS}/textured.glb`);
  await reviewed(page);
  await card(page, "model-review").getByTestId("model-cancel").click();
  await expect(card(page, "model-cancelled")).toContainText("keeps its current look");
  await expect(page.getByTestId("undo")).toBeDisabled();

  // Stale: the world changes under the open review.
  await attachForMachineB(page, `${MODELS}/textured.glb`);
  await reviewed(page);
  await deselect(page);
  await page.getByTestId("chat-input").fill("Move Machine B 1 metre right");
  await page.getByTestId("chat-send").click();
  await card(page, "proposal").getByTestId("chat-apply").click();
  await expect(card(page, "applied")).toContainText("Moved Machine B 1 m right.");
  await page.getByTestId("chat").locator('[data-kind="model-review"]').last().getByTestId("model-apply").click();
  await expect(card(page, "model-stale")).toContainText("nothing was changed");
  expect(machine((await save(page)).project).asset_id).toBeNull();

  // From the selected object: Change look… → Upload a 3D model… → review.
  await selectMachineB(page);
  await page.getByTestId("selection-look").click();
  const look = card(page, "appearance");
  await expect(look.getByTestId("look-upload-obj-dxf-111")).toBeVisible();
  await look.getByTestId("look-upload-obj-dxf-111").click();
  await page.getByTestId("model-file-input").setInputFiles(`${MODELS}/textured.glb`);
  await reviewed(page);
  await card(page, "model-review").getByTestId("model-apply").click();
  await expect(card(page, "model-applied")).toBeVisible();
});

test("enrich: a missing attached model is restored only by the same file, or drawn with its stand-in", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await openExample(page);
  await attachForMachineB(page, `${MODELS}/off-centre.glb`);
  await reviewed(page);
  await card(page, "model-review").getByTestId("model-apply").click();
  const file = await save(page);
  const asset = file.project.catalog[0]!;
  const stored = join(E2E_CATALOG_DIR, asset.visual.uri);
  expect(existsSync(stored)).toBe(true);
  unlinkSync(stored);

  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
  const notice = page.getByTestId("model-notice");
  await expect(notice).toContainText("Attach the same file again", { timeout: 30_000 });
  // A different file is never used in its place.
  await notice.getByTestId(`model-attach-same-${asset.id}`).click();
  await page.getByTestId("model-same-input").setInputFiles(`${MODELS}/textured.glb`);
  await expect(notice).toContainText("is a different file", { timeout: 30_000 });
  // The same file, checked by its hash, restores it.
  await notice.getByTestId(`model-attach-same-${asset.id}`).click();
  await page.getByTestId("model-same-input").setInputFiles(`${MODELS}/off-centre.glb`);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await expect(page.getByTestId("model-notice")).toHaveCount(0);

  // The stand-in path: missing again, the object gets its stand-in back (one undoable step).
  unlinkSync(stored);
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
  await page.getByTestId("model-notice").getByTestId(`model-stand-in-${asset.id}`).click();
  await expect(page.getByTestId("model-notice")).toHaveCount(0);
  expect(machine((await save(page)).project).asset_id).toBeNull();
});

test("enrich: repeated previews free their GPU resources, and an idle world stops rendering", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __renders: number; __renderer: { info: { memory: { geometries: number; textures: number } } } | null; __THREE_DEVTOOLS__: EventTarget };
    w.__renders = 0;
    w.__renderer = null;
    const hook = new EventTarget();
    hook.addEventListener("observe", (event) => {
      const renderer = (event as CustomEvent<{ isWebGLRenderer?: boolean; render: (...args: unknown[]) => void; info: { memory: { geometries: number; textures: number } } }>).detail;
      if (!renderer.isWebGLRenderer) return;
      w.__renderer = renderer;
      const render = renderer.render.bind(renderer);
      renderer.render = (...args: unknown[]) => {
        w.__renders++;
        render(...args);
      };
    });
    w.__THREE_DEVTOOLS__ = hook;
  });
  const memory = () => page.evaluate(() => (window as unknown as { __renderer: { info: { memory: { geometries: number; textures: number } } } }).__renderer.info.memory);
  const renders = () => page.evaluate(() => (window as unknown as { __renders: number }).__renders);
  await openExample(page);
  await attachForMachineB(page, `${MODELS}/textured.glb`);
  const review = await reviewed(page);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const first = await memory();
  for (let i = 0; i < 4; i++) {
    await review.getByTestId("model-turn-right").click();
    await expect(review).toHaveAttribute("data-busy", "false", { timeout: 30_000 });
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  }
  await page.waitForTimeout(1500);
  // Each turn is a new template; the replaced ones are freed (without that, +1 geometry and +1
  // texture per turn here).
  // Freed just after the render that stopped using them: wait for that, not a fixed time. No
  // growth (a leak adds one geometry and one texture per turn; the first reading can include a
  // transient one).
  await expect.poll(async () => { const m = await memory(); return m.geometries <= first.geometries && m.textures <= first.textures; }, { timeout: 15_000 }).toBe(true); // prettier-ignore
  // Idle: no frame is drawn while nothing changes.
  const settled = await renders();
  await page.waitForTimeout(1500);
  expect(await renders()).toBe(settled);
});
