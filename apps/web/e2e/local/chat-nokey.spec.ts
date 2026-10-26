// UX-03 with no Voyager key, on the app as `pnpm start` serves it: the chat-first screen says AI
// is off and does not offer typing, and every suggestion, the attachment, the manual move card,
// the route check, the run, saving and the full editor still work. Nothing pretends to be live AI.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SAMPLE = JSON.parse(readFileSync(new URL("../../../../fixtures/scenes/sample-factory.json", import.meta.url), "utf8")) as { scene: { objects: { id: string; transform: { position_m: { x: number } } }[] } };
const HALL = new URL("../../../../fixtures/drawings/hall-mm.dxf", import.meta.url).pathname;

test("no key: the conversation works by hand, and says why typing is off", { tag: "@local" }, async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 0 objects");
  const chat = page.getByTestId("chat");
  await expect(chat.getByTestId("chat-ai")).toHaveAttribute("data-mode", "off");
  await expect(chat.getByTestId("chat-ai")).toHaveText("AI off · no key");
  await expect(chat.getByTestId("chat-input")).toBeDisabled();
  await expect(chat.getByTestId("chat-input")).toHaveAttribute("placeholder", "Typing needs AI (off: no key)");
  // The three starting points.
  await expect(chat.getByTestId("chat-suggestions").getByRole("button")).toHaveText(["Show me the example factory", "Upload a drawing and make a world", "What can I check in this layout?"]);
  await chat.getByTestId("chat-suggest-capabilities").click();
  await expect(chat.locator('[data-kind="capabilities"]')).toContainText("Here's what works right now");

  // The example, a manual move with its preview, Apply, the route and the run: no model involved.
  await chat.getByTestId("chat-suggest-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await expect(chat.locator('[data-kind="done"]').last()).toContainText("example factory");
  await page.getByTestId("view-toggle").click(); // pick Machine B in the full editor's list…
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Machine B/ }).click();
  await page.getByTestId("view-toggle").click(); // …and come back: the selection is kept
  await chat.getByTestId("chat-suggest-move").click();
  await chat.getByTestId("chat-move-distance").fill("1");
  await chat.getByTestId("chat-move-right").click();
  const proposal = chat.locator('[data-kind="proposal"]');
  await expect(proposal).toContainText("Move Machine B 1 m right?");
  await expect(proposal).not.toContainText("recorded answer");
  await proposal.getByTestId("chat-apply").click();
  await expect(chat.locator('[data-kind="applied"]')).toContainText("Moved Machine B 1 m right.");
  await chat.getByTestId("chat-suggest-route").click();
  await expect(chat.locator('[data-kind="route"]').last()).toContainText(/^Yes: a 1\.40 m wide path gets through/);
  await chat.getByTestId("chat-suggest-run_example").click();
  await expect(chat.locator('[data-kind="run"]').last()).toContainText(/Ran the shift. Whole-shift result: \d+ batches completed by 14:00/);
  await expect(page.getByTestId("run-bar")).toBeVisible();

  // Save: the moved machine is in the file (journey D, UX-04).
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8")) as { scene: { objects: { id: string; transform: { position_m: { x: number } } }[] } };
  const machine = (p: typeof saved) => p.scene.objects.find((o) => o.id === "obj-dxf-111")!.transform.position_m.x;
  expect(machine(saved) - machine(SAMPLE)).toBeCloseTo(1);

  // Attaching a DXF reads it on this computer and asks only for what the review needs.
  await chat.getByTestId("chat-file-input").setInputFiles(HALL);
  await expect(chat.getByTestId("chat-review")).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByTestId("chat-review")).not.toContainText("LWPOLYLINE");
});

test("no key: an imported object's look is chosen by hand from the catalog, previewed, applied, undone, redone and reopened", { tag: "@local" }, async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const chat = page.getByTestId("chat");
  await expect(chat.getByTestId("chat-ai")).toHaveText("AI off · no key");
  await chat.getByTestId("chat-suggest-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("view-toggle").click();
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Electrical cabinet/ }).click();
  await page.getByTestId("view-toggle").click();
  await page.getByTestId("selection-look").click();
  const look = chat.locator('[data-kind="appearance"]').last();
  const row = look.getByTestId("look-row-obj-dxf-10f");
  await row.getByTestId("look-other-obj-dxf-10f").click();
  await row.getByTestId("look-search-obj-dxf-10f").fill("cabinet");
  const option = row.getByTestId("look-option-obj-dxf-10f-asset-electrical-cabinet-800");
  await option.hover(); // the world draws it on the object, fitted to its recorded size
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
  await option.click();
  await look.getByTestId("look-apply").click();
  await expect(chat.locator('[data-kind="appearance-applied"]').last()).toContainText("Changed the look of 1 object.");
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^0\/0/);
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const saved = JSON.parse(text) as { scene: { objects: { id: string; asset_id: string | null; dimensions: unknown }[] } };
  const cabinet = saved.scene.objects.find((o) => o.id === "obj-dxf-10f")!;
  expect(cabinet.asset_id).toBe("asset-electrical-cabinet-800");
  expect(cabinet.dimensions).toEqual((SAMPLE.scene.objects.find((o) => o.id === "obj-dxf-10f") as unknown as { dimensions: unknown }).dimensions);
  await page.goto("/");
  await chat.getByTestId("chat-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(chat.locator('[data-kind="done"]').last()).toContainText(`Opened ${download.suggestedFilename()}: 12 objects.`);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
});

test("no key: a reference photo is kept with the object, and its look is built by hand beside it, applied, undone and reopened", { tag: "@local" }, async ({ page }) => {
  test.setTimeout(150_000);
  const RENDER = new URL("../../../../fixtures/photos/factory-walk.png", import.meta.url).pathname;
  await page.goto("/");
  const chat = page.getByTestId("chat");
  await chat.getByTestId("chat-suggest-example").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("view-toggle").click();
  await page.getByRole("button", { name: "Show the object list and details" }).click();
  await page.getByRole("navigation", { name: "Scene objects" }).getByRole("button", { name: /^Machine B/ }).click();
  await page.getByTestId("view-toggle").click();
  await chat.getByTestId("chat-file-input").setInputFiles(RENDER);
  await chat.locator('[data-kind="question"]').last().getByTestId("photo-for-obj-dxf-111").click();
  const dialog = page.getByTestId("photo-look");
  // No AI proposal is offered or imitated: this is manual work, and it says so.
  await expect(dialog.getByTestId("photo-look-manual-note")).toContainText("This is manual work");
  await expect(dialog.getByTestId("photo-look-suggest")).toHaveCount(0);
  await dialog.getByTestId("photo-look-manual").click();
  await expect(dialog.getByTestId("photo-look-summary")).toContainText("Manual work");
  await expect(dialog.getByTestId("photo-look-proposed")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(dialog.getByTestId("photo-look-apply")).toBeDisabled(); // nothing changed yet
  await dialog.getByTestId("photo-look-edit").locator("summary").first().click();
  await dialog.getByTestId("photo-look-colour-paint_light_grey").selectOption("safety_yellow");
  await expect(dialog.getByTestId("photo-look-apply")).toBeEnabled({ timeout: 30_000 });
  await dialog.getByTestId("photo-look-apply").click();
  await expect(chat.locator('[data-kind="photo-look-applied"]').last()).toBeVisible();
  const save = async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
    return { name: download.suggestedFilename(), text: readFileSync((await download.path())!, "utf8") };
  };
  const saved = await save();
  const project = JSON.parse(saved.text) as { catalog: { id: string; generation: { method: string; language_model: unknown } | null }[]; scene: { objects: { id: string; asset_id: string | null; dimensions: unknown }[] } };
  const machine = project.scene.objects.find((o) => o.id === "obj-dxf-111")!;
  const original = (SAMPLE.scene.objects as unknown as { id: string; dimensions: unknown }[]).find((o) => o.id === "obj-dxf-111")!;
  expect(machine.dimensions).toEqual(original.dimensions);
  const asset = project.catalog.find((a) => a.id === machine.asset_id)!;
  expect(asset.generation).toMatchObject({ method: "reference_photo", language_model: null });
  await page.getByTestId("undo").click();
  await page.getByTestId("redo").click();
  await page.goto("/");
  await chat.getByTestId("chat-file-input").setInputFiles({ name: saved.name, mimeType: "application/json", buffer: Buffer.from(saved.text) });
  await expect(chat.locator('[data-kind="done"]').last()).toContainText(`Opened ${saved.name}: 12 objects.`);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^1\/1 ready/, { timeout: 30_000 });
});
