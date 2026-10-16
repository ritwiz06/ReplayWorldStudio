// Shared steps for the revision-review journeys (GEN-07). The API replays recorded answers.
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export interface SavedAsset {
  id: string;
  name: string;
  visual: { uri: string; sha256: string };
  generation: { spec: { parts: { id: string }[] }; revision: { revises: string; changes: string[] } | null } | null;
}
export interface Saved {
  schema_version: string;
  catalog: SavedAsset[];
  scene: { objects: { id: string; name: string; asset_id: string | null }[] };
}

export const CONVEYOR = "a guarded conveyor about 2.2 m long with a control screen";
const FACTORY = new URL("../../../fixtures/photos/factory-walk.png", import.meta.url).pathname;
const WALKWAY: [number, number][] = [
  [0.2073, 0.6507],
  [0.7927, 0.6507],
  [0.934, 0.7511],
  [0.066, 0.7511],
];

export const objects = (page: Page, n: number) => expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${n} objects`);
export const objectList = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name });

export async function save(page: Page): Promise<{ name: string; text: string; json: Saved }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, json: JSON.parse(text) as Saved };
}

export async function reopen(page: Page, file: { name: string; text: string }) {
  await page.getByTestId("scene-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
}

/** Describe the GEN-01 conveyor, confirm its sizes and place it at the marker. */
export async function placeConveyor(page: Page) {
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

/** The rendered factory photo, scaled by the walkway between two floor grid lines. */
export async function worldFromPhoto(page: Page) {
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
