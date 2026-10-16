// IMG-03: the scorer's world is the world the browser builds. A development render (never held
// out) goes through the real photo dialog with its recorded development answer; the operator marks
// the floor mat's four corners and types its measured sides; the created, saved project must hold
// the same placements as scripts/img03/score.ts computes for that photo's initial world.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SET = new URL("../../../docs/assist-evaluation/img-03/", import.meta.url).pathname;
const CASE = "dev-office-a";
const annotation = JSON.parse(readFileSync(`${SET}annotations/${CASE}.annotation.json`, "utf8")) as {
  rectangle: { corners: { u: number; v: number }[]; width_m: number; depth_m: number };
};
const expected = (JSON.parse(readFileSync(`${SET}development/worlds-dev.json`, "utf8")) as Record<string, Record<string, { initial: { id: string; x: number; z: number; yaw_deg: number; width: number; depth: number; height: number }[] }>>)[
  "qwen3-vl-32b-instruct"
]![CASE]!.initial;

interface Saved {
  sources: { photo_import: { observations: { id: string; object_id: string | null }[] } | null }[];
  scene: { objects: { id: string; transform: { position_m: { x: number; z: number }; rotation_rad: { y: number } }; dimensions: Record<string, { value_m: number }> }[] };
}

test("a development render through the real photo dialog gives the scorer's placements", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("open-start").click();
  await page.getByTestId("start-image").click();
  await page.getByTestId("photo-file-input").setInputFiles(`${SET}photos/${CASE}.jpg`);
  await page.getByTestId("photo-analyse").click();
  await expect(page.getByTestId("photo-stage")).toBeVisible();
  await page.getByTestId("photo-tab-scale").click();
  for (const [i, c] of annotation.rectangle.corners.entries()) {
    const stage = (await page.getByTestId("photo-stage").boundingBox())!;
    const handle = (await page.getByTestId(`photo-corner-${i}`).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + c.u * stage.width, stage.y + c.v * stage.height, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByTestId("photo-feature").fill("floor mat");
  for (const [id, value] of [
    ["photo-scale-width", annotation.rectangle.width_m],
    ["photo-scale-depth", annotation.rectangle.depth_m],
  ] as const) {
    await page.getByTestId(id).fill(String(value));
    await page.getByTestId(id).press("Enter");
  }
  await page.getByTestId("photo-basis-measured").check();
  await page.getByTestId("photo-create").click();
  await expect(page.getByTestId("photo-import")).toBeHidden({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8")) as Saved;
  const observations = saved.sources.find((s) => s.photo_import)!.photo_import!.observations;
  expect(observations.filter((o) => o.object_id).map((o) => o.id).sort()).toEqual(expected.map((e) => e.id).sort());
  for (const e of expected) {
    const object = saved.scene.objects.find((o) => o.id === observations.find((o) => o.id === e.id)!.object_id)!;
    // Corners dragged on screen land within about a pixel of the annotation's.
    expect(Math.abs(object.transform.position_m.x - e.x), `${e.id} x`).toBeLessThan(0.05);
    expect(Math.abs(object.transform.position_m.z - e.z), `${e.id} z`).toBeLessThan(0.05);
    expect(Math.abs(object.dimensions.width!.value_m / e.width - 1), `${e.id} width`).toBeLessThan(0.03);
    expect(Math.abs(object.dimensions.depth!.value_m / e.depth - 1), `${e.id} depth`).toBeLessThan(0.03);
  }
});
