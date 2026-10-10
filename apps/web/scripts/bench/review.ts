// Visual review screenshots in headed, hardware-accelerated Chrome (WRL-04).
//
//   pnpm review -- --stage before            bench-results/review-before/shots/<viewport>-<view>.jpg
//   pnpm review -- --stage after --viewports 1440x900@2,1280x800@2
//
// The full sets stay out of Git; docs/visual-review/ keeps downscaled before/after pairs of the
// views that show each fixed issue.
//
// Views: the default demo in orbit, top and walk; move and resize handles in the overview
// (selection without framing); an edited layout (demo + 15 instances, one conveyor stretched)
// in orbit, top and walk; and a large layout (demo + 105 instances) in orbit and top.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect, type Page } from "@playwright/test";
import { BASE, buildScenes, buildWeb, CHROME_ARGS, pause, REPO, startServers, stopServers } from "./servers.ts";

const { values: options } = parseArgs({
  options: {
    stage: { type: "string", default: "before" },
    viewports: { type: "string", default: "1440x900@2,1280x800@2" },
    only: { type: "string" },
  },
});

const work = join(REPO, "bench-results", `review-${options.stage}`);
const shots = join(work, "shots");

async function ready(page: Page, objects: number) {
  await expect(page.getByTestId("scene-status")).toHaveText(`Scene loaded · ${objects} objects`, { timeout: 30_000 });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed", { timeout: 30_000 });
}

async function main() {
  mkdirSync(shots, { recursive: true });
  buildScenes(join(work, "scenes"), [15, 105]);
  buildWeb(join(work, "web"));
  await startServers(join(work, "web"), work);
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: CHROME_ARGS });
  for (const spec of options.viewports.split(",")) {
    const [size, dpr] = spec.split("@");
    const [width, height] = size!.split("x").map(Number) as [number, number];
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(dpr ?? 1) });
    // Skip the guided start panel (GEN-01); the review screenshots show the editor.
    await context.addInitScript(() => window.localStorage.setItem("rws.start.seen", "1"));
    const page = await context.newPage();
    await page.bringToFront();
    const shot = async (name: string, settle = 1400) => {
      if (options.only && !name.includes(options.only)) return;
      await pause(settle);
      const path = join(shots, `${width}x${height}-${name}.jpg`);
      await page.screenshot({ path, type: "jpeg", quality: 80 });
      console.log(path);
    };
    const key = (k: string) => page.keyboard.press(k);
    const deselect = async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await key("Escape");
    };

    await page.goto(BASE);
    await ready(page, 15);
    await key("h");
    await shot("demo-orbit");
    await key("2");
    await shot("demo-top");
    await key("3");
    await shot("demo-walk");
    await key("Escape");
    await key("h");
    await page.getByRole("button", { name: /^Filling cell/ }).click();
    await key("m");
    await shot("demo-handles-move");
    await page.getByRole("button", { name: /^Control cabinet 1/ }).click();
    await key("s");
    await shot("demo-handles-resize-small");
    await key("v");
    await deselect();

    await page.getByTestId("scene-file-input").setInputFiles(join(work, "scenes", "industrial-demo-plus-15.json"));
    await ready(page, 30);
    await page.getByRole("button", { name: /^Infeed conveyor/ }).click();
    await page.getByTestId("field-width").fill("3.6");
    await page.getByTestId("field-width").press("Enter");
    await deselect();
    await key("h");
    await shot("edited-orbit");
    await key("2");
    await shot("edited-top");
    await key("3");
    await shot("edited-walk");
    await key("Escape");
    await page.getByRole("button", { name: /^Infeed conveyor/ }).click();
    await key("h");
    await shot("edited-selected-stretched");
    await deselect();

    // The edited layout has unsaved changes; discard them when opening the next file.
    await page.getByTestId("scene-file-input").setInputFiles(join(work, "scenes", "industrial-demo-plus-105.json"));
    await page.getByTestId("unsaved-dialog").getByRole("button", { name: "Discard changes" }).click();
    await ready(page, 120);
    await key("h");
    await shot("large-orbit");
    await key("2");
    await shot("large-top");
    await context.close();
  }
  await browser.close();
  stopServers();
}

await main().catch((error: unknown) => {
  console.error(error);
  stopServers();
  process.exit(1);
});
