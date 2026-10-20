// UX-03 screenshots (local only): the same states at 1440 × 900 and 1280 × 800, written to
// docs/ux-03/<UX_SET>/. UX_SET=before was taken on the previous main screen; UX_SET=after uses
// the chat-first screen with recorded AI answers (DEMO_ASSIST=recorded), and UX_SET=nokey with
// no key at all. Repository-owned sample files only.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const SET = process.env.UX_SET ?? "after";
const OUT = `${ROOT}docs/ux-03/${SET}`;
const DXF = `${ROOT}fixtures/drawings/hall-mm.dxf`;

async function shot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${page.viewportSize()!.width}-${name}.jpg`, type: "jpeg", quality: 82 });
}
async function ask(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
}
const card = (page: Page, kind: string) => page.getByTestId("chat").locator(`[data-kind="${kind}"]`).last();

for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
  test(`${SET} at ${width}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.evaluate((set) => {
      localStorage.clear();
      if (set === "before") localStorage.setItem("rws.view", "editor");
    }, SET);
    await page.goto("/");
    await expect(page.getByTestId("scene-status")).toHaveText(/Scene loaded/);
    await shot(page, "1-first-visit");
    if (SET === "before") {
      await page.evaluate(() => localStorage.setItem("rws.start.seen", "1"));
      await page.goto("/");
      await page.getByTestId("journey-run").click();
      await expect(page.getByTestId("run-panel")).toHaveAttribute("data-outcome", "ready", { timeout: 30_000 });
      await page.waitForTimeout(2500);
      await shot(page, "2-sample-running");
      await page.getByTestId("example-start").click();
      for (let i = 0; i < 4; i++) await page.getByTestId("example-next").click();
      await shot(page, "3-comparison");
      await page.goto("/");
      await page.getByTestId("journey-upload").click();
      await page.getByTestId("drawing-file-input").setInputFiles(DXF);
      await expect(page.getByTestId("drawing-summary")).toBeVisible();
      await shot(page, "4-import");
      await page.getByTestId("drawing-open").click();
      await expect(page.getByTestId("drawing-review")).toBeVisible();
      await shot(page, "5-review");
      return;
    }
    if (SET === "nokey") {
      await page.getByTestId("chat-suggest-example").click();
      await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
      await shot(page, "2-example-nokey");
      return;
    }
    await ask(page, "Show me the example factory");
    await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 12 objects");
    await shot(page, "2-example");
    await ask(page, "Move the rack 1 m back");
    await expect(card(page, "question")).toBeVisible();
    await card(page, "question").getByTestId("chat-choice-obj-dxf-106").hover();
    await shot(page, "3-ambiguity");
    await ask(page, "Move Machine B 3.5 m forward");
    await expect(card(page, "proposal").getByTestId("chat-apply")).toBeVisible();
    await shot(page, "4-proposal");
    await card(page, "proposal").getByTestId("chat-apply").click();
    await ask(page, "What happens during a shift?");
    await expect(card(page, "run")).toBeVisible();
    await page.getByTestId("run-speed").selectOption("120");
    await page.waitForTimeout(1500);
    await shot(page, "5-running-blocked");
    await ask(page, "Why did output change?");
    await expect(card(page, "why")).toBeVisible();
    await shot(page, "6-why");
    await page.getByTestId("chat-suggest-undo").click();
    await page.getByTestId("chat-suggest-run_again").click();
    await expect(card(page, "run-again")).toBeVisible();
    await page.waitForTimeout(2500);
    await shot(page, "7-running");
    await ask(page, "Paint the mixer red");
    await expect(card(page, "cannot")).toBeVisible();
    await shot(page, "8-cannot");
    // The conversation as text, with each card's details opened (the recorded run's evidence).
    if (width === 1440) {
      await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("[data-testid=chat] details").forEach((d) => (d.open = true)));
      const turns = await page.getByTestId("chat-list").evaluate((list) =>
        [...list.children].map((el) => {
          const who = (el as HTMLElement).dataset.testid === "chat-user" ? "You" : `Assistant [${(el as HTMLElement).dataset.kind ?? ""}]`;
          const lines = (el as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean);
          return `${who}: ${lines.join("\n    ")}`;
        }),
      );
      writeFileSync(`${OUT}/conversation.txt`, `${turns.join("\n\n")}\n`);
    }
    await page.getByTestId("view-toggle").click();
    await shot(page, "9-full-editor");
    await page.getByTestId("view-toggle").click();
    await page.getByTestId("chat-file-input").setInputFiles(DXF);
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByTestId("chat-review")).toBeVisible({ timeout: 30_000 });
    await shot(page, "10-import-review");
  });
}
