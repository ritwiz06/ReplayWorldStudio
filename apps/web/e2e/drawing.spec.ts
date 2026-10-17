// ONB-01: upload a plan, walk through it, change it, see what changed. A synthetic DXF floor
// layout becomes a walkable 3D draft through the real API and editor; nothing calls a model.
// Set ONB_TIMINGS=<file> to append the measured times (plan on screen, walkable draft) as JSON.
import { appendFileSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const drawing = (name: string) => new URL(`../../../fixtures/drawings/${name}`, import.meta.url).pathname;

interface Saved {
  schema_version: string;
  sources: { kind: string; filename: string; sha256: string; drawing: { units: { basis: string }; objects: { object_id: string; refs: { handle: string; layer: string }[] }[] } }[];
  scene: { objects: { id: string; name: string; transform: { position_m: { x: number; z: number } }; dimensions: { height: { origin: string; source_ref: string } } }[]; edit_log: { type: string; object_id: string }[] };
}

const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);
const objectList = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name });

async function save(page: Page): Promise<{ name: string; text: string; json: Saved }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, json: JSON.parse(text) as Saved };
}

/** Upload a drawing through the main "Upload a plan" action; returns ms until the plan shows. */
async function upload(page: Page, name: string): Promise<number> {
  await page.getByTestId("journey-upload").click();
  await expect(page.getByTestId("drawing-import")).toBeVisible();
  const started = Date.now();
  await page.getByTestId("drawing-file-input").setInputFiles(drawing(name));
  await expect(page.getByTestId("drawing-plan")).toBeVisible();
  return Date.now() - started;
}

function record(timing: Record<string, unknown>) {
  if (process.env.ONB_TIMINGS) appendFileSync(process.env.ONB_TIMINGS, `${JSON.stringify({ at: new Date().toISOString(), ci: Boolean(process.env.CI), ...timing })}\n`);
}

test("a DXF floor plan becomes a walkable draft that is moved, compared, saved and reopened", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 120_000 : 60_000);
  await page.goto("/");
  await objects(page, 15);
  await expect(page.getByTestId("journey-upload")).toHaveAttribute("aria-current", "step");

  // Upload: the plan is shown as soon as the drawing is read, with what was found and assumed.
  const planMs = await upload(page, "hall-mm.dxf");
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.getByTestId("drawing-units")).toHaveText("Unit: millimetres, as the drawing says · the layout is 24 m × 16 m");
  await expect(dialog.getByTestId("drawing-summary")).toContainText("Found 11 objects and the floor outline: 7 pieces of equipment, 2 columns or walls, 1 walkway, 1 keep-clear zone.");
  await expect(dialog.getByTestId("drawing-summary")).toContainText("1 open line (1 on CONVEYOR) is shown on the plan but not built as objects");
  await expect(dialog.getByTestId("drawing-height-note")).toContainText("a floor plan has none");
  await expect(dialog.getByTestId("drawing-skipped")).toContainText("1 annotation item not used");
  await expect(dialog.getByTestId("drawing-plan-object-obj-dxf-104")).toBeVisible();
  const open = dialog.getByTestId("drawing-open");
  await expect(open).toHaveText("Open the 3D draft");
  const planInAppMs = Number(await dialog.getAttribute("data-plan-ms"));
  const draftInAppMs = Number(await dialog.getAttribute("data-draft-ms"));

  // Open the draft and walk it at once; timed with nothing else in between.
  const opening = Date.now();
  await open.click();
  await objects(page, 12);
  await page.getByTestId("mode-walk").click();
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const openToWalkMs = Date.now() - opening;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-renderer", "ready");
  await expect(page.getByTestId("scene-source")).toHaveText("Built from the drawing hall-mm.dxf (not saved yet)");
  // The upload step stays current until the draft is reviewed, and says so.
  await expect(page.getByTestId("journey-upload")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("journey-upload")).toContainText("Now check the draft: floor, scale and objects, in the Review panel.");

  // Walk: the draft is walkable.
  await page.getByTestId("mode-walk").click();
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  const before = await page.getByTestId("viewport").getAttribute("data-camera");
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await expect.poll(() => page.getByTestId("viewport").getAttribute("data-camera")).not.toBe(before);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("walk-hud")).toBeHidden();
  const walkableMs = draftInAppMs + openToWalkMs;
  record({
    test: "hall-mm.dxf",
    plan_in_app_ms: planInAppMs,
    plan_wall_ms: planMs,
    draft_in_app_ms: draftInAppMs,
    open_to_walk_ms: openToWalkMs,
    walkable_draft_ms: walkableMs,
    note: "in_app: from choosing the file to the plan painted / the checked draft ready, measured in the page; open_to_walk: clicking Open the 3D draft, then Walk, to the walk view drawn; walkable = draft_in_app + open_to_walk (no human think time)",
  });
  test.info().annotations.push({ type: "timing", description: `plan ${planInAppMs} ms, draft ${draftInAppMs} ms, walkable ${walkableMs} ms` });

  // The source drawing stays linked: each object says where it came from and what is assumed.
  await objectList(page, /Press 1/).click();
  const inspector = page.getByTestId("object-inspector");
  await expect(inspector.getByTestId("drawn-from")).toContainText("From the drawing hall-mm.dxf: LWPOLYLINE 104 on layer EQUIPMENT, named by the text inside it.");
  await expect(inspector.getByTestId("height-assumed")).toContainText("Height assumed for display (2.20 m)");
  await expect(inspector.getByTestId("axis-height")).toContainText("Default");
  await page.getByTestId("drawing-tab-drawing").click();
  await expect(page.getByTestId("source-plan-object-obj-dxf-104")).toHaveClass(/selected/);
  await expect(page.getByTestId("source-drawing-link")).toHaveText("Press 1 comes from LWPOLYLINE 104 on layer EQUIPMENT.");

  // Change something: move Press 1 two metres with the editor.
  await page.getByTestId("journey-change").click();
  await expect(page.getByTestId("tool-move")).toHaveAttribute("aria-pressed", "true");
  const x = page.getByTestId("field-position-x");
  await expect(x).toHaveValue("-8.500");
  await x.fill("-6.500");
  await x.press("Enter");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  await expect(page.getByTestId("journey-upload")).toHaveAttribute("aria-current", "step"); // its review is still open

  // Play or compare: the drawing and the arrangement now, the change listed, nothing invented.
  await page.getByTestId("journey-compare").click();
  const compare = page.getByTestId("drawing-compare");
  await expect(compare.getByTestId("compare-summary")).toHaveText("Compared with hall-mm.dxf: 1 changed · 10 as drawn");
  await expect(compare.getByTestId("compare-change-obj-dxf-104")).toHaveText("Press 1 moved 2.00 m");
  await expect(compare.getByTestId("compare-after-object-obj-dxf-104")).toHaveAttribute("data-state", "moved");
  await expect(compare.getByTestId("compare-before-object-obj-dxf-104")).toHaveAttribute("data-state", "drawn");
  await expect(compare.getByTestId("not-available")).toContainText("Not available yet: route, process and physical checks.");
  await compare.getByTestId("check-questions").locator("summary").click();
  await compare.getByTestId("check-overhead").click();
  await expect(compare.getByTestId("check-answer")).toHaveAttribute("data-status", "height_needed");
  await expect(compare.getByTestId("check-answer")).toContainText("Height needed. 9 objects have only a height assumed for display");
  await compare.getByTestId("check-clearance").click();
  await expect(compare.getByTestId("check-answer")).toHaveAttribute("data-status", "not_available");
  await expect(compare.getByTestId("check-answer")).toContainText("no clearance result is shown");
  await expect(compare.getByTestId("check-answer")).toContainText("The values are not ready for a check either: Column 1 is not reviewed yet");

  // Undo and redo keep the link to the drawing.
  await page.getByTestId("undo").click();
  await expect(compare.getByTestId("compare-summary")).toHaveText("Compared with hall-mm.dxf: 11 as drawn");
  await page.getByTestId("redo").click();
  await expect(compare.getByTestId("compare-summary")).toHaveText("Compared with hall-mm.dxf: 1 changed · 10 as drawn");
  await compare.getByTestId("compare-walk").click();
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  await page.keyboard.press("Escape");

  // Save: the drawing, its unit basis, every source reference and the move are in the file.
  const saved = await save(page);
  expect(saved.json.schema_version).toBe("0.10.0");
  const [source] = saved.json.sources;
  expect([source?.kind, source?.filename, source?.drawing.units.basis]).toEqual(["dxf", "hall-mm.dxf", "drawing_header"]);
  expect(source?.drawing.objects.find((o) => o.object_id === "obj-dxf-104")?.refs[0]).toMatchObject({ handle: "104", layer: "EQUIPMENT" });
  const press = saved.json.scene.objects.find((o) => o.id === "obj-dxf-104")!;
  expect(press.transform.position_m.x).toBe(-6.5);
  expect(press.dimensions.height.origin).toBe("default");
  expect(saved.json.scene.edit_log).toEqual([expect.objectContaining({ type: "object_edited", object_id: "obj-dxf-104" })]);

  // Reopen in a fresh page: the API checks the stored drawing; the link and the change remain.
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("scene-file-input").setInputFiles({ name: saved.name, mimeType: "application/json", buffer: Buffer.from(saved.text) });
  await objects(page, 12);
  await expect(page.getByTestId("scene-source")).toContainText(`${saved.name} (accepted by API)`);
  await objectList(page, /Press 1/).click();
  await expect(page.getByTestId("drawn-from")).toContainText("LWPOLYLINE 104 on layer EQUIPMENT");
  await page.getByTestId("journey-compare").click();
  await expect(page.getByTestId("compare-summary")).toHaveText("Compared with hall-mm.dxf: 1 changed · 10 as drawn");
});

test("a drawing without units asks once, and the answer is recorded as the person's", async ({ page }) => {
  await page.goto("/");
  await objects(page, 15);
  await upload(page, "room-unitless.dxf");
  const dialog = page.getByTestId("drawing-import");
  const question = dialog.getByTestId("drawing-unit-question");
  await expect(question).toContainText("What unit is this drawing in?");
  await expect(question).toContainText("The drawing does not say what unit it is drawn in ($INSUNITS is 0, unitless).");
  await expect(question).toContainText("millimetres→ 12 m × 8 m");
  await expect(dialog.getByTestId("drawing-open")).toBeDisabled();
  await expect(dialog.getByTestId("drawing-open")).toHaveText("Choose the unit first");
  await expect(dialog.getByTestId("drawing-step-units")).toHaveAttribute("data-state", "waiting");
  await dialog.getByTestId("drawing-unit-mm").check();
  await expect(dialog.getByTestId("drawing-open")).toBeEnabled();
  await dialog.getByTestId("drawing-open").click();
  await objects(page, 4);
  await objectList(page, /Saw/).click();
  await expect(page.getByTestId("axis-width")).toContainText("1 unit = 1 mm (your choice of unit)");
});

test("a DWG, a cancelled upload and unsaved changes all leave the current scene as it was", async ({ page }) => {
  await page.goto("/");
  await objects(page, 15);
  const name = await page.getByTestId("project-name").textContent();

  // DWG: the export route, no import.
  await upload(page, "layout.dwg").catch(() => undefined); // no plan appears for a DWG
  const dialog = page.getByTestId("drawing-import");
  await expect(dialog.getByTestId("drawing-error")).toContainText("DWG is not supported yet");
  await expect(dialog.getByTestId("drawing-error")).toContainText("Save As (or Export) > DXF, AutoCAD 2000 or later, ASCII format");
  await expect(dialog.getByTestId("drawing-error")).toContainText("Nothing was imported. Your current scene is unchanged.");
  await expect(dialog.getByTestId("drawing-plan")).toHaveCount(0);

  // Unsupported geometry is listed, never silently dropped.
  await dialog.getByTestId("drawing-file-input").setInputFiles(drawing("unsupported-mm.dxf"));
  await expect(dialog.getByTestId("drawing-skipped")).toContainText("6 shapes not imported");
  await expect(dialog.getByTestId("drawing-skipped-spline")).toContainText("1 SPLINE on layer EQUIPMENT (107): Splines are not in the supported subset");

  // Cancel while the drawing is being read.
  await page.route("**/api/v1/sources/drawings*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => undefined);
  });
  await dialog.getByTestId("drawing-another").click();
  await dialog.getByTestId("drawing-file-input").setInputFiles(drawing("hall-mm.dxf"));
  await expect(dialog.getByTestId("drawing-reading")).toBeVisible();
  await dialog.getByTestId("drawing-cancel").click();
  await expect(dialog.getByTestId("drawing-error")).toContainText("Cancelled. Nothing was imported. Your current scene is unchanged.");
  await page.unroute("**/api/v1/sources/drawings*");
  await dialog.getByRole("button", { name: "Close" }).click();
  await objects(page, 15);
  await expect(page.getByTestId("project-name")).toHaveText(name!);

  // Unsaved changes: opening a draft asks first; cancelling keeps the edited scene.
  await objectList(page, /Infeed conveyor/).click();
  const x = page.getByTestId("field-position-x");
  await x.fill(String(Number(await x.inputValue()) + 1));
  await x.press("Enter");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  await upload(page, "hall-mm.dxf");
  await page.getByTestId("drawing-open").click();
  const unsaved = page.getByTestId("unsaved-dialog");
  await expect(unsaved).toContainText("open the world built from hall-mm.dxf");
  await unsaved.getByRole("button", { name: "Cancel" }).click();
  await objects(page, 15);
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
});
