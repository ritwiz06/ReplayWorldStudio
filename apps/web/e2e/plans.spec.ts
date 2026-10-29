// UX-04 in the browser: one message, a short plan of up to four steps. The plan is shown with its
// consequences and the proposed change in the world, applied once on Apply, step by step, and
// undone as one request. Interpretations are recorded live answers (labelled "recorded answer");
// every step is performed by the app's own commands, checks and run engine.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const CHAT = { cookies: [], origins: [{ origin: "http://127.0.0.1:5180", localStorage: [{ name: "rws.start.seen", value: "1" }] }] };
test.use({ storageState: CHAT });

async function ask(page: Page, text: string) {
  await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat").locator('[data-kind="progress"]')).toHaveCount(0, { timeout: 120_000 });
}
const lastCard = (page: Page, kind: string) => page.getByTestId("chat").locator(`[data-kind="${kind}"]`).last();
const rows = (card: ReturnType<typeof lastCard>) => card.getByTestId("plan-rows").locator(".plan-label");
const objectCount = (page: Page) => page.getByTestId("scene-status");

async function openExample(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("empty-start")).toBeVisible();
  await page.getByTestId("empty-example").click();
  await expect(objectCount(page)).toHaveText("Scene loaded · 12 objects");
  await expect(page.getByTestId("empty-start")).toHaveCount(0);
}

test("plan: move, check its routes and run the shift in one request; why; undo that and run again", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  await openExample(page);
  await ask(page, "Move Machine B 1 metre right, check its routes, and run the shift again.");

  // Review: the whole plan, its known consequences, nothing changed yet.
  const plan = lastCard(page, "proposal");
  await expect(plan).toContainText("Plan: 3 steps");
  await expect(plan).toContainText("recorded answer");
  await expect(rows(plan)).toHaveText(["Move Machine B 1 m right", "Check Machine B's routes", "Run the same shift again"]);
  await expect(plan).toContainText("Walk Mixer ↔ Machine B: 4.9 m → 5.9 m.");
  await expect(page.getByTestId("viewport")).not.toHaveAttribute("data-ghosts", "0");
  await expect(page.getByTestId("undo")).toBeDisabled();

  // Apply once: each step done in order, the button gone so it cannot run twice.
  await plan.getByTestId("chat-apply").click();
  const done = lastCard(page, "plan-done");
  await expect(done).toContainText("Done: 3 of 3 steps.", { timeout: 60_000 });
  await expect(done.getByTestId("chat-apply")).toHaveCount(0);
  await expect(rows(done)).toHaveText(["Move Machine B 1 m right", "Check Machine B's routes", "Run the same shift again"]);
  await expect(lastCard(page, "route")).toContainText("Yes: its 2 routes still fit.");
  await expect(lastCard(page, "run")).toContainText("Ran the shift. Whole-shift result: 102 batches completed by 14:00");
  // The run bar separates the playback clock from the whole shift.
  await expect(page.getByTestId("run-bar-whole")).toContainText("102");
  await expect(page.getByTestId("run-bar-completed")).toBeVisible();
  await expect(page.getByTestId("undo")).toHaveAttribute("title", /Move Machine B/);

  // Why: from the comparison of the two runs, not from the model.
  await ask(page, "Why did output change?");
  await expect(page.getByTestId("chat").locator('[data-kind="why"]').last()).toContainText("102");

  // "Undo that move and run again": "that" is Machine B, from the conversation.
  await ask(page, "Undo that move and run again.");
  const undoPlan = lastCard(page, "proposal");
  await expect(rows(undoPlan)).toHaveText(["Undo: Move Machine B", "Run the shift"]);
  await undoPlan.getByTestId("chat-apply").click();
  await expect(lastCard(page, "plan-done")).toContainText("Done: 2 of 2 steps.", { timeout: 60_000 });
  await expect(lastCard(page, "plan-done")).toContainText("Redo (top bar) brings back what was undone.");
  await expect(page.getByTestId("redo")).toBeEnabled();
  await expect(lastCard(page, "run")).toContainText("Whole-shift result: 102 batches completed by 14:00");
});

test("plan: select the mixer, turn it 90° clockwise and check the layout; undone as one request", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await openExample(page);
  const before = await page.getByTestId("viewport").getAttribute("data-revision");
  await ask(page, "Select the mixer, turn it 90 degrees clockwise, and check the layout.");
  const plan = lastCard(page, "proposal");
  await expect(rows(plan)).toHaveText(["Show Mixer", "Turn Mixer 90° clockwise", "Check the layout (overlaps, keep-clear zones, routes)"]);
  await plan.getByText("Details").click();
  await expect(plan).toContainText("Directions are as seen from above (the Top view), whatever the camera shows.");
  await plan.getByTestId("chat-apply").click();
  const done = lastCard(page, "plan-done");
  await expect(done).toContainText("Done: 3 of 3 steps.", { timeout: 60_000 });
  await expect(page.getByTestId("selection-chip")).toContainText("Mixer");
  await done.getByTestId("chat-undo-request").click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-revision", String(Number(before) + 2));
  await expect(page.getByTestId("undo")).toBeDisabled();
});

test("plan: add a dimensioned packing table beside Machine B from the catalog; undo, redo, save and reopen", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await openExample(page);
  await ask(page, "Add a packing table, 1.5 metres wide and 0.8 metres deep, beside Machine B.");
  const plan = lastCard(page, "proposal");
  // A catalog suggestion to accept, never a silent match; then which side.
  const asset = plan.getByTestId("plan-need-0");
  await expect(asset).toHaveAttribute("data-kind", "asset");
  await expect(asset).toContainText("The closest catalog item is “Generic packing station (provisional)”, a plain stand-in. Use it at the size you gave?");
  await expect(plan.getByTestId("chat-apply")).toHaveCount(0);
  await asset.getByTestId("chat-asset-use").click();
  const side = plan.getByTestId("plan-need-0");
  await expect(side).toContainText("Which side of Machine B? (as seen from above)");
  await side.getByTestId("chat-side-left").click();
  await expect(plan).toContainText("Add a packing table, 1.5 m wide, 0.8 m deep to the left of Machine B?");
  await expect(page.getByTestId("viewport")).not.toHaveAttribute("data-ghosts", "0");
  await plan.getByTestId("chat-apply").click();
  await expect(lastCard(page, "applied")).toContainText("Added a packing table, 1.5 m wide, 0.8 m deep to the left of Machine B.");
  await expect(objectCount(page)).toHaveText("Scene loaded · 13 objects");

  // One undo step, and redo brings it back.
  await page.getByTestId("undo").click();
  await expect(objectCount(page)).toHaveText("Scene loaded · 12 objects");
  await page.getByTestId("redo").click();
  await expect(objectCount(page)).toHaveText("Scene loaded · 13 objects");

  // The stated sizes are kept with their source; the height is the catalog's assumption.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save").click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const saved = JSON.parse(text) as { scene: { objects: { id: string; name: string; asset_id: string; dimensions: Record<string, { value_m: number; origin: string; source_ref?: string }> }[] } };
  const table = saved.scene.objects.find((o) => o.id.startsWith("obj-chat-packing-table"))!;
  expect(table).toMatchObject({ name: "Packing table", asset_id: "asset-generic-packing-station" });
  expect(table.dimensions.width).toMatchObject({ value_m: 1.5, origin: "user_supplied", source_ref: "Stated in the conversation" });
  expect(table.dimensions.depth).toMatchObject({ value_m: 0.8, origin: "user_supplied" });
  expect(table.dimensions.height!.origin).not.toBe("user_supplied");
  await page.getByTestId("chat-file-input").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(lastCard(page, "done")).toContainText(`Opened ${download.suggestedFilename()}: 13 objects.`);
});

test("start: the empty world offers the workshop task, the plan drop, the example and the formats; a DWG asks for a DXF", async ({ page }) => {
  await page.goto("/");
  const start = page.getByTestId("empty-start");
  await expect(start.getByTestId("empty-workshop")).toContainText("Try rearranging a workshop");
  await expect(start.getByRole("img", { name: /example workshop/ })).toBeVisible();
  await expect(start.getByRole("heading", { name: "Or start from your own plan" })).toBeVisible();
  await expect(start.getByTestId("empty-upload")).toBeVisible();
  await expect(start.getByTestId("empty-example")).toBeVisible();
  await expect(start.getByTestId("empty-formats")).toContainText("A DWG must be saved as DXF first.");
  await page.getByTestId("chat-file-input").setInputFiles({ name: "plan.dwg", mimeType: "application/acad", buffer: Buffer.from("AC1032") });
  await expect(start.getByTestId("empty-refused")).toContainText("DXF");
  await expect(objectCount(page)).toHaveText("Scene loaded · 0 objects");
  // The keyboard reaches both ways in.
  await start.getByTestId("empty-example").focus();
  await page.keyboard.press("Enter");
  await expect(objectCount(page)).toHaveText("Scene loaded · 12 objects");
});

test("appearance: the uncertainty view and see-through change only the display, never the run", async ({ page }) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  await openExample(page);
  await expect(page.getByTestId("appearance-chip")).toContainText("Draft appearance · some heights assumed");
  await page.getByTestId("chat-suggest-run_example").click();
  await expect(page.getByTestId("run-bar")).toBeVisible();
  const fingerprint = await page.getByTestId("run-bar").getAttribute("data-fingerprint");
  const revision = await page.getByTestId("viewport").getAttribute("data-revision");
  await page.getByTestId("appearance-toggle").click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-appearance", "uncertainty");
  await page.getByTestId("run-see-through").click();
  await expect(page.getByTestId("run-see-through")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("run-overview").click();
  expect(await page.getByTestId("run-bar").getAttribute("data-fingerprint")).toBe(fingerprint);
  expect(await page.getByTestId("viewport").getAttribute("data-revision")).toBe(revision);
  await expect(page.getByTestId("undo")).toBeDisabled();
});

test("timed: one task as three messages, as one plan, and by forms alone (scripted, not a user study)", async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  const results: Record<string, { clicks: number; typed: number; appMs: number; requests: number }> = {};
  const measure = async (name: string, steps: (t: { click: (testId: string) => Promise<void>; say: (text: string) => Promise<void> }) => Promise<void>) => {
    await openExample(page);
    const tally = { clicks: 0, typed: 0, requests: 0 };
    const started = Date.now();
    await steps({
      click: async (testId) => {
        tally.clicks++;
        await page.getByTestId("chat").getByTestId(testId).last().click();
      },
      say: async (text) => {
        tally.typed += text.length;
        tally.clicks++;
        tally.requests++;
        await ask(page, text);
      },
    });
    results[name] = { ...tally, appMs: Date.now() - started };
  };
  // The task: move Machine B 1 m right, check the routes, run the shift.
  await measure("three messages (one action each, as in UX-03)", async ({ click, say }) => {
    await say("Move Machine B 1 metre right");
    await click("chat-apply");
    await expect(lastCard(page, "applied")).toContainText("Moved Machine B 1 m right.");
    await say("Does the route still fit?");
    await expect(lastCard(page, "route")).toContainText(/^Yes/);
    await say("What happens during a shift?");
    await expect(lastCard(page, "run")).toContainText("Whole-shift result: 102 batches");
  });
  await measure("one plan (UX-04)", async ({ click, say }) => {
    await say("Move Machine B 1 metre right, check its routes, and run the shift again.");
    await click("chat-apply");
    await expect(lastCard(page, "plan-done")).toContainText("Done: 3 of 3 steps.", { timeout: 60_000 });
    await expect(lastCard(page, "run")).toContainText("Whole-shift result: 102 batches");
  });
  await measure("forms and suggestions only (no AI)", async ({ click }) => {
    await click("chat-suggest-move_any");
    await page.getByTestId("chat-move-object").selectOption("obj-dxf-111");
    await page.getByTestId("chat-move-distance").fill("1");
    await click("chat-move-right");
    await click("chat-apply");
    await expect(lastCard(page, "applied")).toContainText("Moved Machine B 1 m right.");
    await click("chat-suggest-route");
    await expect(lastCard(page, "route")).toContainText(/^Yes/);
    await click("chat-suggest-run_example");
    await expect(lastCard(page, "run")).toContainText("Whole-shift result: 102 batches");
  });
  // The form path also picks the machine (1 choice) and types "1" (1 character).
  results["forms and suggestions only (no AI)"]!.clicks += 1;
  results["forms and suggestions only (no AI)"]!.typed += 1;
  test.info().annotations.push({ type: "timed (recorded answers)", description: JSON.stringify(results) });
  console.log("timed", JSON.stringify(results, null, 2));
});
