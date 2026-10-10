// GEN-01: a first-time user describes a missing object, checks its size and places it, then
// changes the scene with words. The API replays recorded answers from the live provider
// ("recorded" mode, labelled as such), so the whole pipeline - schema checks, grounding,
// bounded geometry, model build and hash checks - runs offline and deterministically.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { E2E_CATALOG_DIR } from "./paths";

const CONVEYOR = "a guarded conveyor about 2.2 m long with a control screen";

interface SavedAsset {
  id: string;
  name: string;
  visual: { uri: string; sha256: string };
  source: { kind: string };
  nominal_dimensions: Record<string, { value_m: number; origin: string; review_status: string; source_ref: string }>;
  generation: { method: string; description: string; language_model: { model: string }; unknown_properties: { property: string }[] };
}

interface Saved {
  catalog: SavedAsset[];
  scene: { objects: { id: string; asset_id: string | null }[]; edit_log: { type: string; asset_id?: string }[] };
}

/** An object in the left-hand list (candidate buttons elsewhere carry the same names). */
const objectList = (page: Page, name: RegExp) => page.locator(".panel-left .object-item", { hasText: name });
const revision = (page: Page, n: number) => expect(page.getByTestId("revision-status")).toHaveText(`Scene revision ${n}`);
const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);

async function save(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  return { name: download.suggestedFilename(), text: readFileSync((await download.path())!, "utf8") };
}

async function reopen(page: Page, file: { name: string; text: string }) {
  await page.getByTestId("scene-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
}

test.describe("first visit", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("describe, check, place, undo, save, reopen and rebuild a missing model", { tag: "@smoke" }, async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");

    // The guided entry: three working choices and image import shown as upcoming.
    const start = page.getByTestId("start-panel");
    await expect(start).toBeVisible();
    await expect(start.getByTestId("start-image")).toContainText("Coming next");
    await expect(start.getByTestId("start-image").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");
    await start.getByTestId("start-describe").click();

    // Describe the object in ordinary words. The offline provider is labelled as such.
    const create = page.getByTestId("create-object");
    await expect(create.getByTestId("assist-note")).toContainText("Not live AI");
    await create.getByTestId("describe-text").fill(CONVEYOR);
    await create.getByTestId("describe-submit").click();

    // Review: the stated length is the user's; estimates must be confirmed before placing.
    await expect(create.getByTestId("object-name")).not.toHaveValue("");
    const sizes = create.getByTestId("size-review");
    await expect(sizes).toContainText("from your words: “about 2.2 m long”");
    await expect(sizes).toContainText("estimate - please check");
    await expect(create.getByTestId("unknowns")).toContainText("mass, strength, material chemistry and how it operates");
    await expect(create.getByTestId("parts-summary")).toBeVisible();
    // No schema or provenance panel is needed to get here; evidence waits behind Details.
    await expect(create.getByTestId("create-details")).toBeHidden();
    const preview = create.getByTestId("model-preview");
    await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(preview).toHaveAttribute("data-sha256", /^[0-9a-f]{64}$/);
    await expect(preview).toHaveAttribute("data-extents", /^2\.200,/);
    await expect(create.getByTestId("place-generated")).toBeDisabled();
    await create.getByTestId("details-toggle").click();
    await expect(create.getByTestId("create-details")).toContainText("recorded offline test answer (not live AI)");
    await expect(create.getByTestId("create-details")).toContainText("No code from the language model is run");
    await create.getByTestId("confirm-sizes").click();
    await expect(create.getByTestId("place-generated")).toBeEnabled();
    await create.getByTestId("place-generated").click();

    // Place it through the usual placement marker and command path.
    await expect(create).toBeHidden();
    await expect(page.getByTestId("placement-banner")).toBeVisible();
    // The marker in the 3D view (which listens for Enter) mounts just after the banner.
    await expect(page.getByTestId("placement-readout")).toBeVisible();
    await page.keyboard.press("Enter");
    await revision(page, 1);
    await objects(page, 16);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "5/5 ready, 0 failed");
    const inspector = page.getByTestId("object-inspector");
    await expect(inspector.getByTestId("model-state")).toHaveText("Loaded; hash and bounds verified");
    await expect(inspector.getByTestId("asset-details")).toContainText("generated");

    // One undo removes the object and its catalog entry; redo brings both back.
    await page.getByTestId("undo").click();
    await objects(page, 15);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");
    await page.getByTestId("redo").click();
    await objects(page, 16);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "5/5 ready, 0 failed");

    // Save: the file records the description, the model, the evidence and the unknowns.
    const file = await save(page);
    const saved = JSON.parse(file.text) as Saved;
    const asset = saved.catalog.find((a) => a.source.kind === "generated")!;
    expect(asset.generation).toMatchObject({ method: "described", description: CONVEYOR, language_model: { model: "qwen3-235b-a22b-instruct-2507" } });
    expect(asset.generation.unknown_properties.map((u) => u.property).sort()).toEqual(["chemical_composition", "mass", "operating_behaviour", "strength"]);
    expect(asset.nominal_dimensions.width).toMatchObject({ value_m: 2.2, origin: "user_supplied", review_status: "confirmed" });
    expect(asset.nominal_dimensions.height).toMatchObject({ origin: "inferred", review_status: "confirmed" });
    expect(saved.scene.edit_log.at(-1)).toMatchObject({ type: "object_added", asset_id: asset.id });
    expect(asset.visual.uri).toBe(`generated/${asset.visual.sha256}.glb`);

    // Reopen: accepted by the API (model file present and hash-checked).
    await reopen(page, file);
    await expect(page.getByTestId("scene-source")).toHaveText(`${file.name} (accepted by API)`);
    await objects(page, 16);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "5/5 ready, 0 failed");

    // On a machine without the generated file, the project is refused at the model's location,
    // and can be opened after rebuilding the exact file from its recorded specification.
    const modelFile = join(E2E_CATALOG_DIR, asset.visual.uri);
    rmSync(modelFile);
    await reopen(page, file);
    const rejected = page.getByTestId("file-rejected");
    await expect(rejected).toContainText(`/catalog/${saved.catalog.indexOf(asset)}/visual/uri`);
    await rejected.getByTestId("restore-models").click();
    await expect(rejected).toBeHidden();
    await expect(page.getByTestId("scene-source")).toHaveText(`${file.name} (accepted by API)`);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "5/5 ready, 0 failed");
    expect(existsSync(modelFile)).toBe(true);
  });

  test("the start panel's other choices work and the full editor stays one click away", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-editor").click();
    await expect(page.getByTestId("start-panel")).toBeHidden();
    // It does not reappear on its own, and the Start button brings it back.
    await page.reload();
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
    await expect(page.getByTestId("start-panel")).toBeHidden();
    await page.getByTestId("open-start").click();
    await page.getByTestId("start-explore").click();
    await expect(page.getByTestId("start-panel")).toBeHidden();
    await page.getByRole("button", { name: "Foundation fixture" }).click();
    await objects(page, 6);
    await page.getByTestId("open-start").click();
    await page.getByTestId("start-explore").click();
    await objects(page, 15);
    // Open a project from the start panel.
    await page.getByTestId("open-start").click();
    await page.getByTestId("start-file-input").setInputFiles(new URL("../../../fixtures/scenes/foundation-scene.json", import.meta.url).pathname);
    await expect(page.getByTestId("scene-source")).toHaveText("foundation-scene.json (accepted by API)");
  });
});

test("builds an object by hand when the description assistant is off", async ({ page }) => {
  // The API reports no provider (as without VOYAGER_API_KEY): describing is unavailable, the
  // builder still works end to end.
  await page.route("**/api/v1/assist/status", (route) =>
    route.fulfill({
      json: { available: false, mode: "off", service: null, base_url: null, model: null, message: "Language proposals are off: no provider is configured." },
    }),
  );
  await page.goto("/");
  await expect(page.getByTestId("change-input")).toBeDisabled();
  await page.getByTestId("catalog-describe").click();
  const create = page.getByTestId("create-object");
  await expect(create.getByTestId("describe-text")).toBeDisabled();
  await expect(create.getByTestId("assist-note")).toContainText("no provider is configured");
  await create.getByTestId("open-builder").click();
  await create.getByTestId("template-tank").click();
  await expect(create.getByTestId("object-name")).toHaveValue("Tank");
  const preview = create.getByTestId("model-preview");
  await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const before = await preview.getAttribute("data-sha256");
  await create.getByTestId("size-width").fill("1.5");
  await create.getByTestId("size-width").press("Enter");
  // The parts are refitted to the new size and the verified preview changes with them.
  await expect(preview).toHaveAttribute("data-extents", /^1\.500,1\.860,1\.240$/);
  await expect(preview).not.toHaveAttribute("data-sha256", before ?? "");
  await expect(preview).toHaveAttribute("data-state", "ready");
  await create.getByTestId("place-generated").click();
  await expect(page.getByTestId("placement-banner")).toBeVisible();
  // The marker in the 3D view (which listens for Enter) mounts just after the banner.
  await expect(page.getByTestId("placement-readout")).toBeVisible();
  await page.keyboard.press("Enter");
  await revision(page, 1);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "5/5 ready, 0 failed");
  await expect(page.getByTestId("object-inspector")).toContainText("Tank");
});

test.describe("changing the scene with words", () => {
  async function ask(page: Page, request: string) {
    await page.getByTestId("change-input").fill(request);
    await page.getByTestId("change-submit").click();
    await expect(page.getByTestId("change-card")).not.toContainText("Interpreting");
  }

  test("shows the exact change, applies it on request, and undoes it", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");
    await objectList(page, /Control cabinet 1/).click();
    await ask(page, "move the selected cabinet 1 metre left");
    await expect(page.getByTestId("change-summary")).toHaveText("Move Control cabinet 1 by 1.000 m left (−X)");
    await expect(page.getByTestId("change-values")).toHaveText("x  -2.000 → -3.000 m");
    await revision(page, 0); // nothing applied yet
    await page.getByTestId("change-apply").click();
    await revision(page, 1);
    await expect(page.getByTestId("field-position-x")).toHaveValue("-3.000");
    await expect(page.getByTestId("change-applied")).toContainText("Move Control cabinet 1");
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("field-position-x")).toHaveValue("-2.000");
  });

  test("asks when the request is ambiguous and refuses a change the editor rejects", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");

    // Two cabinets (and a cabinet access zone) fit "the cabinet": the user is asked which.
    await ask(page, "move the cabinet 1 m left");
    await expect(page.getByTestId("change-question")).toContainText("Which one?");
    await expect(page.getByTestId("change-candidate-obj-cabinet-1")).toBeVisible();
    await expect(page.getByTestId("change-candidate-obj-cabinet-2")).toBeVisible();

    // "The selected cabinet" while a conveyor is selected: asked, not guessed.
    await objectList(page, /Infeed conveyor/).click();
    await ask(page, "move the selected cabinet 1 metre left");
    await expect(page.getByTestId("change-question")).toContainText("the selected object is Infeed conveyor");

    // 2 km is understood, but the command engine refuses it; nothing changes.
    await objectList(page, /Control cabinet 1/).click();
    await ask(page, "move the selected cabinet 2 km left");
    await expect(page.getByTestId("change-refused")).toHaveText("Position X must be within ±1000 m. Nothing was changed.");
    await revision(page, 0);
    await expect(page.getByTestId("field-position-x")).toHaveValue("-2.000");
  });
});
