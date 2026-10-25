// UX-05 in the browser: imported equipment drawn with reviewed catalog or generated models,
// without rebuilding the world, and a chat that says how long it is waiting and stops at its
// deadline. Interpretations are recorded live answers or labelled synthetic test fixtures.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const CHAT = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: CHAT });

const HALL = new URL("../../../fixtures/drawings/hall-mm.dxf", import.meta.url).pathname;
const SAMPLE = JSON.parse(readFileSync(new URL("../../../fixtures/scenes/sample-factory.json", import.meta.url), "utf8")) as Project;
interface Obj { id: string; name: string; asset_id: string | null; transform: unknown; dimensions: unknown; parameters: unknown }
interface Project { catalog: { id: string }[]; scene: { objects: Obj[] }; process: unknown; sources: { id: string }[] }

const card = (page: Page, kind: string) => page.getByTestId("chat").locator(`[data-kind="${kind}"]`).last();
async function ask(page: Page, text: string) {
  await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
}
async function openExample(page: Page) {
  await page.goto("/");
  await page.getByTestId("empty-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
}
async function saved(page: Page): Promise<{ name: string; text: string; project: Project }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, project: JSON.parse(text) as Project };
}
const byName = (p: Project, name: string) => p.scene.objects.find((o) => o.name === name)!;
const without = (o: Obj) => ({ ...o, asset_id: null });

test("appearance: suggested models applied as one reviewed batch keep every recorded value; the shift, a move and why work on the same world", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await openExample(page);
  await page.getByTestId("chat-suggest-appearance").click();
  const look = card(page, "appearance");
  await expect(look).toContainText("Equipment appearance: 2 suggested, 1 to choose or keep");
  await expect(look).toContainText("identifies no manufacturer or machine");
  const cabinet = look.getByTestId("look-row-obj-dxf-10f");
  await expect(cabinet).toHaveAttribute("data-status", "suggested");
  await expect(cabinet).toContainText("Electrical cabinet, 800 mm");
  await expect(cabinet).toContainText("generic model");
  await expect(cabinet).toContainText("Both are a cabinet");
  await expect(cabinet).toContainText("Squeezed to 55 % of its depth");
  await expect(cabinet.locator("img")).toBeVisible();
  await expect(look).not.toContainText("%  confidence");
  // A name that says nothing about the machine is a question; the footprint alone decides nothing.
  const machine = look.getByTestId("look-row-obj-dxf-111");
  await expect(machine).toHaveAttribute("data-status", "ask");
  await expect(machine).toContainText("does not say what kind of equipment it is");
  await expect(look.getByTestId("look-apply")).toHaveCount(0); // nothing is chosen by default

  await cabinet.getByTestId("look-use-obj-dxf-10f").click();
  await look.getByTestId("look-row-obj-dxf-10c").getByTestId("look-use-obj-dxf-10c").click();
  await machine.getByTestId("look-keep-obj-dxf-111").click();
  await expect(look).toContainText("Apply changes: Control panel, Electrical cabinet.");
  const before = await saved(page);
  await look.getByTestId("look-apply").click();
  const done = card(page, "appearance-applied");
  await expect(done).toContainText("Changed the look of 2 objects.");
  await expect(done.getByTestId("look-apply")).toHaveCount(0); // applied once
  await expect(page.getByTestId("undo")).toHaveAttribute("title", /Change the look of 2 objects/);

  // Only which model draws them changed: ids, names, placement, dimensions, evidence, links.
  const after = await saved(page);
  for (const name of ["Electrical cabinet", "Control panel"]) {
    expect(byName(after.project, name).asset_id).toBe("asset-electrical-cabinet-800");
    expect(without(byName(after.project, name))).toEqual(without(byName(SAMPLE, name)));
  }
  expect(byName(after.project, "Machine B")).toEqual(byName(SAMPLE, "Machine B"));
  expect(after.project.process).toEqual(before.project.process);
  expect(after.project.sources).toEqual(before.project.sources);
  expect(after.project.catalog.map((a) => a.id)).toEqual(["asset-electrical-cabinet-800"]);

  // The same shift, a move by request and why, on the same world.
  await page.getByTestId("chat-suggest-run_example").click();
  await expect(card(page, "run")).toContainText("Whole-shift result: 102 batches completed by 14:00");
  await ask(page, "Move Machine B 1 metre right, check its routes, and run the shift again.");
  const plan = card(page, "proposal");
  await plan.getByTestId("chat-apply").click();
  await expect(card(page, "plan-done")).toContainText("Done: 3 of 3 steps.", { timeout: 60_000 });
  await ask(page, "Why did output change?");
  await expect(page.getByTestId("chat").locator('[data-kind="why"]').last()).toContainText("102");
});

test("appearance: batch undo and redo, a stale review changes nothing, and a reopened file keeps the models", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await openExample(page);
  await page.getByTestId("chat-suggest-appearance").click();
  const look = card(page, "appearance");
  await look.getByTestId("look-use-obj-dxf-10f").click();
  await look.getByTestId("look-use-obj-dxf-10c").click();
  await look.getByTestId("look-apply").click();
  await card(page, "appearance-applied").getByTestId("look-undo").click();
  await expect(card(page, "appearance-undone")).toContainText("Undone");
  let file = await saved(page);
  expect(byName(file.project, "Electrical cabinet").asset_id).toBeNull();
  expect(file.project.catalog).toEqual([]);
  await page.getByTestId("redo").click();
  file = await saved(page);
  expect(byName(file.project, "Control panel").asset_id).toBe("asset-electrical-cabinet-800");

  // Suggestions made before the world changed are not applied.
  await page.getByTestId("chat-suggest-appearance").click();
  const stale = card(page, "appearance");
  await expect(stale.getByTestId("look-row-obj-dxf-111")).toBeVisible();
  await stale.getByTestId("look-other-obj-dxf-111").click();
  await stale.getByTestId("look-option-obj-dxf-111-asset-guarded-machine-cell").click();
  await page.getByTestId("undo").click(); // the world changes under the open card
  await stale.getByTestId("look-apply").click();
  await expect(card(page, "appearance-stale")).toContainText("nothing was changed");

  // Reopened, the models are still there.
  await page.getByTestId("redo").click();
  file = await saved(page);
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: Buffer.from(file.text) });
  await expect(card(page, "done")).toContainText(`Opened ${file.name}: 12 objects.`);
  const reopened = await saved(page);
  expect(byName(reopened.project, "Electrical cabinet").asset_id).toBe("asset-electrical-cabinet-800");
});

test("appearance: with no catalog model, the generator makes one for the same object; a failure or a cancel leaves it as it was", async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles(HALL);
  const review = page.getByTestId("chat-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 8 && (await review.count()); i++) {
    const next = review.locator('[data-testid^="chat-"][data-testid$="-accept"], [data-testid="chat-symbols-none"]').first();
    if (!(await next.count())) break;
    await next.click();
  }
  await expect(page.getByTestId("chat-review")).toHaveCount(0);
  const count = await page.getByTestId("scene-status").textContent();
  await page.getByTestId("chat-suggest-appearance").click();
  const look = card(page, "appearance");
  await look.getByTestId("look-rest").locator("summary").click();
  const bench = look.locator('[data-testid^="look-row-"]', { hasText: "Workbench" });
  await expect(bench).toHaveAttribute("data-status", "none");
  const benchId = ((await bench.getAttribute("data-testid")) ?? "").replace("look-row-", "");

  // Cancel: the dialog closes and nothing changes.
  await bench.getByTestId(`look-describe-${benchId}`).click();
  const dialog = page.getByTestId("create-object");
  await expect(dialog.getByRole("textbox").first()).toHaveValue(/^workbench \d\.\d\d m wide and \d\.\d\d m deep$/);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(look.getByTestId(`look-note-${benchId}`)).toContainText("Closed without a new model");

  // A failure (no recorded answer for these words) changes nothing either.
  await bench.getByTestId(`look-describe-${benchId}`).click();
  await dialog.getByRole("textbox").first().fill("a workbench made of something unusual");
  await dialog.getByRole("button", { name: /Draft|Propose|Describe/ }).first().click();
  await expect(dialog).toContainText(/no recorded answer/i, { timeout: 30_000 });
  await dialog.getByRole("button", { name: "Close" }).click();
  let file = await saved(page);
  expect(file.project.scene.objects.find((o) => o.id === benchId)!.asset_id).toBeNull();

  // The recorded description: the reviewed model becomes the same object's look.
  const object = file.project.scene.objects.find((o) => o.id === benchId)!;
  await bench.getByTestId(`look-describe-${benchId}`).click();
  await dialog.getByRole("textbox").first().fill("a workbench 1.8 m wide with a monitor and a drawer unit");
  await dialog.getByRole("button", { name: /Draft|Propose|Describe/ }).first().click();
  const use = dialog.getByRole("button", { name: "Use for Workbench" });
  await expect(use).toBeVisible({ timeout: 30_000 });
  for (const confirm of await dialog.getByRole("button", { name: /^Confirm/ }).all()) await confirm.click();
  await use.click();
  await expect(look.getByTestId(`look-note-${benchId}`)).toContainText("Now drawn with");
  await expect(page.getByTestId("scene-status")).toHaveText(count!); // no object added
  file = await saved(page);
  const now = file.project.scene.objects.find((o) => o.id === benchId)!;
  expect(now.asset_id).toMatch(/^asset-gen-/);
  expect(without(now)).toEqual(without(object)); // the same object, same size and evidence
  await page.getByTestId("undo").click();
  file = await saved(page);
  expect(file.project.scene.objects.find((o) => o.id === benchId)!.asset_id).toBeNull();
});

test("chat: the wait shows its elapsed time and stops at the deadline with nothing changed; a part not understood blocks Apply", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await openExample(page);
  await ask(page, "Run the shift slowly for the progress test");
  await expect(card(page, "progress")).toContainText(/Reading your request… [1-5] s \(stops at 6 s\)/);
  await expect(card(page, "run")).toContainText("Whole-shift result: 102 batches", { timeout: 20_000 });

  await ask(page, "Run the shift, but the provider is too slow");
  await expect(card(page, "progress")).toContainText("stops at 6 s");
  const timeout = card(page, "timeout");
  await expect(timeout).toContainText("No answer within 6 s, so nothing was changed.", { timeout: 20_000 });
  await expect(timeout).toContainText("Your request: “Run the shift, but the provider is too slow”");
  await expect(timeout.getByTestId("chat-retry")).toBeVisible();
  await timeout.getByTestId("chat-manual-move").click();
  await expect(page.getByTestId("chat-move-object")).toBeVisible(); // the manual control, at once
  await expect(page.getByTestId("chat").locator('[data-kind="progress"]')).toHaveCount(0); // no hidden second request

  await ask(page, "Move Machine B 1 m right and sort out the corner.");
  const plan = card(page, "proposal");
  await expect(plan.getByTestId("plan-rows").locator(".plan-label")).toHaveText(["Move Machine B 1 m right", "Not understood yet"]);
  await expect(plan).toContainText("What do you mean by “sort out the corner”?");
  await expect(plan).toContainText("Nothing is applied until the part not understood is answered.");
  await expect(plan.getByTestId("chat-apply")).toHaveCount(0);
  await expect(page.getByTestId("undo")).toBeDisabled();
});

test("chat: each amount stays with its own object", async ({ page }) => {
  await openExample(page);
  await ask(page, "Move Rack A 1 m right and Machine B 2 m left.");
  const plan = card(page, "proposal");
  await expect(plan.getByTestId("plan-rows").locator(".plan-label")).toHaveText(["Move Rack A (material) 1 m right", "Move Machine B 2 m left"]);
  await plan.getByText("Details").click();
  await expect(plan).toContainText(/Interpreted in \d+\.\d s; a recorded answer, no provider wait\./);
  await expect(plan).toContainText(/Proposal prepared in the browser in \d+ ms\./);
});
