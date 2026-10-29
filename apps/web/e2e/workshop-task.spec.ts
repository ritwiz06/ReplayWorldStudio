// "Try rearranging a workshop": the first screen's one way in, done through the interface as a
// first-time visitor would. Every sentence checked here is computed by the app on the layout as
// it is (the route check the shift uses, and the same shift run on both layouts); nothing is
// scripted into the app. No AI is used.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const CHAT = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: CHAT });

const ROOT = new URL("../../../", import.meta.url).pathname;
const EXAMPLE = JSON.parse(readFileSync(`${ROOT}fixtures/scenes/workshop.json`, "utf8")) as Saved;
interface Obj { id: string; name: string; transform: { position_m: { x: number; z: number } }; dimensions: unknown; asset_id: string | null }
interface Saved { id: string; scene: { objects: Obj[]; edit_log: { type: string }[] }; sources: { id: string; drawing: unknown }[]; process: unknown }
const BENCH = "obj-dxf-10a";

const task = (page: Page) => page.getByTestId("chat").locator('[data-kind^="task"]').last();
const bench = (p: Saved) => p.scene.objects.find((o) => o.id === BENCH)!;

async function save(page: Page): Promise<{ name: string; text: string; project: Saved }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), text, project: JSON.parse(text) as Saved };
}

test("workshop: move the bench beside the doorway, see the route blocked, correct it, compare the shift, save and reopen", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await page.goto("/");
  await page.getByTestId("empty-workshop").click();
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 10 objects");
  const card = task(page);
  await expect(card).toHaveAttribute("data-kind", "task-as_drawn");
  await expect(card).toContainText("Can the assembly bench go beside the doorway?");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-selected", BENCH);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", /^6\/6 ready/, { timeout: 30_000 });

  // The proposed spot: the doorway narrows below what a carried frame needs.
  await card.getByTestId("task-move").click();
  await expect(card).toHaveAttribute("data-kind", "task-blocked");
  await expect(card).toContainText("Blocked: Assembly bench → Packing table narrows to 0.57 m between Partition and Assembly bench; needs 0.70 m.");
  await card.getByTestId("task-compare").click();
  await expect(card).toHaveAttribute("data-kind", "task-result");
  await expect(card).toContainText("As drawn: 166 frames. With the bench here: 0 frames (-166).");
  await expect(card).toContainText("Assembly bench → Packing table is blocked, so no frame gets through");

  // Corrected by the person: two nudges toward the front wall.
  await card.getByTestId("task-nudge-front").click();
  await expect(card).toHaveAttribute("data-kind", "task-unknown");
  await expect(card).toContainText("Too close to tell");
  await card.getByTestId("task-nudge-front").click();
  await expect(card).toHaveAttribute("data-kind", "task-fits");
  await expect(card).toContainText("It fits: every route still clears, and the walk to the packing table is 8.5 m → 4.6 m.");
  await card.getByTestId("task-compare").click();
  await expect(card).toContainText("As drawn: 166 frames. With the bench here: 174 frames (+8).");
  await expect(card).toContainText("Assembly bench → Packing table 8.5 m → 4.6 m");
  await expect(page.getByTestId("run-bar")).toBeVisible();

  // The same object: only its placement changed, with its drawn size, evidence and links.
  const corrected = await save(page);
  const moved = bench(corrected.project);
  expect({ ...moved, transform: null }).toEqual({ ...bench(EXAMPLE), transform: null });
  expect(moved.transform.position_m).toMatchObject({ x: 0.05, z: 1.45 });
  expect(corrected.project.scene.objects.map((o) => o.id)).toEqual(EXAMPLE.scene.objects.map((o) => o.id));
  expect(corrected.project.sources).toEqual(EXAMPLE.sources);
  expect(corrected.project.process).toEqual(EXAMPLE.process);

  // Export review names both runs; then undo returns the drawing's placement.
  await card.getByTestId("task-export").click();
  await expect(page.getByTestId("export-run")).toContainText("runs/edited/events.json");
  await page.getByTestId("export-close").click();
  await card.getByTestId("task-undo").click();
  await card.getByTestId("task-undo").click();
  await card.getByTestId("task-undo").click();
  await expect(card).toHaveAttribute("data-kind", "task-as_drawn");
  await page.getByTestId("redo").click();
  await page.getByTestId("redo").click();
  await page.getByTestId("redo").click();
  // Back on the corrected spot: its comparison still applies to this exact layout.
  await expect(card).toHaveAttribute("data-kind", "task-result");
  await expect(card).toContainText("With the bench here: 174 frames (+8).");

  // Reopened: the same layout, and the same shift result from it.
  await page.goto("/");
  await page.getByTestId("chat-file-input").setInputFiles({ name: corrected.name, mimeType: "application/json", buffer: Buffer.from(corrected.text) });
  await expect(page.getByTestId("chat").locator('[data-kind="done"]').last()).toContainText(`Opened ${corrected.name}: 10 objects.`);
  await page.getByTestId("chat-suggest-run").click();
  await expect(page.getByTestId("chat").locator('[data-kind="run"]').last()).toContainText("Whole-shift result: 174 frames");
});

test("workshop: dragging the bench with its Move handle gives the same kind of reading", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("empty-workshop").click();
  const card = task(page);
  await expect(card).toHaveAttribute("data-kind", "task-as_drawn");
  // The task's view is set once the world is shown: wait for the camera to come to rest.
  let last = "";
  await expect
    .poll(async () => {
      const now = (await page.getByTestId("viewport").getAttribute("data-camera")) ?? "";
      const still = now !== "" && now === last;
      last = now;
      return still;
    }, { intervals: [500] })
    .toBe(true);
  let probe: { tool: string; objectId: string; points: Record<string, [number, number]> } | null = null;
  await expect
    .poll(async () => {
      probe = JSON.parse((await page.getByTestId("viewport").getAttribute("data-handles")) ?? "null");
      return probe ? `${probe.tool}:${probe.objectId}` : null;
    })
    .toBe(`move:${BENCH}`);
  // As the editing tests drag a handle: press, move through a midpoint, release.
  const from = probe!.points["move-x"]!;
  const to: [number, number] = [from[0] + 160, from[1] - 50];
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-dragging", "false");
  await expect(card).not.toHaveAttribute("data-kind", "task-as_drawn");
  await expect(card).toContainText(/It fits|Blocked|Too close to tell/);
  await expect(card.getByTestId("task-move")).toHaveText("Move it to the outlined spot");
});
