// GEN-06/07 inspection: screenshots of the revision review for development regressions (the
// GEN-05 failures on builder objects, and synthetic stand-ins for its photo-made ones). The API
// replays recorded answers (scripts/build_inspection_recordings.py), judges them with the
// current checks, and the dialog shows them as a first-time viewer would see them.
//
//   INSPECT_OUT=../../docs/gen-07/inspect pnpm exec playwright test e2e/inspect-revisions.spec.ts
//
// Skipped unless INSPECT_OUT is set: it writes files for a person to look at, it asserts little.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import cases from "./inspection-cases.json" with { type: "json" };

const OUT = process.env.INSPECT_OUT;
const TEMPLATE: Record<string, string> = { rack: "rack", table: "table", sofa: "sofa", chair: "chair", screen: "screen", tank: "tank" };

async function build(page: Page, template: string) {
  await page.getByTestId("catalog-describe").click();
  const create = page.getByTestId("create-object");
  await create.getByTestId("open-builder").click();
  await create.getByTestId(`template-${TEMPLATE[template]}`).click();
  await expect(create.getByTestId("model-preview")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await create.getByTestId("place-generated").click();
  await expect(page.getByTestId("placement-readout")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("object-inspector")).toBeVisible();
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test.describe(`revision review at ${size.width}x${size.height}`, () => {
    test.skip(!OUT, "set INSPECT_OUT to write the inspection screenshots");
    test.use({ viewport: size });
    for (const c of cases) {
      // Every case at the reference size; a representative few at 1280 px.
      if (size.width === 1280 && !["glass-top", "valve-under", "tiny-light", "bracket-behind"].includes(c.label)) continue;
      test(c.label, async ({ page }) => {
        test.setTimeout(120_000);
        const dir = join(OUT!, `${size.width}x${size.height}`);
        mkdirSync(dir, { recursive: true });
        await page.goto("/");
        await build(page, c.template);
        await page.getByTestId("improve-model-open").click();
        const dialog = page.getByTestId("improve-model");
        await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
        await dialog.getByTestId("improve-instruction").fill(c.instruction);
        await dialog.getByTestId("improve-propose").click();
        await expect(dialog.getByTestId("improve-proposal")).toBeVisible({ timeout: 30_000 });
        await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
        await page.waitForTimeout(800);
        const opened = await dialog.getByTestId("improve-preview-new").getAttribute("data-view");
        await dialog.screenshot({ path: join(dir, `${c.label}-dialog-${opened}.png`) });
        await dialog.locator(".improve-compare").screenshot({ path: join(dir, `${c.label}-compare-${opened}.png`) });
        for (const view of ["front-right", "rear-left", "low-front"]) {
          if (view === opened) continue;
          await dialog.getByTestId(`improve-view-${view}`).click();
          await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-view", view);
          await page.waitForTimeout(500);
          await dialog.locator(".improve-compare").screenshot({ path: join(dir, `${c.label}-compare-${view}.png`) });
        }
        if (size.width === 1440) {
          await dialog.getByTestId("improve-apply").click();
          await expect(dialog).toBeHidden({ timeout: 30_000 });
          await page.keyboard.press("f"); // frame the selection: the placed object fills the view
          await page.waitForTimeout(1200);
          await page.getByTestId("viewport").screenshot({ path: join(dir, `${c.label}-placed.png`) });
        }
      });
    }
  });
}
