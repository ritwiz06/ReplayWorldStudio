// IMG-02: reviewing several objects from one indoor photo. A table outlined with its chairs is
// split and the chair outlined twice is merged; missed objects are added, one partly visible and
// one not seen at all; photo overlaps and 3D footprint intersections are listed apart and
// recomputed as the layout is adjusted. Every correction is kept in the saved project and comes
// back the same after reopening, and after a missing photo is attached again. The API replays
// the vision model's recorded answers ("recorded", never live AI); the manual path calls nothing.
//
// With INSPECT_OUT set, before/after screenshots are written for a person to look at:
//   INSPECT_OUT=../../docs/img-02 pnpm exec playwright test e2e/photo-review.spec.ts
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { E2E_SOURCES_DIR } from "./paths";

const photoPath = (name: string) => new URL(`../../../fixtures/photos/${name}`, import.meta.url).pathname;
const CLASSROOM = photoPath("classroom.jpg");
const FACTORY = photoPath("factory-walk.png");
const OUT = process.env.INSPECT_OUT;

// The front table's four feet in the classroom photo (IMG-01's reference, 1.52 m wide: assumed).
const TABLE_FEET: [number, number][] = [
  [0.19, 0.864],
  [0.424, 0.835],
  [0.443, 0.907],
  [0.158, 0.951],
];
// The rendered demo's walkway: exactly 6 m by 1.8 m (see e2e/photo.spec.ts).
const WALKWAY: [number, number][] = [
  [0.2073, 0.6507],
  [0.7927, 0.6507],
  [0.934, 0.7511],
  [0.066, 0.7511],
];

interface Observation {
  id: string;
  label: string;
  decision: string;
  object_id: string | null;
  found_by: string;
  visibility: string;
  derived_from: string | null;
  replaced_by: string | null;
  corrections: string[];
  notes: string[];
}
interface Saved {
  sources: { photo_import: { vision_model: unknown; observations: Observation[] } | null }[];
  catalog: { id: string; generation: { description: string } | null; nominal_dimensions: Record<string, { origin: string; review_status: string; source_ref: string }> }[];
  scene: { objects: { id: string; name: string; asset_id: string | null; transform: { position_m: { x: number; z: number } } }[] };
}

const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);

async function shot(target: Page | Locator, name: string) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  await target.screenshot({ path: join(OUT, `${name}.png`) });
}

async function startPhoto(page: Page, file: string) {
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("open-start").click();
  await page.getByTestId("start-image").click();
  await page.getByTestId("photo-file-input").setInputFiles(file);
}

async function scale(page: Page, corners: [number, number][], feature: string, width: string, depth: string | null, basis: "measured" | "assumed") {
  await page.getByTestId("photo-tab-scale").click();
  for (const [i, [u, v]] of corners.entries()) {
    const stage = (await page.getByTestId("photo-stage").boundingBox())!;
    const handle = (await page.getByTestId(`photo-corner-${i}`).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + u * stage.width, stage.y + v * stage.height, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByTestId("photo-feature").fill(feature);
  for (const [id, value] of [["photo-scale-width", width], ["photo-scale-depth", depth]] as const) {
    if (value === null) continue;
    await page.getByTestId(id).fill(value);
    await page.getByTestId(id).press("Enter");
  }
  await page.getByTestId(`photo-basis-${basis}`).check();
}

/** Draw a missed object's outline on the photo; returns its id (it is selected once drawn). */
async function addObject(page: Page, [u0, v0, u1, v1]: [number, number, number, number], label: string, template: string): Promise<string> {
  await page.getByTestId("photo-tab-objects").click();
  await page.getByTestId("photo-add").click();
  const stage = (await page.getByTestId("photo-stage").boundingBox())!;
  await page.mouse.move(stage.x + u0 * stage.width, stage.y + v0 * stage.height);
  await page.mouse.down();
  await page.mouse.move(stage.x + u1 * stage.width, stage.y + v1 * stage.height, { steps: 8 });
  await page.mouse.up();
  const open = page.locator(".photo-object.open");
  await expect(open).toHaveCount(1);
  const id = (await open.getAttribute("data-testid"))!.replace("photo-object-", "");
  await open.locator(".photo-field input[type=text]").first().fill(label);
  await page.getByTestId(`photo-template-${id}`).selectOption(template);
  return id;
}

async function open(page: Page, id: string) {
  const item = page.getByTestId(`photo-object-${id}`);
  if (!(await item.evaluate((e) => e.classList.contains("open")))) await item.locator(".photo-object-head").click();
}

async function setValue(page: Page, testId: string, value: number) {
  // Degrees are typed to 0.1°, metres to the millimetre.
  await page.getByTestId(testId).fill(value.toFixed(testId.endsWith("-yaw") ? 1 : 3));
  await page.getByTestId(testId).press("Enter");
  await expect(page.getByTestId(testId).locator("xpath=following-sibling::span[contains(@class,'field-error')]")).toHaveCount(0);
}

async function save(page: Page): Promise<{ name: string; text: string; json: Saved }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, json: JSON.parse(text) as Saved };
}

async function reopen(page: Page, file: { name: string; text: string }) {
  await page.getByTestId("scene-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
}

const observationsOf = (saved: Saved) => saved.sources.find((s) => s.photo_import)!.photo_import!.observations;

test("classroom: split a table outlined with its chairs, merge a chair outlined twice, add what was missed, fix the layout; it all survives save, reopen and a missing photo @smoke", async ({ page }) => {
  test.setTimeout(240_000);
  await startPhoto(page, CLASSROOM);
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-stage")).toBeVisible();
  const wizard = page.getByTestId("photo-import");
  await shot(wizard, "classroom-1-objects-before");

  // The model outlined tables together with their chairs: those outlines are flagged for splitting.
  const hints = page.getByTestId("photo-suggestions");
  await expect(hints.locator('li[data-kind="split"]')).toHaveCount(3);
  await expect(hints).not.toContainText("machine");
  await hints.getByTestId("photo-hint-split-obs-1").click();
  await page.getByTestId("photo-split-count-obs-1").selectOption("2");
  await page.getByTestId("photo-split-obs-1").click();
  // The original outline is kept, marked split; the pieces name it.
  await expect(page.getByTestId("photo-object-obs-1")).toHaveAttribute("data-decision", "split");
  await expect(page.getByTestId("photo-accept-obs-1")).toBeDisabled();
  await expect(page.getByTestId("photo-object-obs-1-a")).toContainText("rectangular table");
  await expect(page.getByTestId("photo-object-obs-1-b")).toContainText("chair");
  await expect(page.getByTestId("photo-box-obs-1")).toHaveCount(0);

  // The chair piece is chair #10 outlined twice: merge it into that tighter outline.
  const merge = hints.locator('li[data-kind="merge"]');
  await expect(merge).toHaveCount(1);
  await expect(merge).toContainText("may be the same object");
  await merge.getByRole("button").click();
  await expect(page.getByTestId("photo-object-obs-1-b")).toHaveAttribute("data-decision", "merged");
  await expect(page.getByTestId("photo-object-obs-1-b")).toContainText("merged into #");

  // The table piece covers the left half of the old outline: drag its right edge to the table's.
  await open(page, "obs-1-a");
  const tableBox = page.getByTestId("photo-box-obs-1-a");
  const edge = (await tableBox.locator(".edge-right").boundingBox())!;
  const stage = (await page.getByTestId("photo-stage").boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + 0.447 * stage.width, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.up();
  // The table stands partly behind the chairs in front of it.
  await page.getByTestId("photo-visibility-obs-1-a").selectOption("partly_visible");
  await expect(page.getByTestId("photo-visibility-note-obs-1-a")).toContainText("estimates");

  // Missed: a low white cabinet partly behind the teacher's desk, and a bin not seen at all.
  const cabinet = await addObject(page, [0.494, 0.541, 0.59, 0.632], "low white cabinet", "cabinet");
  await page.getByTestId(`photo-visibility-${cabinet}`).selectOption("partly_visible");
  const bin = await addObject(page, [0.556, 0.585, 0.586, 0.636], "waste bin", "box");
  await page.getByTestId(`photo-visibility-${bin}`).selectOption("added");
  await expect(page.getByTestId(`photo-visibility-note-${bin}`)).toContainText("Not seen in the photo");
  await expect(page.getByTestId(`photo-box-${bin}`)).toHaveClass(/vis-added/);

  await scale(page, TABLE_FEET, "front table's four feet", "1.52", null, "assumed");
  await page.getByTestId("photo-tab-objects").click();
  await open(page, bin);
  await expect(page.getByTestId(`photo-source-width-${bin}`)).toHaveText("not seen: an estimate");
  await open(page, cabinet);
  await expect(page.getByTestId(`photo-source-height-${cabinet}`)).toHaveText("partly hidden: an estimate, may be larger");
  await shot(wizard, "classroom-2-objects-after");

  // Layout: the two kinds of overlap, listed apart.
  await page.getByTestId("photo-tab-layout").click();
  const checks = page.getByTestId("photo-layout-checks");
  await expect(checks).toContainText("Two kinds of overlap");
  await expect(page.getByTestId("photo-tucked")).toContainText("seats tucked under a table");
  await expect(page.getByTestId("photo-overlaps").locator("li").first()).toContainText("is partly behind");
  // The two added objects' guessed depths run into the teacher's desk: listed as 3D clashes.
  const clashes = page.getByTestId("photo-clashes").locator("li");
  await expect(clashes.locator(`text=“low white cabinet”`).first()).toBeVisible();
  await expect(page.getByTestId("photo-clashes").locator(`li[data-pair="obs-4 ${cabinet}"]`)).toContainText("two machines cannot");
  await shot(wizard, "classroom-3-layout-clashes");

  // The desk's back edge, from its place and depth in the layout.
  await page.getByTestId("photo-plan-obs-4").click();
  const deskZ = Number(await page.getByTestId("photo-layout-z").inputValue());
  const deskDepth = Number(await page.getByTestId("photo-layout-depth").inputValue());
  await setValue(page, "photo-layout-yaw", 0);
  // The cabinet: a known 45 cm depth, facing the room, set behind the desk. Rechecked at once.
  await page.getByTestId(`photo-plan-${cabinet}`).click();
  await expect(page.getByTestId("photo-layout-edit")).toContainText("Its base is hidden");
  const cabinetX = Number(await page.getByTestId("photo-layout-x").inputValue());
  const cabinetWidth = Number(await page.getByTestId("photo-layout-width").inputValue());
  await setValue(page, "photo-layout-yaw", 0);
  await setValue(page, "photo-layout-depth", 0.45);
  const behindDesk = deskZ - deskDepth / 2 - 0.45 / 2 - 0.1;
  await setValue(page, "photo-layout-z", behindDesk);
  await expect(page.getByTestId("photo-layout-edit")).toContainText("Moved by you; the photo put it at");
  await expect(page.locator(`[data-testid="photo-clashes"] li[data-pair="obs-4 ${cabinet}"]`)).toHaveCount(0);
  // The bin beside it.
  await page.getByTestId(`photo-plan-${bin}`).click();
  await setValue(page, "photo-layout-yaw", 0);
  await setValue(page, "photo-layout-width", 0.3);
  await setValue(page, "photo-layout-depth", 0.3);
  await setValue(page, "photo-layout-x", cabinetX + cabinetWidth / 2 + 0.3);
  await setValue(page, "photo-layout-z", behindDesk);
  await expect(page.locator(`[data-testid="photo-clashes"] li[data-pair*="${bin}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid="photo-clashes"] li[data-pair*="${cabinet}"]`)).toHaveCount(0);
  await shot(wizard, "classroom-4-layout-after");

  // Create: 22 proposed − 1 split + 2 pieces − 1 merged + 2 added = 24 objects, with floor and scale.
  await expect(page.getByTestId("photo-create")).toHaveText("Create the 3D world (24 objects)");
  await page.getByTestId("photo-create").click();
  await expect(wizard).toBeHidden({ timeout: 90_000 });
  await objects(page, 26);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "24/24 ready, 0 failed", { timeout: 60_000 });
  await expect(page.locator('[data-testid="source-photo"] [data-visibility="added"]')).toHaveCount(1);
  // Partly visible: three the model reported (hidden or cut off at the edge) and two marked by the user.
  await expect(page.locator('[data-testid="source-photo"] [data-visibility="partly_visible"]')).toHaveCount(5);
  await shot(page, "classroom-6-world");
  await page.getByTestId("source-photo-view").click();
  await page.waitForTimeout(1200);
  await shot(page.getByTestId("viewport"), "classroom-7-photo-camera");
  await page.getByTestId("mode-walk").click();
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page.getByTestId("viewport"), "classroom-8-walk");
  await page.getByTestId("mode-orbit").click();

  // The record: nothing deleted, every piece linked to its observation, every correction said.
  const first = await save(page);
  const obs = Object.fromEntries(observationsOf(first.json).map((o) => [o.id, o]));
  expect(obs["obs-1"]).toMatchObject({ decision: "split", object_id: null, derived_from: null });
  expect(obs["obs-1"]!.corrections[0]).toContain("Split by you into “rectangular table” (obs-1-a), “chair” (obs-1-b)");
  expect(obs["obs-1-a"]).toMatchObject({ decision: "accepted", derived_from: "obs-1", visibility: "partly_visible", found_by: "model" });
  expect(obs["obs-1-b"]).toMatchObject({ decision: "merged", derived_from: "obs-1", replaced_by: "obs-10", object_id: null });
  expect(obs["obs-10"]!.corrections).toContain("Merged by you with “chair” (obs-1-b): the same object, outlined twice.");
  expect(obs[bin]).toMatchObject({ decision: "accepted", found_by: "user", visibility: "added" });
  expect(obs[cabinet]).toMatchObject({ decision: "accepted", found_by: "user", visibility: "partly_visible" });
  expect(obs[cabinet]!.corrections.some((c) => c.startsWith("Moved in the layout by you"))).toBe(true);
  expect(obs[cabinet]!.corrections).toContain("Depth entered by you: 0.45 m.");
  expect(obs["obs-4"]!.corrections).toEqual(["Facing entered by you: 0.0°."]);
  // What the analysis said about the desk (its outline may include the computers) predates that
  // correction, and the record says so; an untouched chair's notes stand as they were.
  expect(obs["obs-4"]!.notes.length).toBeGreaterThan(0);
  expect(obs["obs-4"]!.notes.every((n) => n.startsWith("Before your corrections, the analysis said: "))).toBe(true);
  expect(obs["obs-14"]!.notes.some((n) => n.startsWith("Before your corrections"))).toBe(false);
  // Evidence never stronger than the photo: the bin is an estimate, never observed.
  const objectOf = (id: string) => first.json.scene.objects.find((o) => o.id === obs[id]!.object_id)!;
  const assetOf = (id: string) => first.json.catalog.find((a) => a.id === objectOf(id).asset_id)!;
  // Its height is an estimate, never observed; its width was typed in the layout, so it is the user's.
  expect(assetOf(bin).nominal_dimensions.height!.source_ref).toContain("not seen in the photo");
  expect(assetOf(bin).nominal_dimensions.height).toMatchObject({ origin: "inferred", review_status: "unreviewed" });
  expect(assetOf(bin).nominal_dimensions.width).toMatchObject({ origin: "user_supplied", review_status: "confirmed" });
  expect(assetOf(bin).generation!.description).toContain("not seen in the photo");
  expect(assetOf(cabinet).nominal_dimensions.height!.source_ref).toContain("partly hidden");
  expect(assetOf(cabinet).nominal_dimensions.depth).toMatchObject({ origin: "user_supplied", review_status: "confirmed" });

  // An edit, undone and redone, then saved.
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Rectangular table/ }).click();
  const x = page.getByTestId("field-position-x");
  const before = Number(await x.inputValue());
  await x.fill((before + 0.3).toFixed(3));
  await x.press("Enter");
  await expect(page.getByTestId("revision-status")).toHaveText("Scene revision 1");
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("revision-status")).toHaveText("Scene revision 2");
  await page.getByTestId("redo").click();
  const second = await save(page);
  expect(observationsOf(second.json)).toEqual(observationsOf(first.json));

  // Reopen: the same objects and the same corrections and evidence.
  await reopen(page, second);
  await expect(page.getByTestId("scene-source")).toHaveText(`${second.name} (accepted by API)`);
  await objects(page, 26);
  const reopened = await save(page);
  expect(observationsOf(reopened.json)).toEqual(observationsOf(second.json));
  expect(reopened.json.scene.objects).toEqual(second.json.scene.objects);
  expect(reopened.json.catalog).toEqual(second.json.catalog);

  // Without the photo: refused, the original attached again, and still the same record.
  const sha = createHash("sha256").update(readFileSync(CLASSROOM)).digest("hex");
  rmSync(join(E2E_SOURCES_DIR, "photos", `${sha}.jpg`));
  await reopen(page, second);
  const rejected = page.getByTestId("file-rejected");
  await expect(rejected.getByTestId("photo-missing")).toContainText("classroom.jpg");
  await rejected.getByTestId("attach-photo-input").setInputFiles(CLASSROOM);
  await expect(rejected).toBeHidden();
  const recovered = await save(page);
  expect(observationsOf(recovered.json)).toEqual(observationsOf(second.json));
});

test("factory render: equipment partly hiding another item; the missed cabinet behind a machine is added, a 3D clash fixed", async ({ page }) => {
  test.setTimeout(180_000);
  await startPhoto(page, FACTORY);
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-stage")).toBeVisible();
  const wizard = page.getByTestId("photo-import");
  // "machine with yellow safety cage" names one machine, not a group: no split suggested.
  await expect(page.getByTestId("photo-suggestions")).toHaveCount(0);
  await shot(wizard, "factory-1-objects-before");

  // The control cabinet behind the centre machine was missed: its top shows through the guard,
  // its base is hidden. Outline it where it stands, as partly visible.
  const cabinet = await addObject(page, [0.395, 0.415, 0.44, 0.59], "control cabinet", "cabinet");
  await page.getByTestId(`photo-visibility-${cabinet}`).selectOption("partly_visible");
  await scale(page, WALKWAY, "walkway between floor grid lines", "6", "1.8", "measured");

  await page.getByTestId("photo-tab-layout").click();
  // In the photo: the left conveyor is partly behind the left machine. Mark it.
  const overlap = page.getByTestId("photo-overlaps").locator('li[data-pair="obs-1 obs-3"]');
  await expect(overlap).toContainText("#3 “left conveyor belt” is partly behind #1 “left machine with yellow safety cage”");
  await overlap.getByTestId("photo-mark-partly-obs-3").click();
  // In 3D: the conveyor's guessed depth and the machine's footprint overlap. Not a seat under a table.
  const clash = page.getByTestId("photo-clashes").locator('li[data-pair="obs-1 obs-3"]');
  await expect(clash).toContainText("two machines cannot");
  await expect(clash).toContainText("hidden side whose size is a guess");
  await shot(wizard, "factory-2-layout-before");
  await clash.getByRole("button", { name: "Adjust #3" }).click();
  const x = Number(await page.getByTestId("photo-layout-x").inputValue());
  await setValue(page, "photo-layout-x", x + 0.2);
  await expect(page.getByTestId("photo-no-clashes")).toBeVisible();

  // The added cabinet's base is hidden behind the machine, near the horizon: placed from where
  // its base was drawn, it lands metres short. The user types where it stands (truth, in this
  // photo's frame: x −1.2 m, z −8.53 m, 0.80 m wide), and its sizes follow that distance.
  await page.getByTestId(`photo-plan-${cabinet}`).click();
  await expect(page.getByTestId("photo-layout-edit")).toContainText("this can be metres off near the horizon");
  const fromPhoto = { z: Number(await page.getByTestId("photo-layout-z").inputValue()), width: Number(await page.getByTestId("photo-layout-width").inputValue()) };
  await setValue(page, "photo-layout-x", -1.2);
  await setValue(page, "photo-layout-z", -8.53);
  const typed = Number(await page.getByTestId("photo-layout-width").inputValue());
  test.info().annotations.push({ type: "cabinet", description: `from the photo: z ${fromPhoto.z} m, width ${fromPhoto.width} m; typed z −8.53 m: width ${typed} m (truth 0.80 m)` });
  expect(fromPhoto.z).toBeGreaterThan(-6);
  expect(typed).toBeGreaterThan(fromPhoto.width * 1.5);
  await expect(page.getByTestId("photo-no-clashes")).toBeVisible();
  await shot(wizard, "factory-3-layout-after");

  await page.getByTestId("photo-create").click();
  await expect(wizard).toBeHidden({ timeout: 60_000 });
  // Two machines, two conveyors, the pallet and the added cabinet (the two monitors stay rejected).
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "6/6 ready, 0 failed", { timeout: 60_000 });
  await shot(page, "factory-4-world");
  await page.getByTestId("source-photo-view").click();
  await page.waitForTimeout(1200);
  await shot(page.getByTestId("viewport"), "factory-5-photo-camera");
  await page.getByTestId("mode-walk").click();
  await page.waitForTimeout(800);
  await shot(page.getByTestId("viewport"), "factory-6-walk");
  await page.getByTestId("mode-orbit").click();

  const saved = await save(page);
  const obs = Object.fromEntries(observationsOf(saved.json).map((o) => [o.id, o]));
  expect(obs[cabinet]).toMatchObject({ found_by: "user", visibility: "partly_visible", decision: "accepted" });
  expect(obs["obs-3"]!.visibility).toBe("partly_visible");
  expect(obs["obs-3"]!.corrections).toEqual(["Marked by you as partly visible (behind another object).", expect.stringMatching(/^Moved in the layout by you to x /)]);
  expect(obs[cabinet]!.corrections.some((c) => c.includes("z -8.53 m"))).toBe(true);
  // The monitors on the machines stay rejected, and are kept.
  expect([obs["obs-6"]!.decision, obs["obs-7"]!.decision]).toEqual(["rejected", "rejected"]);
  await reopen(page, saved);
  await expect(page.getByTestId("scene-source")).toHaveText(`${saved.name} (accepted by API)`);
  expect(observationsOf((await save(page)).json)).toEqual(observationsOf(saved.json));
});

test("manual only: objects marked by hand make a world with no call to the vision model", async ({ page }) => {
  test.setTimeout(120_000);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/assist/")) calls.push(r.url());
  });
  await startPhoto(page, FACTORY);
  await page.getByTestId("photo-manual").click();
  await expect(page.getByTestId("photo-no-objects")).toBeVisible();
  const machine = await addObject(page, [0.4, 0.365, 0.575, 0.615], "centre machine", "machine");
  const pallet = await addObject(page, [0.845, 0.495, 0.995, 0.61], "pallet with boxes", "pallet");
  await page.getByTestId(`photo-visibility-${pallet}`).selectOption("partly_visible");
  await scale(page, WALKWAY, "walkway between floor grid lines", "6", "1.8", "measured");
  await page.getByTestId("photo-tab-layout").click();
  await expect(page.getByTestId("photo-no-clashes")).toBeVisible();
  await page.getByTestId("photo-create").click();
  await expect(page.getByTestId("photo-import")).toBeHidden({ timeout: 60_000 });
  await objects(page, 4);
  const saved = await save(page);
  const source = saved.json.sources.find((s) => s.photo_import)!.photo_import!;
  expect(source.vision_model).toBeNull();
  expect(source.observations.map((o) => [o.id, o.found_by, o.visibility])).toEqual([
    [machine, "user", "visible"],
    [pallet, "user", "partly_visible"],
  ]);
  // Only the local availability check ran; nothing went to a model.
  expect(calls.filter((u) => /\/api\/v1\/assist\/(?!status)/.test(u))).toEqual([]);
});
