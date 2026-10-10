// WRL-04: regressions for the defects found by the performance and visual review.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const demoText = readFileSync(new URL("../../../fixtures/scenes/industrial-demo.json", import.meta.url), "utf8");

async function openDemo(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("scene-status")).toHaveText("Scene loaded · 15 objects");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-models", "4/4 ready, 0 failed");
}

const camera = async (page: Page) =>
  JSON.parse((await page.getByTestId("viewport").getAttribute("data-camera")) ?? "null") as { mode: string; pixelsPerMetre: number | null } | null;

test("renders nothing while the scene is idle, and renders again on interaction", { tag: "@smoke" }, async ({ page }) => {
  // Count WebGL renders through the hook three.js offers developer tools.
  await page.addInitScript(() => {
    const page = window as unknown as { __renders: number; __THREE_DEVTOOLS__: EventTarget };
    page.__renders = 0;
    const hook = new EventTarget();
    hook.addEventListener("observe", (event) => {
      const renderer = (event as CustomEvent<{ isWebGLRenderer?: boolean; render: (...args: unknown[]) => void }>).detail;
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (...args: unknown[]) => {
        page.__renders++;
        render(...args);
      };
    });
    page.__THREE_DEVTOOLS__ = hook;
  });
  await openDemo(page);
  const renders = () => page.evaluate(() => (window as unknown as { __renders: number }).__renders);
  await page.waitForTimeout(1500); // let the first frames and any settling finish
  const before = await renders();
  await page.waitForTimeout(1500);
  expect(await renders()).toBe(before); // continuous rendering used to redraw ~120 times a second

  const box = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A few pointer moves suffice: each one renders, and orbit damping keeps rendering after it.
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(renders).toBeGreaterThan(before + 5);
});

test("frames a newly opened document afresh even when it has the same project ID", async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press("2");
  await expect.poll(async () => (await camera(page))?.mode).toBe("top");
  await expect.poll(async () => (await camera(page))?.pixelsPerMetre ?? null).not.toBeNull();
  const demoScale = (await camera(page))!.pixelsPerMetre!;

  // The same project, saved with a floor four times as deep: the plan must show all of it.
  const doc = JSON.parse(demoText) as { scene: { objects: { id: string; transform: { position_m: { z: number } }; dimensions: { depth: { value_m: number } } }[] } };
  const floor = doc.scene.objects.find((o) => o.id === "obj-floor")!;
  floor.dimensions.depth.value_m = 60;
  floor.transform.position_m.z = 22.5;
  await page.getByTestId("scene-file-input").setInputFiles({ name: "deeper.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.getByTestId("scene-source")).toHaveText("deeper.json (accepted by API)");
  // Before the fix the top view reused the previous document's framing (same scale).
  await expect.poll(async () => (await camera(page))?.pixelsPerMetre ?? Number.POSITIVE_INFINITY).toBeLessThan(demoScale * 0.5);
});

test("keeps the resize handles of a small, distant object apart", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: /^Control cabinet 1/ }).click();
  await page.keyboard.press("s");
  let points: Record<string, [number, number]> = {};
  await expect
    .poll(async () => {
      const probe = JSON.parse((await page.getByTestId("viewport").getAttribute("data-handles")) ?? "null") as { tool: string; points: Record<string, [number, number]> } | null;
      points = probe?.tool === "resize" ? probe.points : {};
      return Object.keys(points).length;
    })
    .toBe(5);
  const knobs = Object.values(points);
  const closest = Math.min(...knobs.flatMap((a, i) => knobs.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
  // The 0.8 m cabinet is about 20 px wide in the overview; its knobs used to overlap.
  expect(closest).toBeGreaterThan(18);
});

test.describe("at a 1280 × 800 window", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the top bar fits on one line and the toolbar does not cover the data banner", async ({ page }) => {
    await openDemo(page);
    const bar = page.locator(".topbar");
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const button of await bar.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeLessThan(40);
    expect((await page.getByTestId("project-name").boundingBox())!.width).toBeGreaterThan(120);

    const banner = (await page.getByTestId("fixture-banner").boundingBox())!;
    const toolbar = (await page.getByRole("toolbar", { name: "Camera" }).boundingBox())!;
    const overlaps = banner.x < toolbar.x + toolbar.width && toolbar.x < banner.x + banner.width && banner.y < toolbar.y + toolbar.height && toolbar.y < banner.y + banner.height;
    expect(overlaps).toBe(false);
  });
});
