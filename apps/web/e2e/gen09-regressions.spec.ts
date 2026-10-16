// GEN-09: misleading but unwarned revisions, in the real dialog. The GEN-08 glass-door (t2) and
// floating-frame (p3) answers are replayed as development regressions (scripts/
// build_gen09_regressions.py), with two controls: glass added on purpose as a cover, and a beacon
// mounted on a post. Each must be warned about, or not, before Apply; t2 and p3 are then fixed
// with the one-part controls and applied. With INSPECT_OUT set, screenshots are written for a
// person to look at.
//
//   INSPECT_OUT=../../docs/gen-09/inspect pnpm exec playwright test e2e/gen09-regressions.spec.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import cases from "./gen09-cases.json" with { type: "json" };
import { objectList, objects, save } from "./helpers";

const FIXTURE = new URL("../../../fixtures/gen09/gen08-regressions.json", import.meta.url).pathname;
const OUT = process.env.INSPECT_OUT;

async function openRegressions(page: Page) {
  await page.goto("/");
  await objects(page, 15);
  await page.getByTestId("scene-file-input").setInputFiles(FIXTURE);
  // The first open finds no model files and rebuilds them; later opens find them.
  const rejected = page.getByTestId("file-rejected");
  const accepted = page.getByTestId("scene-source").filter({ hasText: "gen08-regressions.json (accepted by API)" });
  await expect(rejected.or(accepted)).toBeVisible();
  if (await rejected.isVisible()) {
    await rejected.getByTestId("restore-models").click();
    await expect(rejected).toBeHidden();
  }
  await expect(accepted).toBeVisible();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^(\d+)\/\1 ready, 0 failed$/);
}

async function ask(page: Page, name: string, instruction: string) {
  await objectList(page, new RegExp(`^${name}`)).first().click();
  await page.getByTestId("improve-model-open").click();
  const dialog = page.getByTestId("improve-model");
  await expect(dialog.getByTestId("improve-preview-old")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await dialog.getByTestId("improve-instruction").fill(instruction);
  await dialog.getByTestId("improve-propose").click();
  await expect(dialog.getByTestId("improve-proposal")).toContainText("Proposed by", { timeout: 30_000 });
  await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.waitForTimeout(600);
  return dialog;
}

async function shot(page: Page, dir: string, name: string, target?: ReturnType<Page["locator"]>) {
  if (!OUT) return;
  mkdirSync(dir, { recursive: true });
  await (target ?? page).screenshot({ path: join(dir, `${name}.png`) });
}

async function setPart(page: Page, testId: string, value: number) {
  const box = page.getByTestId("improve-model").getByTestId(testId);
  await box.fill(value.toFixed(3));
  await box.press("Enter");
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test.describe(`GEN-09 regressions at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });
    const dir = OUT ? join(OUT, `${size.width}x${size.height}`) : "";

    for (const c of cases) {
      test(`${c.label}: warned before Apply only when misleading`, async ({ page }) => {
        test.setTimeout(120_000);
        await openRegressions(page);
        const dialog = await ask(page, c.name, c.instruction);
        for (const [kind, expected] of Object.entries(c.expect)) {
          await expect(dialog.locator(`[data-testid="improve-problems"] li[data-kind="${kind}"]`)).toHaveCount(expected ? 1 : 0);
        }
        await shot(page, dir, `${c.label}-dialog`, dialog);
        await shot(page, dir, `${c.label}-compare`, dialog.locator(".improve-compare"));
      });
    }

    test(`t2 glass door: the solid body is said plainly, then made a back panel by hand and applied${size.width === 1440 ? " @smoke" : ""}`, async ({ page }) => {
      test.setTimeout(150_000);
      await openRegressions(page);
      const t2 = cases.find((c) => c.label === "gen08-t2")!;
      const dialog = await ask(page, t2.name, t2.instruction);
      const warning = dialog.locator('li[data-kind="backed_glass"]');
      await expect(warning).toContainText("solid body through it");
      await expect(warning).toContainText("not removed");
      await warning.getByRole("button", { name: "Show it" }).click();
      await expect(dialog.getByTestId("improve-preview-new")).not.toHaveAttribute("data-highlights", "0");
      await shot(page, dir, "t2-show-it", dialog.locator(".improve-compare"));

      // The beginner's fix: the body becomes a thin back panel, so the glass shows an inside.
      await dialog.getByTestId("improve-part-select").selectOption({ label: "cabinet body (paint light grey)" });
      await setPart(page, "improve-part-size-z", 0.02);
      await setPart(page, "improve-part-pos-z", -0.18);
      const lines = dialog.getByTestId("improve-part-changes");
      await expect(lines).toContainText("Made “cabinet body” 36 cm shallower");
      await expect(lines).toContainText("back");
      await expect(dialog.getByTestId("improve-problems")).toContainText("found before your own changes");
      await expect(dialog.getByTestId("improve-preview-new")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await page.waitForTimeout(600);
      await shot(page, dir, "t2-fixed-dialog", dialog);
      await shot(page, dir, "t2-fixed-compare", dialog.locator(".improve-compare"));
      for (const box of await dialog.getByTestId("improve-needs-confirm").getByRole("checkbox").all()) await box.check();
      await dialog.getByTestId("improve-apply").click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      const saved = await save(page);
      const revised = saved.json.catalog.find((a) => a.generation?.revision?.revises?.startsWith("asset-gen-cabinet"))!;
      const record = revised.generation!.revision!.changes;
      expect(record.some((l) => l.startsWith("By you: Made “cabinet body”"))).toBe(true);
      expect(record.some((l) => l.startsWith("Problem found in the proposal:") && l.includes("solid body"))).toBe(true);
      // The placed scene: glass edges on the scene's own ground.
      await page.keyboard.press("f");
      await page.waitForTimeout(1200);
      await shot(page, dir, "t2-placed", page.getByTestId("viewport"));
      await page.keyboard.press("Escape"); // no selection outline: only the glass edges remain
      await page.waitForTimeout(600);
      await shot(page, dir, "t2-placed-unselected", page.getByTestId("viewport"));
    });

    test("p3 open frame: kept parts left floating are said plainly, then one is removed by hand", async ({ page }) => {
      test.setTimeout(150_000);
      await openRegressions(page);
      const p3 = cases.find((c) => c.label === "gen08-p3")!;
      const dialog = await ask(page, p3.name, p3.instruction);
      const unasked = dialog.getByTestId("improve-problems-unasked");
      await expect(unasked).toContainText("Parts you did not ask about");
      await expect(unasked.locator('li[data-kind="floating_kept"]')).toContainText("“control panel” and “stack light” were kept");
      await expect(unasked.locator('li[data-kind="unrelated_change"]').first()).toContainText("the proposal changed it");
      await unasked.locator('li[data-kind="floating_kept"]').getByRole("button", { name: "Show it" }).click();
      await shot(page, dir, "p3-show-it", dialog.locator(".improve-compare"));
      await shot(page, dir, "p3-dialog", dialog);

      await dialog.getByTestId("improve-part-select").selectOption({ label: "stack light (signal green)" });
      await dialog.getByTestId("improve-part-remove").click();
      await expect(dialog.getByTestId("improve-part-changes")).toContainText("Removed “stack light”");
      // The light reached the top: the overall height follows, and waits for the user to confirm it.
      const confirm = dialog.getByTestId("improve-needs-confirm");
      await expect(confirm).toContainText("because of your part change", { timeout: 30_000 });
      await expect(dialog.getByTestId("improve-apply")).toBeDisabled();
      await confirm.getByRole("checkbox").check();
      // The floating light is gone; the panel's problem is still said, as found before the change.
      await expect(dialog.getByTestId("improve-apply-problems")).toContainText("Applying may keep");
      await shot(page, dir, "p3-fixed-dialog", dialog);
      await dialog.getByTestId("improve-apply").click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      const record = (await save(page)).json.catalog.find((a) => a.generation?.revision?.revises?.startsWith("asset-gen-left-machine"))!.generation!.revision!.changes;
      expect(record).toContain("By you: Removed “stack light”");
      expect(record.some((l) => l.startsWith("Problem found in the proposal:") && l.includes("“control panel” and “stack light”"))).toBe(true);
      await page.getByTestId("undo").click();
      await page.getByTestId("redo").click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await page.keyboard.press("f");
      await page.waitForTimeout(1200);
      await shot(page, dir, "p3-placed", page.getByTestId("viewport"));
    });
  });
}
