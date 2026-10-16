// GEN-02: correct and reuse a generated object after placement. The API replays recorded live
// answers ("recorded" mode, labelled as such) for descriptions, photos and model revisions, so
// the whole path - reopening the exact specification, previews, the revision as a new asset, the
// one-step update of one or all instances, undo/redo, save, reopen and rebuild - runs offline.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type Route, test } from "@playwright/test";
import { E2E_CATALOG_DIR } from "./paths";

const CONVEYOR = "a guarded conveyor about 2.2 m long with a control screen";

interface SavedLength {
  value_m: number;
  origin: string;
  review_status: string;
  source_ref: string;
}
interface SavedAsset {
  id: string;
  name: string;
  visual: { uri: string; sha256: string };
  nominal_dimensions: Record<"width" | "height" | "depth", SavedLength>;
  generation: null | {
    method: string;
    description: string | null;
    language_model: { model: string } | null;
    revision: { revises: string; version: number; instruction: string | null; language_model: { model: string } | null; changes: string[]; not_represented: string[] } | null;
  };
}
interface Saved {
  schema_version: string;
  catalog: SavedAsset[];
  sources: { photo_import: { observations: { id: string; object_id: string | null }[] } | null }[];
  scene: {
    objects: { id: string; name: string; asset_id: string | null; dimensions: Record<"width" | "height" | "depth", SavedLength> }[];
    edit_log: { type: string; asset_before?: string; asset_after?: string; objects?: { object_id: string; dimensions: { axis: string }[] }[] }[];
  };
}

const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);
const revision = (page: Page, n: number) => expect(page.getByTestId("revision-status")).toHaveText(`Scene revision ${n}`);
const objectList = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name });

async function save(page: Page): Promise<{ name: string; text: string; json: Saved }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, json: JSON.parse(text) as Saved };
}

async function reopen(page: Page, file: { name: string; text: string }) {
  await page.getByTestId("scene-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
}

/** Describe the GEN-01 conveyor, confirm its sizes and place it at the marker. */
async function placeConveyor(page: Page) {
  await page.getByTestId("catalog-describe").click();
  const create = page.getByTestId("create-object");
  await create.getByTestId("describe-text").fill(CONVEYOR);
  await create.getByTestId("describe-submit").click();
  await expect(create.getByTestId("model-preview")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await create.getByTestId("confirm-sizes").click();
  await create.getByTestId("place-generated").click();
  await expect(page.getByTestId("placement-readout")).toBeVisible();
  await page.keyboard.press("Enter");
}

test("improve a described object by hand for every instance, keeping a measured size, then undo, save, reopen and rebuild", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await placeConveyor(page);
  await objects(page, 16);
  // A second instance of the same asset, whose width is then measured as 2.4 m.
  await page.locator("[data-testid^=place-asset-gen-]").first().click();
  await expect(page.getByTestId("placement-readout")).toBeVisible();
  await page.keyboard.press("Enter");
  await objects(page, 17);
  const width = page.getByTestId("field-width");
  await width.fill("2.4");
  await width.press("Enter");
  await revision(page, 3);
  const before = await save(page);
  const original = before.json.catalog.find((a) => a.generation?.method === "described")!;
  const generation = original.generation!;
  const [first, second] = before.json.scene.objects.filter((o) => o.asset_id === original.id);
  const heightChange = `Height ${original.nominal_dimensions.height.value_m.toFixed(3)} m → 1.400 m`;

  // Open "Improve model" on the first instance: the exact recorded specification, both previews.
  await objectList(page, new RegExp(`^${first!.name}`)).first().click();
  await page.getByTestId("improve-model-open").click();
  const dialog = page.getByTestId("improve-model");
  await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-sha256", original.visual.sha256, { timeout: 30_000 });
  await expect(dialog.getByTestId("improve-no-changes")).toBeVisible();
  await expect(dialog.getByTestId("improve-apply")).toBeDisabled();

  // An invalid specification (the API cannot build it) is reported; nothing can be applied.
  await page.route("**/api/v1/catalog/generated-models/preview", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: "part 'x' is thinner than 2 mm" }) }));
  await dialog.getByTestId("improve-size-height").fill("1.5");
  await dialog.getByTestId("improve-size-height").press("Enter");
  await expect(dialog.getByTestId("improve-build-error")).toContainText("cannot be built");
  await expect(dialog.getByTestId("improve-apply")).toBeDisabled();
  await page.unroute("**/api/v1/catalog/generated-models/preview");

  // By hand: a new colour and a taller model (entered by the user).
  await dialog.getByTestId("improve-size-height").fill("1.4");
  await dialog.getByTestId("improve-size-height").press("Enter");
  const firstColour = dialog.locator("[data-testid^=improve-colour-]").first();
  await firstColour.selectOption("paint_blue");
  await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(dialog.getByTestId("improve-changes")).toContainText(heightChange);
  await expect(dialog.getByTestId("improve-changes")).toContainText("paint blue");

  // Every instance: the plan shows the measured width kept (with the option to replace it).
  await dialog.getByTestId("improve-scope-all").check();
  const plan = dialog.getByTestId("improve-plan");
  await expect(plan.getByTestId(`improve-plan-${first!.id}`)).toContainText(heightChange);
  await expect(plan.getByTestId(`improve-plan-${second!.id}`)).toContainText(heightChange);
  await expect(dialog.getByTestId("improve-apply")).toHaveText("Apply to 2 objects");

  // A failed build changes nothing.
  await page.route("**/api/v1/catalog/generated-assets/revisions", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Generator unavailable" }) }));
  await dialog.getByTestId("improve-apply").click();
  await expect(dialog.getByTestId("improve-error")).toContainText("Nothing was changed");
  await revision(page, 3);
  await page.unroute("**/api/v1/catalog/generated-assets/revisions");

  await dialog.getByTestId("improve-apply").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await revision(page, 4);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^6\/6 ready, 0 failed$/);

  // One undo restores both objects' model and size; redo applies it again.
  await page.getByTestId("undo").click();
  await revision(page, 5);
  const undone = await save(page);
  expect(undone.json.scene.objects).toEqual(before.json.scene.objects);
  expect(undone.json.catalog).toEqual(before.json.catalog);
  await page.getByTestId("redo").click();
  await revision(page, 6);

  // Saved: both versions, linked; kept sizes keep their evidence; the entered one is the user's.
  const after = await save(page);
  const v2 = after.json.catalog.find((a) => a.generation?.revision?.revises === original.id)!;
  expect(after.json.schema_version).toBe("0.7.0");
  expect(after.json.catalog.find((a) => a.id === original.id)).toEqual(original);
  expect(v2.generation).toMatchObject({ method: "described", description: CONVEYOR, language_model: generation.language_model, revision: { version: 2, instruction: null, language_model: null } });
  expect(v2.visual.sha256).not.toBe(original.visual.sha256);
  expect(v2.nominal_dimensions.width).toEqual(original.nominal_dimensions.width);
  expect(v2.nominal_dimensions.depth).toEqual(original.nominal_dimensions.depth);
  expect(v2.nominal_dimensions.height).toMatchObject({ value_m: 1.4, origin: "user_supplied", review_status: "confirmed" });
  const objectsAfter = Object.fromEntries(after.json.scene.objects.map((o) => [o.id, o]));
  expect([objectsAfter[first!.id]!.asset_id, objectsAfter[second!.id]!.asset_id]).toEqual([v2.id, v2.id]);
  expect(objectsAfter[second!.id]!.dimensions.width).toEqual(second!.dimensions.width); // measured 2.4 m kept
  expect(objectsAfter[second!.id]!.dimensions.height.value_m).toBe(1.4);
  const record = after.json.scene.edit_log.at(-1)!;
  expect(record).toMatchObject({ type: "asset_revised", asset_before: original.id, asset_after: v2.id });
  expect(record.objects!.map((o) => [o.object_id, o.dimensions.map((d) => d.axis)])).toEqual([
    [first!.id, ["height"]],
    [second!.id, ["height"]],
  ]);

  // Reopen: both model versions are present and hash-checked.
  await reopen(page, after);
  await expect(page.getByTestId("scene-source")).toHaveText(`${after.name} (accepted by API)`);
  await objectList(page, new RegExp(`^${first!.name}`)).first().click();
  await expect(page.getByTestId("revision-details")).toContainText("Version 2");
  await expect(page.getByTestId("asset-versions")).toContainText(original.id);

  // Without the new version's file the project is refused; rebuilding gives the recorded hash.
  rmSync(join(E2E_CATALOG_DIR, v2.visual.uri));
  await reopen(page, after);
  const rejected = page.getByTestId("file-rejected");
  await expect(rejected).toContainText(`/catalog/${after.json.catalog.indexOf(v2)}/visual/uri`);
  await rejected.getByTestId("restore-models").click();
  await expect(rejected).toBeHidden();
  await expect(page.getByTestId("scene-source")).toHaveText(`${after.name} (accepted by API)`);
});

// The rendered factory photo, scaled by the walkway between two floor grid lines (see photo.spec.ts).
const FACTORY = new URL("../../../fixtures/photos/factory-walk.png", import.meta.url).pathname;
const WALKWAY: [number, number][] = [
  [0.2073, 0.6507],
  [0.7927, 0.6507],
  [0.934, 0.7511],
  [0.066, 0.7511],
];
const PALLET = "make this a wooden pallet with cardboard boxes stacked on top of it instead of one solid block";

async function worldFromPhoto(page: Page) {
  await page.getByTestId("open-start").click();
  await page.getByTestId("start-image").click();
  await page.getByTestId("photo-file-input").setInputFiles(FACTORY);
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-stage")).toBeVisible();
  await page.getByTestId("photo-tab-scale").click();
  for (const [i, [u, v]] of WALKWAY.entries()) {
    const stage = (await page.getByTestId("photo-stage").boundingBox())!;
    const handle = (await page.getByTestId(`photo-corner-${i}`).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + u * stage.width, stage.y + v * stage.height, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByTestId("photo-feature").fill("walkway between floor grid lines");
  for (const [id, value] of [
    ["photo-scale-width", "6"],
    ["photo-scale-depth", "1.8"],
  ] as const) {
    await page.getByTestId(id).fill(value);
    await page.getByTestId(id).press("Enter");
  }
  await page.getByTestId("photo-basis-measured").check();
  await page.getByTestId("photo-create").click();
  await expect(page.getByTestId("photo-import")).toBeHidden({ timeout: 60_000 });
  await objects(page, 7);
}

test("improve a photo-made object with a proposal: cancel, propose, apply to it alone, keep the photo link", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await worldFromPhoto(page);
  const before = await save(page);
  const pallet = before.json.scene.objects.find((o) => o.name.startsWith("Stacked cardboard boxes"))!;
  const original = before.json.catalog.find((a) => a.id === pallet.asset_id)!;
  const observation = before.json.sources[0]!.photo_import!.observations.find((o) => o.object_id === pallet.id)!;

  await objectList(page, /^Stacked cardboard boxes/).click();
  await page.getByTestId("improve-model-open").click();
  const dialog = page.getByTestId("improve-model");
  await expect(dialog.getByTestId("improve-origin")).toContainText("Seen in a photo");
  await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-sha256", original.visual.sha256, { timeout: 30_000 });

  // A slow proposal can be cancelled; nothing changes.
  const proposals = "**/api/v1/assist/model-revisions";
  let held = false;
  await page.route(proposals, () => {
    held = true; // never answered; the cancel below abandons it
  });
  await dialog.getByTestId("improve-instruction").fill(PALLET);
  await dialog.getByTestId("improve-propose").click();
  await expect(dialog.getByTestId("improve-waiting")).toBeVisible();
  await expect.poll(() => held).toBe(true);
  await dialog.getByTestId("improve-cancel-proposal").click();
  await expect(dialog.getByTestId("improve-ask-notice")).toContainText("Cancelled. Nothing was changed.");
  await expect(dialog.getByTestId("improve-no-changes")).toBeVisible();
  await page.unroute(proposals);

  // The recorded proposal: separate parts instead of one block, size kept.
  await dialog.getByTestId("improve-propose").click();
  await expect(dialog.getByTestId("improve-proposal")).toContainText("Proposed by qwen3-235b-a22b-instruct-2507");
  await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(dialog.getByTestId("improve-changes")).toContainText("Removed “body”");
  await expect(dialog.getByTestId("improve-changes")).toContainText("cardboard");
  await expect(dialog.getByTestId("improve-scope-all")).toBeDisabled(); // the only instance
  await dialog.getByTestId("improve-apply").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Saved: the photo observation still points at the same object, which uses the revision; the
  // original observation and vision model stay; the sizes from the photo stay inferred.
  const after = await save(page);
  const v2 = after.json.catalog.find((a) => a.generation?.revision?.revises === original.id)!;
  const generation = original.generation!;
  expect(v2.generation).toMatchObject({
    method: "photo",
    description: generation.description,
    language_model: generation.language_model,
    revision: { version: 2, instruction: PALLET, language_model: { model: "qwen3-235b-a22b-instruct-2507" } },
  });
  for (const axis of ["width", "height", "depth"] as const) expect(v2.nominal_dimensions[axis]).toEqual(original.nominal_dimensions[axis]);
  expect(after.json.scene.objects.find((o) => o.id === pallet.id)).toMatchObject({ asset_id: v2.id, dimensions: pallet.dimensions });
  expect(after.json.sources[0]!.photo_import!.observations.find((o) => o.id === observation.id)!.object_id).toBe(pallet.id);
  expect(after.json.catalog.find((a) => a.id === original.id)).toEqual(original);
});

const MIXED = "put it on four caster wheels that actually roll and stack two cardboard boxes on it";

test("a mixed request becomes a partial revision: the drawable part is applied, the rest listed; refusals change nothing", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await worldFromPhoto(page);
  const before = await save(page);
  const pallet = before.json.scene.objects.find((o) => o.name.startsWith("Stacked cardboard boxes"))!;
  const original = before.json.catalog.find((a) => a.id === pallet.asset_id)!;

  await objectList(page, /^Stacked cardboard boxes/).click();
  await page.getByTestId("improve-model-open").click();
  const dialog = page.getByTestId("improve-model");
  await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });

  // "Already shown" and "nothing drawable" answers (fixed API responses) leave everything as it is.
  const proposals = "**/api/v1/assist/model-revisions";
  const provider = { service: "ASU Voyager", base_url: "https://openai.rc.asu.edu/v1", model: "qwen3-235b-a22b-instruct-2507", mode: "recorded", attempts: 1, first_attempt_valid: true, latency_ms: 1 };
  const reply = (body: object) => page.route(proposals, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
  await reply({ outcome: "already_satisfied", message: "The boxes are already cardboard.", spec: null, summary: null, partial: false, size_changed: false, not_represented: [], checks: [], problems: [], provider });
  await dialog.getByTestId("improve-instruction").fill("make the boxes cardboard");
  await dialog.getByTestId("improve-propose").click();
  await expect(dialog.getByTestId("improve-ask-notice")).toContainText("Already shown: The boxes are already cardboard. Nothing was changed.");
  await expect(dialog.getByTestId("improve-no-changes")).toBeVisible();
  await page.unroute(proposals);
  await reply({ outcome: "unsupported", message: "Nothing in this request can be drawn.", spec: null, summary: null, partial: false, size_changed: false, not_represented: ["“make it fireproof”: material properties are not modelled"], checks: [], problems: [], provider });
  await dialog.getByTestId("improve-instruction").fill("make it fireproof");
  await dialog.getByTestId("improve-propose").click();
  await expect(dialog.getByTestId("improve-ask-notice")).toContainText("Nothing in this request can be drawn. Nothing was changed.");
  await expect(dialog.getByTestId("improve-unshown")).toContainText("make it fireproof");
  await expect(dialog.getByTestId("improve-apply")).toBeDisabled();
  await page.unroute(proposals);

  // The recorded live answer to a mixed request: boxes drawn, rolling listed before Apply.
  await dialog.getByTestId("improve-instruction").fill(MIXED);
  await dialog.getByTestId("improve-propose").click();
  await expect(dialog.getByTestId("improve-partial")).toBeVisible();
  await expect(dialog.getByTestId("improve-unshown")).toContainText("roll");
  // The app's own notes (size kept, fitting) are listed apart, never as something not shown.
  await expect(dialog.getByTestId("improve-unshown")).not.toContainText("Size kept");
  await expect(dialog.getByTestId("improve-checks")).toContainText("Size kept");
  await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(dialog.getByTestId("improve-changes")).toContainText("cardboard");
  // The recorded answer stacks the boxes above the pallet with a gap: shown as a problem.
  await expect(dialog.getByTestId("improve-problems")).toContainText("“cardboard box” does not touch anything that holds it up; it floats.");
  await expect(dialog.getByTestId("improve-apply")).toHaveText("Apply despite these problems to this object");
  await dialog.getByTestId("improve-apply").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const after = await save(page);
  const v2 = after.json.catalog.find((a) => a.generation?.revision?.revises === original.id)!;
  expect(v2.generation!.revision!.instruction).toBe(MIXED);
  expect(v2.generation!.revision!.not_represented.join(" ")).toContain("roll");
  for (const axis of ["width", "height", "depth"] as const) expect(v2.nominal_dimensions[axis]).toEqual(original.nominal_dimensions[axis]);
  expect(after.json.scene.objects.find((o) => o.id === pallet.id)).toMatchObject({ asset_id: v2.id, dimensions: pallet.dimensions });
  // One undo returns the pallet to its previous model.
  await page.getByTestId("undo").click();
  const undone = await save(page);
  expect(undone.json.scene.objects.find((o) => o.id === pallet.id)!.asset_id).toBe(original.id);
});

test("problems the checks found are shown before Apply and kept on the version; a late answer after Cancel changes nothing", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await worldFromPhoto(page);
  const before = await save(page);
  const pallet = before.json.scene.objects.find((o) => o.name.startsWith("Stacked cardboard boxes"))!;
  const original = before.json.catalog.find((a) => a.id === pallet.asset_id)!;

  await objectList(page, /^Stacked cardboard boxes/).click();
  await page.getByTestId("improve-model-open").click();
  const dialog = page.getByTestId("improve-model");
  await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const proposals = "**/api/v1/assist/model-revisions";
  const provider = { service: "ASU Voyager", base_url: "https://openai.rc.asu.edu/v1", model: "qwen3-235b-a22b-instruct-2507", mode: "recorded", attempts: 2, first_attempt_valid: true, latency_ms: 1 };
  const spec = (original as unknown as { generation: { spec: { parts: Record<string, unknown>[] } } }).generation.spec;
  const blue = { ...spec, parts: spec.parts.map((p, i) => (i === 0 ? { ...p, material: "paint_blue" } : p)) };
  const answer = {
    outcome: "proposal", message: null, spec: blue, summary: "Painted it blue and added a stack light.", partial: false, size_changed: false,
    not_represented: [], checks: ["Size kept: the instruction did not ask for a different size."],
    problems: ["“stack light” does not touch anything that holds it up; it floats."], provider,
  };

  // Cancelled while waiting; the answer that arrives afterwards is ignored.
  let held: Route | null = null;
  await page.route(proposals, (route) => {
    held = route;
  });
  await dialog.getByTestId("improve-instruction").fill("paint it blue and add a stack light");
  await dialog.getByTestId("improve-propose").click();
  await expect.poll(() => held !== null).toBe(true);
  await dialog.getByTestId("improve-cancel-proposal").click();
  await expect(dialog.getByTestId("improve-ask-notice")).toContainText("Cancelled. Nothing was changed.");
  await held!.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }).catch(() => undefined);
  await page.waitForTimeout(500);
  await expect(dialog.getByTestId("improve-proposal")).toBeHidden();
  await expect(dialog.getByTestId("improve-no-changes")).toBeVisible();
  await page.unroute(proposals);

  // A proposal with a problem the model did not fix: shown before Apply, never as fully shown.
  await page.route(proposals, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }));
  await dialog.getByTestId("improve-propose").click();
  await expect(dialog.getByTestId("improve-problems")).toContainText("Not clearly shown");
  await expect(dialog.getByTestId("improve-problems")).toContainText("“stack light” does not touch anything that holds it up; it floats.");
  await expect(dialog.getByTestId("improve-apply")).toHaveText("Apply despite these problems to this object");
  await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await dialog.getByTestId("improve-apply").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.unroute(proposals);

  const after = await save(page);
  const v2 = after.json.catalog.find((a) => a.generation?.revision?.revises === original.id)!;
  expect(v2.generation!.revision!.changes).toContain("Problem found in the proposal: “stack light” does not touch anything that holds it up; it floats.");
  await page.getByTestId("undo").click();
  const undone = await save(page);
  expect(undone.json.scene.objects.find((o) => o.id === pallet.id)!.asset_id).toBe(original.id);
});
