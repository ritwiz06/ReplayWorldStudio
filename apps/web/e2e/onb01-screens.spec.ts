// ONB-01 screens at desktop size, for a person to inspect (upload, draft world, before/after).
//
//   SCREENS_OUT=../../docs/onb-01 pnpm exec playwright test e2e/onb01-screens.spec.ts
//
// Skipped unless SCREENS_OUT is set: it writes files and asserts little.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const OUT = process.env.SCREENS_OUT;
const drawing = (name: string) => new URL(`../../../fixtures/drawings/${name}`, import.meta.url).pathname;

test.use({ storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.view", value: "editor" }] }] }, viewport: { width: 1440, height: 900 } });

test("first-time journey screens", async ({ page }) => {
  test.skip(!OUT, "set SCREENS_OUT to write the screenshots");
  test.setTimeout(120_000);
  mkdirSync(OUT!, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: join(OUT!, name), type: "jpeg", quality: 82 });

  await page.goto("/");
  await expect(page.getByTestId("start-panel")).toBeVisible();
  await page.waitForTimeout(800);
  await shot("1-start.jpg");

  await page.getByTestId("start-drawing").click();
  await page.getByTestId("drawing-file-input").setInputFiles(drawing("hall-mm.dxf"));
  await expect(page.getByTestId("drawing-open")).toHaveText("Open the 3D draft");
  await shot("2-upload-plan.jpg");

  await page.getByTestId("drawing-open").click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-renderer", "ready");
  await page.waitForTimeout(1500);
  await shot("3-draft-world.jpg");

  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /Press 1/ }).click();
  await page.waitForTimeout(800);
  await shot("4-selected-provisional.jpg");

  await page.getByTestId("journey-change").click();
  const x = page.getByTestId("field-position-x");
  await x.fill("-6.500");
  await x.press("Enter");
  const table = page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /Packing table/ });
  await table.click();
  const yaw = page.getByTestId("field-rotation-y");
  await yaw.fill("90");
  await yaw.press("Enter");
  await page.getByTestId("journey-compare").click();
  await page.waitForTimeout(1200);
  await shot("5-compare-before-after.jpg");
  await page.getByTestId("check-questions").locator("summary").click();
  await page.getByTestId("check-overhead").click();
  await shot("5b-height-needed.jpg");
  await page.getByTestId("check-questions").locator("summary").click();

  await page.getByTestId("mode-top").click();
  await page.waitForTimeout(1500);
  await shot("6-top-view-moved.jpg");

  await page.getByTestId("compare-walk").click().catch(() => page.getByTestId("mode-walk").click());
  await expect(page.getByTestId("walk-hud")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot("7-walk.jpg");
  await page.keyboard.press("Escape");

  await page.getByTestId("journey-upload").click();
  await page.getByTestId("drawing-file-input").setInputFiles(drawing("room-unitless.dxf"));
  await expect(page.getByTestId("drawing-unit-question")).toBeVisible();
  await shot("8-unit-question.jpg");

  await page.getByTestId("drawing-another").click();
  await page.getByTestId("drawing-file-input").setInputFiles(drawing("unsupported-mm.dxf"));
  await expect(page.getByTestId("drawing-skipped")).toBeVisible();
  await shot("9-not-imported.jpg");

  await page.getByTestId("drawing-another").click();
  await page.getByTestId("drawing-file-input").setInputFiles(drawing("layout.dwg"));
  await expect(page.getByTestId("drawing-error")).toBeVisible();
  await shot("10-dwg.jpg");
});
