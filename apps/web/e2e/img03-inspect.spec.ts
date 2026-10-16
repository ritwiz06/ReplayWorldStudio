// IMG-03: the worst measured errors as the photo dialog shows them, for a person to look at.
// Two held-out answers (already scored; replayed offline, never re-scored) go through the real
// dialog with the operator's measured mat, and the Objects and Layout views are captured.
//
//   INSPECT_OUT=../../docs/assist-evaluation/img-03/browser pnpm exec playwright test e2e/img03-inspect.spec.ts
//
// Skipped unless INSPECT_OUT is set: it writes files, it asserts little.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const SET = new URL("../../../docs/assist-evaluation/img-03/", import.meta.url).pathname;
const OUT = process.env.INSPECT_OUT;

for (const name of ["office-a", "store-a"]) {
  test(`${name}: the scored errors in the browser`, async ({ page }) => {
    test.skip(!OUT, "set INSPECT_OUT to write the inspection screenshots");
    test.setTimeout(120_000);
    const a = JSON.parse(readFileSync(`${SET}annotations/${name}.annotation.json`, "utf8")) as { rectangle: { corners: { u: number; v: number }[]; width_m: number; depth_m: number } };
    mkdirSync(OUT!, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("open-start").click();
    await page.getByTestId("start-image").click();
    await page.getByTestId("photo-file-input").setInputFiles(`${SET}photos/${name}.jpg`);
    await page.getByTestId("photo-analyse").click();
    await expect(page.getByTestId("photo-stage")).toBeVisible();
    await page.getByTestId("photo-tab-scale").click();
    for (const [i, c] of a.rectangle.corners.entries()) {
      const stage = (await page.getByTestId("photo-stage").boundingBox())!;
      const handle = (await page.getByTestId(`photo-corner-${i}`).boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(stage.x + c.u * stage.width, stage.y + c.v * stage.height, { steps: 6 });
      await page.mouse.up();
    }
    await page.getByTestId("photo-feature").fill("floor mat");
    for (const [id, value] of [
      ["photo-scale-width", a.rectangle.width_m],
      ["photo-scale-depth", a.rectangle.depth_m],
    ] as const) {
      await page.getByTestId(id).fill(String(value));
      await page.getByTestId(id).press("Enter");
    }
    await page.getByTestId("photo-basis-measured").check();
    const wizard = page.getByTestId("photo-import");
    await page.getByTestId("photo-tab-objects").click();
    await wizard.screenshot({ path: join(OUT!, `${name}-objects.png`) });
    await page.getByTestId("photo-tab-layout").click();
    await page.waitForTimeout(300);
    await wizard.screenshot({ path: join(OUT!, `${name}-layout.png`) });
    await page.getByTestId("photo-create").click();
    await expect(wizard).toBeHidden({ timeout: 60_000 });
    await page.getByTestId("mode-top").click();
    await page.waitForTimeout(1200);
    await page.getByTestId("viewport").screenshot({ path: join(OUT!, `${name}-plan.png`) });
    await page.getByTestId("source-photo-view").click();
    await page.waitForTimeout(1200);
    await page.getByTestId("viewport").screenshot({ path: join(OUT!, `${name}-photo-camera.png`) });
  });
}
