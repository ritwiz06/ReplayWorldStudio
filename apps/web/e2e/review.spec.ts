// GEN-07: the revision review for a first-time viewer, end to end, for a model saved before
// GEN-06, a photo-made model and a described model. Each journey asks for a change, inspects it
// from two camera angles (one click each, and back to the standard view), applies it, undoes and
// redoes it, saves, reopens, and rebuilds a missing model file to its recorded sha256. The API
// replays recorded answers (labelled "recorded", never live AI).
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { objectList, objects, placeConveyor, reopen, save, worldFromPhoto } from "./helpers";
import { E2E_CATALOG_DIR } from "./paths";

const LEGACY = new URL("../../../fixtures/legacy/generated-0.7.0-pre-gen06.json", import.meta.url).pathname;
const MIXED = "put it on four caster wheels that actually roll and stack two cardboard boxes on it";

/** Ask, inspect from two angles, apply, undo, redo, save, reopen, rebuild a missing file. */
async function journey(page: Page, object: RegExp, instruction: string) {
  const before = await save(page);
  const target = before.json.scene.objects.find((o) => object.test(o.name))!;
  // Select it (a just-placed object is already selected; clicking it again would deselect it).
  if (!(await page.getByTestId("improve-model-open").isVisible())) await objectList(page, object).first().click();
  await page.getByTestId("improve-model-open").click();
  const dialog = page.getByTestId("improve-model");
  await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  // Keyboard access: the instruction field and the button are reachable without the mouse.
  await dialog.getByTestId("improve-instruction").focus();
  await page.keyboard.type(instruction);
  await page.keyboard.press("Tab");
  await expect(dialog.getByTestId("improve-propose")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByTestId("improve-proposal")).toContainText("Proposed by", { timeout: 30_000 });
  const preview = dialog.getByTestId("improve-preview-new");
  await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });

  // Two angles, one click each; both previews follow; there is a way back.
  const opened = (await preview.getAttribute("data-view"))!;
  const other = opened === "front-right" ? "rear-left" : "front-right";
  await dialog.getByTestId(`improve-view-${other}`).click();
  await expect(preview).toHaveAttribute("data-view", other);
  await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-view", other);
  await expect(dialog.getByTestId(`improve-view-${other}`)).toHaveAttribute("aria-pressed", "true");
  if (other !== "front-right") {
    await dialog.getByTestId("improve-view-back").click();
    await expect(preview).toHaveAttribute("data-view", "front-right");
  }
  await dialog.getByTestId("improve-view-low-front").click();
  await expect(preview).toHaveAttribute("data-view", "low-front");

  // An informed Apply: any unresolved problem is repeated beside the button.
  const problems = await dialog.getByTestId("improve-problems").count();
  if (problems) {
    await expect(dialog.getByTestId("improve-apply-problems")).toBeVisible();
    await expect(dialog.getByTestId("improve-apply")).toContainText("Apply despite these problems");
    await expect(preview).not.toHaveAttribute("data-highlights", "0"); // the part is outlined
  }
  await dialog.getByTestId("improve-apply").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const after = await save(page);
  const revised = after.json.catalog.find((a) => a.generation?.revision?.revises === target.asset_id)!;
  expect(revised).toBeTruthy();
  expect(after.json.scene.objects.find((o) => o.id === target.id)!.asset_id).toBe(revised.id);
  if (problems) expect(revised.generation!.revision!.changes.some((c) => c.startsWith("Problem found in the proposal:"))).toBe(true);
  // The preview's highlight and edge lines are never stored: the new version's file is only the model.
  expect(JSON.stringify(revised)).not.toContain("transparent-edges");

  // One undo returns the object; redo brings the revision back.
  await page.getByTestId("undo").click();
  expect((await save(page)).json.scene.objects.find((o) => o.id === target.id)!.asset_id).toBe(target.asset_id);
  await page.getByTestId("redo").click();
  const redone = await save(page);
  expect(redone.json.scene.objects.find((o) => o.id === target.id)!.asset_id).toBe(revised.id);

  // Reopen, then without the new file: refused, rebuilt to the recorded sha256, accepted.
  await reopen(page, redone);
  await expect(page.getByTestId("scene-source")).toHaveText(`${redone.name} (accepted by API)`);
  rmSync(join(E2E_CATALOG_DIR, revised.visual.uri));
  await reopen(page, redone);
  const rejected = page.getByTestId("file-rejected");
  await expect(rejected).toBeVisible();
  await rejected.getByTestId("restore-models").click();
  await expect(rejected).toBeHidden();
  await expect(page.getByTestId("scene-source")).toHaveText(`${redone.name} (accepted by API)`);
}

test("a model saved before GEN-06 validates, rebuilds to its recorded hash and is improved, applied, undone and reopened", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  // Saved in contract 0.7.0, and its model file is not in this machine's catalog: refused, then
  // rebuilt by today's generator to exactly the sha256 recorded when it was made, then upgraded
  // to 0.12.0 for review (only photo-observation and drawing fields are added; it has neither).
  await page.getByTestId("scene-file-input").setInputFiles(LEGACY);
  const rejected = page.getByTestId("file-rejected");
  await expect(rejected).toBeVisible();
  await rejected.getByTestId("restore-models").click();
  await expect(rejected).toBeHidden();
  const review = page.getByTestId("upgrade-dialog");
  await expect(review).toContainText("This file uses contract 0.7.0");
  await review.getByRole("button", { name: "Open upgraded project" }).click();
  await expect(page.getByTestId("scene-source")).toHaveText("generated-0.7.0-pre-gen06.json (upgraded from 0.7.0; not saved yet)");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^(\d+)\/\1 ready, 0 failed$/);
  await journey(page, /^Display rack/, "add a white sign on the back of the rack");
});

test("a photo-made model: improve, two angles, apply, undo, save, reopen, rebuild", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await worldFromPhoto(page);
  await journey(page, /^Stacked cardboard boxes/, MIXED);
});

test("a described model: improve, two angles, apply, undo, save, reopen, rebuild", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await placeConveyor(page);
  await journey(page, /^Guarded conveyor with control screen/, "add a cable tray under the belt");
});

/** One part at a time (GEN-09): pick, resize, move, remove, confirm a size change, apply, round-trip. */
async function partJourney(page: Page, object: RegExp, shot: string) {
  const before = await save(page);
  const target = before.json.scene.objects.find((o) => object.test(o.name))!;
  if (!(await page.getByTestId("improve-model-open").isVisible())) await objectList(page, object).first().click();
  await page.getByTestId("improve-model-open").click();
  const dialog = page.getByTestId("improve-model");
  const preview = dialog.getByTestId("improve-preview-new");
  await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });

  // Click a part in the proposed model: it is selected and outlined.
  const select = dialog.getByTestId("improve-part-select");
  const box = (await preview.boundingBox())!;
  for (const [u, v] of [[0.5, 0.5], [0.5, 0.42], [0.45, 0.4], [0.55, 0.45], [0.5, 0.35], [0.6, 0.4]]) {
    await page.mouse.click(box.x + u * box.width, box.y + v * box.height);
    if ((await select.inputValue()) !== "") break;
  }
  await expect(select).not.toHaveValue("");
  await expect(preview).not.toHaveAttribute("data-highlights", "0");

  // Or choose one from the list, then make it narrower and move it: each exact change is listed.
  const count = await select.locator("option").count();
  await select.selectOption({ index: count - 1 });
  const width = dialog.getByTestId("improve-part-size-x");
  await width.fill((Number(await width.inputValue()) * 0.8).toFixed(3));
  await width.press("Enter");
  await expect(dialog.getByTestId("improve-part-changes")).toContainText("narrower");
  const single = count - 1 === 1;
  let lines = 1;
  if (!single) {
    const across = dialog.getByTestId("improve-part-pos-x");
    await across.fill((Number(await across.inputValue()) + 0.05).toFixed(3));
    await across.press("Enter");
    await expect(dialog.getByTestId("improve-part-changes")).toContainText("to the right");
    lines += 1;
  }
  await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });

  // Remove it, unless it is the only part (then the dialog says why it cannot be moved or removed).
  const remove = dialog.getByTestId("improve-part-remove");
  if (!single) {
    await remove.click();
    await expect(dialog.getByTestId("improve-part-changes")).toContainText("Removed");
    await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    lines += 1;
  } else {
    await expect(remove).toBeDisabled();
    await expect(dialog.getByTestId("improve-part-pos-x")).toHaveCount(0);
    await expect(dialog.getByTestId("improve-part")).toContainText("only part");
  }

  // A part change that alters the overall size waits for the user to confirm it.
  const confirm = dialog.getByTestId("improve-needs-confirm");
  if ((await confirm.getAttribute("data-open").catch(() => "0")) !== "0" && (await confirm.isVisible())) {
    await expect(dialog.getByTestId("improve-apply")).toBeDisabled();
    await expect(confirm).toContainText("because of your part change");
    await page.screenshot({ path: `test-results/${shot}-confirm.png` });
    for (const box of await confirm.getByRole("checkbox").all()) await box.check();
  }
  await expect(dialog.getByTestId("improve-apply")).toBeEnabled();
  await dialog.getByTestId("improve-apply").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const after = await save(page);
  const revised = after.json.catalog.find((a) => a.generation?.revision?.revises === target.asset_id)!;
  expect(revised.generation!.revision!.changes.filter((c) => c.startsWith("By you:")).length).toBe(lines);
  expect(after.json.scene.objects.find((o) => o.id === target.id)!.asset_id).toBe(revised.id);
  await page.getByTestId("undo").click();
  expect((await save(page)).json.scene.objects.find((o) => o.id === target.id)!.asset_id).toBe(target.asset_id);
  await page.getByTestId("redo").click();
  const redone = await save(page);
  rmSync(join(E2E_CATALOG_DIR, revised.visual.uri));
  await reopen(page, redone);
  const rejected = page.getByTestId("file-rejected");
  await expect(rejected).toBeVisible();
  await rejected.getByTestId("restore-models").click();
  await expect(rejected).toBeHidden();
  await expect(page.getByTestId("scene-source")).toHaveText(`${redone.name} (accepted by API)`);
  const reopened = await save(page);
  expect(reopened.json.catalog.find((a) => a.id === revised.id)!.generation!.revision!.changes).toEqual(revised.generation!.revision!.changes);
}

test("change one part of a described model: pick, resize, move or remove, apply, undo, save, reopen, rebuild", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await placeConveyor(page);
  await partJourney(page, /^Guarded conveyor with control screen/, "gen09-part-described");
});

test("change one part of a photo-made model: pick, resize, move or remove, apply, undo, save, reopen, rebuild", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await objects(page, 15);
  await worldFromPhoto(page);
  await partJourney(page, /^Stacked cardboard boxes/, "gen09-part-photo");
});
