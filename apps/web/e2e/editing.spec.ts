// WRL-03: editing through one command path, undo/redo, save as JSON and reopen exactly; unsaved
// changes are protected, and older or invalid files never replace the scene unreviewed.
import { readFileSync } from "node:fs";
import { expect, type Download, type Page, test } from "@playwright/test";

const repo = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repo(path), "utf8");

interface HandleProbe {
  objectId: string;
  tool: string;
  points: Record<string, [number, number]>;
}

interface SavedProject {
  schema_version: string;
  fixture: { kind: string } | null;
  scene: {
    revision: number;
    objects: { id: string; name: string; asset_id: string | null; transform: unknown; dimensions: Record<string, { value_m: number; origin: string; source_ref: string | null }> }[];
    edit_log: { type: string; revision: number; object_id?: string; dimensions?: { axis: string; before: { value_m: number; origin: string }; after: { origin: string } }[] }[];
  };
}

async function openDemo(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");
}

async function handles(page: Page, tool: string, objectId: string): Promise<HandleProbe> {
  let probe: HandleProbe | null = null;
  await expect
    .poll(async () => {
      probe = JSON.parse((await page.getByTestId("viewport").getAttribute("data-handles")) ?? "null") as HandleProbe | null;
      return probe ? `${probe.tool}:${probe.objectId}` : null;
    })
    .toBe(`${tool}:${objectId}`);
  return probe!;
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-dragging", "false");
}

async function setField(page: Page, testId: string, value: string) {
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.press("Enter");
}

/** Clear the selection so the inspector shows the scene summary. */
async function deselect(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("object-inspector")).toBeHidden();
}

const revision = (page: Page, n: number) => expect(page.getByTestId("revision-status")).toHaveText(`Scene revision ${n}`);

async function save(page: Page): Promise<{ download: Download; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  return { download, text: readFileSync((await download.path())!, "utf8") };
}

test("edits, undoes and redoes, saves and reopens the demo with every value intact", async ({ page }) => {
  test.setTimeout(150_000);
  await openDemo(page);
  const inspector = page.getByTestId("object-inspector");
  await expect(page.getByTestId("undo")).toBeDisabled();
  await expect(page.getByTestId("redo")).toBeDisabled();
  await expect(page.getByTestId("save-state")).toHaveText("No unsaved changes");

  // Numeric move, in metres.
  await page.getByRole("button", { name: /Infeed conveyor/ }).click();
  await setField(page, "field-position-x", "-7.2");
  await revision(page, 1);
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  await expect(page.getByTestId("undo")).toHaveAttribute("title", /Undo: Move Infeed conveyor/);

  // A handle drag is one undo step, however many pointer moves it takes.
  await page.getByTestId("tool-move").click();
  let probe = await handles(page, "move", "obj-conveyor-infeed");
  const [zx, zy] = probe.points["move-z"]!;
  await drag(page, [zx, zy], [zx - 40, zy + 50]);
  await revision(page, 2);
  const draggedZ = await page.getByTestId("field-position-z").inputValue();
  expect(Number(draggedZ)).toBeGreaterThan(-1.2);
  expect(Math.round(Number(draggedZ) * 1000) % 10).toBe(0); // snapped to 10 mm

  // The handle and the numeric field store the same value: undo the drag, type what it showed.
  const afterDrag = JSON.parse((await save(page)).text) as SavedProject;
  await page.getByTestId("undo").click();
  await revision(page, 3);
  await expect(page.getByTestId("field-position-z")).toHaveValue("-1.200");
  await setField(page, "field-position-z", draggedZ);
  await revision(page, 4);
  const afterTyping = JSON.parse((await save(page)).text) as SavedProject;
  expect(afterTyping.scene.objects).toEqual(afterDrag.scene.objects);
  expect(afterTyping.scene.edit_log.map(({ revision: _, ...r }) => r)).toEqual(afterDrag.scene.edit_log.map(({ revision: _, ...r }) => r));

  // Rotation in degrees (stored in radians), then a resize big enough to stretch the model.
  await setField(page, "field-rotation-y", "90");
  await revision(page, 5);
  await expect(page.getByTestId("field-rotation-y")).toHaveValue("90.0");
  await expect(inspector).toContainText("Rotation Y1.571 rad (90.0°)");
  await setField(page, "field-width", "3.6");
  await revision(page, 6);
  await expect(page.getByTestId("stretch-warning")).toContainText("stretched 20 % (tolerance 5 %)");
  await expect(inspector.getByTestId("axis-width")).toContainText("3.60 mUser-supplied");
  await expect(inspector.getByTestId("axis-width-edit")).toHaveText("Edited at r6; was 3.00 m User-supplied");
  await expect(inspector.getByTestId("object-edit-log")).toContainText("Width 3.000 m → 3.600 m");

  // An invalid value is refused and changes nothing.
  await setField(page, "field-depth", "0");
  await expect(inspector.getByRole("alert")).toHaveText("The depth must be at least 1 mm.");
  await revision(page, 6);

  // Resize the depth with a face handle, after framing the conveyor so its handles are apart.
  await page.getByTestId("tool-resize").click();
  await page.getByRole("button", { name: /Frame selection/ }).click();
  await page.waitForTimeout(800);
  probe = await handles(page, "resize", "obj-conveyor-infeed");
  const [dx, dy] = probe.points["size-z+"]!;
  const [cx, cy] = probe.points["size-z-"]!;
  await drag(page, [dx, dy], [dx + (dx - cx) * 0.4, dy + (dy - cy) * 0.4]);
  await revision(page, 7);
  expect(Number(await page.getByTestId("field-depth").inputValue())).toBeGreaterThan(0.83);

  // Add a catalog instance where the marker shows it.
  await page.keyboard.press("v");
  await page.keyboard.press("h");
  await page.waitForTimeout(800);
  await page.getByTestId("place-asset-electrical-cabinet-800").click();
  await expect(page.getByTestId("placement-banner")).toContainText("Placing Electrical cabinet, 800 mm");
  const box = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 3 });
  await expect(page.getByTestId("placement-readout")).toContainText("Electrical cabinet, 800 mm");
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.65);
  await revision(page, 8);
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 16 objects");
  await expect(inspector.locator(".panel-title")).toHaveText("Electrical cabinet, 800 mm");
  await expect(inspector.getByTestId("asset-details")).toContainText("asset-electrical-cabinet-800");
  await expect(inspector.getByTestId("object-edit-log")).toContainText("Added from catalog asset asset-electrical-cabinet-800");

  // Duplicate (placed beside the source with Enter), then remove the copy.
  await page.mouse.move(5, box.y + 200);
  const sourceX = Number(await page.getByTestId("field-position-x").inputValue());
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.getByTestId("placement-readout")).toContainText(`x ${(sourceX + 1.05).toFixed(3)} m`);
  await page.keyboard.press("Enter");
  await revision(page, 9);
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 17 objects");
  await expect(inspector.locator(".panel-title")).toHaveText("Electrical cabinet, 800 mm (copy)");
  await page.keyboard.press("Delete");
  await revision(page, 10);
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 16 objects");

  // Undo restores the copy and selects it; redo removes it again.
  await page.keyboard.press("ControlOrMeta+z");
  await revision(page, 11);
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 17 objects");
  await expect(inspector.locator(".panel-title")).toHaveText("Electrical cabinet, 800 mm (copy)");
  await expect(page.getByTestId("redo")).toHaveAttribute("title", /Redo: Remove Electrical cabinet, 800 mm \(copy\)/);
  await page.getByTestId("redo").click();
  await revision(page, 12);
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 16 objects");
  await expect(page.getByTestId("redo")).toBeDisabled();

  // An edit after undo clears the redo branch.
  await page.getByTestId("undo").click();
  await revision(page, 13);
  await expect(page.getByTestId("redo")).toBeEnabled();
  await page.getByRole("button", { name: /Outfeed pallet/ }).click();
  await setField(page, "field-position-x", "6.1");
  await revision(page, 14);
  await expect(page.getByTestId("redo")).toBeDisabled();

  // Save.
  const first = await save(page);
  expect(first.download.suggestedFilename()).toBe("proj-industrial-demo-r14.json");
  await expect(page.getByTestId("save-state")).toHaveText("No unsaved changes");
  const saved = JSON.parse(first.text) as SavedProject;
  expect(saved.schema_version).toBe("0.4.0");
  expect(saved.fixture?.kind).toBe("demonstration"); // still labelled synthetic
  expect(saved.scene.revision).toBe(14);
  expect(saved.scene.objects).toHaveLength(17);
  expect(saved.scene.edit_log.map((r) => r.type)).toEqual([
    "object_edited", // move x
    "object_edited", // typed z (the dragged z was undone)
    "object_edited", // rotate
    "object_edited", // width
    "object_edited", // depth handle
    "object_added", // cabinet
    "object_added", // copy (its removal was undone)
    "object_edited", // pallet
  ]);
  const conveyor = saved.scene.objects.find((o) => o.id === "obj-conveyor-infeed")!;
  expect(conveyor.dimensions.width!.value_m).toBe(3.6);
  expect(conveyor.dimensions.width!.origin).toBe("user_supplied");
  const widthEdit = saved.scene.edit_log[3]!.dimensions![0]!;
  expect(widthEdit.before).toMatchObject({ value_m: 3, origin: "user_supplied" });

  // Reopen the saved file: the API accepts it and nothing is lost or changed.
  await page.getByTestId("scene-file-input").setInputFiles({ name: first.download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(first.text) });
  await expect(page.getByTestId("scene-source")).toHaveText("proj-industrial-demo-r14.json (accepted by API)");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 17 objects");
  await expect(page.getByTestId("undo")).toBeDisabled(); // undo history is not part of the file
  await expect(page.getByTestId("edit-count")).toHaveText("8 edits recorded");
  await expect(page.getByTestId("fixture-banner")).toContainText("Edited layout - not checked for clearance or feasibility");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");
  await page.getByRole("button", { name: /^Infeed conveyor/ }).click();
  await expect(page.getByTestId("field-width")).toHaveValue("3.600");
  await expect(page.getByTestId("field-rotation-y")).toHaveValue("90.0");
  await expect(page.getByTestId("field-position-z")).toHaveValue(draggedZ);
  await expect(page.getByTestId("stretch-warning")).toBeVisible();
  await expect(page.getByTestId("model-state")).toHaveText("Loaded; hash and bounds verified");
  await page.keyboard.press("f");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/edited-scene.png" });

  const second = await save(page);
  expect(second.text).toBe(first.text); // byte-for-byte the same document
});

test("protects unsaved changes when switching scenes or opening files", async ({ page }) => {
  test.setTimeout(90_000);
  await openDemo(page);
  await page.getByRole("button", { name: /Filling cell/ }).click();
  await setField(page, "field-position-z", "-1.5");
  await revision(page, 1);

  // Switching scenes asks first; Cancel keeps everything.
  await page.getByRole("button", { name: "Foundation fixture" }).click();
  const dialog = page.getByTestId("unsaved-dialog");
  await expect(dialog).toContainText("Scene revision 1 has not been saved. To load the foundation fixture");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await revision(page, 1);
  await deselect(page);
  await expect(page.getByTestId("scene-source")).toHaveText("API industrial demo");

  // Opening a valid file asks too; "Save, then continue" downloads the edits first.
  await page.getByTestId("scene-file-input").setInputFiles(repo("fixtures/scenes/foundation-scene.json").pathname);
  await expect(dialog).toContainText("To open foundation-scene.json");
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Save, then continue" }).click()]);
  expect(download.suggestedFilename()).toBe("proj-industrial-demo-r1.json");
  await expect(page.getByTestId("scene-source")).toHaveText("foundation-scene.json (accepted by API)");
  await expect(page.getByTestId("save-state")).toHaveText("No unsaved changes");

  // Discard is an explicit choice.
  await page.getByRole("button", { name: /1 m reference cube/ }).click();
  await setField(page, "field-height", "1.5");
  await page.getByRole("button", { name: "Industrial demo" }).click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await revision(page, 0);
  await expect(page.getByTestId("save-state")).toHaveText("No unsaved changes");
});

test("reviews older project files before upgrading and keeps the scene for unknown, failed or invalid files", async ({ page }) => {
  test.setTimeout(90_000);
  await openDemo(page);
  const input = page.getByTestId("scene-file-input");
  const review = page.getByTestId("upgrade-dialog");
  const rejected = page.getByTestId("file-rejected");
  const source = page.getByTestId("scene-source");
  const upload = (name: string, doc: unknown) => input.setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });

  // 0.1.0: the notes are shown and nothing changes until the user decides.
  await input.setInputFiles(repo("fixtures/legacy/foundation-scene-0.1.0.json").pathname);
  await expect(review).toContainText("This file uses contract 0.1.0. The API upgraded a copy to 0.4.0");
  const notes = review.getByTestId("upgrade-notes");
  await expect(notes.locator("li").first()).toHaveText("schema_version 0.1.0 -> 0.2.0");
  await expect(notes).toContainText("obj-packing-station: box origin 'inferred' applied to width, height and depth");
  await expect(notes.locator("li").last()).toHaveText("schema_version 0.3.0 -> 0.4.0 (adds an empty scene edit log; no values or evidence changed)");
  await expect(source).toHaveText("API industrial demo");
  const [download] = await Promise.all([page.waitForEvent("download"), review.getByRole("button", { name: "Download upgraded file" }).click()]);
  expect(download.suggestedFilename()).toBe("foundation-scene-0.1.0-0.4.0.json");
  const upgraded = JSON.parse(readFileSync((await download.path())!, "utf8")) as SavedProject;
  expect([upgraded.schema_version, upgraded.scene.edit_log]).toEqual(["0.4.0", []]);
  await expect(review).toContainText("Upgraded copy downloaded as foundation-scene-0.1.0-0.4.0.json");
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(source).toHaveText("API industrial demo");

  // 0.2.0: open the upgraded copy; it counts as unsaved until saved in the new version.
  const current = JSON.parse(read("fixtures/scenes/foundation-scene.json")) as { scene: Record<string, unknown> };
  const { edit_log: _, ...legacyScene } = current.scene;
  await upload("plan-0.2.0.json", { ...current, schema_version: "0.2.0", scene: legacyScene });
  await expect(review).toContainText("This file uses contract 0.2.0");
  await review.getByRole("button", { name: "Open upgraded project" }).click();
  await expect(source).toHaveText("plan-0.2.0.json (upgraded from 0.2.0; not saved yet)");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 6 objects");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: /Packing station/ }).click();
  await expect(page.getByTestId("object-inspector").getByTestId("axis-width")).toContainText("1.20 mMeasured");
  await deselect(page);

  // An unknown version and a failed migration are refused; the upgraded scene stays.
  const legacy = JSON.parse(read("fixtures/legacy/foundation-scene-0.1.0.json")) as { scene: { objects: { dimensions: Record<string, unknown> }[] } };
  await upload("future.json", { ...legacy, schema_version: "9.9.9" });
  await expect(rejected).toContainText("future.json was rejected");
  await expect(rejected).toContainText("/schema_version");
  await expect(rejected).toContainText("unsupported schema_version '9.9.9'");
  await expect(review).toBeHidden();
  delete legacy.scene.objects[0]!.dimensions.width_m;
  await upload("broken-0.1.0.json", legacy);
  await expect(rejected).toContainText("broken-0.1.0.json was rejected");
  await expect(rejected).toContainText("The document could not be upgraded: malformed 0.1.0 document");

  // A current file whose edit log no longer matches its scene is refused as a whole.
  const edited = JSON.parse(read("fixtures/edited/foundation-edited.json")) as SavedProject;
  edited.scene.objects.find((o) => o.id === "obj-packing-station")!.dimensions.width!.value_m = 1.5;
  await upload("tampered.json", edited);
  await expect(rejected).toContainText("tampered.json was rejected");
  await expect(rejected).toContainText("the log no longer describes the scene");
  await expect(source).toHaveText("plan-0.2.0.json (upgraded from 0.2.0; not saved yet)");
});
