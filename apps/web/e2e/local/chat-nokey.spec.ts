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
