// REL-01 in the browser: "Show the example" takes the synthetic sample through a real before and
// after (run, move Machine B into the aisle, run the same shift again, compare, undo, run again)
// using the app's own commands and engine; "Export this run" writes one ZIP without changing the
// project; opening that ZIP in a fresh page checks it and reruns both layouts with the same
// events, fingerprints, counts and explanation; a damaged bundle is refused with the reason.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const SIMPLE = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }, { name: "rws.view", value: "editor" }] }] };
test.use({ storageState: SIMPLE });

async function step(page: Page, index: number) {
  await expect(page.getByTestId("example-next")).toBeEnabled();
  await page.getByTestId("example-next").click();
  await expect(page.getByTestId("show-example")).toHaveAttribute("data-step", String(index + 1));
}

test("show the example, export the run, and reproduce it from the bundle", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("journey-run").click();
  const panel = page.getByTestId("run-panel");
  await expect(panel).toHaveAttribute("data-outcome", "ready", { timeout: 30_000 });

  // The guided example: each step is the app's own command or a run made at that moment.
  await expect(page.getByTestId("show-example")).toContainText("Synthetic example");
  await page.getByTestId("example-start").click();
  await step(page, 0);
  await expect(page.getByTestId("run-completed")).toHaveText("102");
  const original = await panel.getAttribute("data-fingerprint");
  await step(page, 1);
  await expect(page.getByTestId("run-stale-notice")).toBeVisible();
  await step(page, 2);
  await expect(panel).toHaveAttribute("data-outcome", "blocked");
  await expect(page.getByTestId("run-completed")).toHaveText("0");
  const edited = await panel.getAttribute("data-fingerprint");
  await step(page, 3);
  const explanation = page.getByTestId("run-explanation");
  await expect(explanation).toContainText("Rack A (material) ↔ Mixer is blocked in the edited layout");
  await expect(explanation).toContainText("narrows to 0.50 m between Rack A and Machine B");
  await expect(explanation).toContainText("Output goes from 102 to 0 completed batches");

  // Export this run: the review lists the sample's drawing as part of the repository; the ZIP
  // is saved and the project is not changed.
  const undoLabel = await page.getByTestId("undo").getAttribute("title");
  await page.getByTestId("run-export").click();
  const dialog = page.getByTestId("export-run");
  await expect(dialog.getByTestId("export-asset-drawing")).toHaveAttribute("data-status", "repo_owned");
  await expect(dialog.getByTestId("export-replay")).toHaveAttribute("data-replay", "full");
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("export-save").click()]);
  await expect(dialog.getByTestId("export-done")).toContainText("The project was not changed.");
  expect(download.suggestedFilename()).toBe(`sample-factory-hall-synthetic-run-${edited}.zip`);
  const zip = readFileSync((await download.path())!);
  await dialog.getByTestId("export-close").click();
  await expect(panel).toHaveAttribute("data-fingerprint", edited!);
  expect(await page.getByTestId("undo").getAttribute("title")).toBe(undoLabel);

  // Undo the move and run again: the original result, event for event.
  await step(page, 4);
  await expect(page.getByTestId("example-result")).toContainText(`the same events as the first run (fingerprint ${original})`);
  await expect(page.getByTestId("run-completed")).toHaveText("102");

  // A fresh page opens the bundle, checks it and reruns both layouts.
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("scene-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/zip", buffer: zip });
  const check = page.getByTestId("bundle-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  await expect(check).toContainText("files checked against its manifest");
  await check.getByTestId("bundle-rerun").click();
  await expect(check).toHaveAttribute("data-same", "true");
  await expect(page.getByTestId("bundle-verdict")).toContainText("Reproduced");
  await expect(panel).toHaveAttribute("data-fingerprint", edited!);
  await expect(page.getByTestId("run-explanation")).toContainText("Rack A (material) ↔ Mixer is blocked");
  // Playback choices never change the events.
  await page.getByTestId("run-pause").click();
  await page.getByTestId("run-speed").selectOption("600");
  for (const mode of ["mode-top", "mode-walk", "mode-orbit"]) await page.getByTestId(mode).click();
  await expect(panel).toHaveAttribute("data-fingerprint", edited!);
});

test("a damaged bundle is refused with the reason and the open project is kept", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await page.getByTestId("scene-file-input").setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("PK\u0003\u0004 not really a zip") });
  await expect(page.getByTestId("file-rejected")).toContainText("This is not a ZIP file, or the ZIP is damaged.");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
});
